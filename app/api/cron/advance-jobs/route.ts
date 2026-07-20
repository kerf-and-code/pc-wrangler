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

  // SWEEP: jobs stranded at 'transcribing'.
  //
  // finalizeJob() lives in the Deepgram callback and only runs when a callback arrives. If
  // the last callback for a job fires while another track is still 'pending' (because it
  // never reached Deepgram), nothing will ever re-evaluate that job. It sits at
  // 'transcribing' forever, and no amount of pressing Transcribe helps, because that route
  // submits tracks rather than advancing jobs.
  //
  // This sweep is the safety net: any job at 'transcribing' whose tracks have ALL resolved
  // gets the same decision finalizeJob would have made. The logic is deliberately kept in
  // step with the canonical copy in /api/transcribe/callback: segments present means
  // proceed to extraction, no segments at all means the recording produced nothing.
  const { data: stalledJobs } = await admin
    .from("capture_jobs")
    .select("id")
    .eq("status", "transcribing")
    .order("created_at", { ascending: false })
    .limit(20);

  const swept: Array<{ job: string; status: string }> = [];
  for (const sj of (stalledJobs as Array<{ id: string }>) || []) {
    const { data: trk } = await admin
      .from("audio_tracks")
      .select("status")
      .eq("job_id", sj.id);
    const trackRows = (trk as Array<{ status: string }>) || [];
    if (trackRows.length === 0) continue;
    if (trackRows.some((t) => t.status === "pending" || t.status === "transcribing")) continue;

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
    // Vercel logs the status code, NOT the response body, so a route that only returns
    // JSON is invisible in the dashboard: every run reads 200 with no detail. On
    // 2026-07-20 a job sat unsubmitted overnight while this cron ran 750 times, and the
    // logs could not say whether it had been seen and skipped or never seen at all.
    // These console.log lines are the difference between one line in the dashboard and
    // an afternoon of guessing.
    console.log("[advance-jobs] no draft jobs (swept %d stranded)", swept.length);
    return NextResponse.json({ ok: true, ready: 0, submitted: 0, swept });
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
    // Draft jobs exist but none has a finished capture_control row. Either the sidecar is
    // still finalizing, or these are manual uploads awaiting the GM. Naming the ids here
    // is what distinguishes "seen and correctly skipped" from "never seen".
    console.log(
      "[advance-jobs] %d draft job(s), none finalized by the sidecar: %s",
      draft.length,
      draft.map((j) => j.id).join(", "),
    );
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
  console.log(
    "[advance-jobs] draft=%d finalized=%d withAudio=%d ready=%s",
    draft.length,
    finishedJobs.length,
    ready.length,
    ready.map((j) => j.id).join(", ") || "(none)",
  );

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
