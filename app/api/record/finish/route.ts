import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// After the player uploads via the signed URL, register the track (so the
// transcription worker will pick it up) and record self-consent.
//
// Push 8:
//   B17  The track goes on the capture job named in its own upload path (/api/record/start put it there),
//        and only while that job can still take tracks. It used to fall back to the newest job of any
//        status, so a long recording could land on a session already transcribed or reviewed. If the job
//        has moved on, the file is deleted and the player keeps their copy to send the GM.
//   T10  Self-consent is recorded only when the uploader is signed in as the character's owner, and it
//        never overwrites an existing row: a GM's opt-out for this session (consented = false) used to be
//        flipped to true by any upload made with the campaign link. An upload from someone else still
//        registers the track; whether it is transcribed is decided by consent as usual.
//   T8   The path comes off storage_purge_queue once the track row exists, so the file now has a row that
//        retention and account deletion can find.
//
// Audit round 2, T2 (push 41): the track is registered only for the character's owner, signed in, or a
// GM of the campaign, the same rule /api/record/start now applies. A share link alone no longer puts
// audio into a session under someone else's character. Also, a track longer than MAX_HOURS is refused.

const MAX_HOURS = 12;

// Job stages that still take new tracks: everything before transcription starts.
const OPEN_STAGES = new Set(["draft", "blocked_consent", "uploading"]);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export async function POST(req: NextRequest) {
  let share: string | undefined; let characterId: string | undefined; let path: string | undefined; let durationSeconds: number | undefined;
  try { const b = await req.json(); share = b?.share; characterId = b?.characterId; path = b?.path; durationSeconds = b?.durationSeconds; } catch { /* guard below */ }
  if (!share || !characterId || !path) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const admin = createAdminClient();
  const { data: camp } = await admin.from("campaigns").select("id").eq("share_code", share).single();
  if (!camp) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const { data: ch } = await admin.from("characters").select("id, profile_id").eq("id", characterId).eq("campaign_id", camp.id).eq("kind", "pc").single();
  if (!ch) return NextResponse.json({ error: "Unknown character" }, { status: 400 });

  const owner = (ch as { profile_id: string | null }).profile_id;
  const supa = await createClient();
  const { data: claims } = await supa.auth.getClaims();
  const uid = claims?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.json({ error: "Sign in to record your side. Download your file below and send it to your GM." }, { status: 401 });
  if (uid !== owner) {
    const { data: isGm } = await supa.rpc("is_campaign_gm", { p_campaign: camp.id });
    if (!isGm) return NextResponse.json({ error: "You can only record for your own character. Download your file below and send it to your GM." }, { status: 403 });
  }

  // The path /api/record/start issued: <campaign>/<job>/<character>-self-<ms>.<ext>
  const m = new RegExp(`^${camp.id}/(${UUID})/${characterId}-self-\\d+\\.[a-z0-9]{2,5}$`, "i").exec(path);
  if (!m) return NextResponse.json({ error: "Bad path" }, { status: 400 });
  const jobId = m[1];

  const { data: jobRow } = await admin.from("capture_jobs").select("id, session_id, status").eq("id", jobId).eq("campaign_id", camp.id).maybeSingle();
  const job = jobRow as { id: string; session_id: string | null; status: string } | null;
  if (!job) return NextResponse.json({ error: "No capture job to attach to." }, { status: 409 });

  const dropQueued = () => admin.from("storage_purge_queue").delete().eq("bucket", "session-audio").eq("path", path).eq("reason", "upload");

  if (!OPEN_STAGES.has(job.status)) {
    // Too late for this session: do not keep the file on the server with nowhere to go.
    const { error: rmErr } = await admin.storage.from("session-audio").remove([path]);
    if (!rmErr) await dropQueued();
    return NextResponse.json(
      { error: "This session was already being processed when your upload finished, so it could not be added. Download your file below and send it to your GM." },
      { status: 409 },
    );
  }

  const dur = typeof durationSeconds === "number" && durationSeconds > 0 ? Math.round(durationSeconds) : null;
  if (dur !== null && dur > MAX_HOURS * 3600) {
    const { error: rmErr } = await admin.storage.from("session-audio").remove([path]);
    if (!rmErr) await dropQueued();
    return NextResponse.json({ error: `That recording is longer than ${MAX_HOURS} hours, so it was not added. Download it below and send it to your GM.` }, { status: 400 });
  }
  const { error: insErr } = await admin.from("audio_tracks").insert({ job_id: job.id, campaign_id: camp.id, character_id: characterId, storage_path: path, duration_seconds: dur, status: "pending" });
  if (insErr) return NextResponse.json({ error: "Your file uploaded but could not be added to the session. Download it below and send it to your GM." }, { status: 500 });
  await dropQueued();

  // Self-consent: only the character's owner, signed in, and only where no row exists for this session.
  let consentRecorded = false;
  if (job.session_id && owner) {
    if (uid === owner) {
      const { error: cErr } = await admin.from("recording_consents").upsert(
        { session_id: job.session_id, campaign_id: camp.id, character_id: characterId, profile_id: uid, consented: true, method: "self_recording" },
        { onConflict: "session_id,character_id", ignoreDuplicates: true },
      );
      consentRecorded = !cErr;
    }
  }

  return NextResponse.json({ ok: true, consentRecorded });
}
