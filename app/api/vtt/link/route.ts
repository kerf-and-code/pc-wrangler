import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/vtt/link  { campaignId, sessionId, actorName, characterId }
// Attributes an unlinked roller's captured rolls to a roster character.
export async function POST(req: NextRequest) {
  let body: { campaignId?: string; sessionId?: string; actorName?: string; characterId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const campaignId = (body.campaignId || "").trim();
  const sessionId = (body.sessionId || "").trim();
  const actorName = (body.actorName || "").trim();
  const characterId = (body.characterId || "").trim();
  if (!campaignId || !sessionId || !actorName || !characterId) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  const supa = await createClient();
  const { data: claimsData } = await supa.auth.getClaims();
  const uid = claimsData?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: isGm } = await supa.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only the campaign GM can link rollers." }, { status: 403 });

  const admin = createAdminClient();

  // Confirm the session and character both belong to this campaign.
  const { data: sessRow } = await admin.from("sessions").select("campaign_id").eq("id", sessionId).maybeSingle();
  if ((sessRow as { campaign_id: string } | null)?.campaign_id !== campaignId) {
    return NextResponse.json({ error: "Session is not in this campaign." }, { status: 400 });
  }
  const { data: charRow } = await admin.from("characters").select("campaign_id").eq("id", characterId).maybeSingle();
  if ((charRow as { campaign_id: string } | null)?.campaign_id !== campaignId) {
    return NextResponse.json({ error: "Character is not in this campaign." }, { status: 400 });
  }

  const { error } = await admin
    .from("vtt_events")
    .update({ character_id: characterId })
    .eq("session_id", sessionId)
    .eq("actor_name", actorName)
    .is("character_id", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
