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
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Recordings the sidecar has finished with.
  const { data: finished, error: cErr } = await admin
    .from("capture_control")
    .select("id, campaign_id, capture_job_id, updated_at")
    .eq("status", "done")
    .not("capture_job_id", "is", null)
    .order("updated_at", { ascending: true })
    .limit(20);

  if (cErr) {
    return NextResponse.json({ error: cErr.message, stage: "scan" }, { status: 500 });
  }
  if (!finished || finished.length === 0) {
    return NextResponse.json({ ok: true, ready: 0, submitted: 0 });
  }

  const jobIds = [...new Set(finished.map((r) => r.capture_job_id as string))];

  // Only jobs still waiting. Anything past 'draft' is already moving.
  const { data: jobs } = await admin
    .from("capture_jobs")
    .select("id, campaign_id, session_id, status")
    .in("id", jobIds)
    .eq("status", "draft");

  const draft = (jobs as Array<{ id: string; session_id: string }>) || [];
  if (draft.length === 0) {
    return NextResponse.json({ ok: true, ready: 0, submitted: 0 });
  }

  // A job with no uploaded audio has nothing to transcribe. Submitting it would flip it
  // to 'transcribing' and strand it there.
  const { data: tracks } = await admin
    .from("audio_tracks")
    .select("job_id, storage_path")
    .in("job_id", draft.map((j) => j.id));

  const withAudio = new Set(
    ((tracks as Array<{ job_id: string; storage_path: string | null }>) || [])
      .filter((t) => t.storage_path)
      .map((t) => t.job_id),
  );

  const ready = draft.filter((j) => withAudio.has(j.id));

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
    noAudio: draft.filter((j) => !withAudio.has(j.id)).map((j) => j.id),
    results,
  });
}
