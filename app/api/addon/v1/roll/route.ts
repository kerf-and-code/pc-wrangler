import { roll, DiceError } from "@/lib/dice";
import { addonAuth, fail, messageOut, ok, openSession, preflight } from "@/lib/addons/api";

// app/api/addon/v1/roll/route.ts (2026-11-09)
//
// Phase 6b (p131): an add-on rolls (roll scope). The SERVER rolls, with the same dice as the table
// (lib/dice), and the roll lands in chat marked "via <key name>". { secret: true } makes it a GM-only
// roll. Add-on rolls are not filed for Mechanics: they belong to no character.

export const OPTIONS = preflight;

export async function POST(req: Request) {
  const a = await addonAuth(req, "roll");
  if (a instanceof Response) return a;
  let b: { notation?: unknown; label?: unknown; as?: unknown; secret?: unknown } = {};
  try { b = await req.json(); } catch { return fail(400, "Send JSON: { \"notation\": \"1d20+5\" }."); }
  const notation = typeof b.notation === "string" ? b.notation.trim().slice(0, 100) : "";
  const label = (typeof b.label === "string" ? b.label : "").trim().slice(0, 120);
  const as = (typeof b.as === "string" ? b.as : "").trim().slice(0, 60) || a.key.name;
  let r;
  try { r = roll(notation); } catch (e) { return fail(400, e instanceof DiceError ? e.message : "Could not read that roll."); }
  const { data, error } = await a.admin.from("vtt_messages").insert({
    campaign_id: a.key.campaignId, session_id: await openSession(a.admin, a.key.campaignId), author_profile: a.key.owner,
    as_name: as, kind: "roll", body: label, gm_only: b.secret === true,
    roll: { label, notation: r.notation, total: r.total, dice: r.dice, modifier: r.modifier, natural: r.natural, logged: false, addon: a.key.name },
  }).select("id, kind, body, as_name, gm_only, created_at, roll").single();
  if (error) return fail(500, "The roll was made but could not be posted.");
  return ok({ message: messageOut(data as Parameters<typeof messageOut>[0], as) });
}
