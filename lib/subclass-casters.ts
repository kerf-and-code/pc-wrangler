// lib/subclass-casters.ts
//
// Subclasses that turn a non-casting class into a one-third caster: Eldritch Knight (Fighter),
// Arcane Trickster (Rogue), and Warrior of the Mystic Arts (Monk, Arcana Unleashed).
//
// WHY THIS EXISTS
//   Single-class spell slots are read off the class table (resources.slotsFor), and Fighter, Rogue
//   and Monk tables have no slot columns, so these characters showed no slots at all. The multiclass
//   path read caster_type from the CLASS only, so their levels also contributed nothing there.
//
// ONE TABLE, TWO ROUNDINGS
//   A single-class third-caster's own table is exactly the shared multiclass table read at caster
//   level ceil(class level / 3): level 3 -> 1 (two 1st), level 4 -> 2 (three 1st), level 7 -> 3,
//   level 19 -> 7 (one 4th). Checked row by row against the Mystic Arts table in Arcana Unleashed.
//   When MULTICLASSING the rules count floor(level / 3) instead, which multiclass-slots already does
//   for type "THIRD". Below level 3 the subclass does not exist yet, so there are no slots.

import { sameSubclass } from "./subclass-names";
import { multiclassSlots, type CasterType } from "./multiclass-slots";

// The third field is the class spell list the subclass casts from. Spells are tagged by class
// ("Wizard", "Sorcerer"), never by subclass, so without it the Forge's Spells tab filtered an
// Eldritch Knight on "Fighter" and showed nothing at all.
const THIRD_CASTERS: [className: string, subclass: string, spellList: string][] = [
  ["Fighter", "Eldritch Knight", "Wizard"],
  ["Rogue", "Arcane Trickster", "Wizard"],
  ["Monk", "Warrior of the Mystic Arts", "Sorcerer"],
];

const findThird = (className: string, subclass: string | null | undefined) =>
  THIRD_CASTERS.find(([c, s]) => c === className && sameSubclass(s, subclass));

/** "THIRD" when this class + subclass is a subclass caster, otherwise null (use the class's own type). */
export function subclassCasterType(className: string, subclass: string | null | undefined): CasterType | null {
  return findThird(className, subclass) ? "THIRD" : null;
}

/** The class list a subclass caster picks from ("Wizard" for an Eldritch Knight), otherwise null. */
export function subclassSpellList(className: string, subclass: string | null | undefined): string | null {
  return findThird(className, subclass)?.[2] ?? null;
}

/** Slots for a SINGLE-CLASS third-caster. [] below level 3. */
export function thirdCasterSlots(level: number): { level: number; slots: number }[] {
  return level >= 3 ? multiclassSlots(Math.ceil(level / 3)) : [];
}

// What a single-class subclass caster may pick at a given class level. Checked against the books
// on 2026-10-28: the Eldritch Knight and Arcane Trickster tables in PHB 2024 and the Warrior of the
// Mystic Arts table in Arcana Unleashed are row-for-row identical (3 spells at level 3 to 13 at
// level 20), and the 2014 Spells Known column carries the same numbers.
const THIRD_CASTER_SPELLS = [3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13];

// Cantrips at level 3, then at level 10. Arcane Trickster's count includes Mage Hand.
const THIRD_CASTER_CANTRIPS: Record<string, [number, number]> = {
  "Eldritch Knight": [2, 3],
  "Arcane Trickster": [3, 4],
  "Warrior of the Mystic Arts": [2, 3],
};

// 2014 only: most spells must come from two schools. The level 3 grant allows one spell from any
// school, and levels 8, 14 and 20 each allow one more. 2024 dropped the restriction.
const SCHOOLS_2014: Record<string, string[]> = {
  "Eldritch Knight": ["Abjuration", "Evocation"],
  "Arcane Trickster": ["Enchantment", "Illusion"],
};

export type SubclassCasting = {
  spellList: string;
  cantrips: number;
  spells: number;
  maxSpellLevel: number;
  /** null when any school is allowed. */
  schools: string[] | null;
  /** How many level 1+ spells may come from outside `schools`. */
  anySchool: number;
};

/** Limits for a single-class subclass caster, or null (not one, or below level 3). */
export function subclassCasting(
  className: string, subclass: string | null | undefined, level: number, edition: string,
): SubclassCasting | null {
  const hit = findThird(className, subclass);
  if (!hit || level < 3) return null;
  const [, book, spellList] = hit;
  const [c3, c10] = THIRD_CASTER_CANTRIPS[book];
  const slots = thirdCasterSlots(level);
  const schools = edition === "2014" ? SCHOOLS_2014[book] || null : null;
  return {
    spellList,
    cantrips: level >= 10 ? c10 : c3,
    spells: THIRD_CASTER_SPELLS[Math.min(level, 20) - 3],
    maxSpellLevel: slots.length ? slots[slots.length - 1].level : 0,
    schools,
    anySchool: schools ? (level >= 20 ? 4 : level >= 14 ? 3 : level >= 8 ? 2 : 1) : 0,
  };
}
