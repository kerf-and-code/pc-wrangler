import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// app/api/record/room/route.ts
//
// The in-person capture path: one microphone in the room, uploaded by the GM from the browser.
//
// WHY THIS DOES NOT TOUCH capture_control
//   capture_control is the contract between the web app and the Fly sidecar, and it is easy to
//   break from outside: `stopping` is the only status that makes the sidecar finalize, so a row
//   moved to `done` by anyone else strands the recorder mid-session. That is exactly what cost a
//   table three hours of audio on 2026-07-31. There is no bot in an in-person session, so this
//   creates the capture_job and the audio_track directly and leaves that table alone entirely.
//
// TWO ACTIONS, ONE FILE
//   start  - verify GM, verify consent was affirmed, find or open a job, hand back a signed upload
//            URL. Called once, before recording begins, so the GM learns about a problem BEFORE
//            they run a four-hour session rather than after.
//   finish - register the uploaded object as a room track.
//
// The upload itself goes browser-to-storage on a signed URL and never passes through here. A
// session's audio is tens of megabytes and a serverless function is the wrong place for it.

export const maxDuration = 30;

type Body = {
  action?: "start" | "finish";
  campaignId?: string;
  sessionId?: string;
  ext?: string;
  consentAffirmed?: boolean;
  path?: string;
  durationSeconds?: number;
};

export async function POST(req: Request) {
  let b: Body = {};
  try { b = await req.json(); } catch { /* handled by the guards below */ }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const admin = createAdminClient();

  // The caller must be the GM of this campaign. Checked against campaigns.gm_id rather than trusting
  // anything in the request body.
  const { data: camp } = await admin
    .from("campaigns")
    .select("id, gm_id, name")
    .eq("id", b.campaignId ?? "")
    .maybeSingle();
  if (!camp) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (camp.gm_id !== user.id) {
    return NextResponse.json({ error: "Only the GM of this campaign can record it." }, { status: 403 });
  }

  if (b.action === "start") return start(admin, user.id, camp.id, b);
  if (b.action === "finish") return finish(admin, camp.id, b);
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

async function start(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  campaignId: string,
  b: Body,
) {
  // Room-level consent. A single mixed track cannot exclude one person's voice before upload, so
  // the per-speaker model used for Discord cannot apply here. Everyone in the room agrees or this
  // does not run. Refusing at start is the point: it is the only moment where refusing costs
  // nothing, whereas discovering it afterwards means the audio already exists.
  if (b.consentAffirmed !== true) {
    return NextResponse.json({
      error: "Everyone in the room has to agree to be recorded before this can start.",
    }, { status: 428 });
  }

  const safeExt = typeof b.ext === "string" && /^[a-z0-9]{2,5}$/.test(b.ext) ? b.ext : "webm";

  // Reuse the session's open draft job if there is one, so a break in play does not fragment a
  // night into two sessions. The Discord path behaves the same way.
  const { data: existing } = await admin
    .from("capture_jobs")
    .select("id, session_id")
    .eq("campaign_id", campaignId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let jobId = existing?.id as string | undefined;

  if (!jobId) {
    if (!b.sessionId) {
      return NextResponse.json({
        error: "No session is open. Open one on the Session Log first, then start recording.",
      }, { status: 409 });
    }
    const { data: created, error: jErr } = await admin
      .from("capture_jobs")
      .insert({
        campaign_id: campaignId,
        session_id: b.sessionId,
        source: "in_person",
        status: "draft",
      })
      .select("id")
      .single();
    if (jErr || !created) {
      return NextResponse.json({ error: jErr?.message ?? "Could not open a capture job." }, { status: 500 });
    }
    jobId = created.id;
  }

  // Stamp who affirmed consent and when. This records an assertion, not proof, and exists so there
  // is an audit trail and so nothing starts without someone taking responsibility for it.
  await admin
    .from("capture_jobs")
    .update({ room_consent_by: userId, room_consent_at: new Date().toISOString() })
    .eq("id", jobId);

  const path = `${campaignId}/${jobId}/room-${Date.now()}.${safeExt}`;
  const { data: signed, error: sErr } = await admin.storage
    .from("session-audio")
    .createSignedUploadUrl(path);

  if (sErr || !signed) {
    return NextResponse.json({ error: sErr?.message ?? "Could not prepare the upload." }, { status: 500 });
  }

  return NextResponse.json({ jobId, path: signed.path, token: signed.token });
}

async function finish(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string,
  b: Body,
) {
  if (!b.path) return NextResponse.json({ error: "Missing the uploaded path." }, { status: 400 });

  // Derive the job from the path rather than trusting a second body field: the path was minted by
  // start() and already contains it, so they cannot disagree.
  const jobId = b.path.split("/")[1];
  if (!jobId) return NextResponse.json({ error: "That upload path is not one of ours." }, { status: 400 });

  const { error } = await admin.from("audio_tracks").insert({
    job_id: jobId,
    campaign_id: campaignId,
    kind: "room",
    // No character_id and no gm_identity_id on purpose. A room track belongs to the room until
    // diarization splits it and a human maps the speakers.
    character_id: null,
    storage_path: b.path,
    duration_seconds: typeof b.durationSeconds === "number" ? Math.round(b.durationSeconds) : null,
    status: "pending",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, jobId });
}
