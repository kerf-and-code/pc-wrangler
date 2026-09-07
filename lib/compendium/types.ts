// lib/compendium/types.ts
//
// Shape of the offline voice-compendium data emitted by scripts/build-compendium-index.mjs into
// public/compendium/index-<ed>.json. One entry per term; `spoken` are the lexicon-friendly phrases
// used for both the Vosk grammar and runtime matching; `display` is the compact card, typed per
// category. Kept in sync with the generator by hand (both read lib/srd, there is one source of truth
// for the data itself).

export type CompendiumCategory =
  | "spell" | "magic-item" | "equipment" | "condition" | "feat" | "feature" | "rule" | "monster";
export type Ruleset = "2014" | "2024" | "both";

// Attribution. "srd" is Open Game Content under CC-BY (SRD 5.1 / 5.2); "kc" is original content
// authored by Kerf and Code (e.g. the feats beyond the small SRD set). The card surfaces a tag for
// "kc" so that credit is visible per entry, and the footer names both.
export type CompendiumSource = "srd" | "kc";

export interface SpellDamage {
  type: string | null;
  base: string | null;
  scaling: Record<string, string> | null;
}

export interface SpellDisplay {
  level: number;
  school: string | null;
  castingTime: string | null;
  range: string | null;
  components: string | null;
  duration: string | null;
  concentration: boolean;
  ritual: boolean;
  attackType: string | null;
  classes: string[];
  damage: SpellDamage | null;
  description: string | null;
}

export interface ItemVariants {
  label: string | null;
  options: string[];
}

export interface ItemDisplay {
  type: string | null;
  rarity: string | null;
  attunement: boolean;
  attunementNote: string | null;
  variants: ItemVariants | null;
  description: string | null;
}

export interface GearDisplay {
  type: string | null;
  cost: string | null;
  weight: number | null;
  description: string | null;
}

export interface ConditionDisplay {
  description: string | null;
}

export interface FeatDisplay {
  // The feat's own bucket as it appears in the source data: "Feat", "Origin Feat", "Epic Boon",
  // "Fighting Style", "Dark Gift", etc. Shown as the card's meta line.
  featType: string | null;
  prerequisite: string | null;
  description: string | null;
}

export interface FeatureDisplay {
  // Which flavour of class option this is, so the card can tag it: "metamagic", "invocation",
  // "fighting-style", or "feature" (a general class or subclass feature, e.g. Rage, Sneak Attack).
  kind: "metamagic" | "invocation" | "fighting-style" | "feature";
  className: string | null;
  subclass: string | null; // set for subclass features (e.g. "Champion"), null for base-class features
  level: number | null;
  description: string | null;
}

// A monster stat block. Kept compact: the fields a DM reads at the table, with the action-ish sections
// as name/description lists. Sourced from the SRD monster data (source_key "srd-*").
export interface MonsterTrait {
  name: string | null;
  description: string | null;
}
export interface MonsterDisplay {
  size: string | null;
  type: string | null;
  alignment: string | null;
  ac: number | string | null;
  hp: number | string | null;
  hitDice: string | null;
  speed: string | null;
  senses: string | null;
  languages: string | null;
  cr: string | null;
  xp: number | null;
  abilities: { str: number | null; dex: number | null; con: number | null; int: number | null; wis: number | null; cha: number | null };
  damageVulnerabilities: string | null;
  damageResistances: string | null;
  damageImmunities: string | null;
  conditionImmunities: string | null;
  traits: MonsterTrait[];
  actions: MonsterTrait[];
  bonusActions: MonsterTrait[];
  reactions: MonsterTrait[];
  legendaryActions: MonsterTrait[];
}

// Scaffolded for the next pass (the verbatim-SRD rules glossary: grapple, cover, hiding, etc.).
// No entries carry this category yet; the generator does not emit "rule" rows until the glossary
// source lands, but the type and its narrowing helper are here so that pass is a pure add.
export interface RuleDisplay {
  topic: string | null; // "Combat", "Adventuring", "Spellcasting", ...
  description: string | null;
}

export type CompendiumDisplay =
  | SpellDisplay | ItemDisplay | GearDisplay | ConditionDisplay | FeatDisplay | FeatureDisplay | RuleDisplay | MonsterDisplay;

// One entry per term. This is a DISCRIMINATED UNION keyed on `category`: each category pins its own
// `display` shape, so a check on `category` narrows `display` exactly. The discriminant is load-bearing
// here because ConditionDisplay ({ description }) is a structural subset of every other display, so
// guards written against the display SHAPE alone chained down to `never` by the time they reached the
// feat/feature branches. Keying the guards on the literal `category` avoids that structural collapse.
interface EntryBase<C extends CompendiumCategory, D> {
  id: string;
  name: string;
  category: C;
  ruleset: string;
  source: CompendiumSource;
  spoken: string[];
  display: D;
}

export type CompendiumEntry =
  | EntryBase<"spell", SpellDisplay>
  | EntryBase<"magic-item", ItemDisplay>
  | EntryBase<"equipment", GearDisplay>
  | EntryBase<"condition", ConditionDisplay>
  | EntryBase<"feat", FeatDisplay>
  | EntryBase<"feature", FeatureDisplay>
  | EntryBase<"rule", RuleDisplay>
  | EntryBase<"monster", MonsterDisplay>;

// Narrowing helpers so the card renderer can read the right fields with no `any`. Each keys on the
// category discriminant and returns the matching union member via Extract.
export const isSpell = (e: CompendiumEntry): e is Extract<CompendiumEntry, { category: "spell" }> => e.category === "spell";
export const isItem = (e: CompendiumEntry): e is Extract<CompendiumEntry, { category: "magic-item" }> => e.category === "magic-item";
export const isGear = (e: CompendiumEntry): e is Extract<CompendiumEntry, { category: "equipment" }> => e.category === "equipment";
export const isCondition = (e: CompendiumEntry): e is Extract<CompendiumEntry, { category: "condition" }> => e.category === "condition";
export const isFeat = (e: CompendiumEntry): e is Extract<CompendiumEntry, { category: "feat" }> => e.category === "feat";
export const isFeature = (e: CompendiumEntry): e is Extract<CompendiumEntry, { category: "feature" }> => e.category === "feature";
export const isRule = (e: CompendiumEntry): e is Extract<CompendiumEntry, { category: "rule" }> => e.category === "rule";
export const isMonster = (e: CompendiumEntry): e is Extract<CompendiumEntry, { category: "monster" }> => e.category === "monster";
