// Daggerheart rules data (SRD 1.0). Feeds deriveDaggerheartSheet. MECHANICS ONLY: starting values,
// domain mappings, armor thresholds, and the handful of numeric feature modifiers. No Darrington Press
// descriptive card/feature text is stored here (that content is under the Darrington Press Community
// Gaming License and is deliberately not shipped in this build).
//
// Sources: class starting Evasion/HP, subclass Spellcast traits, and armor tables are transcribed from
// the Daggerheart SRD 1.0. Ancestry and community lists follow the SRD (18 ancestries + Mixed, 9
// communities), which corrects two gaps in the community SRD API repo (it omitted Wildborne and listed
// Bard's HP as 8 where the SRD says 5). Only ancestry/feature modifiers with a concrete, permanent
// numeric effect are encoded; conditional or situational features are left for the player to track.

import type {
  DHRules, DHClass, DHSubclass, DHAncestry, DHCommunity, DHArmor, DHWeapon, DHDomainDef, DHDomainId,
} from "./character";

// ---- domains -----------------------------------------------------------------------------------
const DOMAINS: Record<DHDomainId, DHDomainDef> = {
  arcana:   { id: "arcana",   name: "Arcana",   classes: ["druid", "sorcerer"] },
  blade:    { id: "blade",    name: "Blade",    classes: ["guardian", "warrior"] },
  bone:     { id: "bone",     name: "Bone",     classes: ["ranger", "warrior"] },
  codex:    { id: "codex",    name: "Codex",    classes: ["bard", "wizard"] },
  grace:    { id: "grace",    name: "Grace",    classes: ["bard", "rogue"] },
  midnight: { id: "midnight", name: "Midnight", classes: ["rogue", "sorcerer"] },
  sage:     { id: "sage",     name: "Sage",     classes: ["druid", "ranger"] },
  splendor: { id: "splendor", name: "Splendor", classes: ["seraph", "wizard"] },
  valor:    { id: "valor",    name: "Valor",    classes: ["guardian", "seraph"] },
};

// ---- classes (starting Evasion / HP / two domains) ---------------------------------------------
const CLASSES: Record<string, DHClass> = {
  bard:     { id: "bard",     name: "Bard",     domains: ["grace", "codex"],    evasion: 10, hp: 5 },
  druid:    { id: "druid",    name: "Druid",    domains: ["sage", "arcana"],    evasion: 10, hp: 6 },
  guardian: { id: "guardian", name: "Guardian", domains: ["valor", "blade"],    evasion: 9,  hp: 7 },
  ranger:   { id: "ranger",   name: "Ranger",   domains: ["bone", "sage"],      evasion: 12, hp: 6 },
  rogue:    { id: "rogue",    name: "Rogue",    domains: ["midnight", "grace"], evasion: 12, hp: 6 },
  seraph:   { id: "seraph",   name: "Seraph",   domains: ["splendor", "valor"], evasion: 9,  hp: 7 },
  sorcerer: { id: "sorcerer", name: "Sorcerer", domains: ["arcana", "midnight"],evasion: 10, hp: 6 },
  warrior:  { id: "warrior",  name: "Warrior",  domains: ["blade", "bone"],     evasion: 11, hp: 6 },
  wizard:   { id: "wizard",   name: "Wizard",   domains: ["codex", "splendor"], evasion: 11, hp: 5 },
};

