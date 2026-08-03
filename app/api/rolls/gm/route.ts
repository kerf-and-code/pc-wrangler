import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { roll, DiceError } from "@/lib/dice";

// app/api/rolls/gm/route.ts
//
// Rolls dice on the server and logs the result.
//
// WHY THE SERVER ROLLS RATHER THAN THE BROWSER
//   Not distrust of the GM: it is that a roll which happens in one place and is logged from another
//   can disagree with itself. Rolling here means the number shown, the number stored, and the number
//   the encounter-calibration loop later reads are the same number, produced once.
//
//   It also means the notation is validated by the same parser that evaluates it, so a malformed
//   roll fails before anything is written rather than storing a total with no way to reproduce it.
//
// FIDELITY IS canonical, AND THAT IS THE POINT
//   Beyond20 readings are canonical because they come from D&D Beyond's own dice. These are
//   canonical because the app rolled them itself - there is no transcription, no speech
//   recognition, no human reading a die across a table. That is the whole reason a GM-side roller
//   is worth building: it is the only way to get exact MONSTER numbers, which Beyond20 never sees
//   and which the encounter loop needs to say anything useful about how a fight actually went.

export const maxDuration = 30;

const EVENT_TYPE: Record<string, string> = {
  attack: "to-hit",
  spell: "to-hit",
  damage: "damage",
  save: "saving-throw",
  check: "skill",
  initiative: "initiative",
  other: "other",
};

/** Beyond20 groups by die size: [{ faces: 20, results: [17] }, { faces: 6, results: [3, 5] }]. */
function groupForBeyond20(dice: { sides: number; value: number; kept: boolean }[]) {
  const by = new Map<number, number[]>();
  // Only KEPT dice, so a 2d20kh1 reads as one d20 with the face that counted - which is exactly
  // what advantage means and what the distribution should record.
  for (const d of dice.filter((x) => x.kept)) {
    const list = by.get(d.sides) ?? [];
    list.push(d.value);
    by.set(d.sides, list);
  }
  return [...by.entries()].map(([faces, results]) => ({ faces, results }));
}

/** Beyond20 uses a signed advantage flag. Derived from the keep rule the notation asked for. */
function advantageFlag(notation: string): number {
  if (/d20kh/i.test(notation)) return 1;
  if (/d20kl/i.test(notation)) return -1;
  return 0;
}

export async function POST(req: Request) {
  let b: {
    campaignId?: string; sessionId?: string; notation?: string;
    kind?: string; actorName?: string; characterId?: string | null; label?: string;
  } = {};
  try { b = await req.json(); } catch { /* guarded below */ }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const admin = createAdminClient();
  const { data: camp } = await admin
    .from("campaigns").select("id, gm_id").eq("id", b.campaignId ?? "").maybeSingle();
  if (!camp) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (camp.gm_id !== user.id) {
    return NextResponse.json({ error: "Only this campaign's GM can roll here." }, { status: 403 });
  }

  let result;
  try {
    result = roll(b.notation ?? "");
  } catch (e) {
    // DiceError messages are written to be read by a person, so they pass straight through.
    return NextResponse.json(
      { error: e instanceof DiceError ? e.message : "Could not read that roll." },
      { status: 400 },
    );
  }

  const kind = b.kind && EVENT_TYPE[b.kind] ? b.kind : "other";

  const { error } = await admin.from("vtt_events").insert({
    campaign_id: camp.id,
    session_id: b.sessionId || null,
    // A monster has no character row, so it is named rather than linked. A player using a shared
    // roller does have one, and gets linked properly so their rolls reach their own analytics.
    character_id: b.characterId || null,
    // Falls back to "The GM" rather than null. Mechanics groups by character_id ?? actor_name, so
    // a nameless roll landed under the key "unknown" and rendered as "Unknown (unlinked)" - which
    // reads as a data fault, not as your own rolls, and gets scanned past.
    actor_name: b.actorName?.trim() || (b.characterId ? null : "The GM"),
    ddb_character_id: null,
    source: "six_axes_roller",
    event_type: EVENT_TYPE[kind],
    name: b.label?.trim() || null,
    // SHAPED LIKE BEYOND20, deliberately.
    //
    // The Mechanics page reads a d20 face as rolls.dice.find(g => g.faces === 20).results[0],
    // because that is what Beyond20 sends. A roller emitting its own tidier shape - {sides, value} -
    // wrote rows that Mechanics COUNTED but could not read: the roll incremented the d20 tally and
    // contributed nothing to the distribution, the natural-20s or any average. Present and
    // invisible, which is worse than absent.
    //
    // Conforming here rather than teaching Mechanics a second shape keeps one reader and one
    // format. critical_success / critical_failure / advantage are read directly by that page too.
    rolls: {
      total: result.total,
      dice: groupForBeyond20(result.dice),
      critical_success: result.natural === 20,
      critical_failure: result.natural === 1,
      advantage: advantageFlag(b.notation ?? ""),
      // Ours, kept alongside: the exact notation and which dice a keep rule dropped, so a roll can
      // be reproduced and explained rather than only totalled.
      notation: result.notation,
      modifier: result.modifier,
      natural: result.natural,
      dropped: result.dice.filter((d) => !d.kept).map((d) => ({ faces: d.sides, value: d.value })),
      kind,
    },
    state: null,
    fidelity: "canonical",
    rolled_at: new Date().toISOString(),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, result });
}
