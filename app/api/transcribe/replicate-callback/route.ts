import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// app/api/transcribe/replicate-callback/route.ts
//
// The webhook Replicate calls when a room-track diarization+transcription finishes. This is the
// in-person twin of /api/transcribe/callback: Deepgram used to diarize the one room mic, now
// WhisperX (Whisper + pyannote) on Replicate does, off Deepgram entirely.
//
// Async, like the Deepgram path: /api/transcribe/submit creates the prediction with this URL as its
// webhook; Replicate POSTs the finished prediction here; we write transcript_segments (speaker-
// labelled, remapped to real session time if the track was trimmed), mark the track done, and let
// the job advance to extraction. Gated by the same ?k= callback secret as the Deepgram callback.

type RepSegment = { start?: number; end?: number; text?: string; speaker?: string };
type RepOutput = { segments?: RepSegment[]; num_speakers?: number; language?: string };
type Prediction = { status?: string; output?: RepOutput | null; error?: string | null };

type SegmentRow = {
  job_id: string;
  track_id: string;
  campaign_id: string;
  character_id: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker: number | null;
};
type TimelineSpan = { t0: number; r0: number; d: number };
type Track = {
  id: string;
  job_id: string;
  campaign_id: string;
  character_id: string | null;
  timeline_map: TimelineSpan[] | null;
};
type Admin = ReturnType<typeof createAdminClient>;

// Trimmed -> real session time. Identical to remapMs in /api/transcribe/callback; a room track with
// no timeline_map (untrimmed today) passes null and the value is used as-is.
function remapMs(trimmedMs: number, map: TimelineSpan[] | null): number {
  if (!map || map.length === 0) return trimmedMs;
  if (trimmedMs <= map[0].t0) return map[0].r0;
  for (const s of map) {
    if (trimmedMs <= s.t0 + s.d) return s.r0 + (trimmedMs - s.t0);
  }
  const last = map[map.length - 1];
  return last.r0 + last.d;
}

// "SPEAKER_00" -> 0, so it lands in transcript_segments.speaker the same way Deepgram diarization
// does. Anything unparseable is null rather than a wrong number.
function speakerIndex(s: string | undefined): number | null {
  const m = /(\d+)/.exec(String(s ?? ""));
  return m ? parseInt(m[1], 10) : null;
}

// Same decision the Deepgram callback and advance-jobs sweep make, kept in step: once every track
// has resolved, segments present -> extract, none -> the recording produced nothing.
async function finalizeJob(admin: Admin, jobId: string): Promise<string | undefined> {
  const { data: tracks } = await admin.from("audio_tracks").select("status").eq("job_id", jobId);
  const all = (tracks as { status: string }[]) || [];
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
    .select("id, job_id, campaign_id, character_id, timeline_map")
    .eq("id", trackId)
    .single();
  if (!trackRow) return NextResponse.json({ error: "unknown track" }, { status: 404 });
  const t = trackRow as Track;

  const toRealMs = (secs: number) => remapMs(Math.round((secs || 0) * 1000), t.timeline_map);

  // Mark failed, re-check the job, return 200 so Replicate does not keep retrying the webhook; the
  // failure is captured in track + job state, not the HTTP code.
  async function failTrack(): Promise<NextResponse> {
    await admin.from("audio_tracks").update({ status: "error" }).eq("id", t.id);
    const status = await finalizeJob(admin, t.job_id);
    if (status === "extracting") kickExtraction(req, t.job_id);
    return NextResponse.json({ ok: true });
  }

  let body: Prediction;
  try {
    body = (await req.json()) as Prediction;
  } catch {
    return failTrack();
  }

  if (body.status !== "succeeded" || !body.output) {
    return failTrack();
  }

  const segments = body.output.segments || [];
  const rows: SegmentRow[] = segments
    .filter((s) => (s.text || "").trim().length > 0)
    .map((s) => ({
      job_id: t.job_id,
      track_id: t.id,
      campaign_id: t.campaign_id,
      // A room track has no character_id; diarization gives a speaker index instead, which a human
      // maps to characters later (same as the Deepgram room path).
      character_id: t.character_id,
      start_ms: toRealMs(s.start || 0),
      end_ms: toRealMs(s.end || 0),
      text: (s.text || "").trim(),
      speaker: speakerIndex(s.speaker),
    }));

  if (rows.length) {
    const { error: insErr } = await admin.from("transcript_segments").insert(rows);
    if (insErr) return failTrack();
  }

  // Empty-but-valid (no speech) is "done", not an error — a quiet room still resolves the track.
  await admin.from("audio_tracks").update({ status: "done" }).eq("id", t.id);
  const status = await finalizeJob(admin, t.job_id);
  if (status === "extracting") kickExtraction(req, t.job_id);

  return NextResponse.json({ ok: true });
}
