// PF2e creature (NPC) stat-block schema for Six Axes' Monster Maker.
//
// Field structure follows the Foundry VTT pf2e NPC data model (src/module/actor/npc/data.ts) - level,
// size, rarity, traits, abilities, AC, Fort/Ref/Will, HP, perception, speeds, immunities/weaknesses/
// resistances - which is game MECHANICS (open under OGL/ORC), used as a structural reference only. No
// Paizo content ships here; it's an empty shape the GM fills in.
//
// Deliberately mirrors the D&D StatBlockDoc's authoring style: the numbers that matter are structured
// (level, AC, saves, HP, ability mods, perception), while strikes/actions/spells are free-text entries
// and traits/immunities/resistances/weaknesses are CSV lists - the same "authored directly, no
// derivation" pattern, so the PF2e editor reuses the D&D page's Field / NumInput / EntryListPanel.
// name lives in the page's own state (like StatBlockDoc), so it is not on the creature.

export type PF2Size = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
export type PF2Rarity = "common" | "uncommon" | "rare" | "unique";
export type PF2Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type PF2Save = "fortitude" | "reflex" | "will";

export const PF2_SIZES: PF2Size[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
export const PF2_RARITIES: PF2Rarity[] = ["common", "uncommon", "rare", "unique"];
export const PF2_ABILITIES: [PF2Ability, string][] = [
  ["str", "Str"], ["dex", "Dex"], ["con", "Con"], ["int", "Int"], ["wis", "Wis"], ["cha", "Cha"],
];
export const PF2_SAVES: [PF2Save, string][] = [
  ["fortitude", "Fortitude"], ["reflex", "Reflex"], ["will", "Will"],
];

// A free-text stat-block entry (name + description), same shape as the D&D NamedEntry, so both editors
// share the EntryListPanel. Kept local to avoid a circular import with lib/stat-blocks.
export type PF2Entry = { name: string; desc: string };

export interface PF2Creature {
  level: number;                          // -1 .. 25
  size: PF2Size;
  rarity: PF2Rarity;
  traits: string[];                       // creature type + tags: "undead", "fiend", "aquatic"
  perception: number;                     // modifier
  senses: string;                         // "darkvision, scent (imprecise) 30 feet"
  languages: string;                      // "Common, Draconic"
  skills: string;                         // "Athletics +12, Stealth +9, Intimidation +10"
  abilities: Record<PF2Ability, number>;  // ability modifiers
  ac: number;
  saves: Record<PF2Save, number>;         // save modifiers
  hp: number;
  immunities: string[];                   // "fire", "paralyzed"
  resistances: string[];                  // "physical 10 (except adamantine)", "fire 5"
  weaknesses: string[];                   // "cold iron 5", "good 10"
  speed: string;                          // "25 feet, fly 40 feet"
  strikes: PF2Entry[];                    // "Jaws +18" / "Damage 2d10+9 piercing plus Grab"
  actions: PF2Entry[];                    // "Breath Weapon (two-actions)" / effect text
  spells: PF2Entry[];                     // "Arcane Prepared, DC 30" / "3rd: fireball, haste"
  adjustment: "elite" | "weak" | null;    // PF2e elite/weak template (applied on display)
  blurb: string;
}

export function blankPF2Creature(): PF2Creature {
  return {
    level: 1,
    size: "medium",
    rarity: "common",
    traits: [],
    perception: 5,
    senses: "",
    languages: "",
    skills: "",
    abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    ac: 15,
    saves: { fortitude: 5, reflex: 5, will: 5 },
    hp: 20,
    immunities: [],
    resistances: [],
    weaknesses: [],
    speed: "25 feet",
    strikes: [],
    actions: [],
    spells: [],
    adjustment: null,
    blurb: "",
  };
}

// PF2e elite/weak template: a quick +/-1 effective level. Elite adds +2 to AC, attacks, DCs, saves,
// Perception and damage and bumps HP by level; weak subtracts the same. The HP step follows PF2e's
// by-level table. Applied when rendering, so the stored creature stays canonical.
export function hpAdjustmentStep(level: number): number {
  if (level <= 1) return 10;
  if (level <= 4) return 15;
  if (level <= 19) return 20;
  return 30;
}
