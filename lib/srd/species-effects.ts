// lib/srd/species-effects.ts
//
// Turns a species entry (rules-data.json SPECIES, shape in species-mechanics.ts) plus the player's
// recorded picks into the effects the sheet applies.
//
// WHY THE PICKER OPTIONS COME FROM HERE
//   The Species tab used to read its dropdowns out of the trait text (species-choices.ts). The 2024
//   SRD text flattens its tables ("Black Acid Gold Fire ..."), so for every 2024 species that asks a
//   question the parser found no options and the tab said "note your pick for now". When a species
//   has a structured `choice`, its options are used instead, and the pick is stored under the same
//   key as before (the trait name), so existing saved picks still match.
//
// HOW A PICK IS MATCHED
//   Saved picks may predate these names ("Black" against "Black (acid)", curly against straight
//   apostrophes). Names are compared after dropping a parenthetical, punctuation and case.

// The JSON directly, not RULES_DATA: rules-context imports this file, and the reverse import would
// be circular.
import rulesData from "./rules-data.json";
import type { SpeciesEffects, SpeciesMechanics, SpeciesSpell } from "./species-mechanics";

export type Ruleset = "2014" | "2024";

/** The spellcasting-ability pick for species whose spellAbility is "choose". */
export const SPECIES_ABILITY_KEY = "Spellcasting Ability";
export const SPECIES_ABILITY_OPTIONS = ["Intelligence", "Wisdom", "Charisma"];

const norm = (s: string) =>
  (s || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[‘’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The entry for a species, with the 2014 overrides layered on when the ruleset is 2014. */
export function speciesMechanics(name: string, ruleset: Ruleset): SpeciesMechanics | undefined {
  const base = (rulesData as unknown as { SPECIES: Record<string, SpeciesMechanics> }).SPECIES[name];
  if (!base) return undefined;
  const over = ruleset === "2014" ? base.editions?.["2014"] : undefined;
  return over ? { ...base, ...over } : base;
}

/** Options for a trait's dropdown when the species has a structured choice for it, else null. */
export function structuredChoiceOptions(
  mech: SpeciesMechanics | undefined, traitName: string,
): { name: string; detail?: string }[] | null {
  if (!mech?.choice || norm(mech.choice.label) !== norm(traitName)) return null;
  return Object.entries(mech.choice.options).map(([name, o]) => ({ name, detail: o.summary }));
}

/** The picked option of the species' choice, matched loosely so older saves still resolve. */
export function pickedOption(
  mech: SpeciesMechanics | undefined, picks: Record<string, string>,
): { name: string; effects: SpeciesEffects } | null {
  if (!mech?.choice) return null;
  const label = norm(mech.choice.label);
  const raw = Object.entries(picks).find(([k]) => norm(k) === label)?.[1];
  if (!raw) return null;
  const hit = Object.entries(mech.choice.options).find(([k]) => norm(k) === norm(raw));
  return hit ? { name: hit[0], effects: hit[1] } : null;
}

const union = (a?: string[], b?: string[]) => {
  const out = [...(a || [])];
  for (const x of b || []) if (!out.some((y) => y.toLowerCase() === x.toLowerCase())) out.push(x);
  return out.length ? out : undefined;
};

/**
 * Base entry plus the picked option. An option REPLACES a single value it states (Wood Elf speed
 * 35, Drow darkvision 120) and ADDS to a list (a legacy's resistance, a lineage's spells).
 */
export function resolveSpecies(
  name: string, ruleset: Ruleset, picks: Record<string, string> = {},
): { mech: SpeciesMechanics; option: string | null; effects: SpeciesEffects } | null {
  const mech = speciesMechanics(name, ruleset);
  if (!mech) return null;
  const opt = pickedOption(mech, picks);
  const o = opt?.effects || {};
  const effects: SpeciesEffects = {
    ...mech,
    speed: o.speed ?? mech.speed,
    darkvision: Math.max(o.darkvision || 0, mech.darkvision || 0) || undefined,
    speeds: { ...(mech.speeds || {}), ...(o.speeds || {}) },
    senses: { ...(mech.senses || {}), ...(o.senses || {}) },
    resist: union(mech.resist, o.resist),
    immune: union(mech.immune, o.immune),
    advAgainst: union(mech.advAgainst, o.advAgainst),
    acBonus: (mech.acBonus || 0) + (o.acBonus || 0) || undefined,
    spells: [...(mech.spells || []), ...(o.spells || [])] as SpeciesSpell[],
  };
  return { mech, option: opt?.name ?? null, effects };
}
