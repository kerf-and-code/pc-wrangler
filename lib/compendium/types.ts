// lib/compendium/types.ts
//
// Shape of the offline voice-compendium data emitted by scripts/build-compendium-index.mjs into
// public/compendium/index-<ed>.json. One entry per term; `spoken` are the lexicon-friendly phrases
// used for both the Vosk grammar and runtime matching; `display` is the compact card, typed per
// category. Kept in sync with the generator by hand (both read lib/srd, there is one source of truth
// for the data itself).

export type CompendiumCategory = "spell" | "magic-item" | "equipment" | "condition";
export type Ruleset = "2014" | "2024" | "both";

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

export type CompendiumDisplay = SpellDisplay | ItemDisplay | GearDisplay | ConditionDisplay;

export interface CompendiumEntry {
  id: string;
  name: string;
  category: CompendiumCategory;
  ruleset: string;
  spoken: string[];
  display: CompendiumDisplay;
}

// Narrowing helpers so the card renderer can read the right fields with no `any`.
export const isSpell = (e: CompendiumEntry): e is CompendiumEntry & { display: SpellDisplay } => e.category === "spell";
export const isItem = (e: CompendiumEntry): e is CompendiumEntry & { display: ItemDisplay } => e.category === "magic-item";
export const isGear = (e: CompendiumEntry): e is CompendiumEntry & { display: GearDisplay } => e.category === "equipment";
export const isCondition = (e: CompendiumEntry): e is CompendiumEntry & { display: ConditionDisplay } => e.category === "condition";
