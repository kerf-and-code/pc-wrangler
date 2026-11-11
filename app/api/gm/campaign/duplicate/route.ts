import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { duplicateCampaign } from "@/lib/campaign/duplicate";
import { hasGmAccess } from "@/lib/ai-allowance";

export const maxDuration = 60;

// POST /api/gm/campaign/duplicate   body: { campaignId, name? } (2026-11-10, push 24, audit F16)
//
// Copies a campaign's prepared world into a new campaign owned by the caller, without players, sessions
// or recordings (lib/campaign/duplicate.ts says exactly what goes). The caller must run the campaign
// (owner or co-GM) and be able to start campaigns of their own (the account-wide GM access, or owning
// this one). On any failure nothing is left behind.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { campaignId?: string; name?: string };
  const campaignId = (body.campaignId || "").trim();
  if (!UUID.test(campaignId)) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only this campaign's GMs can duplicate it." }, { status: 403 });

  const admin = createAdminClient();
  const { data: camp } = await admin.from("campaigns").select("gm_id").eq("id", campaignId).maybeSingle();
  const owner = (camp as { gm_id: string } | null)?.gm_id === user.id;
  if (!owner && !(await hasGmAccess(admin, user.id))) {
    return NextResponse.json({ error: "Starting a campaign of your own needs GM access. Ask the owner to duplicate it for you." }, { status: 403 });
  }

  try {
    const out = await duplicateCampaign(admin, campaignId, user.id, name || undefined);
    return NextResponse.json(out);
  } catch (e) {
    console.error("campaign duplicate failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not duplicate the campaign. Nothing was created; try again." }, { status: 500 });
  }
}
