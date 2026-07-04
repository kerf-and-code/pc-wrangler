import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// gm_identities has RLS enabled with no policies, so the browser client cannot
// touch it. All access runs here through the admin client, gated by an explicit
// campaign-owner check against the RLS-scoped client (same shape as the
// transcribe submit route).

type Identity = {
  id: string;
  campaign_id: string;
  profile_id: string | null;
  discord_user_id: string | null;
  display_name: string | null;
};

type Gate =
  | { ok: false; res: NextResponse }
  | { ok: true; userId: string };

// Confirm the signed-in user owns this campaign. Returns the user id on success
// or a ready-to-return error response on failure.
async function requireCampaignOwner(campaignId: string): Promise<Gate> {
  const supa = await createClient();
  const { data: auth } = await supa.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, res: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };

  const { data: camp } = await supa
    .from("campaigns")
    .select("id, gm_id")
    .eq("id", campaignId)
    .maybeSingle();
  const owner = (camp as { gm_id: string } | null)?.gm_id;
  if (!owner || owner !== user.id) {
    return { ok: false, res: NextResponse.json({ error: "Not found or not permitted." }, { status: 403 }) };
  }
  return { ok: true, userId: user.id };
}

export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: "Missing campaignId" }, { status: 400 });

  const gate = await requireCampaignOwner(campaignId);
  if (!gate.ok) return gate.res;

  const admin = createAdminClient();
  const { data } = await admin
    .from("gm_identities")
    .select("id, campaign_id, profile_id, discord_user_id, display_name")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  const identities = (data as Identity[]) || [];
  const mine = identities.find((i) => i.profile_id === gate.userId) || null;
  return NextResponse.json({ identities, mineId: mine?.id ?? null });
}

export async function POST(req: NextRequest) {
  let body: { campaignId?: string; discordUserId?: string; displayName?: string };
  try {
    body = (await req.json()) as { campaignId?: string; discordUserId?: string; displayName?: string };
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const campaignId = (body.campaignId || "").trim();
  const discordUserId = (body.discordUserId || "").trim();
  const displayName = (body.displayName || "").trim();

  if (!campaignId) return NextResponse.json({ error: "Missing campaignId" }, { status: 400 });
  // Discord snowflakes are long numeric strings; keep the guard loose but real.
  if (!/^\d{5,25}$/.test(discordUserId)) {
    return NextResponse.json({ error: "Enter a valid Discord user ID (the long number, usually 17 to 19 digits)." }, { status: 400 });
  }

  const gate = await requireCampaignOwner(campaignId);
  if (!gate.ok) return gate.res;
  const userId = gate.userId;

  const admin = createAdminClient();

  // One narrator identity per GM per campaign: find this user's existing row.
  const { data: existingRow } = await admin
    .from("gm_identities")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("profile_id", userId)
    .maybeSingle();
  const existing = existingRow as { id: string } | null;

  // Respect unique(campaign_id, discord_user_id). A row with no profile_id is an
  // auto-linked narrator (created by /record); adopt it for this GM rather than
  // blocking. A row owned by a different profile is a genuine clash.
  const { data: clashRow } = await admin
    .from("gm_identities")
    .select("id, profile_id")
    .eq("campaign_id", campaignId)
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  const clash = clashRow as { id: string; profile_id: string | null } | null;
  if (clash && clash.id !== existing?.id) {
    if (clash.profile_id && clash.profile_id !== userId) {
      return NextResponse.json({ error: "That Discord ID is already linked to another narrator on this campaign." }, { status: 409 });
    }
    const { error: adoptErr } = await admin
      .from("gm_identities")
      .update({ profile_id: userId, display_name: displayName || null })
      .eq("id", clash.id);
    if (adoptErr) return NextResponse.json({ error: adoptErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (existing) {
    const { error: e } = await admin
      .from("gm_identities")
      .update({ discord_user_id: discordUserId, display_name: displayName || null })
      .eq("id", existing.id);
    if (e) return NextResponse.json({ error: e.message }, { status: 500 });
  } else {
    const { error: e } = await admin
      .from("gm_identities")
      .insert({ campaign_id: campaignId, profile_id: userId, discord_user_id: discordUserId, display_name: displayName || null });
    if (e) return NextResponse.json({ error: e.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const campaignId = req.nextUrl.searchParams.get("campaignId");
  if (!id || !campaignId) return NextResponse.json({ error: "Missing id or campaignId" }, { status: 400 });

  const gate = await requireCampaignOwner(campaignId);
  if (!gate.ok) return gate.res;

  const admin = createAdminClient();
  // Scope the delete to the owned campaign so an id alone can't reach another
  // campaign's row.
  const { error: e } = await admin
    .from("gm_identities")
    .delete()
    .eq("id", id)
    .eq("campaign_id", campaignId);
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
