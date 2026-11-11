// lib/marketing/systems.ts
//
// Single source of truth for the marketing "which systems" tiers. The landing page, the pilot page,
// the FAQ, and the features explorer all describe the same three tiers, and they had drifted apart:
// the pilot page claimed a different full-toolset list (Lancer and a "Dark Matter" that appears
// nowhere else) than the other three. Driving every surface from these arrays keeps them in lockstep.
//
// Prose surfaces (pilot sentence, FAQ answer, features paragraph) call systemsAnd(); the dotted tier
// lists on the landing page call systemsDots(). Change a tier here and all four surfaces follow.

// Push 22 (audit G6): Lancer moves up. It has a character builder with derivation, an NPC builder in the
// Monster Maker and a Forge column, so "builders still to come" undersold it. FULL_TOOLSET_NOTE says
// plainly where the depth differs, so the full tier no longer oversells the newer systems either.
export const FULL_TOOLSET = [
  "D&D 5e (2014 and 2024)",
  "Pathfinder 2e",
  "Draw Steel",
  "Daggerheart",
  "Lancer",
] as const;

/** One honest line under the full tier: what only D&D 5e has so far. Keep it true as systems deepen. */
export const FULL_TOOLSET_NOTE =
  "D&D 5e goes deepest: its play sheet carries attacks, spells and inventory. The other systems keep hit points and resources at the table, and Lancer has no encounter maths yet.";

export const THEMED_TABLE = [
  "Call of Cthulhu",
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
