// lib/ability-gen.ts
//
// The three ways a character's ability scores get decided, as rules rather than as UI.
//
// WHY A SEPARATE FILE
//   Standard array, point buy and rolling look like one feature and are three different validation
//   models. Standard array and rolling hand you a POOL and ask where each value goes - every value
//   used exactly once. Point buy gives you a BUDGET and a per-score ceiling, and the same score
//   costs different amounts depending where you are on the curve. Mixing those three sets of rules
//   into a panel is how you end up with a character who spent 27 points and also has a 17.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   It does not apply species or background bonuses. Those are added AFTER generation by the
//   derivation engine, which is why point buy caps at 15 rather than 20 - the cap is on what you
//   buy, not on what you end up with. A generator that enforced the final number would refuse a
//   legal character.

export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";
export const ABILITY_KEYS: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];

export type GenMode = "manual" | "array" | "point" | "roll";

/** The standard array, highest first because that is the order people assign from. */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

/**
 * Point buy costs. Not linear: 14 costs 7 rather than 6, and 15 costs 9 rather than 8, which is the
 * whole point of the system. A loop that charged one point per step would let a player buy two 15s
 * and still have change.
 */
export const POINT_COSTS: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};
export const POINT_BUDGET = 27;
export const POINT_MIN = 8;
export const POINT_MAX = 15;

export function pointsSpent(scores: Partial<Record<AbilityKey, number>>): number {
  let total = 0;
  for (const k of ABILITY_KEYS) {
    const v = scores[k];
    if (typeof v !== "number") continue;
    // An out-of-range score costs nothing rather than throwing: a character switched INTO point buy
    // from manual entry may hold an 18, and the panel needs to report that state, not crash on it.
    total += POINT_COSTS[v] ?? 0;
  }
  return total;
}

/** Whether one more point in this ability is affordable and legal. */
export function canRaise(scores: Partial<Record<AbilityKey, number>>, k: AbilityKey): boolean {
  const cur = scores[k] ?? POINT_MIN;
  if (cur >= POINT_MAX) return false;
  const cost = (POINT_COSTS[cur + 1] ?? Infinity) - (POINT_COSTS[cur] ?? 0);
  return pointsSpent(scores) + cost <= POINT_BUDGET;
}

export function canLower(scores: Partial<Record<AbilityKey, number>>, k: AbilityKey): boolean {
  return (scores[k] ?? POINT_MIN) > POINT_MIN;
}

/** A point-buy starting point: every score at the floor, nothing spent. */
export function pointBuyReset(): Record<AbilityKey, number> {
  return Object.fromEntries(ABILITY_KEYS.map((k) => [k, POINT_MIN])) as Record<AbilityKey, number>;
}

/**
 * A pool value that has been placed on an ability, or not yet.
 *
 * Tracked as a LIST WITH SLOTS rather than a set of numbers, because a rolled array can legitimately
 * contain the same value twice - two 13s - and a set would silently collapse them into one.
 */
export type PoolEntry = { value: number; assignedTo: AbilityKey | null };

export function makePool(values: number[]): PoolEntry[] {
  return values.map((value) => ({ value, assignedTo: null }));
}

/**
 * Put a pool value on an ability. Returns a NEW pool.
 *
 * Assigning to an ability that already holds a value frees the old one back to the pool rather than
 * refusing, because "I meant that one to go here instead" is the commonest correction and making it
 * a two-step (unassign, then assign) is friction with no safety benefit.
 */
export function assign(pool: PoolEntry[], index: number, k: AbilityKey): PoolEntry[] {
  if (index < 0 || index >= pool.length) return pool;
  return pool.map((e, i) => {
    if (i === index) return { ...e, assignedTo: k };
    if (e.assignedTo === k) return { ...e, assignedTo: null };
    return e;
  });
}

export function unassign(pool: PoolEntry[], index: number): PoolEntry[] {
  return pool.map((e, i) => (i === index ? { ...e, assignedTo: null } : e));
}

/** The scores a pool describes. Abilities with nothing placed on them are simply absent. */
export function poolScores(pool: PoolEntry[]): Partial<Record<AbilityKey, number>> {
  const out: Partial<Record<AbilityKey, number>> = {};
  for (const e of pool) if (e.assignedTo) out[e.assignedTo] = e.value;
  return out;
}

export const poolComplete = (pool: PoolEntry[]) => pool.every((e) => e.assignedTo !== null);
