// PF2e rules data for the Forge's PF2e derivation engine (lib/pf2e/character.ts).
//
// This is DATA, not mechanics: it fills the Ancestry / Heritage / Background / PClass shapes the
// engine consumes. Level-1 proficiencies are taken verbatim from the Foundry VTT pf2e class items
// (packs/classes/*.json) - open game mechanics, used as a reference. The per-level proficiency BUMPS
// come from each class's advancement: the confident, high-impact ones (Fighter weapon/save masteries;
// the universal caster spell progression Expert@7 / Master@15 / Legendary@19) are canonical, and a few
// mid-level bumps are a first pass to refine in play-testing - which is the whole point of shipping the
// data early. No Paizo Product Identity ships here: ability boosts, HP, sizes, and proficiency ranks
// are mechanics. Expand ancestries/backgrounds/classes iteratively.

import type { Ancestry, Heritage, Background, PClass, PF2Rules, Prog, ProfRank } from "./character";

// U=0 Untrained, T=1 Trained, E=2 Expert, M=3 Master, L=4 Legendary.
const pr = (start: ProfRank, bumps?: [number, ProfRank][]): Prog => (bumps ? { start, bumps } : { start });

// ---- Ancestries (common Core set; boosts/flaws/HP are canonical) --------------------------------
const ancestries: Record<string, Ancestry> = {
  human:    { id: "human",    name: "Human",    hp: 8,  size: "medium", speed: 25, boosts: ["free", "free"], flaws: [],      languages: ["Common"] },
  elf:      { id: "elf",      name: "Elf",      hp: 6,  size: "medium", speed: 30, boosts: ["dex", "int", "free"], flaws: ["con"], languages: ["Common", "Elven"] },
  dwarf:    { id: "dwarf",    name: "Dwarf",    hp: 10, size: "medium", speed: 20, boosts: ["con", "wis", "free"], flaws: ["cha"], languages: ["Common", "Dwarven"] },
  gnome:    { id: "gnome",    name: "Gnome",    hp: 8,  size: "small",  speed: 25, boosts: ["con", "cha", "free"], flaws: ["str"], languages: ["Common", "Gnomish", "Sylvan"] },
  goblin:   { id: "goblin",   name: "Goblin",   hp: 6,  size: "small",  speed: 25, boosts: ["dex", "cha", "free"], flaws: ["wis"], languages: ["Common", "Goblin"] },
  halfling: { id: "halfling", name: "Halfling", hp: 6,  size: "small",  speed: 25, boosts: ["dex", "wis", "free"], flaws: ["str"], languages: ["Common", "Halfling"] },
  orc:      { id: "orc",      name: "Orc",      hp: 10, size: "medium", speed: 25, boosts: ["str", "free"], flaws: [], languages: ["Common", "Orcish"] },
  leshy:    { id: "leshy",    name: "Leshy",    hp: 8,  size: "small",  speed: 25, boosts: ["con", "wis", "free"], flaws: ["int"], languages: ["Common", "Fey"] },
};

// ---- Heritages (representative; note-only - the engine reads no numeric field from a heritage) ----
const heritages: Record<string, Heritage> = {
  "versatile-human": { id: "versatile-human", name: "Versatile Human", ancestryId: "human", note: "A bonus general feat at level 1." },
  "skilled-human":   { id: "skilled-human",   name: "Skilled Human",   ancestryId: "human", note: "Trained in one skill of choice (Expert at 5)." },
  "ancient-elf":     { id: "ancient-elf",     name: "Ancient Elf",     ancestryId: "elf",   note: "A multiclass dedication feat at level 1." },
  "whisper-elf":     { id: "whisper-elf",     name: "Whisper Elf",     ancestryId: "elf",   note: "Sharper hearing; ignore some cover for Seek." },
  "rock-dwarf":      { id: "rock-dwarf",      name: "Rock Dwarf",      ancestryId: "dwarf", note: "Harder to shove or trip." },
  "forge-dwarf":     { id: "forge-dwarf",     name: "Forge Dwarf",     ancestryId: "dwarf", note: "Fire resistance; treat environmental heat as one step less." },
  "chameleon-gnome": { id: "chameleon-gnome", name: "Chameleon Gnome", ancestryId: "gnome", note: "Skin shifts colour; +1 circumstance to Stealth to Hide/Sneak when still." },
  "razortooth-goblin": { id: "razortooth-goblin", name: "Razortooth Goblin", ancestryId: "goblin", note: "A jaws unarmed strike (1d6 piercing)." },
  "gutsy-halfling":  { id: "gutsy-halfling",  name: "Gutsy Halfling",  ancestryId: "halfling", note: "Success vs emotion effects becomes critical success." },
  "badlands-orc":    { id: "badlands-orc",    name: "Badlands Orc",    ancestryId: "orc",   note: "Faster Hustle; endure heat." },
  "fungus-leshy":    { id: "fungus-leshy",    name: "Fungus Leshy",    ancestryId: "leshy", note: "Low-light vision." },
};

