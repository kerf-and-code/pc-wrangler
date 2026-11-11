import type { SupabaseClient } from "@supabase/supabase-js";

// lib/campaign-gm.ts (2026-11-10, push 18)
//
// Co-GMs (p149). A campaign has one owner (campaigns.gm_id) and may have co-GMs (memberships with role
// "co-gm", active). A co-GM may do everything the owner can except the owner's actions: delete or trash
// the campaign, hand it over, and add or remove GMs. The database says the same in is_campaign_gm and
// campaign_gm_of; these helpers are the app-side form for API routes and pages.
//
// Works with the signed-in client (RLS lets a user read their own membership rows and the campaigns
// they belong to) or the service-role client.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when userId is the campaign's owner or an active co-GM. Pass ownerId when the route already
 *  read campaigns.gm_id: a string skips the lookup, null means the campaign was not found (false), and
 *  leaving it out looks the owner up. */
export async function isCampaignGm(
  client: SupabaseClient,
  campaignId: string | null | undefined,
  userId: string | null | undefined,
  ownerId?: string | null,
): Promise<boolean> {
  if (!campaignId || !userId || !UUID.test(campaignId)) return false;
  let owner = ownerId;
  if (owner === undefined) {
    const { data } = await client.from("campaigns").select("gm_id").eq("id", campaignId).maybeSingle();
    owner = (data as { gm_id: string } | null)?.gm_id ?? null;
  }
  if (owner === null) return false;
  if (owner === userId) return true;
  const { data, error } = await client.from("memberships").select("id")
    .eq("campaign_id", campaignId).eq("profile_id", userId).in("role", ["gm", "co-gm"]).eq("active", true).limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

/** A PostgREST or() filter for "campaigns this user runs": the ones they own plus the ones they co-GM.
 *  Use it where a page used .eq("gm_id", user.id): .or(await gmCampaignsFilter(supabase, user.id)). */
export async function gmCampaignsFilter(client: SupabaseClient, userId: string): Promise<string> {
  const own = `gm_id.eq.${userId}`;
  const { data } = await client.from("memberships").select("campaign_id")
    .eq("profile_id", userId).eq("role", "co-gm").eq("active", true);
  const ids = ((data ?? []) as { campaign_id: string }[]).map((r) => r.campaign_id).filter((id) => UUID.test(id));
  return ids.length ? `${own},id.in.(${ids.join(",")})` : own;
}

/** Whether this account co-GMs any campaign that is not in the trash. The /gm gate (lib/supabase/proxy.ts)
 *  lets such an account in without the account-wide GM flag (Terry, 2026-11-10: campaign-only access). */
export async function coGmsAnything(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.from("memberships").select("campaign_id, campaigns!inner(deleted_at)")
    .eq("profile_id", userId).eq("role", "co-gm").eq("active", true).is("campaigns.deleted_at", null).limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}
