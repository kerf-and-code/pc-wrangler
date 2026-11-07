import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { roll, DiceError } from "@/lib/dice";

// app/api/tabletop/roll/route.ts (2026-11-06)
//
// A roll made at the tabletop. Like /api/rolls/gm, the SERVER rolls (lib/dice, crypto rejection
// sampling), so the number in chat, the number stored and the number Mechanics reads are one number.
// It writes two rows with the service role:
//   vtt_events    the canonical roll, Beyond20-shaped so Mechanics reads it unchanged, source
//                 'six_axes_tabletop'. Only when a session is open (vtt_events.session_id is NOT NULL),
//                 exactly as /api/vtt/ingest refuses rolls with no open session.
//   vtt_messages  the chat card everyone at the table sees (or only the GM, for /gr).
// Who may roll: the GM, or a player who owns a pc in the campaign; a player may roll as their own
// character only. Checked with the caller's own session through the same functions RLS uses.

export const maxDuration = 30;

function groupForBeyond20(dice: { sides: number; value: number; kept: boolean }[]) {
  const by = new Map<number, number[]>();
  for (const d of dice.filter((x) => x.kept)) {
    const list = by.get(d.sides) ?? [];
    list.push(d.value);
    by.set(d.sides, list);
  }
  return [...by.entries()].map(([faces, results]) => ({ faces, results }));
}

function advantageFlag(notation: string): number {
  if (/d20kh/i.test(notation)) return 1;
  if (/d20kl/i.test(notation)) return -1;
  return 0;
}

// The label decides how Mechanics files the roll; anything unrecognised is "other" rather than a guess.
function eventType(label: string): string {
  const l = label.toLowerCase();
  if (/initiative/.test(l)) return "initiative";
  if (/\bsave\b|saving/.test(l)) return "saving-throw";
  if (/damage|\bdmg\b/.test(l)) return "damage";
  if (/attack|to hit|to-hit/.test(l)) return "to-hit";
  if (/check|skill|perception|stealth|athletics|acrobatics|insight|investigation|arcana/.test(l)) return "skill";
  return "other";
}

export async function POST(req: Request) {
  let b: { campaignId?: string; notation?: string; label?: string; gmOnly?: boolean; characterId?: string | null; asName?: string } = {};
  try { b = await req.json(); } catch { /* guarded below */ }
  const campaignId = typeof b.campaignId === "string" ? b.campaignId : "";
  const label = (typeof b.label === "string" ? b.label : "").trim().slice(0, 120);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const [{ data: isGm }, { data: isPlayer }] = await Promise.all([
    supabase.rpc("is_campaign_gm", { p_campaign: campaignId }),
    supabase.rpc("tabletop_is_player", { p_campaign: campaignId }),
  ]);
  if (!isGm && !isPlayer) return NextResponse.json({ error: "You are not at this table." }, { status: 403 });

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

  let result;
  try {
    result = roll(b.notation ?? "");
  } catch (e) {
    return NextResponse.json({ error: e instanceof DiceError ? e.message : "Could not read that roll." }, { status: 400 });
  }

  const { data: sessionId } = await supabase.rpc("tabletop_open_session", { p_campaign: campaignId });
  const gmOnly = !!b.gmOnly;
  const rolledAt = new Date().toISOString();

  let eventId: string | null = null;
  if (typeof sessionId === "string" && sessionId) {
    const { data: ev, error } = await admin.from("vtt_events").insert({
      campaign_id: campaignId,
      session_id: sessionId,
      character_id: characterId,
      actor_name: actorName,
      ddb_character_id: null,
      source: "six_axes_tabletop",
      event_type: eventType(label),
      name: label || null,
      rolls: {
        total: result.total,
        dice: groupForBeyond20(result.dice),
        critical_success: result.natural === 20,
        critical_failure: result.natural === 1,
        advantage: advantageFlag(b.notation ?? ""),
        notation: result.notation,
        modifier: result.modifier,
        natural: result.natural,
        dropped: result.dice.filter((d) => !d.kept).map((d) => ({ faces: d.sides, value: d.value })),
        kind: eventType(label),
        gm_only: gmOnly,
      },
      state: null,
      fidelity: "canonical",
      rolled_at: rolledAt,
    }).select("id").single();
    if (error) return NextResponse.json({ error: `The roll could not be saved: ${error.message}` }, { status: 500 });
    eventId = (ev as { id: string }).id;
  }

  const { data: msg, error: mErr } = await admin.from("vtt_messages").insert({
    campaign_id: campaignId,
    session_id: typeof sessionId === "string" && sessionId ? sessionId : null,
    author_profile: user.id,
    as_name: actorName,
    character_id: characterId,
    kind: "roll",
    body: label,
    roll: { label, notation: result.notation, total: result.total, dice: result.dice, modifier: result.modifier, natural: result.natural, logged: !!eventId },
    vtt_event_id: eventId,
    gm_only: gmOnly,
  }).select("*").single();
  if (mErr) return NextResponse.json({ error: `The roll was made but could not be posted: ${mErr.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, message: msg, logged: !!eventId });
}
