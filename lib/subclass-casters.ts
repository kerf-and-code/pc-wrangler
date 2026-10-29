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

const THIRD_CASTERS: [className: string, subclass: string][] = [
  ["Fighter", "Eldritch Knight"],
  ["Rogue", "Arcane Trickster"],
  ["Monk", "Warrior of the Mystic Arts"],
];

/** "THIRD" when this class + subclass is a subclass caster, otherwise null (use the class's own type). */
export function subclassCasterType(className: string, subclass: string | null | undefined): CasterType | null {
  return THIRD_CASTERS.some(([c, s]) => c === className && sameSubclass(s, subclass)) ? "THIRD" : null;
}

/** Slots for a SINGLE-CLASS third-caster. [] below level 3. */
export function thirdCasterSlots(level: number): { level: number; slots: number }[] {
  return level >= 3 ? multiclassSlots(Math.ceil(level / 3)) : [];
}
