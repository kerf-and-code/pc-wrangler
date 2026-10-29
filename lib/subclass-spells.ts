// lib/subclass-spells.ts
//
// Spells a subclass hands you, always prepared and free of your prepared limit.
//
// SAME RULE AS A SPECIES LINEAGE, DIFFERENT SOURCE
//   An Oath of Devotion paladin gets Protection from Evil and Good at level 3 the way a Drow elf
//   gets Faerie Fire: without choosing it, always prepared, and not counted against the number they
//   may prepare. The Forge already renders that for species; this is the same shape pointed at
//   subclasses, so the two arrive in one list on the Spells tab rather than as two features that
//   happen to look alike.
//
// AUTHORED, BECAUSE THE DATA DOES NOT CARRY IT
//   subclasses-2024-structured.json holds feature TEXT, not spell tables, and the catalog's 189
//   subclasses have no feature data at all. So this is a short hand-written table that grows one
//   subclass at a time. A subclass absent from it grants nothing, which is the honest default: a
//   missing entry shows no spells, where a guessed one would put spells on a sheet that do not
//   belong there.
//
// KEYS ARE MATCHED BY sameSubclass(), NOT BY STRING EQUALITY
//   The Forge stores the catalog's short name ("Devotion", "Arcana"); this table uses the book name.
//   Until 2026-10 the lookup was an exact string match, so "Oath of Devotion" never matched the
//   "Devotion" the picker saves and no paladin ever saw these spells.
//
// SPELL NAMES follow the 2024 data where it has the spell (Secret Chest, Arcane Hand); Nystul's
// Magic Aura has no 2024 SRD name, so the authored one is used.

import { sameSubclass } from "./subclass-names";
import { choiceKey } from "./class-choices";

export type SubclassSpell = { level: number; spell: string };

const S = (rows: [number, string[]][]): SubclassSpell[] =>
  rows.flatMap(([level, spells]) => spells.map((spell) => ({ level, spell })));

/**
 * 2024 Cleric domain lists, checked against the 2024 Player's Handbook. Shared because the Vestige
 * Patron (Arcana Unleashed) borrows exactly these four, chosen by the player.
 */
const DOMAIN_SPELLS: Record<"Life" | "Light" | "Trickery" | "War", SubclassSpell[]> = {
  Life: S([[3, ["Aid", "Bless", "Cure Wounds", "Lesser Restoration"]], [5, ["Mass Healing Word", "Revivify"]],
    [7, ["Aura of Life", "Death Ward"]], [9, ["Greater Restoration", "Mass Cure Wounds"]]]),
  Light: S([[3, ["Burning Hands", "Faerie Fire", "Scorching Ray", "See Invisibility"]], [5, ["Daylight", "Fireball"]],
    [7, ["Arcane Eye", "Wall of Fire"]], [9, ["Flame Strike", "Scrying"]]]),
  Trickery: S([[3, ["Charm Person", "Disguise Self", "Invisibility", "Pass without Trace"]], [5, ["Hypnotic Pattern", "Nondetection"]],
    [7, ["Confusion", "Dimension Door"]], [9, ["Dominate Person", "Modify Memory"]]]),
  War: S([[3, ["Guiding Bolt", "Magic Weapon", "Shield of Faith", "Spiritual Weapon"]], [5, ["Crusader's Mantle", "Spirit Guardians"]],
    [7, ["Fire Shield", "Freedom of Movement"]], [9, ["Hold Monster", "Steel Wind Strike"]]]),
};

export const SUBCLASS_SPELLS: Record<string, SubclassSpell[]> = {
  "Oath of Devotion": S([
    [3, ["Protection from Evil and Good", "Shield of Faith"]], [5, ["Aid", "Zone of Truth"]],
    [9, ["Beacon of Hope", "Dispel Magic"]], [13, ["Freedom of Movement", "Guardian of Faith"]],
    [17, ["Commune", "Flame Strike"]],
  ]),
  "Life Domain": DOMAIN_SPELLS.Life,
  "Light Domain": DOMAIN_SPELLS.Light,
  "Trickery Domain": DOMAIN_SPELLS.Trickery,
  "War Domain": DOMAIN_SPELLS.War,
  // Arcana Unleashed revision.
  "Arcana Domain": S([
    [3, ["Detect Magic", "Magic Missile", "Magic Weapon", "Nystul's Magic Aura"]], [5, ["Counterspell", "Dispel Magic"]],
    [7, ["Arcane Eye", "Secret Chest"]], [9, ["Arcane Hand", "Teleportation Circle"]],
  ]),
};

/**
 * Vestige Patron's list depends on a domain the player picks. The pick is stored under the same key
 * the class-choices panel saves it with, so the two can never disagree about where it lives.
 */
const VESTIGE_CHOICE_KEY = choiceKey({
  className: "Warlock", subclass: "Vestige Patron", level: 3, feature: "Vestige Spells", choose: 1, kind: "option",
});

/**
 * The ones this character has reached.
 *
 * Level-gated for the same reason lineage spells are: a level 3 paladin has two spells, not ten,
 * and listing the rest as theirs would be wrong rather than early. `picks` is build.classChoices;
 * without it a subclass whose list is chosen (Vestige Patron) grants nothing rather than a guess.
 */
export function subclassSpellsFor(
  subclass: string, level: number, picks: Record<string, string[]> = {},
): SubclassSpell[] {
  let list = Object.entries(SUBCLASS_SPELLS).find(([k]) => sameSubclass(k, subclass))?.[1] || [];
  if (sameSubclass("Vestige Patron", subclass)) {
    const domain = (picks[VESTIGE_CHOICE_KEY] || [])[0] as keyof typeof DOMAIN_SPELLS | undefined;
    list = (domain && DOMAIN_SPELLS[domain]) || [];
  }
  return list
    .filter((s) => s.level <= level)
    .sort((a, b) => a.level - b.level || a.spell.localeCompare(b.spell));
}
