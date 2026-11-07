import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { roll, DiceError } from "@/lib/dice";
import { sortForTurns, type Combatant } from "@/lib/combat";
import { critDice } from "@/lib/combat-effects";

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
//
// Initiative (phase 2b): with `initiative: true` and a character, the total also becomes that
// character's initiative in the campaign's active fight (the Combat page's combats row), if it has none
// yet, so players roll their own and the turn tracker fills in. Before the first turn is taken the order
// is sorted at once, exactly as the Combat page does after rolling monster initiative.
//
// Attacks (phase 4a): with `target` (a combatant id) and `rollFor: "attack"`, the roll is an attack on
// that combatant. combat_attack_resolve (p110) checks the turn gate and compares the roll with the
// target's AC in the database, so the AC never reaches the player; the chat card says hit or miss.
// With `rollFor: "damage"` and the same target, the damage lands on it after a hit, once, and a
// critical hit doubles the dice. Both functions run with the service role; the checks above (who is
// rolling, and as which character) come first.
//
// Saves (phase 4b, p111): with `saveFor` (a pending save's id) the roll is the character's own saving
// throw against it; combat_resolve_save compares it with the DC and applies full, half or no damage.
// With `saveAgainst` ({ targets, ability, dc, half, type }) the roll is the damage of the character's
// own save effect, rolled once, and combat_request_save leaves it pending on each target until each
// one rolls (the GM rolls for monsters).
//
// Action economy (phase 4c, p112): `cost` says what part of the turn an attack or save effect uses:
// attack (one attack of the Attack action; Extra Attack gives more), action, bonus or reaction (allowed
// on someone else's turn while the reaction is unused). The database spends it and refuses when it is
// gone. Attacks default to attack, save effects to action.

export const maxDuration = 30;

