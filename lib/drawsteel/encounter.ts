// Draw Steel encounter budgeting (Draw Steel Rules Reference / Monster Basics, "Step-by-Step Encounter
// Building" - game MECHANICS, used under the Draw Steel Creator License). The parallel to the D&D XP
// budget, the PF2e level budget, and the Daggerheart Battle Points: a party has an Encounter Strength
// (ES), and each monster costs its Encounter Value (EV). Difficulty is a band relative to ES.
//
// Encounter Strength: each hero's ES starts at a baseline of 4, +2 per level. Sum across the party.
// Then add one hero's worth of ES for every 2 Victories the party has earned on average.
//
// Difficulty bands (Step 4), where H is one hero's ES:
//   Trivial : budget < ES - H
//   Easy    : ES - H <= budget < ES
//   Standard: ES <= budget <= ES + H
//   Hard    : ES + H < budget <= ES + 3H
//   Extreme : budget > ES + 3H
//
// Spending (Step 5): each creature costs its EV. Minions are bought four at a time, so a Minion row's
// EV is the cost of a group of four and its count is the number of such groups.

import type { DSOrganization } from "./adversary";
import { dsBenchmarkEV } from "./adversary";

// One hero's Encounter Strength at a given level: 4 + 2*level.
export function dsHeroES(level: number): number {
  const L = Math.max(1, Math.min(10, Math.round(level) || 1));
  return 4 + 2 * L;
}

// The party's Encounter Strength for `size` heroes of `level`, plus the Victories bump (one extra
// hero's ES per 2 average Victories). Uniform-level party, matching how the builder collects it.
export function dsPartyES(size: number, level: number, victories: number): number {
  const s = Math.max(1, Math.round(size) || 1);
  const v = Math.max(0, Math.round(victories) || 0);
  const extraHeroes = Math.floor(v / 2);
  return (s + extraHeroes) * dsHeroES(level);
}

export type DSDifficulty = "trivial" | "easy" | "standard" | "hard" | "extreme";
export const DS_DIFFICULTY_LABEL: Record<DSDifficulty, string> = {
  trivial: "Trivial", easy: "Easy", standard: "Standard", hard: "Hard", extreme: "Extreme",
};

// The band edges for a party, in EV. Returned together so the builder can show the whole ladder and
// place a spend on it. `hero` is one hero's ES (the width of a band step).
export interface DSBands {
  es: number;
  hero: number;
  trivialMax: number;    // budgets strictly below this are Trivial (= ES - H)
  standardMin: number;   // Standard starts here (= ES)
  standardMax: number;   // Standard ends here inclusive (= ES + H)
  hardMax: number;       // Hard ends here inclusive (= ES + 3H)
}

export function dsBands(size: number, level: number, victories: number): DSBands {
  const es = dsPartyES(size, level, victories);
  const hero = dsHeroES(level);
  return {
    es, hero,
    trivialMax: es - hero,
    standardMin: es,
    standardMax: es + hero,
    hardMax: es + 3 * hero,
  };
}

// Which difficulty a given EV spend lands in, for the party's bands.
export function dsDifficultyOf(spent: number, b: DSBands): DSDifficulty {
  if (spent < b.trivialMax) return "trivial";
  if (spent < b.standardMin) return "easy";
  if (spent <= b.standardMax) return "standard";
  if (spent <= b.hardMax) return "hard";
  return "extreme";
}

// A roster row's EV cost. `ev` is the per-creature EV (for a Minion, the EV of a group of four); count
// is the number of creatures, or for Minions the number of four-creature groups.
export function dsRowCost(ev: number, count: number): number {
  return Math.max(0, Math.round(ev) || 0) * Math.max(0, Math.round(count) || 0);
}

// Total EV spent by a roster of {ev, count} rows.
export function dsSpend(rows: { ev: number; count: number }[]): number {
  return rows.reduce((n, r) => n + dsRowCost(r.ev, r.count), 0);
}

// The benchmark EV for a manually-added row of a given organization at a given creature level. Re-exported
// from the adversary module so the encounter builder has one import for its EV math.
export { dsBenchmarkEV };
