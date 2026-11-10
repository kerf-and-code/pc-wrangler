// lib/systems/ruleset.ts (2026-11-09)
//
// Audit G7: the D&D edition a campaign chose decides the starting ruleset on the rules pages
// (workspace, Encounters, Monster Maker, Compendium). Only "2014" means the 2014 rules; "5e" (2024),
// the old "5.5e" label, and anything else mean 2024. The pages still let the GM switch.

export type Ruleset = "2014" | "2024";

export function rulesetForCampaign(system: string | null | undefined): Ruleset {
  return system === "2014" ? "2014" : "2024";
}

/** The value a system picker shows: the old "5.5e" label is the same rules as "5e" (2024). Audit U25. */
export function pickerSystem(system: string | null | undefined): string {
  return !system || system === "5.5e" ? "5e" : system;
}
