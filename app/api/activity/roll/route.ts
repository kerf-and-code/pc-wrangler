import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callAs, isUuid, placesFor, sessionFrom } from "@/lib/discord/activity";
import { tableRoll } from "@/lib/tabletop/roll-core";

// POST /api/activity/roll   body: { campaign, notation, label?, characterId?, initiative?, gmOnly? }
// (2026-11-11, push 34, audit P7)
//
// A roll from the Discord Activity, made exactly as a roll at the web tabletop (lib/tabletop/roll-core):
// the server rolls, the card goes to the table's chat, and with `initiative` the total becomes the
// character's initiative in the running fight. The caller must be the campaign's GM or a player
// (p158); a player rolls as themselves or their own character, and only the GM may roll hidden.

export const maxDuration = 30;

export async function POST(req: Request) {
  const s = sessionFrom(req);
  if (!s) return NextResponse.json({ error: "Your Discord session ended. Close the Activity and open it again." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { campaign?: string; notation?: string; label?: string; characterId?: string | null; initiative?: boolean; gmOnly?: boolean };
  if (!isUuid(b.campaign)) return NextResponse.json({ error: "Pick a campaign." }, { status: 400 });
  const admin = createAdminClient();
  const place = (await placesFor(admin, s).catch(() => [])).find((p) => p.campaignId === b.campaign);
  if (!place || place.role === "watch" || !place.profileId) {
    return NextResponse.json({ error: "Watching only: sign in to Six Axes with Discord, or /claim your character, to roll." }, { status: 403 });
  }
  const uid = place.profileId, campaign = b.campaign;
  const r = await tableRoll(admin, {
    userId: uid,
    isGm: place.role === "gm",
    openSession: async () => callAs(admin, uid, "tabletop_open_session", { campaign }).catch(() => null),
  }, {
    campaignId: campaign,
    notation: typeof b.notation === "string" ? b.notation.slice(0, 60) : "",
    label: typeof b.label === "string" ? b.label.slice(0, 120) : "",
    characterId: isUuid(b.characterId) ? b.characterId : null,
    initiative: !!b.initiative,
    gmOnly: place.role === "gm" && !!b.gmOnly,
  });
  return NextResponse.json(r.body, { status: r.status });
}
