// lib/srd/species-mechanics.ts
//
// The shape of a species entry in rules-data.json SPECIES: what a species DOES to a character,
// as data, so adding a species is a new entry rather than new code.
//
// WHY THIS EXISTS
//   Until 2026-10 each entry carried a handful of loosely typed fields and the sheet read only three
//   of them (speed, resist, mods.hpPerLevel). Darkvision, granted cantrips, condition advantages, AC
//   and skill picks were stored and never applied, and 50 of the 61 catalog species had no entry at
//   all, so they could be picked and did nothing. This type names every field the sheet will read.
//
// RULES FOR AUTHORING AN ENTRY
//   - Only what the book states. A trait that is an activated ability (Breath Weapon, Large Form)
//     stays in `traits` as a summary; only standing effects get structured fields.
//   - Kerf and Code wording for every summary, never the book's prose.
//   - A choice the player makes (lineage, ancestry, legacy) is a `choice`; each option carries only
//     the fields it changes, and the sheet layers the picked option over the base entry.
//   - Levels in `spells` are CHARACTER levels, the way species traits count them.
//   - `editions["2014"]` overrides fields for the 2014 version of the same species (speed 25 for a
//     2014 dwarf, ability score increases). Absent means the 2024 entry applies to both.

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

/** "speed" means equal to the creature's walking Speed. */
export type SpeedValue = number | "speed";

export type SpeciesSpell = {
  spell: string;
  /** Character level the spell is gained at. Cantrips are level 1. */
  level: number;
  /** How the free casting recharges. Absent: a cantrip, or only castable with slots. */
  free?: "1/LR" | "PB/LR";
};

export type SpeciesEffects = {
  /** Walking speed in feet. */
  speed?: number;
  /** Other movement. Only permanent speeds; a temporary fly speed is a trait, not a speed. */
  speeds?: { fly?: SpeedValue; swim?: SpeedValue; climb?: SpeedValue; burrow?: SpeedValue };
  darkvision?: number;
  senses?: { blindsight?: number; tremorsense?: number; truesight?: number };
  /** Damage types, lower case: "poison", "necrotic". */
  resist?: string[];
  immune?: string[];
  /** Conditions you have Advantage on saves to avoid or end, lower case: "poisoned", "charmed". */
  advAgainst?: string[];
  /** Saving throws you always have Advantage on (Gnomish Cunning). */
  advSaves?: Ability[];
  /** When those save advantages only apply against something: "magic" for the 2014 gnome. */
  advSavesVs?: string;
  acBonus?: number;
  /** hpPerLevel: +N hit points per character level (Dwarven Toughness). Ability increases (2014). */
  mods?: Partial<Record<Ability | "hpPerLevel", number>>;
  skillProf?: string[];
  skillPick?: { n: number; from: string[] | "any" };
  toolProf?: string[];
  toolPick?: { n: number; from: string[] | "any" };
  weaponProf?: string[];
  armorProf?: string[];
  languages?: string[];
  languagePick?: { n: number; from: string[] | "any" };
  spells?: SpeciesSpell[];
  /** An Origin feat of the player's choice (2024 Human). */
  bonusOriginFeat?: boolean;
};

export type SpeciesChoice = {
  key: string;
  label: string;
  /** Option name -> only the fields that option adds or changes. */
  options: Record<string, SpeciesEffects & { summary?: string; aliases?: string[] }>;
};

export type SpeciesMechanics = SpeciesEffects & {
  src: string;
  creatureType?: string;
  /** "Medium", "Small", or "Medium or Small" (chosen when you pick the species). */
  size: string;
  /** Casting ability for this species' spells. "choose" = Intelligence, Wisdom, or Charisma. */
  spellAbility?: Ability | "choose";
  choice?: SpeciesChoice;
  /** [trait name, Kerf and Code summary], for display. */
  traits: [string, string][];
  /** null REMOVES a base field for that edition (a 2014 dragonborn has no darkvision). */
  editions?: { "2014"?: EditionOverride };
};

type Overridable = SpeciesEffects & Pick<SpeciesMechanics, "size" | "spellAbility" | "choice" | "src">;
export type EditionOverride = { [K in keyof Overridable]?: Overridable[K] | null };