// ---- Backgrounds (canonical trained skill + lore + feat; boosts are two picks made in the build) --
// Boosts are ["free","free"] here because the engine applies the player's chosen build.boosts.background;
// each background's RAW option pair is noted for the build UI to enforce later.
const backgrounds: Record<string, Background> = {
  acolyte:     { id: "acolyte",     name: "Acolyte",     boosts: ["free", "free"], trainedSkill: "religion",     loreSkill: "Scribing Lore",    feat: "Student of the Canon" },   // Int or Wis + free
  criminal:    { id: "criminal",    name: "Criminal",    boosts: ["free", "free"], trainedSkill: "stealth",      loreSkill: "Underworld Lore",  feat: "Experienced Smuggler" },    // Dex or Int + free
  entertainer: { id: "entertainer", name: "Entertainer", boosts: ["free", "free"], trainedSkill: "performance",  loreSkill: "Theater Lore",     feat: "Fascinating Performance" }, // Dex or Cha + free
  hunter:      { id: "hunter",      name: "Hunter",      boosts: ["free", "free"], trainedSkill: "survival",     loreSkill: "Tanning Lore",     feat: "Survey Wildlife" },         // Dex or Wis + free
  laborer:     { id: "laborer",     name: "Laborer",     boosts: ["free", "free"], trainedSkill: "athletics",    loreSkill: "Labor Lore",       feat: "Hefty Hauler" },            // Str or Con + free
  merchant:    { id: "merchant",    name: "Merchant",    boosts: ["free", "free"], trainedSkill: "diplomacy",    loreSkill: "Mercantile Lore",  feat: "Bargain Hunter" },          // Int or Cha + free
  noble:       { id: "noble",       name: "Noble",       boosts: ["free", "free"], trainedSkill: "society",      loreSkill: "Heraldry Lore",    feat: "Courtly Graces" },          // Int or Cha + free
  scholar:     { id: "scholar",     name: "Scholar",     boosts: ["free", "free"], trainedSkill: "arcana",       loreSkill: "Academia Lore",    feat: "Assurance" },               // Int or Wis + free
  scout:       { id: "scout",       name: "Scout",       boosts: ["free", "free"], trainedSkill: "survival",     loreSkill: "Scouting Lore",    feat: "Forager" },                 // Dex or Wis + free
  warrior:     { id: "warrior",     name: "Warrior",     boosts: ["free", "free"], trainedSkill: "intimidation", loreSkill: "Warfare Lore",     feat: "Intimidating Glare" },       // Str or Con + free
};

// ---- Classes (level-1 starts from Foundry packs/classes; bumps per class advancement) ------------
const classes: Record<string, PClass> = {
  fighter: {
    id: "fighter", name: "Fighter", keyAbility: ["str", "dex"], hp: 10, trainedSkills: 3,
    perception: pr(2, [[7, 3]]),                    // Expert; Battlefield Surveyor -> Master @7
    saves: { fortitude: pr(2, [[9, 3]]), reflex: pr(2), will: pr(1) }, // Juggernaut -> Master Fort @9
    classDc: pr(1, [[9, 2]]),                       // Fighter Expertise -> Expert @9
    weapons: {
      unarmed: pr(2, [[5, 3]]),                     // Weapon Mastery @5
      simple:  pr(2, [[5, 3], [13, 4]]),            // Master @5, Weapon Legend -> Legendary @13
      martial: pr(2, [[5, 3], [13, 4]]),
      advanced: pr(1, [[5, 2], [13, 3]]),
    },
    armor: { unarmored: pr(1, [[11, 2], [17, 3]]), light: pr(1, [[11, 2], [17, 3]]), medium: pr(1, [[11, 2], [17, 3]]), heavy: pr(1, [[11, 2], [17, 3]]) }, // Armor Expertise @11, Mastery @17
  },
  rogue: {
    id: "rogue", name: "Rogue", keyAbility: ["dex"], hp: 8, trainedSkills: 7,
    perception: pr(2, [[7, 3]]),                    // Vigilant Senses -> Master @7
    saves: { fortitude: pr(1, [[11, 2]]), reflex: pr(2, [[7, 3]]), will: pr(2, [[13, 3]]) }, // Evasion -> Master Ref @7
    classDc: pr(1, [[13, 2]]),
    weapons: { unarmed: pr(1, [[5, 2], [15, 3]]), simple: pr(1, [[5, 2], [15, 3]]), martial: pr(1, [[5, 2], [15, 3]]), advanced: pr(0) }, // Weapon Tricks @5, Master Strike @15
    armor: { unarmored: pr(1, [[13, 2], [17, 3]]), light: pr(1, [[13, 2], [17, 3]]), medium: pr(0), heavy: pr(0) },
  },
  cleric: {
    id: "cleric", name: "Cleric", keyAbility: ["wis"], hp: 8, trainedSkills: 2,
    perception: pr(1, [[11, 2]]),
    saves: { fortitude: pr(1, [[9, 2]]), reflex: pr(1), will: pr(2, [[15, 3]]) },
    classDc: pr(1, [[11, 2]]),
    weapons: { unarmed: pr(1), simple: pr(1), martial: pr(0) },
    armor: { unarmored: pr(1), light: pr(0), medium: pr(0), heavy: pr(0) },
    spell: { tradition: "divine", ability: "wis", dc: pr(1, [[7, 2], [15, 3], [19, 4]]) }, // Expert @7, Master @15, Legendary @19
  },
  wizard: {
    id: "wizard", name: "Wizard", keyAbility: ["int"], hp: 6, trainedSkills: 2,
    perception: pr(1, [[13, 2]]),
    saves: { fortitude: pr(1, [[13, 2]]), reflex: pr(1, [[13, 2]]), will: pr(2, [[15, 3]]) },
    classDc: pr(1, [[11, 2]]),
    weapons: { unarmed: pr(1), simple: pr(1), martial: pr(0) },
    armor: { unarmored: pr(1, [[13, 2], [17, 3]]), light: pr(0), medium: pr(0), heavy: pr(0) },
    spell: { tradition: "arcane", ability: "int", dc: pr(1, [[7, 2], [15, 3], [19, 4]]) },
  },
};

export const PF2_RULES: PF2Rules = { ancestries, heritages, backgrounds, classes };
