import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tableRoll, type RollBody } from "@/lib/tabletop/roll-core";

// app/api/tabletop/roll/route.ts (2026-11-06)
//
// A roll made at the tabletop. The server rolls (lib/dice), posts the chat card and, as asked, sets
// initiative, resolves an attack, lands damage or handles a save. Push 34 moved the body of the roll to
// lib/tabletop/roll-core.ts, unchanged, so the Discord Activity rolls the same way; the full description
// of every option lives there. This route checks who is rolling with the caller's own session: the GM,
// or a player who owns a pc in the campaign.

export const maxDuration = 30;

export async function POST(req: Request) {
  let b: RollBody = {};
  try { b = await req.json(); } catch { /* guarded below */ }
  const campaignId = typeof b.campaignId === "string" ? b.campaignId : "";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const [{ data: isGm }, { data: isPlayer }] = await Promise.all([
    supabase.rpc("is_campaign_gm", { p_campaign: campaignId }),
    supabase.rpc("tabletop_is_player", { p_campaign: campaignId }),
  ]);
  if (!isGm && !isPlayer) return NextResponse.json({ error: "You are not at this table." }, { status: 403 });

  const r = await tableRoll(createAdminClient(), {
    userId: user.id,
    isGm: !!isGm,
    openSession: async () => (await supabase.rpc("tabletop_open_session", { p_campaign: campaignId })).data,
  }, b);
  return NextResponse.json(r.body, { status: r.status });
}
