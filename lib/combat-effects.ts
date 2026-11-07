import { CONDITIONS, type Econ } from "@/lib/combat";

// lib/combat-effects.ts (2026-11-07)
//
// What can sit on a combatant beside its HP: the fifteen conditions plus Concentrating (lib/combat.ts),
// and the buffs and debuffs players and the GM mark most often at the table. These are reminders on the
// combatant, not rules the table enforces. combat_markers() in p110 holds the same list, so a player
// can only add what the database knows.

export const BUFFS = ["Blessed", "Hasted", "Inspired", "Raging", "Dodging", "Shielded"] as const;
export const DEBUFFS = ["Baned", "Slowed", "Hexed", "Marked", "Outlined", "Vulnerable"] as const;

export const MARKERS: string[] = [...CONDITIONS, ...BUFFS, ...DEBUFFS];

export type MarkerKind = "condition" | "buff" | "debuff";
export function markerKind(m: string): MarkerKind {
  if ((BUFFS as readonly string[]).includes(m)) return "buff";
  if ((DEBUFFS as readonly string[]).includes(m)) return "debuff";
  return "condition";
}

// Short labels for the badges on a token, unique across every marker.
const SHORT: Record<string, string> = {
  Blinded: "Bd", Charmed: "Ch", Deafened: "Df", Exhaustion: "Ex", Frightened: "Fr", Grappled: "Gr",
  Incapacitated: "In", Invisible: "Iv", Paralyzed: "Pa", Petrified: "Pe", Poisoned: "Po", Prone: "Pr",
  Restrained: "Re", Stunned: "St", Unconscious: "Un", Concentrating: "Co",
  Blessed: "Bl", Hasted: "Ha", Inspired: "Is", Raging: "Ra", Dodging: "Do", Shielded: "Sh",
  Baned: "Ba", Slowed: "Sl", Hexed: "Hx", Marked: "Mk", Outlined: "Ou", Vulnerable: "Vu",
};
export const markerShort = (m: string): string => SHORT[m] ?? m.slice(0, 2);

// Badge colours by kind: conditions purple (as before), buffs green, debuffs red.
export const MARKER_COLORS: Record<MarkerKind, { fill: string; line: string }> = {
  condition: { fill: "#3b2f6b", line: "#c2a8f0" },
  buff: { fill: "#24502c", line: "#8fd18a" },
  debuff: { fill: "#5a2424", line: "#e07a70" },
};

// A critical hit rolls every damage die twice: "2d6+3" becomes "4d6+3", "d8" becomes "2d8".
export function critDice(notation: string): string {
  return notation.replace(/(\d*)d(\d+)/gi, (_m, n: string, sides: string) => `${(Number(n) || 1) * 2}d${sides}`);
}

// ---- action economy (phase 4c, p112) ----
// The database holds the rules (combat_spend, combat_move, combat_speed in p112); these mirror them so
// the screens can show what is left without a round trip.

export const FRESH_ECON: Econ = { action: false, bonus: false, reaction: false, moved: 0, dash: 0, attacks: 0, log: [] };
export const econOf = (c: { econ?: Partial<Econ> | null }): Econ => ({ ...FRESH_ECON, ...(c.econ ?? {}) });

const NO_MOVE = ["Grappled", "Restrained", "Paralyzed", "Petrified", "Stunned", "Unconscious"];
export const NO_ACT = ["Unconscious", "Petrified", "Paralyzed", "Stunned", "Incapacitated"];

/** Speed after conditions: 0 when held or out, doubled when Hasted, halved when Slowed. */
export function speedNow(speed: number | null | undefined, conditions: string[] = []): number | null {
  if (speed == null) return null;
  if (conditions.some((c) => NO_MOVE.includes(c))) return 0;
  let s = speed;
  if (conditions.includes("Hasted")) s *= 2;
  if (conditions.includes("Slowed")) s = Math.floor(s / 2);
  return s;
}
export const cantAct = (conditions: string[] = []): string | null => NO_ACT.find((c) => conditions.includes(c)) ?? null;

/** Movement left this turn, or null when speed is not tracked. */
export function movementLeft(e: Econ, speed: number | null): number | null {
  return speed == null ? null : Math.max(0, speed + e.dash - e.moved);
}

/** Attacks one Attack action makes, from class levels (Extra Attack does not stack across classes). */
export function attacksPerAction(classes: { className: string; subclass?: string; level: number }[]): number {
  let n = 1;
  for (const c of classes) {
    const k = c.className.toLowerCase(), sub = (c.subclass ?? "").toLowerCase(), lv = c.level || 0;
    if (k === "fighter") n = Math.max(n, lv >= 20 ? 4 : lv >= 11 ? 3 : lv >= 5 ? 2 : 1);
    else if (["barbarian", "monk", "paladin", "ranger"].includes(k) && lv >= 5) n = Math.max(n, 2);
    else if (k === "bard" && lv >= 6 && /valor|swords/.test(sub)) n = Math.max(n, 2);
    else if (k === "wizard" && lv >= 6 && /blade/.test(sub)) n = Math.max(n, 2);
  }
  return n;
}

/** The standard actions anyone can take, and what each one costs. Dash adds your speed to this turn. */
export const STANDARD_ACTIONS: { name: string; tip: string }[] = [
  { name: "Dash", tip: "Move up to your speed again this turn" },
  { name: "Disengage", tip: "Your movement does not provoke opportunity attacks this turn" },
  { name: "Dodge", tip: "Attacks against you have disadvantage and you make DEX saves with advantage, until your next turn" },
  { name: "Help", tip: "Give an ally advantage on their next check or attack" },
  { name: "Hide", tip: "Make a DEX (Stealth) check" },
  { name: "Influence", tip: "Make a CHA or WIS check to sway a creature" },
  { name: "Magic", tip: "Cast a spell or use a magic item (spell attacks and save effects spend this for you)" },
  { name: "Ready", tip: "Pick a trigger; act with your reaction when it happens" },
  { name: "Search", tip: "Make a WIS check to find something" },
  { name: "Study", tip: "Make an INT check to recall or work something out" },
  { name: "Utilize", tip: "Use an object (a potion, a lever)" },
];
export const COST_LABEL: Record<string, string> = { action: "Action", attack: "Attack", bonus: "Bonus action", reaction: "Reaction", move: "Move", free: "No cost" };
