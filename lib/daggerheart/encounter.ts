// Daggerheart encounter budgeting (SRD 1.0 "Building Balanced Encounters" - game MECHANICS, open under
// the Darrington Press Community Gaming License). The parallel to the D&D XP budget and the PF2e level
// budget: a party has a pool of Battle Points, and each adversary costs points by its TYPE (a Solo is a
// whole fight; a Minion group is cheap). Start with (3 x PCs in combat) + 2 points, apply the optional
// adjustments, then spend.

import type { DHAdversaryType } from "./adversary";

// Battle-point cost per adversary. A Minion costs 1 point for a GROUP equal to the party's size, so a
// "minion" row's count is the number of party-sized groups.
export const DH_BP_COST: Record<DHAdversaryType, number> = {
  minion: 1, social: 1, support: 1,
  horde: 2, ranged: 2, skulk: 2, standard: 2,
  leader: 3,
  bruiser: 4,
  solo: 5,
};

// Base Battle Points for a party of `size` PCs in combat: (3 x size) + 2.
export function dhBattlePoints(size: number): number {
  const s = Number.isFinite(size) && size > 0 ? Math.round(size) : 4;
  return 3 * s + 2;
}

// The optional battle-point adjustments (each shifts the budget). Signs follow the SRD: spending MORE
// points buys a harder fight, so "+2 for a harder fight" RAISES the budget.
export type DHAdjustment = "harder" | "easier" | "twoPlusSolos" | "bonusDamage" | "lowerTier" | "noElite";
export const DH_ADJUSTMENTS: { id: DHAdjustment; label: string; delta: number }[] = [
  { id: "harder", label: "Harder or longer fight", delta: 2 },
  { id: "easier", label: "Easier or shorter fight", delta: -1 },
  { id: "twoPlusSolos", label: "Using 2 or more Solo adversaries", delta: -2 },
  { id: "bonusDamage", label: "+1d4 (or +2) to all adversaries' damage", delta: -2 },
  { id: "lowerTier", label: "Includes an adversary from a lower tier", delta: 1 },
  { id: "noElite", label: "No Bruisers, Hordes, Leaders, or Solos", delta: 1 },
];

// The adjusted battle-point budget for a party of `size` with the given adjustments active. Not clamped
// low: an over-adjusted budget going toward zero is the GM's own call, and the spend readout shows it.
export function dhAdjustedBudget(size: number, active: DHAdjustment[]): number {
  const delta = DH_ADJUSTMENTS.reduce((n, a) => n + (active.includes(a.id) ? a.delta : 0), 0);
  return dhBattlePoints(size) + delta;
}

// Points spent on one roster row (a type and a count; for Minions the count is party-sized groups).
export function dhAdversaryCost(type: DHAdversaryType, count: number): number {
  return DH_BP_COST[type] * Math.max(0, Math.round(count) || 0);
}

// Total points spent by a roster of {type, count} rows.
export function dhSpend(rows: { type: DHAdversaryType; count: number }[]): number {
  return rows.reduce((n, r) => n + dhAdversaryCost(r.type, r.count), 0);
}