// ---- subclasses (Spellcast trait + any permanent numeric feature modifiers) ---------------------
const SUBCLASSES: Record<string, DHSubclass> = {
  "bard-troubadour":            { id: "bard-troubadour",            classId: "bard",     name: "Troubadour",            spellcast: "presence" },
  "bard-wordsmith":             { id: "bard-wordsmith",             classId: "bard",     name: "Wordsmith",             spellcast: "presence" },
  "druid-warden-of-elements":   { id: "druid-warden-of-elements",   classId: "druid",    name: "Warden of the Elements",spellcast: "instinct" },
  "druid-warden-of-renewal":    { id: "druid-warden-of-renewal",    classId: "druid",    name: "Warden of Renewal",     spellcast: "instinct" },
  // Guardian subclasses are martial (no Spellcast trait). Stalwart's threshold bonuses stack across its
  // three feature tiers (+1 foundation, +2 specialization, +3 mastery); Vengeance gains a Stress slot.
  "guardian-stalwart":          { id: "guardian-stalwart",          classId: "guardian", name: "Stalwart",              spellcast: null,
                                  mods: { major: 1, severe: 1 }, specializationMods: { major: 2, severe: 2 }, masteryMods: { major: 3, severe: 3 } },
  "guardian-vengeance":         { id: "guardian-vengeance",         classId: "guardian", name: "Vengeance",             spellcast: null,
                                  mods: { stress: 1 } },
  "ranger-beastbound":          { id: "ranger-beastbound",          classId: "ranger",   name: "Beastbound",            spellcast: "agility" },
  "ranger-wayfinder":           { id: "ranger-wayfinder",           classId: "ranger",   name: "Wayfinder",             spellcast: "agility" },
  "rogue-nightwalker":          { id: "rogue-nightwalker",          classId: "rogue",    name: "Nightwalker",           spellcast: "finesse",
                                  masteryMods: { evasion: 1 } },
  "rogue-syndicate":            { id: "rogue-syndicate",            classId: "rogue",    name: "Syndicate",             spellcast: "finesse" },
  "seraph-divine-wielder":      { id: "seraph-divine-wielder",      classId: "seraph",   name: "Divine Wielder",        spellcast: "strength" },
  "seraph-winged-sentinel":     { id: "seraph-winged-sentinel",     classId: "seraph",   name: "Winged Sentinel",       spellcast: "strength",
                                  masteryMods: { severe: 4 } },
  "sorcerer-elemental-origin":  { id: "sorcerer-elemental-origin",  classId: "sorcerer", name: "Elemental Origin",      spellcast: "instinct" },
  "sorcerer-primal-origin":     { id: "sorcerer-primal-origin",     classId: "sorcerer", name: "Primal Origin",         spellcast: "instinct" },
  "warrior-call-of-the-brave":  { id: "warrior-call-of-the-brave",  classId: "warrior",  name: "Call of the Brave",     spellcast: null },
  "warrior-call-of-the-slayer": { id: "warrior-call-of-the-slayer", classId: "warrior",  name: "Call of the Slayer",    spellcast: null },
  "wizard-school-of-knowledge": { id: "wizard-school-of-knowledge", classId: "wizard",   name: "School of Knowledge",   spellcast: "knowledge" },
  // School of War's Battlemage foundation grants an extra Hit Point slot.
  "wizard-school-of-war":       { id: "wizard-school-of-war",       classId: "wizard",   name: "School of War",         spellcast: "knowledge",
                                  mods: { hp: 1 } },
};

// ---- ancestries (only permanent numeric creation modifiers are encoded) ------------------------
const ANCESTRIES: Record<string, DHAncestry> = {
  clank:    { id: "clank",    name: "Clank" },
  drakona:  { id: "drakona",  name: "Drakona" },
  dwarf:    { id: "dwarf",    name: "Dwarf" },
  elf:      { id: "elf",      name: "Elf" },
  faerie:   { id: "faerie",   name: "Faerie" },
  faun:     { id: "faun",     name: "Faun" },
  firbolg:  { id: "firbolg",  name: "Firbolg" },
  fungril:  { id: "fungril",  name: "Fungril" },
  galapa:   { id: "galapa",   name: "Galapa",   mods: { thresholdsPlusProficiency: true } },
  giant:    { id: "giant",    name: "Giant",    mods: { hp: 1 } },
  goblin:   { id: "goblin",   name: "Goblin" },
  halfling: { id: "halfling", name: "Halfling" },
  human:    { id: "human",    name: "Human",    mods: { stress: 1 } },
  infernis: { id: "infernis", name: "Infernis" },
  katari:   { id: "katari",   name: "Katari" },
  orc:      { id: "orc",      name: "Orc" },
  ribbet:   { id: "ribbet",   name: "Ribbet" },
  simiah:   { id: "simiah",   name: "Simiah",   mods: { evasion: 1 } },
};

