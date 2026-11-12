import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Issues a one-time signed upload URL so a player can upload their own track directly to storage,
// bypassing both RLS and the Vercel body limit.
//
// Audit T8 (push 8): before the URL is handed out, the path is written to storage_purge_queue (p144)
// with a one-day grace. /api/record/finish takes it off the queue when the track is registered; if
// finish never happens (the tab closed, registration failed), the audio-retention cron deletes the file
// after the grace instead of it sitting in the bucket with nothing pointing at it.
//
// Audit round 2, T2 (push 41): the share link alone used to be enough, so anyone holding it could upload
// audio under any player's character, and it would be transcribed (and extracted) as that player's words.
// Now the caller must be signed in as the character's owner, or be the campaign's GM or co-GM. A player
// who joined with their invite link on this device, or signed in, is that owner already. A character
// with no web owner (claimed in Discord only) cannot self-record until its player signs in. Each
// character may also have at most MAX_OPEN uploads waiting on one session at a time.

const MAX_OPEN = 4;

export async function POST(req: NextRequest) {
  let share: string | undefined; let characterId: string | undefined; let ext: string | undefined;
  try { const b = await req.json(); share = b?.share; characterId = b?.characterId; ext = b?.ext; } catch { /* guard below */ }
  if (!share || !characterId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  const safeExt = typeof ext === "string" && /^[a-z0-9]{2,5}$/.test(ext) ? ext : "webm";

  const admin = createAdminClient();
  const { data: camp } = await admin.from("campaigns").select("id").eq("share_code", share).single();
  if (!camp) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const { data: ch } = await admin.from("characters").select("id, profile_id").eq("id", characterId).eq("campaign_id", camp.id).eq("kind", "pc").single();
  if (!ch) return NextResponse.json({ error: "Pick your character first" }, { status: 400 });

  // Who is uploading: the character's owner, or a GM of this campaign.
  const supa = await createClient();
  const { data: claims } = await supa.auth.getClaims();
  const uid = claims?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.json({ error: "Sign in to record your side. Open your invite link again on this device, then come back here." }, { status: 401 });
  const owner = (ch as { profile_id: string | null }).profile_id;
  if (uid !== owner) {
    const { data: isGm } = await supa.rpc("is_campaign_gm", { p_campaign: camp.id });
    if (!isGm) {
      return NextResponse.json({ error: "You can only record for your own character. If this is yours, open your invite link on this device first, so the app knows it is you." }, { status: 403 });
    }
  }

  const { data: job } = await admin.from("capture_jobs").select("id").eq("campaign_id", camp.id).eq("status", "draft").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!job) return NextResponse.json({ error: "No session is open for recording yet. You can still keep your file and send it to your GM." }, { status: 409 });

  const prefix = `${camp.id}/${job.id}/${characterId}-self-`;
  const { count: waiting } = await admin.from("storage_purge_queue").select("path", { count: "exact", head: true })
    .eq("bucket", "session-audio").eq("reason", "upload").like("path", `${prefix}%`);
  if ((waiting ?? 0) >= MAX_OPEN) {
    return NextResponse.json({ error: "There are already several uploads waiting for this character in this session. Let them finish, or download your file and send it to your GM." }, { status: 429 });
  }

  const path = `${prefix}${Date.now()}.${safeExt}`;
  const { error: qErr } = await admin.from("storage_purge_queue").insert({
    bucket: "session-audio", path, reason: "upload", not_before: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  });
  if (qErr) return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });

  const { data: signed, error: sErr } = await admin.storage.from("session-audio").createSignedUploadUrl(path);
  if (sErr || !signed) return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });

  return NextResponse.json({ path, token: signed.token });
}
