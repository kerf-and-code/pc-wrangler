import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Closes the last manual step in the /stop chain.
//
// THE CHAIN, BEFORE THIS:
//
//   /stop  ->  capture_control 'stopping'
//          ->  sidecar finalizes: uploads one ogg per speaker, inserts audio_tracks,
//              creates the capture_job as 'draft', then sets capture_control to 'done'
//              with capture_job_id
//          ->  [ GM HAS TO CLICK "Transcribe" ON THE CAPTURE PAGE ]   <- the gap
//          ->  Deepgram -> callback -> kickExtraction -> 'review'
//          ->  GM decides the last proposal -> auto-finalize -> recap drafted
//
// Everything downstream of that click was already automatic. This route is the click.
//
// THE SIGNAL, AND WHY IT IS SAFE.
//
// capture_control.status = 'done' WITH a capture_job_id is the LAST thing the sidecar's
// finalize() does, after every track is uploaded and every insert_track has returned.
// It is not a "probably finished" heuristic: it is the sidecar saying nothing more is
// coming. Kicking transcription on a half-uploaded session would silently drop whoever
// was still being written, so the guard matters.
//
// A second guard belt-and-braces: the job must still be 'draft' and must have at least
// one track with a storage_path. A job with no audio has nothing to transcribe, and a
// job already past 'draft' is somebody else's problem.
//
// IDEMPOTENT AND SELF-HEALING. submit() moves the job to 'transcribing', so a job is
// only ever picked up once. If a submit fails, the job stays 'draft' and the next run
// retries it. If consent is not cleared, submit parks the job at 'blocked_consent' so it
// stops being retried every minute and the GM sees the real reason on the Capture page.
//
// WHY THE SCAN STARTS FROM JOBS, NOT FROM capture_control.
//
// It used to read the OLDEST 20 capture_control rows and look up their jobs. That works
// until the history of finished recordings passes 20, and then it silently stops working
// forever: every past recording sorts ahead of the newest one, so a fresh job never enters
// the window and never auto-transcribes. It failed exactly that way on 2026-07-18. Sorting
// the other way only moves the blind spot, because then an older job that needs a retry
// falls off the end instead.
//
// Scanning capture_jobs at 'draft' removes the blind spot rather than relocating it: that
// set is bounded by outstanding WORK, not by accumulated history, and it is naturally
// small. The capture_control lookup stays, but as a GUARD rather than the driver, which is
// the role it was always right for: a 'done' row with a capture_job_id is the sidecar
// saying every track is uploaded.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Jobs still waiting. Anything past 'draft' is already moving.
  const { data: jobs, error: jErr } = await admin
    .from("capture_jobs")
    .select("id, campaign_id, session_id, status")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(50);

  if (jErr) {
    return NextResponse.json({ error: jErr.message, stage: "scan" }, { status: 500 });
  }

  const draft = (jobs as Array<{ id: string; session_id: string }>) || [];
  if (draft.length === 0) {
    return NextResponse.json({ ok: true, ready: 0, submitted: 0 });
  }

  // The guard: the sidecar must have FINISHED with this job. 'done' with a capture_job_id
  // is the last thing finalize() writes, after every upload and every insert_track has
  // returned, so it is the sidecar saying nothing more is coming. A job with no control row
  // at all is a manual upload from the Capture page, which the GM submits by hand and this
  // route deliberately leaves alone.
  const { data: controls, error: cErr } = await admin
    .from("capture_control")
    .select("capture_job_id, status")
    .in("capture_job_id", draft.map((j) => j.id))
    .eq("status", "done");

  if (cErr) {
    return NextResponse.json({ error: cErr.message, stage: "control" }, { status: 500 });
  }

  const finalized = new Set(
    ((controls as Array<{ capture_job_id: string | null }>) || [])
      .map((c) => c.capture_job_id)
      .filter((v): v is string => v !== null),
  );

  const finishedJobs = draft.filter((j) => finalized.has(j.id));
  if (finishedJobs.length === 0) {
    return NextResponse.json({
      ok: true,
      ready: 0,
      submitted: 0,
      // Draft jobs the sidecar has not finished with, or manual uploads awaiting the GM.
      awaitingSidecar: draft.map((j) => j.id),
    });
  }

  // A job with no uploaded audio has nothing to transcribe. Submitting it would flip it
  // to 'transcribing' and strand it there.
  const { data: tracks } = await admin
    .from("audio_tracks")
    .select("job_id, storage_path")
    .in("job_id", finishedJobs.map((j) => j.id));

  const withAudio = new Set(
    ((tracks as Array<{ job_id: string; storage_path: string | null }>) || [])
      .filter((t) => t.storage_path)
      .map((t) => t.job_id),
  );

  const ready = finishedJobs.filter((j) => withAudio.has(j.id));

  const base = new URL(request.url).origin;
  const results: Array<{ job: string; ok: boolean; detail?: string }> = [];

  for (const j of ready) {
    try {
      const res = await fetch(`${base}/api/transcribe/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The cron path. submit() checks this, reads the job with the admin client,
          // and STILL enforces the consent gate. Automation skips the cookie, not consent.
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ jobId: j.id }),
      });
      const out = await res.json().catch(() => ({}));
      results.push({
        job: j.id,
        ok: res.ok,
        detail: res.ok ? undefined : (out?.error ?? `http ${res.status}`),
      });
    } catch (e) {
      results.push({ job: j.id, ok: false, detail: e instanceof Error ? e.message : "fetch failed" });
    }
  }

  return NextResponse.json({
    ok: results.every((r) => r.ok),
    ready: ready.length,
    submitted: results.filter((r) => r.ok).length,
    // A job with no audio is not an error, but it should be visible rather than silently
    // skipped forever.
    noAudio: finishedJobs.filter((j) => !withAudio.has(j.id)).map((j) => j.id),
    // Draft jobs the sidecar has not finished with yet, plus manual uploads that are
    // waiting on the GM. Also not errors, also worth seeing.
    awaitingSidecar: draft.filter((j) => !finalized.has(j.id)).map((j) => j.id),
    results,
  });
}
