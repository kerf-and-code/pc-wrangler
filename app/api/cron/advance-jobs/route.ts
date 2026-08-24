import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Closes the last manual step in the /stop chain, and is the safety net that keeps a fully
// recorded session from silently stranding.
//
// THE CHAIN, BEFORE THIS:
//
//   /stop  ->  capture_control 'stopping'
//          ->  sidecar finalizes: uploads one ogg per speaker, inserts audio_tracks,
//              creates the capture_job as 'draft', then sets capture_control to 'done'
//              with capture_job_id
//          ->  [ GM HAS TO CLICK "Transcribe" ON THE CAPTURE PAGE ]   <- the gap this closes
//          ->  Deepgram -> callback -> kickExtraction -> 'review'
//          ->  GM decides the last proposal -> auto-finalize -> recap drafted
//
// WHY THE DRAFT-SUBMIT PHASE RUNS FIRST (2026-08-23).
//
// Getting complete sessions transcribed is this route's PRIMARY job. Recovering stranded
// 'transcribing' jobs and kicking idle extraction are secondary. They used to run first, and
// because the stranded-track sweep does AWAITED submit() calls in a loop, a backlog of stranded
// jobs could consume the whole 60s function budget before the draft phase was ever reached - so a
// brand-new, fully-uploaded session sat at 'draft' indefinitely with no error anywhere. That is
// exactly how a Sunday Candlekeep session (2026-08-23) and an older one (2026-08-16) stranded:
// their tracks fell back to Deepgram (too long to trim -> Groq skipped them), which put them in
// this phase, and this phase never ran. Groq-inline sessions self-advance in the sidecar, so the
// failure was invisible until a Deepgram-fallback recap came up short.
//
// So: draft-submit first (fresh budget, always runs), then the sweeps under a time guard.
//
// WHY A DRAFT JOB IS "READY", AND THE AGED-AUDIO FALLBACK.
//
// The canonical signal is a capture_control row at 'done' WITH this capture_job_id: the last thing
// the sidecar's finalize() writes, after every upload and insert_track returns. But that marker is
// set through a PATCH that fails silently, and depending on one fragile signal is what let whole
// sessions vanish. So a job is ALSO ready if every uploaded track has audio and the newest track is
// older than STALE_DRAFT_MIN minutes - the age proves the sidecar is not mid-upload. A marked job
// submits immediately; an unmarked one submits after a short quiet period. Either way a complete
// session cannot sit at 'draft' forever.
//
// A job with no control row at all AND no aged audio is a manual upload the GM submits by hand, or
// a session still finalizing; both are left alone and reported as awaitingSidecar.
//
// IDEMPOTENT AND SELF-HEALING. submit() moves a job to 'transcribing', so each job is picked up
// once. A failed submit leaves it 'draft' for the next run. If nothing is consented, submit parks
// the job at 'blocked_consent' so it stops being retried and the GM sees the reason.

