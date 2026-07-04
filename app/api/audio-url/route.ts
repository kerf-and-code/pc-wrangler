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
    .select("id, campaign_id, storage_path")
    .eq("id", trackId)
    .maybeSingle();
  const track = trackRow as { id: string; campaign_id: string; storage_path: string | null } | null;
  if (!track || !track.storage_path) return NextResponse.json({ error: "Audio not found." }, { status: 404 });

  // Owner gate on the track's campaign.
  const { data: camp } = await supa
    .from("campaigns")
    .select("gm_id")
    .eq("id", track.campaign_id)
    .maybeSingle();
  if ((camp as { gm_id: string } | null)?.gm_id !== user.id) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrl(track.storage_path, TTL);
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: "Could not sign the audio URL." }, { status: 502 });
  }

  return NextResponse.json({ url: signed.signedUrl, ttl: TTL });
}
