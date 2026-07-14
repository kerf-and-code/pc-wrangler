import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "session-audio";
const TTL = 7200; // 2 hours

export async function POST(req: NextRequest) {
  let body: { trackId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const trackId = (body.trackId || "").trim();
  if (!trackId) return NextResponse.json({ error: "Missing trackId" }, { status: 400 });

  const supa = await createClient();
  const { data: auth } = await supa.auth.getUser();
  const user = auth?.user;
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: trackRow } = await admin
    .from("audio_tracks")
    .select("id, campaign_id, storage_path, purged_at")
    .eq("id", trackId)
    .maybeSingle();
  const track = trackRow as
    | { id: string; campaign_id: string; storage_path: string | null; purged_at: string | null }
    | null;

  if (!track) return NextResponse.json({ error: "Audio not found." }, { status: 404 });

  // Owner gate on the track's campaign. Runs BEFORE the purge check so a
  // non-owner cannot learn whether a track ever existed.
  const { data: camp } = await supa
    .from("campaigns")
    .select("gm_id")
    .eq("id", track.campaign_id)
    .maybeSingle();
  if ((camp as { gm_id: string } | null)?.gm_id !== user.id) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  // The track was deleted under the 60-day retention policy. This is the policy
  // working, not a failure, so it gets its own status and its own message. If it
  // came back as a generic 404 the UI would tell the GM the app is broken, when in
  // fact it kept a promise. The extracted events and the transcript survive; only
  // the audio is gone.
  if (track.purged_at) {
    return NextResponse.json(
      {
        error: "This audio was deleted under the 60-day retention policy. The transcript and the extracted events are still here.",
        purged: true,
        purgedAt: track.purged_at,
      },
      { status: 410 }, // Gone: existed, deliberately removed, will not return
    );
  }

  if (!track.storage_path) {
    return NextResponse.json({ error: "Audio not found." }, { status: 404 });
  }

  const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrl(track.storage_path, TTL);
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: "Could not sign the audio URL." }, { status: 502 });
  }

  return NextResponse.json({ url: signed.signedUrl, ttl: TTL });
}