const STALE_DRAFT_MIN = 5;                       // a draft job whose newest track is older than this,
const STALE_DRAFT_MS = STALE_DRAFT_MIN * 60_000; // and which has audio, is submitted even with no marker
const SWEEP_BUDGET_MS = 45_000;                  // stop sweeping past this so nothing downstream starves

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const startedAt = Date.now();

  // THE INTERNAL BASE MUST BE THE STABLE PUBLIC ORIGIN, NOT request.url. (root cause, 2026-08-24)
  //
  // Vercel fires this cron against the deployment's IMMUTABLE URL (pc-wrangler-<hash>.vercel.app),
  // which sits behind Deployment Protection. Using new URL(request.url).origin as the base made every
  // internal call below - /api/transcribe/submit and /api/extract/run - target that protected URL, so
  // Vercel's auth wall bounced them (a ~20ms redirect, never reaching the route). The cron still returned
  // 200 because it only records the submit failure internally, so the dashboard looked perfectly healthy
  // while Deepgram-fallback drafts stranded forever. Deepgram callbacks, the Capture page's Transcribe
  // button, and manual curls all hit the public production domain, which is why those paths always worked
  // and only cron-dependent sessions vanished. So: use the same public base Deepgram callbacks use
  // (TRANSCRIBE_CALLBACK_BASE), then the site URL, and only fall back to the request origin if neither is
  // set. Trailing slash trimmed so `${base}/api/...` never double-slashes.
  const base = (process.env.TRANSCRIBE_CALLBACK_BASE || process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");

  // ==========================================================================================
  // PHASE 1 - DRAFT SUBMIT (primary; runs first so it can never be starved by the sweeps).
  // ==========================================================================================

  const { data: draftJobs, error: jErr } = await admin
    .from("capture_jobs")
    .select("id, campaign_id, session_id, status")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(50);

  if (jErr) {
    return NextResponse.json({ error: jErr.message, stage: "scan" }, { status: 500 });
  }

  const draft = (draftJobs as Array<{ id: string; session_id: string }>) || [];
  const submitResults: Array<{ job: string; ok: boolean; detail?: string }> = [];
  const draftFinalized: Array<{ job: string; status: string }> = [];
  const awaitingSidecar: string[] = [];
  const noAudio: string[] = [];

  if (draft.length > 0) {
    const draftIds = draft.map((j) => j.id);

    // The canonical "sidecar finished" markers.
    const { data: controls, error: cErr } = await admin
      .from("capture_control")
      .select("capture_job_id, status")
      .in("capture_job_id", draftIds)
      .eq("status", "done");
    if (cErr) {
      return NextResponse.json({ error: cErr.message, stage: "control" }, { status: 500 });
    }
    const marked = new Set(
      ((controls as Array<{ capture_job_id: string | null }>) || [])
        .map((c) => c.capture_job_id)
        .filter((v): v is string => v !== null),
    );

    // Tracks for every draft job, so we can tell "has audio" and "newest track age" for the
    // aged-audio fallback. created_at is what dates the fallback.
    const { data: trackRows, error: tErr } = await admin
      .from("audio_tracks")
      .select("job_id, storage_path, created_at, status")
      .in("job_id", draftIds);
    if (tErr) {
      return NextResponse.json({ error: tErr.message, stage: "tracks" }, { status: 500 });
    }
    const tracks = (trackRows as Array<{ job_id: string; storage_path: string | null; created_at: string; status: string }>) || [];

    // job_id -> newest track-with-audio timestamp (ms). Absent = no uploaded audio at all.
    const newestAudioAt = new Map<string, number>();
    // job_id -> count of SUBMITTABLE tracks (has audio, not yet 'done'). Zero-with-audio means every
    // track already transcribed, so submit() would 409 "No tracks to transcribe" and the job would sit
    // at 'draft' forever - it needs finalizing (-> extracting/error), not submitting.
    const submittableCount = new Map<string, number>();
    for (const t of tracks) {
      if (!t.storage_path) continue;
      const ts = Date.parse(t.created_at);
      if (!Number.isNaN(ts)) {
        const prev = newestAudioAt.get(t.job_id) ?? 0;
        if (ts > prev) newestAudioAt.set(t.job_id, ts);
      }
      if (t.status !== "done") submittableCount.set(t.job_id, (submittableCount.get(t.job_id) ?? 0) + 1);
    }

    const now = Date.now();
    const ready: string[] = [];      // ready + has submittable tracks -> submit()
    const readyDone: string[] = [];  // ready but every track already 'done' -> finalize, don't submit
    for (const j of draft) {
      const newest = newestAudioAt.get(j.id);
      if (newest === undefined) {
        // No uploaded audio yet. Either mid-finalize or a job that produced nothing.
        noAudio.push(j.id);
        continue;
      }
      const hasMarker = marked.has(j.id);
      const aged = now - newest > STALE_DRAFT_MS;
      if (!(hasMarker || aged)) { awaitingSidecar.push(j.id); continue; } // too fresh + unmarked: wait
      if ((submittableCount.get(j.id) ?? 0) > 0) ready.push(j.id);
      else readyDone.push(j.id); // all tracks transcribed but job never left 'draft': finalize it
    }

    console.log(
      "[advance-jobs] draft=%d marked=%d ready=%d readyDone=%d noAudio=%d awaiting=%d readyIds=%s",
      draft.length, marked.size, ready.length, readyDone.length, noAudio.length, awaitingSidecar.length,
      ready.join(", ") || "(none)",
    );

    for (const jobId of ready) {
      try {
        const res = await fetch(`${base}/api/transcribe/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ jobId }),
        });
        const out = await res.json().catch(() => ({}));
        submitResults.push({ job: jobId, ok: res.ok, detail: res.ok ? undefined : (out?.error ?? `http ${res.status}`) });
      } catch (e) {
        submitResults.push({ job: jobId, ok: false, detail: e instanceof Error ? e.message : "fetch failed" });
      }
    }

    // Finalize draft jobs whose tracks are ALL 'done' (submit is a no-op for them). This is the same
    // decision the Phase 2 sweep makes for stranded 'transcribing' jobs: extracting if there are
    // segments, else error. Guarded on status='draft' so it can't race a concurrent transition.
    for (const jobId of readyDone) {
      const { count } = await admin
        .from("transcript_segments")
        .select("*", { count: "exact", head: true })
        .eq("job_id", jobId);
      const nextStatus = (count || 0) > 0 ? "extracting" : "error";
      const nextError = nextStatus === "error"
        ? "No speech detected in any track. Check mic levels and re-record."
        : null;
      await admin
        .from("capture_jobs")
        .update({ status: nextStatus, error: nextError })
        .eq("id", jobId)
        .eq("status", "draft");
      console.log("[advance-jobs] finalized done-track draft %s -> %s (%d segments)", jobId, nextStatus, count || 0);
      draftFinalized.push({ job: jobId, status: nextStatus });
    }
  }

  // ==========================================================================================
  // PHASE 2 - SWEEP jobs stranded at 'transcribing' (secondary; time-guarded).
  //
  // finalizeJob() lives in the Deepgram callback and only runs when a callback arrives. If the last
  // callback for a job fires while another track is still 'pending' (it never reached Deepgram),
  // nothing re-evaluates the job and it sits at 'transcribing' forever. This resubmits a stranded
  // pending track, and otherwise makes the decision finalizeJob would have made.
  //
  // Bounded by SWEEP_BUDGET_MS: draft-submit already ran, but this loop does awaited submit() calls,
  // and a large backlog must never eat so much of the window that Phase 3 cannot run.
  // ==========================================================================================

  const swept: Array<{ job: string; status: string }> = [];
  const resubmitted: Array<{ job: string; ok: boolean; detail?: string }> = [];
  let sweepTruncated = false;

  const { data: stalledJobs } = await admin
    .from("capture_jobs")
    .select("id")
    .eq("status", "transcribing")
    .order("created_at", { ascending: false })
    .limit(20);

  for (const sj of (stalledJobs as Array<{ id: string }>) || []) {
    if (Date.now() - startedAt > SWEEP_BUDGET_MS) { sweepTruncated = true; break; }

    const { data: trk } = await admin
      .from("audio_tracks")
      .select("status, storage_path")
      .eq("job_id", sj.id);
    const rows = (trk as Array<{ status: string; storage_path: string | null }>) || [];
    if (rows.length === 0) continue;

    // A track still 'transcribing' is genuinely in flight; resubmitting would double-process it.
    if (rows.some((t) => t.status === "transcribing")) continue;

    // A 'pending' track WITH audio never got submitted. Resubmit the job: submit()'s pending filter
    // sends exactly the not-'done' tracks, unsticking the job. Nothing is 'transcribing' here, so
    // there is no in-flight track to double-send.
    const stuckPending = rows.filter((t) => t.status === "pending" && t.storage_path);
    if (stuckPending.length > 0) {
      try {
        const res = await fetch(`${base}/api/transcribe/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ jobId: sj.id }),
        });
        const out = await res.json().catch(() => ({}));
        resubmitted.push({ job: sj.id, ok: res.ok, detail: res.ok ? undefined : (out?.error ?? `http ${res.status}`) });
        console.log("[advance-jobs] resubmitted %d stranded pending track(s) on job %s (ok=%s)",
          stuckPending.length, sj.id, res.ok);
      } catch (e) {
        resubmitted.push({ job: sj.id, ok: false, detail: e instanceof Error ? e.message : "resubmit failed" });
      }
      continue;
    }

    // Every track resolved (done/error), but the last callback fired while another was still
    // pending, so finalizeJob never ran. Make the decision it would have.
    const { count } = await admin
      .from("transcript_segments")
      .select("*", { count: "exact", head: true })
      .eq("job_id", sj.id);

    const nextStatus = (count || 0) > 0 ? "extracting" : "error";
    const nextError = nextStatus === "error"
      ? "No speech detected in any track. Check mic levels and re-record."
      : null;

    await admin
      .from("capture_jobs")
      .update({ status: nextStatus, error: nextError })
      .eq("id", sj.id)
      .eq("status", "transcribing");

    console.log("[advance-jobs] swept stranded job %s -> %s (%d segments)", sj.id, nextStatus, count || 0);
    swept.push({ job: sj.id, status: nextStatus });
  }

  // ==========================================================================================
  // PHASE 3 - kick extraction that never started.
  //
  // /api/extract/run is fired best-effort by the transcribe callback and chains itself until both
  // cursors reach their totals. If that FIRST kick never lands (callback failed, or a human moved a
  // job to 'extracting'), the job sits with both cursors at 0 and nothing running. Only jobs where
  // BOTH cursors are still 0 are kicked - a job partway through has a chain in flight, and a second
  // kick would double-propose. Cursor-at-zero is the one provably-safe state.
  // ==========================================================================================

  const kicked: string[] = [];
  const extractSecret = process.env.TRANSCRIBE_CALLBACK_SECRET;
  if (extractSecret) {
    const { data: idleExtract } = await admin
      .from("capture_jobs")
      .select("id, extract_cursor, gm_extract_cursor")
      .eq("status", "extracting")
      .order("created_at", { ascending: false })
      .limit(10);

    for (const ej of (idleExtract as Array<{ id: string; extract_cursor: number | null; gm_extract_cursor: number | null }>) || []) {
      if ((ej.extract_cursor || 0) !== 0 || (ej.gm_extract_cursor || 0) !== 0) continue;
      const url = `${base}/api/extract/run?job=${encodeURIComponent(ej.id)}&k=${encodeURIComponent(extractSecret)}`;
      void fetch(url, { method: "POST" }).catch(() => {});
      console.log("[advance-jobs] kicked idle extraction for job %s", ej.id);
      kicked.push(ej.id);
    }
  }

  const submitted = submitResults.filter((r) => r.ok).length;
  console.log(
    "[advance-jobs] done: submitted=%d finalized=%d swept=%d resubmitted=%d kicked=%d awaiting=%d noAudio=%d%s",
    submitted, draftFinalized.length, swept.length, resubmitted.length, kicked.length,
    awaitingSidecar.length, noAudio.length, sweepTruncated ? " (sweep truncated)" : "",
  );

  return NextResponse.json({
    ok: submitResults.every((r) => r.ok),
    ready: submitResults.length,
    submitted,
    results: submitResults,
    // Draft jobs whose tracks were all already transcribed; advanced past 'draft' here.
    draftFinalized,
    swept,
    resubmitted,
    kicked,
    sweepTruncated,
    // Draft jobs with uploaded audio that are too fresh to submit yet, plus manual uploads awaiting
    // the GM. Not errors, but visible instead of hidden forever.
    awaitingSidecar,
    // Draft jobs the sidecar finished with but that produced no uploaded audio.
    noAudio,
  });
}
