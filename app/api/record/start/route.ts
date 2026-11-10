import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Issues a one-time signed upload URL so an anonymous player can upload their
// own track directly to storage, bypassing both RLS and the Vercel body limit.
//
// Audit T8 (push 8): before the URL is handed out, the path is written to storage_purge_queue (p144)
// with a one-day grace. /api/record/finish takes it off the queue when the track is registered; if
// finish never happens (the tab closed, registration failed), the audio-retention cron deletes the file
// after the grace instead of it sitting in the bucket with nothing pointing at it.
export async function POST(req: NextRequest) {
  let share: string | undefined; let characterId: string | undefined; let ext: string | undefined;
  try { const b = await req.json(); share = b?.share; characterId = b?.characterId; ext = b?.ext; } catch { /* guard below */ }
  if (!share || !characterId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  const safeExt = typeof ext === "string" && /^[a-z0-9]{2,5}$/.test(ext) ? ext : "webm";

  const admin = createAdminClient();
  const { data: camp } = await admin.from("campaigns").select("id").eq("share_code", share).single();
  if (!camp) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const { data: ch } = await admin.from("characters").select("id").eq("id", characterId).eq("campaign_id", camp.id).eq("kind", "pc").single();
  if (!ch) return NextResponse.json({ error: "Pick your character first" }, { status: 400 });

  const { data: job } = await admin.from("capture_jobs").select("id").eq("campaign_id", camp.id).eq("status", "draft").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!job) return NextResponse.json({ error: "No session is open for recording yet. You can still keep your file and send it to your GM." }, { status: 409 });

  const path = `${camp.id}/${job.id}/${characterId}-self-${Date.now()}.${safeExt}`;
  const { error: qErr } = await admin.from("storage_purge_queue").insert({
    bucket: "session-audio", path, reason: "upload", not_before: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  });
  if (qErr) return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });

  const { data: signed, error: sErr } = await admin.storage.from("session-audio").createSignedUploadUrl(path);
  if (sErr || !signed) return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });

  return NextResponse.json({ path, token: signed.token });
}
