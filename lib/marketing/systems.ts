// lib/marketing/systems.ts
//
// Single source of truth for the marketing "which systems" tiers. The landing page, the pilot page,
// the FAQ, and the features explorer all describe the same three tiers, and they had drifted apart:
// the pilot page claimed a different full-toolset list (Lancer and a "Dark Matter" that appears
// nowhere else) than the other three. Driving every surface from these arrays keeps them in lockstep.
//
// Prose surfaces (pilot sentence, FAQ answer, features paragraph) call systemsAnd(); the dotted tier
// lists on the landing page call systemsDots(). Change a tier here and all four surfaces follow.

export const FULL_TOOLSET = [
  "D&D 5e (2014 and 2024)",
  "Pathfinder 2e",
  "Draw Steel",
  "Daggerheart",
] as const;

export const THEMED_TABLE = [
  "Call of Cthulhu",
  "Lancer",
  "a generic d10 pool",
] as const;

export const PLANNED = [
  "Cyberpunk RED",
  "Vampire: The Masquerade",
] as const;

// "A · B · C · D"
export function systemsDots(list: readonly string[]): string {
  return list.join(" · ");
}

// "A, B, C, and D" (Oxford comma; "A and B" for two; "A" for one)
export function systemsAnd(list: readonly string[]): string {
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}
