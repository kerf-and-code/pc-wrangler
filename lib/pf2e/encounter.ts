// PF2e encounter budgeting (Pathfinder 2e GM Core / Core Rulebook, encounter-building rules - game
// MECHANICS, open under OGL/ORC). A party of four has a per-threat XP budget; each PC above or below
// four adjusts it. A creature costs XP by its level RELATIVE to the party level, so the same monster
// is a different threat to different parties.

export type PF2Threat = "trivial" | "low" | "moderate" | "severe" | "extreme";
export const PF2_THREATS: PF2Threat[] = ["trivial", "low", "moderate", "severe", "extreme"];

export const PF2_THREAT_LABEL: Record<PF2Threat, string> = {
  trivial: "Trivial", low: "Low", moderate: "Moderate", severe: "Severe", extreme: "Extreme",
};

// XP budget for a four-player party, per threat.
const BASE: Record<PF2Threat, number> = { trivial: 40, low: 60, moderate: 80, severe: 120, extreme: 160 };
// Adjustment added/subtracted per character above/below four.
const PER_CHAR: Record<PF2Threat, number> = { trivial: 10, low: 15, moderate: 20, severe: 30, extreme: 40 };

// Creature XP by (creatureLevel - partyLevel). PF2e tables it from party-level-4 to party-level+4.
const XP_BY_DELTA: Record<string, number> = { "-4": 10, "-3": 15, "-2": 20, "-1": 30, "0": 40, "1": 60, "2": 80, "3": 120, "4": 160 };

// The per-threat XP thresholds for a party of `size` (level doesn't change the budget - only the
// party size does; level changes creature COSTS). Never negative.
export function pf2Budget(size: number): Record<PF2Threat, number> {
  const adj = (Number.isFinite(size) ? size : 4) - 4;
  const out = {} as Record<PF2Threat, number>;
  for (const t of PF2_THREATS) out[t] = Math.max(0, BASE[t] + adj * PER_CHAR[t]);
  return out;
}

// A single creature's XP cost against a party level. Below party-level-4 it's negligible (0); above
// party-level+4 we extrapolate at +40/level so absurd fights still read as "beyond Extreme".
export function pf2CreatureXp(creatureLevel: number, partyLevel: number): number {
  const d = Math.round(creatureLevel - partyLevel);
  if (d <= -5) return 0;
  if (d >= 5) return 160 + (d - 4) * 40;
  return XP_BY_DELTA[String(d)] ?? 0;
}

// Total XP for an encounter (a list of creature levels) against a party level.
export function pf2EncounterXp(creatureLevels: number[], partyLevel: number): number {
  return creatureLevels.reduce((sum, lvl) => sum + pf2CreatureXp(lvl, partyLevel), 0);
}

// The threat rating for a total XP against a party size: the highest threat whose threshold the total
// meets or exceeds, or null when it's below even Trivial.
export function pf2Threat(totalXp: number, size: number): PF2Threat | null {
  const b = pf2Budget(size);
  let out: PF2Threat | null = null;
  for (const t of PF2_THREATS) if (totalXp >= b[t]) out = t;
  return out;
}
