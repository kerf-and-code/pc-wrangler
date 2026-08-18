// Draw Steel rules data (MCDM Draw Steel Rules Reference, via the Steel Compendium data set, used under
// the Draw Steel Creator License). MECHANICS ONLY: class starting characteristics/Stamina/Recoveries,
// the kit table, and ancestry Size/Speed. No MCDM descriptive prose is stored here. See
// lib/systems/drawsteel.ts for the required in-app attribution.
//
// Classes with two fixed characteristics (both set to 2) get a 3-value array for the remaining three
// characteristics; classes with one fixed characteristic get a 4-value array for the remaining four.

import type { DSRules, DSClass, DSKit, DSAncestry } from "./character";

// ---- classes -----------------------------------------------------------------------------------
const A3 = [[2, -1, -1], [1, 1, -1], [1, 0, 0]];                       // 3-value arrays (two fixed chars)
const A4 = [[2, 2, -1, -1], [2, 1, 1, -1], [2, 1, 0, 0], [1, 1, 1, 0]]; // 4-value arrays (one fixed char)

const CLASSES: Record<string, DSClass> = {
  censor:       { id: "censor",       name: "Censor",       fixed: { might: 2, presence: 2 },  arrays: A3, keyChar: "presence",  baseStamina: 21, staminaPerLevel: 9, recoveries: 12 },
  conduit:      { id: "conduit",      name: "Conduit",      fixed: { intuition: 2 },           arrays: A4, keyChar: "intuition", baseStamina: 18, staminaPerLevel: 6, recoveries: 8 },
  elementalist: { id: "elementalist", name: "Elementalist", fixed: { reason: 2 },              arrays: A4, keyChar: "reason",    baseStamina: 18, staminaPerLevel: 6, recoveries: 8 },
  fury:         { id: "fury",         name: "Fury",         fixed: { might: 2, agility: 2 },   arrays: A3, keyChar: "might",     baseStamina: 21, staminaPerLevel: 9, recoveries: 10 },
  null_:        { id: "null_",        name: "Null",         fixed: { agility: 2, intuition: 2 }, arrays: A3, keyChar: "intuition", baseStamina: 21, staminaPerLevel: 9, recoveries: 8 },
  shadow:       { id: "shadow",       name: "Shadow",       fixed: { agility: 2 },             arrays: A4, keyChar: "agility",   baseStamina: 18, staminaPerLevel: 6, recoveries: 8 },
  tactician:    { id: "tactician",    name: "Tactician",    fixed: { might: 2, reason: 2 },    arrays: A3, keyChar: "reason",    baseStamina: 21, staminaPerLevel: 9, recoveries: 10 },
  talent:       { id: "talent",       name: "Talent",       fixed: { reason: 2, presence: 2 }, arrays: A3, keyChar: "reason",    baseStamina: 18, staminaPerLevel: 6, recoveries: 8 },
  troubadour:   { id: "troubadour",   name: "Troubadour",   fixed: { agility: 2, presence: 2 }, arrays: A3, keyChar: "presence",  baseStamina: 18, staminaPerLevel: 6, recoveries: 8 },
};

// ---- kits (the Kits Table; "-" columns are 0; damage is a tier-1/2/3 triple) --------------------
const k = (
  id: string, name: string, armor: string, weapon: string,
  staminaPerEchelon: number, speed: number, stability: number,
  meleeDamage: [number, number, number], rangedDamage: [number, number, number],
  meleeDistance: number, rangedDistance: number, disengage: number,
): DSKit => ({ id, name, armor, weapon, staminaPerEchelon, speed, stability, meleeDamage, rangedDamage, meleeDistance, rangedDistance, disengage });

