import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type DgUtterance = { start: number; end: number; transcript: string };
type DgBody = {
  results?: {
    utterances?: DgUtterance[];
    channels?: { alternatives?: { transcript?: string }[] }[];
  };
  metadata?: { duration?: number };
};
type SegmentRow = {
  job_id: string;
  track_id: string;
  campaign_id: string;
  character_id: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
};
type Track = { id: string; job_id: string; campaign_id: string; character_id: string | null };

type Admin = ReturnType<typeof createAdminClient>;

// Decide the job's fate once every track has resolved. A track that transcribed
// but produced no speech is "done", not an error, so a quiet player never sinks
// the session. The job only errors when there is genuinely nothing to review,
// and then it records why. Returns the status it set, or undefined if still
// waiting on other tracks.
async function finalizeJob(admin: Admin, jobId: string): Promise<string | undefined> {
  const { data: tracks } = await admin
    .from("audio_tracks")
    .select("status")
    .eq("job_id", jobId);
  const all = (tracks as { status: string }[]) || [];

  // still waiting on at least one track — let that track's callback finalize.
  if (all.some((t) => t.status === "pending" || t.status === "transcribing")) return undefined;

  const { count } = await admin
    .from("transcript_segments")
    .select("*", { count: "exact", head: true })
    .eq("job_id", jobId);
  const segments = count || 0;
  const errored = all.filter((t) => t.status === "error").length;

  let status: string;
  let error: string | null = null;
  if (segments > 0) {
    // at least one player produced a transcript — proceed, even if others were
    // empty or failed.
    status = "extracting";
  } else if (errored === all.length && all.length > 0) {
    status = "error";
    error = "All tracks failed to transcribe.";
  } else {
    status = "error";
    error = "No speech detected in any track. Check mic levels and re-record.";
  }

  await admin.from("capture_jobs").update({ status, error }).eq("id", jobId);
  return status;
}

// Best-effort server-side extraction head start. If it doesn't complete, the
// Review page's auto-start finishes the job.
function kickExtraction(req: NextRequest, jobId: string) {
  const secret = process.env.TRANSCRIBE_CALLBACK_SECRET;
  if (!secret) return;
  const base = process.env.TRANSCRIBE_CALLBACK_BASE || req.nextUrl.origin;
  const url = `${base}/api/extract/run?job=${encodeURIComponent(jobId)}&k=${encodeURIComponent(secret)}`;
  void fetch(url, { method: "POST" }).catch(() => {});
}

export async function POST(req: NextRequest) {
  const trackId = req.nextUrl.searchParams.get("track");
  const k = req.nextUrl.searchParams.get("k");
  if (!trackId || k !== process.env.TRANSCRIBE_CALLBACK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: trackRow } = await admin
    .from("audio_tracks")
    .select("id, job_id, campaign_id, character_id")
    .eq("id", trackId)
    .single();
  if (!trackRow) return NextResponse.json({ error: "unknown track" }, { status: 404 });
  const t = trackRow as Track;

  // Mark a track failed, then re-check the job. Return 200 so Deepgram doesn't
  // retry; the failure is captured in the track + job state, not the HTTP code.
  async function failTrack(): Promise<NextResponse> {
    await admin.from("audio_tracks").update({ status: "error" }).eq("id", t.id);
    const status = await finalizeJob(admin, t.job_id);
    if (status === "extracting") kickExtraction(req, t.job_id);
    return NextResponse.json({ ok: true });
  }

  let body: DgBody;
  try {
    body = (await req.json()) as DgBody;
  } catch {
    return failTrack();
  }

  // Build segment rows from utterances, falling back to the whole-channel transcript.
  const utterances = body.results?.utterances || [];
  let rows: SegmentRow[] = [];
  if (utterances.length) {
    rows = utterances
      .filter((u) => (u.transcript || "").trim().length > 0)
      .map((u) => ({
        job_id: t.job_id,
        track_id: t.id,
        campaign_id: t.campaign_id,
        character_id: t.character_id,
        start_ms: Math.round((u.start || 0) * 1000),
        end_ms: Math.round((u.end || 0) * 1000),
        text: u.transcript.trim(),
      }));
  } else {
    const whole = body.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
    if (whole) {
      rows = [{
        job_id: t.job_id,
        track_id: t.id,
        campaign_id: t.campaign_id,
        character_id: t.character_id,
        start_ms: 0,
        end_ms: Math.round((body.metadata?.duration || 0) * 1000),
        text: whole,
      }];
    }
  }

  // Insert is checked: a silent DB failure must not masquerade as success.
  if (rows.length) {
    const { error: insErr } = await admin.from("transcript_segments").insert(rows);
    if (insErr) return failTrack();
  }

  // Empty-but-valid (no speech) is "done", not an error. Only real failures above
  // mark a track error.
  await admin.from("audio_tracks").update({ status: "done" }).eq("id", t.id);
  const status = await finalizeJob(admin, t.job_id);
  if (status === "extracting") kickExtraction(req, t.job_id);

  return NextResponse.json({ ok: true });
}
