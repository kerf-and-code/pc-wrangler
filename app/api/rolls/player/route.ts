import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { roll, DiceError } from "@/lib/dice";

// app/api/rolls/player/route.ts
//
// A player rolling their own character from the Forge.
//
// WHY NOT REUSE /api/rolls/gm
//   That route authorises on campaigns.gm_id, which is exactly right for monster rolls and exactly
//   wrong here: a player is not their table's GM. The authorisation question is different - "is
//   this your character" rather than "is this your campaign" - so it gets its own route rather than
//   a flag that widens the GM one.
//
// THE SERVER ROLLS, as it does for the GM roller. A roll made in one place and logged from another
// can disagree with itself, and this number reaches the same Mechanics page and the same encounter
// maths as everything else.
//
// A LIBRARY BUILD HAS NOWHERE TO LOG, and that is not an error. A character that is not playing at
// a table has no session, so the roll happens and simply is not recorded. Refusing to roll would be
// worse: trying a build's numbers before taking it to a campaign is a reasonable thing to do.

export const maxDuration = 30;

const EVENT_TYPE: Record<string, string> = {
  check: "ability",
  skill: "skill",
  save: "saving-throw",
  initiative: "initiative",
  attack: "to-hit",
  damage: "damage",
  other: "other",
};

function groupForBeyond20(dice: { sides: number; value: number; kept: boolean }[]) {
  const by = new Map<number, number[]>();
  for (const d of dice.filter((x) => x.kept)) {
    const list = by.get(d.sides) ?? [];
    list.push(d.value);
    by.set(d.sides, list);
  }
  return [...by.entries()].map(([faces, results]) => ({ faces, results }));
}

export async function POST(req: Request) {
  let b: { characterId?: string; notation?: string; kind?: string; label?: string } = {};
  try { b = await req.json(); } catch { /* guarded below */ }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let result;
  try {
    result = roll(b.notation ?? "");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof DiceError ? e.message : "Could not read that roll." },
      { status: 400 },
    );
  }

  // No character means a library build: roll, return, record nothing.
  if (!b.characterId) return NextResponse.json({ ok: true, logged: false, result });

  const admin = createAdminClient();
  const { data: ch } = await admin
    .from("characters")
    .select("id, campaign_id, profile_id, name")
    .eq("id", b.characterId)
    .maybeSingle();

  if (!ch) return NextResponse.json({ error: "Character not found." }, { status: 404 });
  if (ch.profile_id !== user.id) {
    return NextResponse.json({ error: "That is not your character." }, { status: 403 });
  }

  // The open session, if there is one. A roll made between sessions is still a real roll and is
  // still returned; it just has nothing to attach to, and saying so beats logging it against
  // whichever session happened to be most recent.
  const { data: session } = await admin
    .from("sessions")
    .select("id")
    .eq("campaign_id", ch.campaign_id)
    .is("ended_at", null)
    .order("session_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) return NextResponse.json({ ok: true, logged: false, result, reason: "no open session" });

  const kind = b.kind && EVENT_TYPE[b.kind] ? b.kind : "other";
  const { error } = await admin.from("vtt_events").insert({
    campaign_id: ch.campaign_id,
    session_id: session.id,
    character_id: ch.id,
    actor_name: null,
    ddb_character_id: null,
    source: "six_axes_sheet",
    event_type: EVENT_TYPE[kind],
    name: b.label?.trim() || null,
    rolls: {
      total: result.total,
      dice: groupForBeyond20(result.dice),
      critical_success: result.natural === 20,
      critical_failure: result.natural === 1,
      advantage: /d20kh/i.test(b.notation ?? "") ? 1 : /d20kl/i.test(b.notation ?? "") ? -1 : 0,
      notation: result.notation,
      modifier: result.modifier,
      natural: result.natural,
      dropped: result.dice.filter((d) => !d.kept).map((d) => ({ faces: d.sides, value: d.value })),
      kind,
    },
    state: null,
    // The app rolled it. No transcription, no speech recognition, no one reading a die across a
    // table - the same standing as a Beyond20 reading.
    fidelity: "canonical",
    rolled_at: new Date().toISOString(),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, logged: true, result });
}
