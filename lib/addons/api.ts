import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { KEY_RE, hashKey, type Scope } from "@/lib/addons/keys";

// lib/addons/api.ts (2026-11-09)
//
// Phase 6b (p131): what every /api/addon/v1 route does first. The key comes as
// "Authorization: Bearer sxa_..."; addon_auth checks it (unknown, revoked, or its GM no longer the GM:
// 401), counts it against its minute (over 60: 429), and the route says which scope it needs (403
// without it). CORS is open, as on /api/vtt/ingest: the key is the only credential and nothing ambient
// (no cookies) is read, so pages anywhere (an overlay, a Foundry module) may call it.

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};
export type AddonKey = { id: string; campaignId: string; campaignName: string; name: string; scopes: Scope[]; owner: string };

export const fail = (status: number, error: string, extra: Record<string, string> = {}) =>
  NextResponse.json({ error }, { status, headers: { ...CORS, ...extra } });
export const ok = (body: unknown) => NextResponse.json(body, { headers: CORS });
export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });

export async function addonAuth(req: Request, scope: Scope | null): Promise<{ key: AddonKey; admin: ReturnType<typeof createAdminClient> } | NextResponse> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m || !KEY_RE.test(m[1])) return fail(401, "Send your add-on key as: Authorization: Bearer sxa_...");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("addon_auth", { p_hash: hashKey(m[1]) });
  if (error) return fail(500, "Could not check the key.");
  const k = data as (AddonKey & { limited: boolean }) | null;
  if (!k) return fail(401, "That key is not valid (unknown, revoked, or its GM no longer runs the campaign).");
  if (k.limited) return fail(429, "Slow down: 60 calls a minute per key.", { "Retry-After": "60" });
  if (scope && !k.scopes.includes(scope)) return fail(403, `This key cannot ${scope === "read" ? "read the table" : scope === "chat" ? "post to chat" : "roll"}. The GM can make one that does.`);
  return { key: { id: k.id, campaignId: k.campaignId, campaignName: k.campaignName, name: k.name, scopes: k.scopes, owner: k.owner }, admin };
}

/** The campaign's open session, as tabletop_open_session picks it. */
export async function openSession(admin: ReturnType<typeof createAdminClient>, campaignId: string): Promise<string | null> {
  const { data } = await admin.from("sessions").select("id, started_at, created_at").eq("campaign_id", campaignId).is("ended_at", null);
  const rows = (data ?? []) as { id: string; started_at: string | null; created_at: string }[];
  rows.sort((a, b) => (b.started_at ?? b.created_at).localeCompare(a.started_at ?? a.created_at));
  return rows[0]?.id ?? null;
}

/** A line of chat or a roll, in the same shape webhooks send. */
export function messageOut(m: { id: string; kind: string; body: string; as_name: string | null; gm_only: boolean; created_at: string; roll: Record<string, unknown> | null }, who: string) {
  const r = m.roll ?? {};
  return {
    messageId: m.id, who, kind: m.kind, text: m.body, secret: m.gm_only, addon: (r.addon as string | undefined) ?? null, at: m.created_at,
    ...(m.kind === "roll" ? { roll: { label: r.label ?? null, notation: r.notation ?? null, total: r.total ?? null, natural: r.natural ?? null, dice: r.dice ?? [], table: r.table ?? null } } : {}),
  };
}