// ---- communities (SRD lists nine; features are narrative, no static stat modifiers) ------------
const COMMUNITIES: Record<string, DHCommunity> = {
  highborne:   { id: "highborne",   name: "Highborne" },
  loreborne:   { id: "loreborne",   name: "Loreborne" },
  orderborne:  { id: "orderborne",  name: "Orderborne" },
  ridgeborne:  { id: "ridgeborne",  name: "Ridgeborne" },
  seaborne:    { id: "seaborne",    name: "Seaborne" },
  slyborne:    { id: "slyborne",    name: "Slyborne" },
  underborne:  { id: "underborne",  name: "Underborne" },
  wanderborne: { id: "wanderborne", name: "Wanderborne" },
  wildborne:   { id: "wildborne",   name: "Wildborne" },
};

// ---- armor (base Major/Severe thresholds, base Armor Score, and Evasion/trait/spellcast features) --
// Only feature modifiers that change a derived number are encoded; narrative armor features are omitted.
const ARMORS: Record<string, DHArmor> = {
  // Tier 1 (level 1)
  "gambeson":                 { id: "gambeson",                 name: "Gambeson Armor",            tier: 1, baseMajor: 5,  baseSevere: 11, baseScore: 3, evasionMod: 1 },
  "leather":                  { id: "leather",                  name: "Leather Armor",             tier: 1, baseMajor: 6,  baseSevere: 13, baseScore: 3 },
  "chainmail":                { id: "chainmail",                name: "Chainmail Armor",           tier: 1, baseMajor: 7,  baseSevere: 15, baseScore: 4, evasionMod: -1 },
  "full-plate":               { id: "full-plate",               name: "Full Plate Armor",          tier: 1, baseMajor: 8,  baseSevere: 17, baseScore: 4, evasionMod: -2, traitMods: { agility: -1 } },
  // Tier 2 (levels 2-4)
  "improved-gambeson":        { id: "improved-gambeson",        name: "Improved Gambeson Armor",   tier: 2, baseMajor: 7,  baseSevere: 16, baseScore: 4, evasionMod: 1 },
  "improved-leather":         { id: "improved-leather",         name: "Improved Leather Armor",    tier: 2, baseMajor: 9,  baseSevere: 20, baseScore: 4 },
  "improved-chainmail":       { id: "improved-chainmail",       name: "Improved Chainmail Armor",  tier: 2, baseMajor: 11, baseSevere: 24, baseScore: 5, evasionMod: -1 },
  "improved-full-plate":      { id: "improved-full-plate",      name: "Improved Full Plate Armor", tier: 2, baseMajor: 13, baseSevere: 28, baseScore: 5, evasionMod: -2, traitMods: { agility: -1 } },
  "elundrian-chain":          { id: "elundrian-chain",          name: "Elundrian Chain Armor",     tier: 2, baseMajor: 9,  baseSevere: 21, baseScore: 4 },
  "harrowbone":               { id: "harrowbone",               name: "Harrowbone Armor",          tier: 2, baseMajor: 9,  baseSevere: 21, baseScore: 4 },
  "irontree-breastplate":     { id: "irontree-breastplate",     name: "Irontree Breastplate Armor",tier: 2, baseMajor: 9,  baseSevere: 20, baseScore: 4 },
  "runetan-floating":         { id: "runetan-floating",         name: "Runetan Floating Armor",    tier: 2, baseMajor: 9,  baseSevere: 20, baseScore: 4 },
  "tyris-soft":               { id: "tyris-soft",               name: "Tyris Soft Armor",          tier: 2, baseMajor: 8,  baseSevere: 18, baseScore: 5 },
  "rosewild":                 { id: "rosewild",                 name: "Rosewild Armor",            tier: 2, baseMajor: 11, baseSevere: 23, baseScore: 5 },
  // Tier 3 (levels 5-7)
  "advanced-gambeson":        { id: "advanced-gambeson",        name: "Advanced Gambeson Armor",   tier: 3, baseMajor: 9,  baseSevere: 23, baseScore: 5, evasionMod: 1 },
  "advanced-leather":         { id: "advanced-leather",         name: "Advanced Leather Armor",    tier: 3, baseMajor: 11, baseSevere: 27, baseScore: 5 },
  "advanced-chainmail":       { id: "advanced-chainmail",       name: "Advanced Chainmail Armor",  tier: 3, baseMajor: 13, baseSevere: 31, baseScore: 6, evasionMod: -1 },
  "advanced-full-plate":      { id: "advanced-full-plate",      name: "Advanced Full Plate Armor", tier: 3, baseMajor: 15, baseSevere: 35, baseScore: 6, evasionMod: -2, traitMods: { agility: -1 } },
  "bellamoi-fine":            { id: "bellamoi-fine",            name: "Bellamoi Fine Armor",       tier: 3, baseMajor: 11, baseSevere: 27, baseScore: 5, traitMods: { presence: 1 } },
  "dragonscale":              { id: "dragonscale",              name: "Dragonscale Armor",         tier: 3, baseMajor: 11, baseSevere: 27, baseScore: 5 },
  "spiked-plate":             { id: "spiked-plate",             name: "Spiked Plate Armor",        tier: 3, baseMajor: 10, baseSevere: 25, baseScore: 5 },
  "bladefare":                { id: "bladefare",                name: "Bladefare Armor",           tier: 3, baseMajor: 16, baseSevere: 39, baseScore: 6 },
  "monetts-cloak":            { id: "monetts-cloak",            name: "Monett's Cloak",            tier: 3, baseMajor: 16, baseSevere: 39, baseScore: 6 },
  "runes-of-fortification":   { id: "runes-of-fortification",   name: "Runes of Fortification",    tier: 3, baseMajor: 17, baseSevere: 43, baseScore: 6 },
  // Tier 4 (levels 8-10)
  "legendary-gambeson":       { id: "legendary-gambeson",       name: "Legendary Gambeson Armor",  tier: 4, baseMajor: 11, baseSevere: 32, baseScore: 6, evasionMod: 1 },
  "legendary-leather":        { id: "legendary-leather",        name: "Legendary Leather Armor",   tier: 4, baseMajor: 13, baseSevere: 36, baseScore: 6 },
  "legendary-chainmail":      { id: "legendary-chainmail",      name: "Legendary Chainmail Armor", tier: 4, baseMajor: 15, baseSevere: 40, baseScore: 7, evasionMod: -1 },
  "legendary-full-plate":     { id: "legendary-full-plate",     name: "Legendary Full Plate Armor",tier: 4, baseMajor: 17, baseSevere: 44, baseScore: 7, evasionMod: -2, traitMods: { agility: -1 } },
  "dunamis-silkchain":        { id: "dunamis-silkchain",        name: "Dunamis Silkchain",         tier: 4, baseMajor: 13, baseSevere: 36, baseScore: 7 },
  "channeling":               { id: "channeling",               name: "Channeling Armor",          tier: 4, baseMajor: 13, baseSevere: 36, baseScore: 5, spellcastMod: 1 },
  "emberwoven":               { id: "emberwoven",               name: "Emberwoven Armor",          tier: 4, baseMajor: 13, baseSevere: 36, baseScore: 6 },
  "full-fortified":           { id: "full-fortified",           name: "Full Fortified Armor",      tier: 4, baseMajor: 15, baseSevere: 40, baseScore: 4 },
  "veritas-opal":             { id: "veritas-opal",             name: "Veritas Opal Armor",        tier: 4, baseMajor: 13, baseSevere: 36, baseScore: 6 },
  "savior-chainmail":         { id: "savior-chainmail",         name: "Savior Chainmail",          tier: 4, baseMajor: 18, baseSevere: 48, baseScore: 8, evasionMod: -1,
                                traitMods: { agility: -1, strength: -1, finesse: -1, instinct: -1, presence: -1, knowledge: -1 } },
};

