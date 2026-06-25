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

export async function POST(req: NextRequest) {
  const trackId = req.nextUrl.searchParams.get("track");
  const k = req.nextUrl.searchParams.get("k");
  if (!trackId || k !== process.env.TRANSCRIBE_CALLBACK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: DgBody;
  try {
    body = (await req.json()) as DgBody;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: track } = await admin
    .from("audio_tracks")
    .select("id, job_id, campaign_id, character_id")
    .eq("id", trackId)
    .single();
  if (!track) return NextResponse.json({ error: "unknown track" }, { status: 404 });

  const t = track as { id: string; job_id: string; campaign_id: string; character_id: string | null };
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

  if (rows.length) await admin.from("transcript_segments").insert(rows);
  await admin.from("audio_tracks").update({ status: rows.length ? "done" : "error" }).eq("id", t.id);

  // When no track is still pending or transcribing, the job is done capturing.
  const { data: remaining } = await admin
    .from("audio_tracks")
    .select("id")
    .eq("job_id", t.job_id)
    .in("status", ["pending", "transcribing"]);

  if (!remaining || remaining.length === 0) {
    const { data: anyErr } = await admin
      .from("audio_tracks")
      .select("id")
      .eq("job_id", t.job_id)
      .eq("status", "error");
    const nextStatus = anyErr && anyErr.length ? "error" : "extracting";
    await admin.from("capture_jobs").update({ status: nextStatus }).eq("id", t.job_id);
  }

  return NextResponse.json({ ok: true });
}
