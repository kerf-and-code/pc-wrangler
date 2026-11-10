import type { SupabaseClient } from "@supabase/supabase-js";

// lib/ai-allowance.ts (2026-11-09)
//
// Audit T4: every paid AI call goes through here first. Three rules:
//   1. Pilot access: only an account that entered the GM access code (profiles.access_granted with
//      access_role "gm", set by /api/gate) may spend. The page gate in lib/supabase/proxy.ts covers /gm
//      pages only, not the API, so the routes check it themselves.
//   2. A daily budget per GM and per kind, over any 24 hours, counted in ai_map_renders (p59, kind p135).
//   3. Reserve before calling the model: the row is written first and counted after, so requests fired
//      together cannot all slip under the cap. If the call then fails, releaseAi gives the slot back.
// Takes the service-role client (the log is server-only).

export type AiKind = "world" | "battle" | "trace";

/** Most calls per GM per 24 hours, by kind. world: the world-map fantasy view and city, dungeon,
 *  building and bastion renders; battle: battle-map paintings; trace: reading terrain from a map image. */
export const AI_DAILY: Record<AiKind, number> = { world: 6, battle: 12, trace: 20 };

const LABEL: Record<AiKind, string> = { world: "map renders", battle: "battle-map paintings", trace: "map traces" };

export type AiGrant = { ok: true; id: string; remaining: number };
export type AiRefusal = { ok: false; status: number; error: string; limited?: boolean };

/** Whether this account entered the GM pilot code. */
export async function hasGmAccess(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from("profiles").select("access_granted, access_role").eq("id", userId).maybeSingle();
  const p = data as { access_granted: boolean | null; access_role: string | null } | null;
  return !!p?.access_granted && p.access_role === "gm";
}

export async function reserveAi(admin: SupabaseClient, userId: string, campaignId: string, kind: AiKind): Promise<AiGrant | AiRefusal> {
  if (!(await hasGmAccess(admin, userId))) {
    return { ok: false, status: 403, error: "AI tools need GM access: enter your GM access code first." };
  }
  const limit = AI_DAILY[kind];
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const count = async () => {
    const { count: n, error } = await admin.from("ai_map_renders").select("id", { count: "exact", head: true })
      .eq("profile_id", userId).eq("kind", kind).gte("created_at", since);
    return error ? null : (n ?? 0);
  };
  const before = await count();
  if (before === null) {
    console.error("ai-allowance: ai_map_renders unreadable (has p135 run?)");
    return { ok: false, status: 503, error: "AI tools are being updated. Try again in a few minutes." };
  }
  if (before >= limit) return refusal(kind, limit);
  const { data: row, error: insErr } = await admin.from("ai_map_renders")
    .insert({ campaign_id: campaignId, profile_id: userId, kind }).select("id").single();
  if (insErr || !row) {
    console.error("ai-allowance: could not reserve", insErr?.message);
    return { ok: false, status: 503, error: "AI tools are being updated. Try again in a few minutes." };
  }
  const id = (row as { id: string }).id;
  const after = await count();
  if (after !== null && after > limit) {
    await releaseAi(admin, id);
    return refusal(kind, limit);
  }
  return { ok: true, id, remaining: Math.max(0, limit - (after ?? before + 1)) };
}

/** Gives a reserved slot back when the model call failed. */
export async function releaseAi(admin: SupabaseClient, id: string): Promise<void> {
  const { error } = await admin.from("ai_map_renders").delete().eq("id", id);
  if (error) console.error("ai-allowance: could not release", id, error.message);
}

function refusal(kind: AiKind, limit: number): AiRefusal {
  return { ok: false, status: 429, limited: true, error: `Daily limit reached: ${limit} ${LABEL[kind]} in any 24 hours. Try again later.` };
}
