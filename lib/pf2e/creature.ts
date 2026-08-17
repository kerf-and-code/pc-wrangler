// PF2e creature (NPC) stat-block schema for Six Axes' Monster Maker.
//
// Field structure follows the Foundry VTT pf2e system's NPC data model (src/module/actor/npc/data.ts)
// - abilities, AC, HP, speeds, saves, perception, skills, traits, level, immunities/weaknesses/
// resistances - which is game MECHANICS (open under OGL/ORC), used here as a structural reference only.
// Foundry embeds strikes/actions/spells as separate item documents; we INLINE them, because our
// builder is self-contained and doesn't carry a full item system. Also kept: PF2e's elite/weak
// adjustment template. No Paizo content ships in this file - it's an empty shape the GM fills in.

export type PF2Size = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
export type PF2Rarity = "common" | "uncommon" | "rare" | "unique";
export type PF2Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type PF2Save = "fortitude" | "reflex" | "will";
export type PF2SpeedType = "land" | "fly" | "swim" | "climb" | "burrow";
export type PF2ActionCost = "passive" | "reaction" | "free" | 1 | 2 | 3;
export type PF2Tradition = "arcane" | "divine" | "occult" | "primal";
export type PF2CastKind = "prepared" | "spontaneous" | "innate" | "focus";

export const PF2_SIZES: PF2Size[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
export const PF2_RARITIES: PF2Rarity[] = ["common", "uncommon", "rare", "unique"];
export const PF2_ABILITIES: PF2Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
export const PF2_SAVES: PF2Save[] = ["fortitude", "reflex", "will"];
export const PF2_SPEED_TYPES: PF2SpeedType[] = ["land", "fly", "swim", "climb", "burrow"];
export const PF2_TRADITIONS: PF2Tradition[] = ["arcane", "divine", "occult", "primal"];
// The eight core skills plus Lore is captured free-text per entry, so skills stay a flexible list.

export interface PF2IWR {
  type: string;          // "fire", "physical", "precision", "bludgeoning" ...
  value?: number;        // resistance/weakness amount; omit for immunities
  exceptions?: string;   // "except cold iron"
}

export interface PF2Damage {
  formula: string;       // "1d8+4"
  type: string;          // "slashing", "fire", "mental" ...
}

export interface PF2Strike {
  name: string;          // "jaws", "claw", "longbow"
  kind: "melee" | "ranged";
  mod: number;           // attack modifier (the highest of the three MAP steps)
  traits: string[];      // "agile", "finesse", "reach 10 feet", "deadly d8", "range 60 feet"
  damage: PF2Damage[];
  effects?: string;      // rider text: "plus 1d6 persistent bleed", "Grab", "Improved Grab"
}

export interface PF2Action {
  name: string;          // "Breath Weapon", "Attack of Opportunity", "Frightful Presence"
  cost: PF2ActionCost;   // passive | reaction | free | 1 | 2 | 3
  traits: string[];
  text: string;
}

export interface PF2SpellEntry {
  level: number;         // 0 = cantrips; otherwise spell rank
  slots: number;         // 0 = at-will / constant
  spells: string[];
}

export interface PF2Spellcasting {
  tradition: PF2Tradition;
  kind: PF2CastKind;
  dc: number;
  attack?: number;       // spell attack modifier, when relevant
  entries: PF2SpellEntry[];
}

export interface PF2Skill {
  name: string;          // "Athletics", "Stealth", "Lore: Undead"
  mod: number;
}

export interface PF2Speed {
  type: PF2SpeedType;
  value: number;         // feet
}

export interface PF2Creature {
  name: string;
  level: number;                        // -1 .. 25
  size: PF2Size;
  rarity: PF2Rarity;
  traits: string[];                     // creature type + tags: "undead", "fiend", "aberration", "aquatic"
  perception: number;                   // modifier
  senses: string[];                     // "darkvision", "scent (imprecise) 30 feet"
  languages: string[];
  skills: PF2Skill[];
  abilities: Record<PF2Ability, number>; // ability modifiers
  ac: number;
  saves: Record<PF2Save, number>;        // save modifiers
  hp: number;
  immunities: string[];
  resistances: PF2IWR[];
  weaknesses: PF2IWR[];
  speeds: PF2Speed[];
  strikes: PF2Strike[];
  actions: PF2Action[];
  spellcasting?: PF2Spellcasting;
  adjustment: "elite" | "weak" | null;   // PF2e elite/weak template (applied on display, not stored twice)
  blurb: string;
}

export function blankPF2Creature(): PF2Creature {
  return {
    name: "",
    level: 1,
    size: "medium",
    rarity: "common",
    traits: [],
    perception: 0,
    senses: [],
    languages: [],
    skills: [],
    abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    ac: 15,
    saves: { fortitude: 0, reflex: 0, will: 0 },
    hp: 20,
    immunities: [],
    resistances: [],
    weaknesses: [],
    speeds: [{ type: "land", value: 25 }],
    strikes: [],
    actions: [],
    adjustment: null,
    blurb: "",
  };
}

// The elite/weak template: a quick +/-1 effective level. Elite adds +2 to AC, attacks, DCs, saves,
// Perception and damage and bumps HP by level; weak subtracts the same. Applied when rendering a
// stat block so the stored creature stays canonical. (HP step follows PF2e's by-level table.)
export function hpAdjustmentStep(level: number): number {
  if (level <= 1) return 10;
  if (level <= 4) return 15;
  if (level <= 19) return 20;
  return 30;
}
