import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { roll, DiceError } from "@/lib/dice";
import { entryFor, parseTable } from "@/lib/tabletop/roll-tables";

// app/api/tabletop/table-roll/route.ts (2026-11-08)
//
// A roll on one of the campaign's rollable tables (p123 roll_tables, phase 5r). The SERVER rolls
// (lib/dice, crypto rejection sampling) and reads the entry with the same parser the editor previews
// with (lib/tabletop/roll-tables), then posts the result to the table's chat as a roll card
// (vtt_messages kind 'roll', with roll.table = { id, name, result }). Not written to vtt_events: a table
// roll is not a check or an attack, so it stays out of the Mechanics numbers.
//
// Who may: the table is read with the caller's own session, so row level security decides: the GM sees
// every table of the campaign, a player only the ones marked players_can_roll. A player may roll as
// their own character only. gmOnly (or the table's results_gm_only) keeps the card between the GM and
// the roller.

export const maxDuration = 15;

export async function POST(req: Request) {
  let b: { campaignId?: string; tableId?: string; gmOnly?: boolean; characterId?: string | null; asName?: string } = {};
  try { b = await req.json(); } catch { /* guarded below */ }
  const campaignId = typeof b.campaignId === "string" ? b.campaignId : "";
  const tableId = typeof b.tableId === "string" ? b.tableId : "";
  if (!/^[0-9a-f-]{36}$/i.test(campaignId) || !/^[0-9a-f-]{36}$/i.test(tableId)) return NextResponse.json({ error: "Pick a table to roll on." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const [{ data: isGm }, { data: isPlayer }] = await Promise.all([
    supabase.rpc("is_campaign_gm", { p_campaign: campaignId }),
    supabase.rpc("tabletop_is_player", { p_campaign: campaignId }),
  ]);
  if (!isGm && !isPlayer) return NextResponse.json({ error: "You are not at this table." }, { status: 403 });

  const { data: tb, error: tErr } = await supabase.from("roll_tables")
    .select("id, campaign_id, name, body, results_gm_only").eq("id", tableId).eq("campaign_id", campaignId).maybeSingle();
  if (tErr) return NextResponse.json({ error: `Could not read the table: ${tErr.message}` }, { status: 500 });
  const table = tb as { id: string; campaign_id: string; name: string; body: string; results_gm_only: boolean } | null;
  if (!table) return NextResponse.json({ error: "That table is not there, or the GM has not shared it." }, { status: 404 });

  const parsed = parseTable(table.body);
  if (!parsed.ok) return NextResponse.json({ error: `${table.name} has a problem: ${parsed.error}` }, { status: 422 });
  const t = parsed.table;

  const admin = createAdminClient();
  let characterId: string | null = null;
  let actorName = (typeof b.asName === "string" ? b.asName : "").trim().slice(0, 80);
  if (b.characterId) {
    const { data: ch } = await admin.from("characters").select("id, name, campaign_id, profile_id").eq("id", b.characterId).maybeSingle();
    const row = ch as { id: string; name: string; campaign_id: string; profile_id: string | null } | null;
    if (!row || row.campaign_id !== campaignId || (!isGm && row.profile_id !== user.id)) {
      return NextResponse.json({ error: "You cannot roll as that character." }, { status: 403 });
    }
    characterId = row.id;
    actorName = actorName || row.name;
  }
  if (!actorName) actorName = isGm ? "GM" : "Player";

  let total = 1, dice: { sides: number; value: number; kept: boolean }[] = [], modifier = 0, notation = "";
  if (t.dice) {
    try {
      const r = roll(t.dice);
      total = r.total; dice = r.dice; modifier = r.modifier; notation = r.notation;
    } catch (e) {
      return NextResponse.json({ error: e instanceof DiceError ? e.message : "The roll failed." }, { status: 422 });
    }
  }
  const result = entryFor(t, total);
  const shown = result ?? `nothing on ${total}`;

  const { data: sessionId } = await supabase.rpc("tabletop_open_session", { p_campaign: campaignId });
  const gmOnly = !!b.gmOnly || table.results_gm_only;
  const { data: msg, error: mErr } = await admin.from("vtt_messages").insert({
    campaign_id: campaignId,
    session_id: typeof sessionId === "string" && sessionId ? sessionId : null,
    author_profile: user.id,
    as_name: actorName,
    character_id: characterId,
    kind: "roll",
    body: `${table.name}: ${shown}`.slice(0, 2000),
    roll: { label: table.name, notation, total, dice, modifier, natural: null, logged: false, table: { id: table.id, name: table.name, result: shown, found: result !== null } },
    gm_only: gmOnly,
  }).select("*").single();
  if (mErr) return NextResponse.json({ error: `The roll was made but could not be posted: ${mErr.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, message: msg, total, result: shown });
}
