import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// lib/vtt/ingest-keys.ts (audit B12, push 7)
//
// Roll keys prove WHO is sending rolls to /api/vtt/ingest. The campaign share code only proves that the
// sender was given the table link, which every player (and anyone they forwarded it to) has, so on its
// own it can no longer mark a roll "canonical" or file it as somebody else's verified roll.
//
//   player key  issued to a signed-in player for one campaign; it verifies rolls for the characters
//               that player owns there at the moment the roll arrives (a handed-over character stops
//               verifying for the old owner at once)
//   gm key      issued to the campaign's GM (or a co-GM) for the Foundry module, which sends every roll
//               at the table; it verifies any character in that campaign while the holder is still a GM
//
// Only a SHA-256 hash is stored (public.vtt_ingest_keys, p143, service role only). The key itself is
// shown once and kept by the extension or the Foundry module. Making a new key retires the old one.

export type RollKeyKind = "player" | "gm";

export const ROLL_KEY_PREFIX = "sxk_";

export function newRollKey(): string {
  return ROLL_KEY_PREFIX + randomBytes(24).toString("base64url");
}

export function hashRollKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function looksLikeRollKey(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(ROLL_KEY_PREFIX) && v.length >= 20 && v.length <= 80;
}

/** What one signed-in account may verify in one campaign, or null when it is neither GM nor a player there. */
export async function rollKeyRole(
  admin: SupabaseClient,
  campaignId: string,
  profileId: string,
): Promise<RollKeyKind | null> {
  const [{ data: camp }, { data: gmMember }, { data: pcs }] = await Promise.all([
    admin.from("campaigns").select("gm_id").eq("id", campaignId).maybeSingle(),
    admin.from("memberships").select("profile_id").eq("campaign_id", campaignId).eq("profile_id", profileId)
      .in("role", ["gm", "co-gm"]).eq("active", true).limit(1),
    admin.from("characters").select("id").eq("campaign_id", campaignId).eq("profile_id", profileId).eq("kind", "pc").limit(1),
  ]);
  if ((camp as { gm_id: string | null } | null)?.gm_id === profileId || (gmMember ?? []).length > 0) return "gm";
  if ((pcs ?? []).length > 0) return "player";
  return null;
}

/**
 * Proof gathered for one ingest request: the campaigns where the sender is proven to be a GM, and the
 * characters the sender is proven to own. A roll is canonical only when one of these covers it.
 */
export type RollProof = { gmCampaigns: Set<string>; ownCharacters: Set<string>; keyCampaigns: Set<string> };

export function emptyProof(): RollProof {
  return { gmCampaigns: new Set(), ownCharacters: new Set(), keyCampaigns: new Set() };
}

/** Adds what each profile may verify in each campaign to the proof (roles are checked as of now). */
async function addRoles(admin: SupabaseClient, proof: RollProof, pairs: { profileId: string; campaignId: string; kind: RollKeyKind | "session" }[]) {
  if (pairs.length === 0) return;
  const campaignIds = Array.from(new Set(pairs.map((p) => p.campaignId)));
  const profileIds = Array.from(new Set(pairs.map((p) => p.profileId)));
  const [{ data: camps }, { data: gms }, { data: pcs }] = await Promise.all([
    admin.from("campaigns").select("id, gm_id").in("id", campaignIds),
    admin.from("memberships").select("campaign_id, profile_id").in("campaign_id", campaignIds).in("profile_id", profileIds)
      .in("role", ["gm", "co-gm"]).eq("active", true),
    admin.from("characters").select("id, campaign_id, profile_id").in("campaign_id", campaignIds).in("profile_id", profileIds).eq("kind", "pc"),
  ]);
  const isGm = (profileId: string, campaignId: string) =>
    (camps ?? []).some((c: { id: string; gm_id: string | null }) => c.id === campaignId && c.gm_id === profileId)
    || (gms ?? []).some((m: { campaign_id: string; profile_id: string }) => m.campaign_id === campaignId && m.profile_id === profileId);
  for (const p of pairs) {
    // A player key never verifies as a GM, even if its holder later becomes one: they make a GM key for that.
    if (p.kind !== "player" && isGm(p.profileId, p.campaignId)) proof.gmCampaigns.add(p.campaignId);
    if (p.kind !== "gm") {
      for (const c of (pcs ?? []) as { id: string; campaign_id: string; profile_id: string }[]) {
        if (c.campaign_id === p.campaignId && c.profile_id === p.profileId) proof.ownCharacters.add(c.id);
      }
    }
  }
}

/** Resolves the roll keys sent with a request (unknown or retired keys are ignored) and records their use. */
export async function proofFromKeys(admin: SupabaseClient, keys: string[], proof: RollProof): Promise<void> {
  const hashes = Array.from(new Set(keys.filter(looksLikeRollKey).map(hashRollKey))).slice(0, 20);
  if (hashes.length === 0) return;
  const { data } = await admin
    .from("vtt_ingest_keys")
    .select("id, profile_id, campaign_id, kind")
    .in("key_hash", hashes)
    .is("revoked_at", null);
  const rows = (data ?? []) as { id: string; profile_id: string; campaign_id: string; kind: RollKeyKind }[];
  if (rows.length === 0) return;
  for (const r of rows) proof.keyCampaigns.add(r.campaign_id);
  await addRoles(admin, proof, rows.map((r) => ({ profileId: r.profile_id, campaignId: r.campaign_id, kind: r.kind })));
  void admin.from("vtt_ingest_keys").update({ last_used_at: new Date().toISOString() }).in("id", rows.map((r) => r.id)).then(() => {}, () => {});
}

/** A signed-in sender (Table Tap runs on the site itself, so its requests carry the session) proves the same way. */
export async function proofFromSession(admin: SupabaseClient, profileId: string, campaignIds: string[], proof: RollProof): Promise<void> {
  await addRoles(admin, proof, campaignIds.map((campaignId) => ({ profileId, campaignId, kind: "session" as const })));
}
