import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// This route hands one signed URL per track to Deepgram. Six tracks means six sequential
// round trips, and the platform default cut the function off partway through: on
// 2026-07-18 a six-speaker job submitted two tracks and left four sitting at 'pending'
// with the job reporting success. Everything downstream then ran against a third of the
// session. The other routes in the /stop chain already set this; this one did not.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let jobId: string | undefined;
  try {
    const b = await req.json();
    jobId = b?.jobId;
  } catch {
    /* fall through to the missing-jobId guard */
  }
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  // TWO CALLERS NOW.
  //
  //  1. A GM, from the Capture page. Authorized through RLS: they can only read a job
  //     row for a campaign they run. Unchanged.
  //
  //  2. The auto-transcribe cron (/api/cron/advance-jobs), which closes the last manual
  //     gap in the /stop chain. A cron has no cookie, so RLS would return nothing and
  //     this route would 403 forever. It presents CRON_SECRET instead and reads the job
  //     with the admin client.
  //
  // THE CONSENT GATE SURVIVES BOTH PATHS. That is the entire reason this is written as
  // an auth branch rather than a bypass: automation may skip the GM's cookie, but it does
  // not get to skip consent. The gate below reads consent rows directly, so it evaluates
  // identically from either client.
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const isCron = Boolean(cronSecret) && auth === `Bearer ${cronSecret}`;

  const admin = createAdminClient();

  // A NAMED type, not `typeof job`. Inside the assignment, `typeof job` resolves to the
  // NARROWED type at that point, which after `let job: T | null = null` is just `null`.
  // Casting to it throws the real shape away, and `job` then narrows to `never` past the
  // null check. Which is exactly what the build was telling us.
  type Job = { id: string; campaign_id: string; session_id: string };
  let job: Job | null = null;

  if (isCron) {
    const { data } = await admin
      .from("capture_jobs")
      .select("id, campaign_id, session_id")
      .eq("id", jobId)
      .single();
    job = (data as Job | null) ?? null;
  } else {
    // Authorize via RLS: only the campaign GM can read this job row.
    const supa = await createClient();
    const { data } = await supa
      .from("capture_jobs")
      .select("id, campaign_id, session_id")
      .eq("id", jobId)
      .single();
    job = (data as Job | null) ?? null;
  }
  if (!job) return NextResponse.json({ error: "Not found or not permitted" }, { status: 403 });

  // CONSENT IS NOW PER TRACK, NOT PER SESSION.
  //
  // This used to call session_consent_ok, which was all-or-nothing: unless EVERY attendee
  // had consented, the whole job was parked and nobody's audio was transcribed. It had two
  // failure modes that both showed up in practice.
  //
  //   1. One un-consented player blocked the entire table.
  //   2. The function starts from ATTENDANCE rows, so a session with no attendance marked
  //      produced an empty "present" set and returned false. A GM who never used the
  //      attendance feature could never transcribe anything, and nothing in the Discord
  //      flow said so: /stop reported success and the job silently parked.
  //
  // Discord records one stream per microphone, so consent can be enforced per speaker with
  // no bleed between them. A track is transcribed only if its character holds standing
  // consent and was not opted out of this session. Everything else is dropped from the
  // submission and never reaches Deepgram.
  //
  // The job is parked only when NOTHING is consented, which is the genuine "nothing to do"
  // case rather than a partial one.
  //
  // The sidecar now enforces the same rule earlier, at finalize, so un-consented audio is
  // never uploaded at all. This is the second gate, and it is the only gate on the manual
  // upload path where a GM adds tracks by hand from the Capture page.

  const dgKey = process.env.DEEPGRAM_API_KEY;
  const secret = process.env.TRANSCRIBE_CALLBACK_SECRET;
  if (!dgKey || !secret) {
    return NextResponse.json({ error: "Server is missing transcription configuration." }, { status: 500 });
  }

  // Standing (campaign-wide) consent, given when a player claims their character. These
  // are the same two queries session_consent_ok ran internally, so the rule is unchanged;
  // only its GRANULARITY is.
  const { data: blanket, error: bErr } = await admin
    .from("recording_consents")
    .select("character_id")
    .eq("campaign_id", job.campaign_id)
    .is("session_id", null)
    .eq("consented", true);

  // Per-session opt-out: characters the GM excluded from THIS session.
  const { data: outs, error: oErr } = await admin
    .from("recording_consents")
    .select("character_id")
    .eq("session_id", job.session_id)
    .eq("consented", false);

  // Fail CLOSED. If either read errors we cannot tell who consented, and the safe answer
  // is to transcribe nobody rather than guess.
  if (bErr || oErr) {
    return NextResponse.json(
      { error: "Could not read consent for this session. Nothing was submitted." },
      { status: 500 },
    );
  }

  const consented = new Set(
    ((blanket as { character_id: string | null }[]) || [])
      .map((c) => c.character_id)
      .filter((v): v is string => v !== null)
  );
  const optedOut = new Set(
    ((outs as { character_id: string | null }[]) || [])
      .map((o) => o.character_id)
      .filter((v): v is string => v !== null)
  );

  const { data: tracks } = await admin
    .from("audio_tracks")
    .select("id, character_id, gm_identity_id, storage_path, status")
    .eq("job_id", jobId);

  type Track = {
    id: string;
    character_id: string | null;
    gm_identity_id: string | null;
    storage_path: string | null;
    status: string;
  };
  const all = (tracks as Track[]) || [];

  // The GM narrator track is exempt: running the recording is the operator's own act, and
  // a gm_identities row is linked deliberately and owner-gated. A player track needs
  // standing consent and no opt-out. A track attributed to NOBODY is not transcribed,
  // because there is no one whose consent could cover it.
  function allowed(t: Track): boolean {
    if (t.gm_identity_id) return true;
    if (!t.character_id) return false;
    return consented.has(t.character_id) && !optedOut.has(t.character_id);
  }

  const pending = all.filter((t) => t.storage_path && t.status !== "done");
  const todo = pending.filter(allowed);
  const withheld = pending.length - todo.length;

  if (todo.length === 0) {
    // Nothing consented at all. Park it so the cron stops retrying every minute and the
    // GM sees the real reason on the Capture page.
    if (pending.length > 0) {
      await admin
        .from("capture_jobs")
        .update({
          status: "blocked_consent",
          error: "No one in this recording has consented, so nothing can be transcribed.",
        })
        .eq("id", jobId)
        .eq("status", "draft");
      return NextResponse.json(
        { error: "No one in this recording has consented, so nothing can be transcribed.", withheld },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "No tracks to transcribe." }, { status: 409 });
  }

  const base = process.env.TRANSCRIBE_CALLBACK_BASE || req.nextUrl.origin;
  let submitted = 0;
  const failures: Array<{ track: string; reason: string }> = [];

  for (const t of todo as { id: string; storage_path: string }[]) {
    // EVERY iteration is isolated. Previously an exception anywhere in here escaped the
    // loop entirely (this handler has no outer try/catch around the submission), so one
    // bad track silently abandoned every track after it, and the failure surfaced as a
    // generic 500 with no record of which ones never went. A per-track catch means one
    // failure costs one track.
    try {
      const { data: signed, error: sErr } = await admin.storage
        .from("session-audio")
        .createSignedUrl(t.storage_path, 7200);

      if (!signed?.signedUrl) {
        // This used to be a bare `continue`: no log, no error, no trace. A track skipped
        // here looked identical to one that was never in the job.
        failures.push({ track: t.id, reason: sErr?.message ?? "could not sign the audio URL" });
        continue;
      }

      const cb = `${base}/api/transcribe/callback?track=${t.id}&k=${encodeURIComponent(secret)}`;
      const params = new URLSearchParams({
        model: "nova-3",
        smart_format: "true",
        punctuate: "true",
        utterances: "true",
        callback: cb,
      });

      const res = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
        method: "POST",
        headers: { Authorization: `Token ${dgKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: signed.signedUrl }),
      });

      if (res.ok) {
        submitted += 1;
        await admin.from("audio_tracks").update({ status: "transcribing" }).eq("id", t.id);
      } else {
        const detail = await res.text().catch(() => "");
        failures.push({ track: t.id, reason: `deepgram ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` });
      }
    } catch (e) {
      failures.push({ track: t.id, reason: e instanceof Error ? e.message : "submit threw" });
    }
  }

  if (submitted === 0) {
    await admin
      .from("capture_jobs")
      .update({ status: "error", error: `No tracks could be submitted. ${failures.map((f) => f.reason).join("; ")}`.slice(0, 500) })
      .eq("id", jobId);
    return NextResponse.json(
      { error: "No tracks could be submitted to Deepgram.", failures },
      { status: 502 },
    );
  }

  // A track that could not be submitted must NOT be left at 'pending'.
  //
  // finalizeJob() in /api/transcribe/callback returns early while any track is still
  // 'pending' or 'transcribing', and it only ever runs from a Deepgram callback. A track
  // that never reached Deepgram will never get a callback, so a single stuck 'pending' row
  // strands the whole job at 'transcribing' permanently: extraction never runs, and a
  // session's worth of good transcripts sits unused with nothing retrying it.
  //
  // Marking it 'error' resolves it as far as finalizeJob is concerned, so the job advances
  // on the tracks that did work. It does NOT block a retry: the pending filter above keeps
  // anything that is not 'done', so pressing Transcribe again picks these up.
  if (failures.length > 0) {
    await admin
      .from("audio_tracks")
      .update({ status: "error" })
      .in("id", failures.map((f) => f.track));
  }

  // A PARTIAL submission is not a success. The job still advances, because the tracks that
  // did go need their callbacks handled, but the leftovers stay 'pending' so a re-run picks
  // them up, and the count is recorded on the job so the Capture page shows the truth
  // rather than a green status over a third of a session.
  const leftBehind = todo.length - submitted;
  await admin
    .from("capture_jobs")
    .update({
      status: "transcribing",
      error: leftBehind > 0
        ? `${leftBehind} of ${todo.length} tracks did not submit. Press Transcribe again to retry them.`
        : null,
    })
    .eq("id", jobId);

  // withheld: dropped for consent, deliberately and permanently.
  // leftBehind: failed to submit, retryable.
  return NextResponse.json({ ok: true, submitted, withheld, leftBehind, failures });
}