// ---- weapons (SRD Tier 1 primary weapons) -------------------------------------------------------
// Mechanics only: trait, range, damage die + flat modifier, damage type, and burden. Feature prose is
// not shipped (Darrington Press content), and weapon-feature effects on Evasion are not applied to the
// sheet in this pass. Damage rolls a number of the die equal to Proficiency; the modifier is added once.
const WEAPONS: Record<string, DHWeapon> = {
  // Physical
  "broadsword":      { id: "broadsword",      name: "Broadsword",      tier: 1, category: "primary", trait: "agility",   range: "Melee",     damageDie: "d8",  damageBonus: 0, damageType: "phy", burden: "One-Handed" },
  "longsword":       { id: "longsword",       name: "Longsword",       tier: 1, category: "primary", trait: "agility",   range: "Melee",     damageDie: "d10", damageBonus: 3, damageType: "phy", burden: "Two-Handed" },
  "battleaxe":       { id: "battleaxe",       name: "Battleaxe",       tier: 1, category: "primary", trait: "strength",  range: "Melee",     damageDie: "d10", damageBonus: 3, damageType: "phy", burden: "Two-Handed" },
  "greatsword":      { id: "greatsword",      name: "Greatsword",      tier: 1, category: "primary", trait: "strength",  range: "Melee",     damageDie: "d10", damageBonus: 3, damageType: "phy", burden: "Two-Handed" },
  "mace":            { id: "mace",            name: "Mace",            tier: 1, category: "primary", trait: "strength",  range: "Melee",     damageDie: "d8",  damageBonus: 1, damageType: "phy", burden: "One-Handed" },
  "warhammer":       { id: "warhammer",       name: "Warhammer",       tier: 1, category: "primary", trait: "strength",  range: "Melee",     damageDie: "d12", damageBonus: 3, damageType: "phy", burden: "Two-Handed" },
  "dagger":          { id: "dagger",          name: "Dagger",          tier: 1, category: "primary", trait: "finesse",   range: "Melee",     damageDie: "d8",  damageBonus: 1, damageType: "phy", burden: "One-Handed" },
  "quarterstaff":    { id: "quarterstaff",    name: "Quarterstaff",    tier: 1, category: "primary", trait: "instinct",  range: "Melee",     damageDie: "d10", damageBonus: 3, damageType: "phy", burden: "Two-Handed" },
  "cutlass":         { id: "cutlass",         name: "Cutlass",         tier: 1, category: "primary", trait: "presence",  range: "Melee",     damageDie: "d8",  damageBonus: 1, damageType: "phy", burden: "One-Handed" },
  "rapier":          { id: "rapier",          name: "Rapier",          tier: 1, category: "primary", trait: "presence",  range: "Melee",     damageDie: "d8",  damageBonus: 0, damageType: "phy", burden: "One-Handed" },
  "halberd":         { id: "halberd",         name: "Halberd",         tier: 1, category: "primary", trait: "strength",  range: "Very Close", damageDie: "d10", damageBonus: 2, damageType: "phy", burden: "Two-Handed" },
  "spear":           { id: "spear",           name: "Spear",           tier: 1, category: "primary", trait: "finesse",   range: "Very Close", damageDie: "d8",  damageBonus: 3, damageType: "phy", burden: "Two-Handed" },
  "shortbow":        { id: "shortbow",        name: "Shortbow",        tier: 1, category: "primary", trait: "agility",   range: "Far",       damageDie: "d6",  damageBonus: 3, damageType: "phy", burden: "Two-Handed" },
  "crossbow":        { id: "crossbow",        name: "Crossbow",        tier: 1, category: "primary", trait: "finesse",   range: "Far",       damageDie: "d6",  damageBonus: 1, damageType: "phy", burden: "One-Handed" },
  "longbow":         { id: "longbow",         name: "Longbow",         tier: 1, category: "primary", trait: "agility",   range: "Very Far",  damageDie: "d8",  damageBonus: 3, damageType: "phy", burden: "Two-Handed" },
  // Magic (require a Spellcast trait)
  "arcane-gauntlets":{ id: "arcane-gauntlets",name: "Arcane Gauntlets",tier: 1, category: "primary", trait: "strength",  range: "Melee",     damageDie: "d10", damageBonus: 3, damageType: "mag", burden: "Two-Handed", magic: true },
  "hallowed-axe":    { id: "hallowed-axe",    name: "Hallowed Axe",    tier: 1, category: "primary", trait: "strength",  range: "Melee",     damageDie: "d8",  damageBonus: 1, damageType: "mag", burden: "One-Handed", magic: true },
  "glowing-rings":   { id: "glowing-rings",   name: "Glowing Rings",   tier: 1, category: "primary", trait: "agility",   range: "Very Close", damageDie: "d10", damageBonus: 2, damageType: "mag", burden: "Two-Handed", magic: true },
  "hand-runes":      { id: "hand-runes",      name: "Hand Runes",      tier: 1, category: "primary", trait: "instinct",  range: "Very Close", damageDie: "d10", damageBonus: 0, damageType: "mag", burden: "One-Handed", magic: true },
  "returning-blade": { id: "returning-blade", name: "Returning Blade", tier: 1, category: "primary", trait: "finesse",   range: "Close",     damageDie: "d8",  damageBonus: 0, damageType: "mag", burden: "One-Handed", magic: true },
  "shortstaff":      { id: "shortstaff",      name: "Shortstaff",      tier: 1, category: "primary", trait: "instinct",  range: "Close",     damageDie: "d8",  damageBonus: 1, damageType: "mag", burden: "One-Handed", magic: true },
  "dualstaff":       { id: "dualstaff",       name: "Dualstaff",       tier: 1, category: "primary", trait: "instinct",  range: "Far",       damageDie: "d6",  damageBonus: 3, damageType: "mag", burden: "Two-Handed", magic: true },
  "scepter":         { id: "scepter",         name: "Scepter",         tier: 1, category: "primary", trait: "presence",  range: "Far",       damageDie: "d6",  damageBonus: 0, damageType: "mag", burden: "Two-Handed", magic: true },
  "wand":            { id: "wand",            name: "Wand",            tier: 1, category: "primary", trait: "knowledge", range: "Far",       damageDie: "d6",  damageBonus: 1, damageType: "mag", burden: "One-Handed", magic: true },
  "greatstaff":      { id: "greatstaff",      name: "Greatstaff",      tier: 1, category: "primary", trait: "knowledge", range: "Very Far",  damageDie: "d6",  damageBonus: 0, damageType: "mag", burden: "Two-Handed", magic: true },
};

export const DH_RULES: DHRules = {
  classes: CLASSES,
  subclasses: SUBCLASSES,
  ancestries: ANCESTRIES,
  communities: COMMUNITIES,
  armors: ARMORS,
  weapons: WEAPONS,
  domains: DOMAINS,
};

// Convenience lists for the builder UI.
export const DH_CLASS_LIST: DHClass[] = Object.values(CLASSES);
export const DH_ANCESTRY_LIST: DHAncestry[] = Object.values(ANCESTRIES);
export const DH_COMMUNITY_LIST: DHCommunity[] = Object.values(COMMUNITIES);
export const DH_ARMOR_LIST: DHArmor[] = Object.values(ARMORS);
export const DH_WEAPON_LIST: DHWeapon[] = Object.values(WEAPONS);

export function subclassesForClass(classId: string): DHSubclass[] {
  return Object.values(SUBCLASSES).filter((s) => s.classId === classId);
}
