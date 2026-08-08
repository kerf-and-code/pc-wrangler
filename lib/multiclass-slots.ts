// lib/multiclass-slots.ts
//
// Spell slots for a character holding levels in more than one class.
//
// THE RULE
//   A multiclassed caster does not get each class's slots side by side. Their levels are combined
//   into a single CASTER LEVEL - full for Bard, Cleric, Druid, Sorcerer and Wizard, half for
//   Paladin and Ranger, a third for the subclass casters - and that one number is read off a shared
//   table. A Cleric 3 / Wizard 3 is a level 6 caster with level 3 spells available, not two level 3
//   casters with two sets of level 2 slots.
//
// WARLOCK IS NOT PART OF IT
//   Pact Magic is its own pool with its own recovery, and the rules keep it separate. A Warlock 3 /
//   Cleric 3 has a level 3 caster's slots AND their pact slots, tracked apart. Folding warlock
//   levels into the caster level would hand the character slots they do not have.
//
// THE CASTER TYPE COMES FROM THE DATA
//   classes-2024-structured.json carries caster_type as FULL / HALF / PACT / NONE, so nothing here
//   is authored. A class the fetch has not covered contributes nothing rather than being guessed
//   at, which errs toward too few slots - the direction that gets noticed and corrected, rather
//   than the one that quietly inflates a character.

export type CasterType = "FULL" | "HALF" | "THIRD" | "PACT" | "NONE";

/**
 * The multiclass spellcaster table. Row N is caster level N; the array is slots for spell levels
 * 1 through 9.
 *
 * Written out rather than computed. The progression is not a formula - it has irregular steps at
 * levels 1 to 3 and again in the upper half - and every attempt to generate it produces a table
 * that is right in the middle and wrong at both ends.
 */
const SLOTS: number[][] = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0], //  1
  [3, 0, 0, 0, 0, 0, 0, 0, 0], //  2
  [4, 2, 0, 0, 0, 0, 0, 0, 0], //  3
  [4, 3, 0, 0, 0, 0, 0, 0, 0], //  4
  [4, 3, 2, 0, 0, 0, 0, 0, 0], //  5
  [4, 3, 3, 0, 0, 0, 0, 0, 0], //  6
  [4, 3, 3, 1, 0, 0, 0, 0, 0], //  7
  [4, 3, 3, 2, 0, 0, 0, 0, 0], //  8
  [4, 3, 3, 3, 1, 0, 0, 0, 0], //  9
  [4, 3, 3, 3, 2, 0, 0, 0, 0], // 10
  [4, 3, 3, 3, 2, 1, 0, 0, 0], // 11
  [4, 3, 3, 3, 2, 1, 0, 0, 0], // 12
  [4, 3, 3, 3, 2, 1, 1, 0, 0], // 13
  [4, 3, 3, 3, 2, 1, 1, 0, 0], // 14
  [4, 3, 3, 3, 2, 1, 1, 1, 0], // 15
  [4, 3, 3, 3, 2, 1, 1, 1, 0], // 16
  [4, 3, 3, 3, 2, 1, 1, 1, 1], // 17
  [4, 3, 3, 3, 3, 1, 1, 1, 1], // 18
  [4, 3, 3, 3, 3, 2, 1, 1, 1], // 19
  [4, 3, 3, 3, 3, 2, 2, 1, 1], // 20
];

/**
 * What one class contributes to the caster level.
 *
 * ROUNDING IS DOWN, AND IT IS APPLIED PER CLASS. A Paladin 3 / Ranger 3 contributes 1 + 1 = 2, not
 * 3: each half is floored on its own before they are added. Summing first and halving after is the
 * commonest way to get this wrong and it always errs upward.
 */
export function casterLevelFrom(type: CasterType, level: number): number {
  if (level <= 0) return 0;
  switch (type) {
    case "FULL": return level;
    case "HALF": return Math.floor(level / 2);
    case "THIRD": return Math.floor(level / 3);
    default: return 0;   // PACT and NONE contribute nothing
  }
}

export type ClassLevel = { casterType: CasterType; level: number };

export function casterLevel(classes: ClassLevel[]): number {
  return classes.reduce((n, c) => n + casterLevelFrom(c.casterType, c.level), 0);
}

/**
 * Slots by spell level for a caster level. Returns [] below 1, which is the honest answer for a
 * character with no caster levels at all - a Fighter 5 / Rogue 3 gets no table, not a table of
 * zeroes.
 */
export function multiclassSlots(level: number): { level: number; slots: number }[] {
  if (level < 1) return [];
  const row = SLOTS[Math.min(level, 20) - 1];
  return row
    .map((slots, i) => ({ level: i + 1, slots }))
    .filter((r) => r.slots > 0);
}

/** True when the character holds levels in more than one SLOT-CONTRIBUTING class. */
export const isMulticlassCaster = (classes: ClassLevel[]): boolean =>
  classes.filter((c) => casterLevelFrom(c.casterType, c.level) > 0).length > 1;
