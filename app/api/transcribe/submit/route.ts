import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
  // an auth branch rather than a bypass: automation may skip the GM's cookie, but it
  // does not get to skip consent. session_consent_ok is a pure function of the session,
  // so it evaluates identically from either client.
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

  // Hard consent gate, server-side, for BOTH callers. A forced status flip cannot get
  // past this, and neither can the cron.
  const { data: ok } = await admin.rpc("session_consent_ok", { p_session: job.session_id });
  if (!ok) {
    // Park the job rather than letting the cron retry it every minute forever. The GM
    // sees 'blocked_consent' on the Capture page, which is the actual problem: somebody
    // at that table has not consented and has not been opted out.
    await admin
      .from("capture_jobs")
      .update({ status: "blocked_consent", error: "Consent is not cleared for this session." })
      .eq("id", jobId)
      .eq("status", "draft");
    return NextResponse.json({ error: "Consent is not cleared for this session." }, { status: 409 });
  }

  const dgKey = process.env.DEEPGRAM_API_KEY;
  const secret = process.env.TRANSCRIBE_CALLBACK_SECRET;
  if (!dgKey || !secret) {
    return NextResponse.json({ error: "Server is missing transcription configuration." }, { status: 500 });
  }

  // Per-session opt-out: characters the GM excluded from THIS session. Their
  // audio must never be transcribed, so we drop their tracks before submitting.
  const { data: outs } = await admin
    .from("recording_consents")
    .select("character_id")
    .eq("session_id", job.session_id)
    .eq("consented", false);
  const optedOut = new Set(
    ((outs as { character_id: string | null }[]) || [])
      .map((o) => o.character_id)
      .filter((v): v is string => v !== null)
  );

  const { data: tracks } = await admin
    .from("audio_tracks")
    .select("id, character_id, storage_path, status")
    .eq("job_id", jobId);

  const todo = ((tracks as { id: string; character_id: string | null; storage_path: string | null; status: string }[]) || [])
    .filter((t) => t.storage_path && t.status !== "done" && !(t.character_id && optedOut.has(t.character_id)));
  if (todo.length === 0) return NextResponse.json({ error: "No tracks to transcribe." }, { status: 409 });

  const base = process.env.TRANSCRIBE_CALLBACK_BASE || req.nextUrl.origin;
  let submitted = 0;

  for (const t of todo as { id: string; storage_path: string }[]) {
    const { data: signed } = await admin.storage.from("session-audio").createSignedUrl(t.storage_path, 7200);
    if (!signed?.signedUrl) continue;

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
    }
  }

  if (submitted === 0) {
    await admin.from("capture_jobs").update({ status: "error", error: "No tracks could be submitted." }).eq("id", jobId);
    return NextResponse.json({ error: "No tracks could be submitted to Deepgram." }, { status: 502 });
  }

  await admin.from("capture_jobs").update({ status: "transcribing", error: null }).eq("id", jobId);
  return NextResponse.json({ ok: true, submitted });
}
