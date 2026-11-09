import { addonAuth, ok, preflight } from "@/lib/addons/api";

// app/api/addon/v1/route.ts (2026-11-09)
//
// Phase 6b (p131): GET /api/addon/v1 says which campaign and key this is, and what the key may do.
// Any valid key may ask. The endpoints:
//   GET  /api/addon/v1/chat?since=<ISO time>&secret=1   recent chat and rolls (read)
//   POST /api/addon/v1/chat    { text, kind?: "say" | "emote", as?: name }              (chat)
//   POST /api/addon/v1/roll    { notation, label?, as?, secret?: boolean }              (roll)
//   GET  /api/addon/v1/combat  the fight: round and the turn order, no hit points       (read)

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const a = await addonAuth(req, null);
  if (a instanceof Response) return a;
  return ok({ campaign: { id: a.key.campaignId, name: a.key.campaignName }, key: { name: a.key.name, scopes: a.key.scopes } });
}