const KITS: Record<string, DSKit> = {
  "arcane-archer":    k("arcane-archer",    "Arcane Archer",    "None",           "Bow",                0, 1, 0, [0, 0, 0], [2, 2, 2], 0, 10, 1),
  "battlemind":       k("battlemind",       "Battlemind",       "Light",          "Medium",             3, 2, 1, [2, 2, 2], [0, 0, 0], 0, 0, 0),
  "cloak-and-dagger": k("cloak-and-dagger", "Cloak and Dagger", "Light",          "Light",              3, 2, 0, [1, 1, 1], [1, 1, 1], 0, 5, 1),
  "dual-wielder":     k("dual-wielder",     "Dual Wielder",     "Medium",         "Light, medium",      6, 2, 0, [2, 2, 2], [0, 0, 0], 0, 0, 1),
  "guisarmier":       k("guisarmier",       "Guisarmier",       "Medium",         "Polearm",            6, 0, 1, [2, 2, 2], [0, 0, 0], 1, 0, 0),
  "martial-artist":   k("martial-artist",   "Martial Artist",   "None",           "Unarmed strikes",    3, 3, 0, [2, 2, 2], [0, 0, 0], 0, 0, 1),
  "mountain":         k("mountain",         "Mountain",         "Heavy",          "Heavy",              9, 0, 2, [0, 0, 4], [0, 0, 0], 0, 0, 0),
  "panther":          k("panther",          "Panther",          "None",           "Heavy",              6, 1, 1, [0, 0, 4], [0, 0, 0], 0, 0, 0),
  "pugilist":         k("pugilist",         "Pugilist",         "None",           "Unarmed strikes",    6, 2, 1, [1, 1, 1], [0, 0, 0], 0, 0, 0),
  "raider":           k("raider",           "Raider",           "Light, shield",  "Light",              6, 1, 0, [1, 1, 1], [1, 1, 1], 0, 5, 1),
  "ranger":           k("ranger",           "Ranger",           "Medium",         "Bow, medium",        6, 1, 0, [1, 1, 1], [1, 1, 1], 0, 5, 1),
  "rapid-fire":       k("rapid-fire",       "Rapid-Fire",       "Light",          "Bow",                3, 1, 0, [0, 0, 0], [2, 2, 2], 0, 7, 1),
  "retiarius":        k("retiarius",        "Retiarius",        "Light",          "Ensnaring, polearm", 3, 1, 0, [2, 2, 2], [0, 0, 0], 1, 0, 1),
  "shining-armor":    k("shining-armor",    "Shining Armor",    "Heavy, shield",  "Medium",             12, 0, 1, [2, 2, 2], [0, 0, 0], 0, 0, 0),
  "sniper":           k("sniper",           "Sniper",           "None",           "Bow",                0, 1, 0, [0, 0, 0], [0, 0, 4], 0, 10, 1),
  "spellsword":       k("spellsword",       "Spellsword",       "Light, shield",  "Medium",             6, 1, 1, [2, 2, 2], [0, 0, 0], 0, 0, 0),
  "stick-and-robe":   k("stick-and-robe",   "Stick and Robe",   "Light",          "Polearm",            3, 2, 0, [1, 1, 1], [0, 0, 0], 1, 0, 1),
  "swashbuckler":     k("swashbuckler",     "Swashbuckler",     "Light",          "Medium",             3, 3, 0, [2, 2, 2], [0, 0, 0], 0, 0, 1),
  "sword-and-board":  k("sword-and-board",  "Sword and Board",  "Medium, shield", "Medium",             9, 0, 1, [2, 2, 2], [0, 0, 0], 0, 0, 1),
  "warrior-priest":   k("warrior-priest",   "Warrior Priest",   "Heavy",          "Light",              9, 1, 1, [1, 1, 1], [0, 0, 0], 0, 0, 0),
  "whirlwind":        k("whirlwind",        "Whirlwind",        "None",           "Whip",               0, 3, 0, [1, 1, 1], [0, 0, 0], 1, 0, 1),
};

// ---- ancestries (base Size/Speed; most are 1M / 5; overrides from the Rules Reference) ----------
const anc = (id: string, name: string, size = "1M", speed = 5): DSAncestry => ({ id, name, size, speed });
const ANCESTRIES: Record<string, DSAncestry> = {
  "devil":         anc("devil",         "Devil"),
  "dragon-knight": anc("dragon-knight", "Dragon Knight"),
  "dwarf":         anc("dwarf",         "Dwarf"),
  "hakaan":        anc("hakaan",        "Hakaan", "1L"),
  "high-elf":      anc("high-elf",      "High Elf"),
  "human":         anc("human",         "Human"),
  "memonek":       anc("memonek",       "Memonek", "1M", 7),
  "orc":           anc("orc",           "Orc"),
  "polder":        anc("polder",        "Polder", "1S"),
  "revenant":      anc("revenant",      "Revenant"),
  "time-raider":   anc("time-raider",   "Time Raider"),
  "wode-elf":      anc("wode-elf",      "Wode Elf"),
};

export const DS_RULES: DSRules = {
  classes: CLASSES,
  kits: KITS,
  ancestries: ANCESTRIES,
};

export const DS_CLASS_LIST: DSClass[] = Object.values(CLASSES);
export const DS_KIT_LIST: DSKit[] = Object.values(KITS);
export const DS_ANCESTRY_LIST: DSAncestry[] = Object.values(ANCESTRIES);
