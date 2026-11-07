import { CONDITIONS } from "@/lib/combat";

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
