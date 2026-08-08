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

export type SubclassSpell = { level: number; spell: string };

export const SUBCLASS_SPELLS: Record<string, SubclassSpell[]> = {
  "Oath of Devotion": [
    { level: 3, spell: "Protection from Evil and Good" },
    { level: 3, spell: "Shield of Faith" },
    { level: 5, spell: "Aid" },
    { level: 5, spell: "Zone of Truth" },
    { level: 9, spell: "Beacon of Hope" },
    { level: 9, spell: "Dispel Magic" },
    { level: 13, spell: "Freedom of Movement" },
    { level: 13, spell: "Guardian of Faith" },
    { level: 17, spell: "Commune" },
    { level: 17, spell: "Flame Strike" },
  ],
};

/**
 * The ones this character has reached.
 *
 * Level-gated for the same reason lineage spells are: a level 3 paladin has two spells, not ten,
 * and listing the rest as theirs would be wrong rather than early.
 */
export function subclassSpellsFor(subclass: string, level: number): SubclassSpell[] {
  return (SUBCLASS_SPELLS[subclass] || [])
    .filter((s) => s.level <= level)
    .sort((a, b) => a.level - b.level || a.spell.localeCompare(b.spell));
}
