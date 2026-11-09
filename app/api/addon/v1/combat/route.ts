import { addonAuth, fail, ok, preflight } from "@/lib/addons/api";

// app/api/addon/v1/combat/route.ts (2026-11-09)
//
// Phase 6b (p131): the running fight (read scope): its name, round, and the turn order as players see
// it: names, kinds, initiative, who is down and whose turn it is. Combatants the GM hides from the
// tracker are left out, and no hit points or armour class are given. { combat: null } with no fight.

export const OPTIONS = preflight;

type C = { id: string; name: string; kind: string; initiative?: number | null; defeated?: boolean; hidden?: boolean };

export async function GET(req: Request) {
  const a = await addonAuth(req, "read");
  if (a instanceof Response) return a;
  const { data, error } = await a.admin.from("combats").select("id, name, round, turn, combatants")
    .eq("campaign_id", a.key.campaignId).eq("status", "active").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return fail(500, "Could not read the fight.");
  const cb = data as { id: string; name: string; round: number; turn: number; combatants: C[] } | null;
  if (!cb) return ok({ combat: null });
  const order = cb.combatants.map((c, i) => ({ c, i })).filter(({ c }) => !c.hidden)
    .map(({ c, i }) => ({ id: c.id, name: c.name, kind: c.kind, initiative: c.initiative ?? null, defeated: !!c.defeated, isTurn: i === cb.turn }));
  return ok({ combat: { id: cb.id, name: cb.name, round: cb.round, order } });
}