function friendlyFight(m: string): string {
  if (/not your turn/.test(m)) return "It is not your turn. A reaction can be used on anyone's turn.";
  if (/used your action/.test(m)) return "You have used your action this turn.";
  if (/used your bonus action/.test(m)) return "You have used your bonus action this turn.";
  if (/used your reaction/.test(m)) return "You have used your reaction this round. It comes back at the start of your turn.";
  if (/cannot act while/.test(m)) return `You ${m.replace(/^.*?(cannot act while \w+).*$/, "$1")}.`;
  if (/unknown cost/.test(m)) return "Pick what this uses: attack, action, bonus action or reaction.";
  if (/no fight/.test(m)) return "No fight is running.";
  if (/not in the fight/.test(m)) return "Your character is not in the fight.";
  if (/roll a hit/.test(m)) return "Roll a hit on them first.";
  if (/someone else/.test(m)) return "Pick someone else to attack.";
  if (/no such combatant/.test(m)) return "They are no longer in the fight.";
  if (/already settled/.test(m)) return "That save is already settled.";
  if (/pick an ability|DC must|at least one target|too many targets/.test(m)) return m.charAt(0).toUpperCase() + m.slice(1) + ".";
  return m;
}

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
  let b: { campaignId?: string; notation?: string; label?: string; gmOnly?: boolean; characterId?: string | null; asName?: string; initiative?: boolean; target?: string; rollFor?: "attack" | "damage";
    saveFor?: string; saveAgainst?: { targets?: string[]; ability?: string; dc?: number; half?: boolean; type?: string }; cost?: string } = {};
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

  const target = typeof b.target === "string" && b.target ? b.target.slice(0, 64) : null;
  const rollFor = target && characterId && (b.rollFor === "attack" || b.rollFor === "damage") ? b.rollFor : null;
  let notation = b.notation ?? "";
  const cost = typeof b.cost === "string" && ["attack", "action", "bonus", "reaction", "free"].includes(b.cost) ? b.cost : null;

  // A damage roll at a target needs a hit on it first; a critical hit doubles the dice.
  if (rollFor === "damage") {
    const { data: cb } = await admin.from("combats").select("combatants")
      .eq("campaign_id", campaignId).eq("status", "active").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    const att = ((cb as { combatants: (Combatant & { lastAttack?: { target: string; hit: boolean | null; crit: boolean; applied?: boolean; at: number } })[] } | null)?.combatants ?? [])
      .find((c) => c.kind === "pc" && c.characterId === characterId);
    const la = att?.lastAttack;
    if (!la || la.target !== target || la.hit !== true || la.applied || Date.now() / 1000 - Number(la.at) > 180) {
      return NextResponse.json({ error: "Roll a hit on them first." }, { status: 409 });
    }
    if (la.crit) notation = critDice(notation);
  }

  let result;
  try {
    result = roll(notation);
  } catch (e) {
    return NextResponse.json({ error: e instanceof DiceError ? e.message : "Could not read that roll." }, { status: 400 });
  }

  // A save effect on targets: the damage is this roll, rolled once; each target waits to roll its save.
  let saveNote: { targets: string[]; ability: string; dc: number } | null = null;
  if (b.saveAgainst && characterId) {
    const sa = b.saveAgainst;
    const targets = Array.isArray(sa.targets) ? sa.targets.filter((t) => typeof t === "string").slice(0, 30) : [];
    const { data: res, error: sErr } = await admin.rpc("combat_request_save", {
      p_campaign: campaignId, p_character: characterId, p_targets: targets, p_ability: String(sa.ability ?? ""),
      p_dc: Number(sa.dc), p_damage: result.total, p_type: typeof sa.type === "string" ? sa.type : "", p_half: sa.half !== false,
      p_label: label, p_gm: !!isGm, p_cost: cost === "attack" ? "action" : cost ?? "action",
    });
    if (sErr) return NextResponse.json({ error: friendlyFight(sErr.message) }, { status: 409 });
    saveNote = { targets: ((res as { targets: string[] }).targets) ?? [], ability: String(sa.ability), dc: Number(sa.dc) };
  }
  // A character's own save against a pending effect.
  let saved: { saved: boolean; damage: number; dc: number; label: string; by: string } | null = null;
  if (b.saveFor && characterId) {
    const { data: res, error: rErr } = await admin.rpc("combat_resolve_save", {
      p_campaign: campaignId, p_character: characterId, p_save: String(b.saveFor).slice(0, 64), p_total: result.total,
    });
    if (rErr) return NextResponse.json({ error: friendlyFight(rErr.message) }, { status: 409 });
    saved = res as { saved: boolean; damage: number; dc: number; label: string; by: string };
  }

  // An attack: the turn gate and the AC comparison happen in the database.
  let against: { target: string; hit: boolean | null; crit: boolean; applied?: boolean; defeated?: boolean; attacksLeft?: number } | null = null;
  if (rollFor === "attack") {
    const { data: res, error: aErr } = await admin.rpc("combat_attack_resolve", {
      p_campaign: campaignId, p_character: characterId, p_target: target, p_total: result.total,
      p_natural: result.natural ?? null, p_label: label, p_gm: !!isGm, p_cost: cost ?? "attack",
    });
    if (aErr) return NextResponse.json({ error: friendlyFight(aErr.message) }, { status: 409 });
    const r = res as { hit: boolean | null; crit: boolean; target: string; attacksLeft?: number };
    against = { target: r.target, hit: r.hit, crit: r.crit, attacksLeft: r.attacksLeft ?? 0 };
  }

  const { data: sessionId } = await supabase.rpc("tabletop_open_session", { p_campaign: campaignId });
  const gmOnly = !!b.gmOnly;
  const rolledAt = new Date().toISOString();

  const kindOf = rollFor === "attack" ? "to-hit" : rollFor === "damage" || b.saveAgainst ? "damage" : b.saveFor ? "saving-throw" : eventType(label);
  let eventId: string | null = null;
  if (typeof sessionId === "string" && sessionId) {
    const { data: ev, error } = await admin.from("vtt_events").insert({
      campaign_id: campaignId,
      session_id: sessionId,
      character_id: characterId,
      actor_name: actorName,
      ddb_character_id: null,
      source: "six_axes_tabletop",
      event_type: kindOf,
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
        kind: kindOf,
        gm_only: gmOnly,
      },
      state: null,
      fidelity: "canonical",
      rolled_at: rolledAt,
    }).select("id").single();
    if (error) return NextResponse.json({ error: `The roll could not be saved: ${error.message}` }, { status: 500 });
    eventId = (ev as { id: string }).id;
  }

  // Damage at a target lands now, before the card is posted, so the card can say it did.
  if (rollFor === "damage") {
    const { data: res, error: dErr } = await admin.rpc("combat_attack_damage", {
      p_campaign: campaignId, p_character: characterId, p_target: target, p_amount: result.total,
    });
    if (dErr) return NextResponse.json({ error: friendlyFight(dErr.message) }, { status: 409 });
    const r = res as { target: string; defeated: boolean };
    against = { target: r.target, hit: true, crit: notation !== (b.notation ?? ""), applied: true, defeated: r.defeated };
  }

  const { data: msg, error: mErr } = await admin.from("vtt_messages").insert({
    campaign_id: campaignId,
    session_id: typeof sessionId === "string" && sessionId ? sessionId : null,
    author_profile: user.id,
    as_name: actorName,
    character_id: characterId,
    kind: "roll",
    body: label,
    roll: { label, notation: result.notation, total: result.total, dice: result.dice, modifier: result.modifier, natural: result.natural, logged: !!eventId, against, saveNote, saved },
    vtt_event_id: eventId,
    gm_only: gmOnly,
  }).select("*").single();
  if (mErr) return NextResponse.json({ error: `The roll was made but could not be posted: ${mErr.message}` }, { status: 500 });

  let initiativeSet = false;
  if (b.initiative && characterId) {
    const { data: cb } = await admin.from("combats").select("id, round, turn, combatants")
      .eq("campaign_id", campaignId).eq("status", "active").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    const row = cb as { id: string; round: number; turn: number; combatants: Combatant[] } | null;
    const mine = row?.combatants.find((c) => c.kind === "pc" && c.characterId === characterId);
    if (row && mine && mine.initiative == null) {
      const withInit = row.combatants.map((c) => (c.id === mine.id ? { ...c, initiative: result.total } : c));
      const first = row.round === 1 && row.turn === 0;
      const { error: cErr } = await admin.from("combats").update({
        combatants: first ? sortForTurns(withInit) : withInit, turn: first ? 0 : row.turn, updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      initiativeSet = !cErr;
    }
  }

  return NextResponse.json({ ok: true, message: msg, logged: !!eventId, initiativeSet, against, saveNote, saved });
}
