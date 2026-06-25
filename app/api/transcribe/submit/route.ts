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

  // Authorize via RLS: only the campaign GM can read this job row.
  const supa = await createClient();
  const { data: job } = await supa
    .from("capture_jobs")
    .select("id, campaign_id, session_id")
    .eq("id", jobId)
    .single();
  if (!job) return NextResponse.json({ error: "Not found or not permitted" }, { status: 403 });

  // Hard consent gate, server-side. A forced status flip can't get past this.
  const { data: ok } = await supa.rpc("session_consent_ok", { p_session: job.session_id });
  if (!ok) return NextResponse.json({ error: "Consent is not cleared for this session." }, { status: 409 });

  const dgKey = process.env.DEEPGRAM_API_KEY;
  const secret = process.env.TRANSCRIBE_CALLBACK_SECRET;
  if (!dgKey || !secret) {
    return NextResponse.json({ error: "Server is missing transcription configuration." }, { status: 500 });
  }

  const admin = createAdminClient();
  const { data: tracks } = await admin
    .from("audio_tracks")
    .select("id, storage_path, status")
    .eq("job_id", jobId);

  const todo = ((tracks as { id: string; storage_path: string | null; status: string }[]) || [])
    .filter((t) => t.storage_path && t.status !== "done");
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
