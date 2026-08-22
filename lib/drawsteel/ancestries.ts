// Draw Steel ancestries + their traits (MCDM Draw Steel Rules Reference, via the Steel Compendium data
// set, used under the Draw Steel Creator License). MECHANICS ONLY: each ancestry's base Size/Speed, its
// signature (automatic) traits, its purchased traits with point costs, the ancestry-point pool, and any
// FLAT, ALWAYS-ON numeric sheet modifier a trait grants (e.g. Grounded +1 stability, Staying Power +2
// Recoveries). Situational, triggered, or active traits ship as a name + cost only — their effect text
// lives in the SRD, not here (same stance as the domain-card and weapon catalogs). No MCDM prose is
// stored. See lib/systems/drawsteel.ts for the required in-app attribution.
//
// Base Size/Speed: the general rules give every hero size 1M and speed 5. An ancestry differs only where
// an AUTOMATIC signature trait changes it — Hakaan "Big!" (1L), Polder "Small!" (1S). Memonek's speed 7
// is NOT a base value; it comes from the purchased trait Lightning Nimbleness (+2), so Memonek's base
// speed is 5 like everyone else and the trait supplies the difference.

import type { DSAncestry, DSAncestryTrait } from "./character";

// Trait builders. Signature traits are automatic (cost 0). Purchased traits cost points. `mods` is set
// only for traits with a clear flat, always-on number the engine can add to the sheet.
const sig = (name: string, mods?: DSAncestryTrait["mods"]): DSAncestryTrait =>
  ({ id: slug(name), name, cost: 0, signature: true, ...(mods ? { mods } : {}) });
const buy = (name: string, cost: number, mods?: DSAncestryTrait["mods"]): DSAncestryTrait =>
  ({ id: slug(name), name, cost, ...(mods ? { mods } : {}) });

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const A = (
  id: string, name: string,
  size: string, speed: number,
  points: number,
  signatureTraits: DSAncestryTrait[],
  purchasedTraits: DSAncestryTrait[],
  quickTraits: string[],
): DSAncestry => ({ id, name, size, speed, points, signatureTraits, purchasedTraits, quickTraits });

const ANCESTRIES: Record<string, DSAncestry> = {
  devil: A("devil", "Devil", "1M", 5, 3,
    [sig("Silver Tongue")],
    [buy("Barbed Tail", 1), buy("Beast Legs", 1), buy("Glowing Eyes", 1), buy("Hellsight", 1),
     buy("Impressive Horns", 2), buy("Prehensile Tail", 2), buy("Wings", 2)],
    ["beast-legs", "impressive-horns"]),

  "dragon-knight": A("dragon-knight", "Dragon Knight", "1M", 5, 3,
    [sig("Wyrmplate")],
    [buy("Draconian Guard", 1), buy("Draconian Pride", 2), buy("Dragon Breath", 2),
     buy("Prismatic Scales", 1), buy("Remember Your Oath", 1), buy("Wings", 2)],
    ["dragon-breath", "prismatic-scales"]),

  dwarf: A("dwarf", "Dwarf", "1M", 5, 3,
    [sig("Runic Carving")],
    [buy("Great Fortitude", 2), buy("Grounded", 1, { stability: 1 }),
     buy("Spark Off Your Skin", 2, { staminaPerEchelon: 6 }), buy("Stand Tough", 1),
     buy("Stone Singer", 1)],
    ["grounded", "spark-off-your-skin"]),

  hakaan: A("hakaan", "Hakaan", "1L", 5, 3,
    [sig("Big!")], // sets size 1L; already the base size here, so no size mod is re-applied
    [buy("All Is a Feather", 1), buy("Doomsight", 2), buy("Forceful", 1),
     buy("Great Fortitude", 2), buy("Stand Tough", 1)],
    ["doomsight", "forceful"]),

  "high-elf": A("high-elf", "High Elf", "1M", 5, 3,
    [sig("High Elf Glamor")],
    [buy("Glamor of Terror", 2), buy("Graceful Retreat", 1), buy("High Senses", 1),
     buy("Otherworldly Grace", 2), buy("Revisit Memory", 1), buy("Unstoppable Mind", 2)],
    ["high-senses", "otherworldly-grace"]),

  human: A("human", "Human", "1M", 5, 3,
    [sig("Detect the Supernatural")],
    [buy("Can't Take Hold", 1), buy("Determination", 2), buy("Perseverance", 1),
     buy("Resist the Unnatural", 1), buy("Staying Power", 2, { recoveries: 2 })],
    ["perseverance", "staying-power"]),

  memonek: A("memonek", "Memonek", "1M", 5, 4,
    [sig("Fall Lightly"), sig("Lightweight")],
    [buy("I Am Law", 1), buy("Keeper of Order", 2),
     buy("Lightning Nimbleness", 2, { speed: 2 }), // "Your speed is 7" over the base 5
     buy("Nonstop", 2), buy("Systematic Mind", 1), buy("Unphased", 1), buy("Useful Emotion", 1)],
    ["lightning-nimbleness", "nonstop"]),

  orc: A("orc", "Orc", "1M", 5, 3,
    [sig("Relentless")],
    [buy("Bloodfire Rush", 1), buy("Glowing Recovery", 2), buy("Grounded", 1, { stability: 1 }),
     buy("Nonstop", 2), buy("Passionate Artisan", 1)],
    ["glowing-recovery", "grounded"]),

  polder: A("polder", "Polder", "1S", 5, 4,
    [sig("Shadowmeld"), sig("Small!")], // Small! sets size 1S; already the base size here
    [buy("Corruption Immunity", 1), buy("Fearless", 2), buy("Graceful Retreat", 1),
     buy("Nimblestep", 2), buy("Polder Geist", 1), buy("Reactive Tumble", 1)],
    ["corruption-immunity", "fearless", "graceful-retreat"]),

  // Revenant: 2 ancestry points (or 3 if the chosen previous-life size is 1S). "Previous Life" traits
  // grant a trait from the ancestry you were before death and can't be auto-resolved here, so they ship
  // as name + cost only. The 1S -> 3-point case is left to the player to track.
  revenant: A("revenant", "Revenant", "1M", 5, 2,
    [sig("Former Life"), sig("Tough But Withered")],
    [buy("Bloodless", 2), buy("Previous Life: 1 Point", 1), buy("Previous Life: 2 Points", 2),
     buy("Undead Influence", 1), buy("Vengeance Mark", 2)],
    ["bloodless"]),

  "time-raider": A("time-raider", "Time Raider", "1M", 5, 3,
    [sig("Psychic Scar")],
    [buy("Beyondsight", 1), buy("Foresight", 1), buy("Four-Armed Athletics", 1),
     buy("Four-Armed Martial Arts", 2), buy("Psionic Gift", 2), buy("Unstoppable Mind", 2)],
    ["beyondsight", "psionic-gift"]),

  "wode-elf": A("wode-elf", "Wode Elf", "1M", 5, 3,
    [sig("Wode Elf Glamor")],
    [buy("Forest Walk", 1), buy("Quick and Brutal", 1), buy("Otherworldly Grace", 2),
     buy("Revisit Memory", 1), buy("Swift", 1), buy("The Wode Defends", 2)],
    ["swift", "otherworldly-grace"]),
};

export const DS_ANCESTRIES: Record<string, DSAncestry> = ANCESTRIES;
export const DS_ANCESTRY_LIST: DSAncestry[] = Object.values(ANCESTRIES);
export const ancestryById = (id: string): DSAncestry | undefined => ANCESTRIES[id];
