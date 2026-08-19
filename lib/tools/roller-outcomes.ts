// lib/tools/roller-outcomes.ts
//
// The per-system outcome logic for the roller, forked VERBATIM from app/gm/roll/page.tsx so the free
// tool reads results exactly as the in-app roller does. Pure functions over already-rolled dice; the
// randomness itself comes from lib/dice (crypto rejection sampling), never re-implemented here.

export type Die = { sides: number; value: number; kept: boolean };

// Call of Cthulhu: d100 under a skill target.
export function cocBand(roll: number, target: number): string {
  if (roll === 1) return "Critical";
  const fumble = target < 50 ? roll >= 96 : roll === 100;
  if (fumble) return "Fumble";
  if (roll <= Math.floor(target / 5)) return "Extreme";
  if (roll <= Math.floor(target / 2)) return "Hard";
  if (roll <= target) return "Success";
  return "Failure";
}

// Pathfinder 2e: four degrees of success around a DC, with nat 20/1 stepping the result.
export function pf2eDegree(total: number, dc: number, natural: 20 | 1 | null): string {
  let step = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (natural === 20) step = Math.min(3, step + 1);
  else if (natural === 1) step = Math.max(0, step - 1);
  return ["Critical Failure", "Failure", "Success", "Critical Success"][step];
}

// Daggerheart: 2d12 Hope vs Fear, optional Difficulty.
export function dualityOutcome(hope: number, fear: number, total: number, difficulty: number | null): string {
  if (hope === fear) return "Critical Success";
  const via = hope > fear ? "Hope" : "Fear";
  if (difficulty == null) return `with ${via}`;
  return `${total >= difficulty ? "Success" : "Failure"} with ${via}`;
}

// Draw Steel: build the "2d10 + N" notation; a single edge/bane folds +2/-2 into the modifier, a double
// edge/bane carries no numeric (it shifts the tier).
export function powerRollNotation(mod: string, eb: number): string {
  const m = (parseInt(mod, 10) || 0) + (eb === 1 ? 2 : eb === -1 ? -2 : 0);
  return `2d10${m > 0 ? ` + ${m}` : m < 0 ? ` - ${-m}` : ""}`;
}

// Draw Steel: total vs tiers; double edge/bane shifts one tier; a natural 19-20 on the 2d10 is a crit + tier 3.
export function drawSteelOutcome(d1: number, d2: number, total: number, doubleEdge: boolean, doubleBane: boolean): string {
  const crit = d1 + d2 >= 19;
  let tier = total <= 11 ? 1 : total <= 16 ? 2 : 3;
  if (doubleEdge) tier = Math.min(3, tier + 1);
  if (doubleBane) tier = Math.max(1, tier - 1);
  if (crit) tier = 3;
  return `Tier ${tier}${crit ? " · critical" : ""}`;
}

// Generic d10 success pool: each 6+ is a success, a pair of 10s adds a critical bonus.
export function poolOutcome(dice: Die[], difficulty: number | null): { successes: number; band: string } {
  const vals = dice.filter((d) => d.kept).map((d) => d.value);
  const base = vals.filter((v) => v >= 6).length;
  const tens = vals.filter((v) => v === 10).length;
  const successes = base + Math.floor(tens / 2) * 2;
  const critical = tens >= 2;
  const noun = `${successes} success${successes === 1 ? "" : "es"}`;
  if (difficulty == null) return { successes, band: critical ? `Critical · ${noun}` : noun };
  const win = successes >= difficulty;
  return { successes, band: win ? (critical ? "Critical Success" : "Success") : "Failure" };
}
