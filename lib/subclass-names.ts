// lib/subclass-names.ts
//
// One subclass, several spellings. The catalog (class_capabilities) stores SHORT names - "Devotion",
// "Life", "Fiend", "Evocation" - and that is what the Forge saves in build.meta.subclass. The
// hand-authored tables (class-choices, subclass-spells) were written with the BOOK names - "Oath of
// Devotion", "Life Domain", "Fiend Patron", "Evoker" - and a D&D Beyond import can bring either.
// Comparing the strings directly meant 27 of the 30 subclass-gated entries never matched anything,
// so their choices, Channel Divinity buttons and granted spells silently never appeared.
//
// THE FIX IS TO COMPARE, NOT TO RENAME. Renaming the tables to the short names would make them
// match the picker and break every caller holding the long name (imports, the compendium, old
// saved builds). Reducing both sides to one canonical form makes every spelling agree.
//
// THE CANONICAL FORM
//   lower case; leading "Oath of (the)", "Circle of (the)", "College of (the)", "School of",
//   "Way of (the)", "Path of (the)", "Warrior of (the)", "The" removed; trailing "Domain",
//   "Patron", "(Legacy)" removed; then the 2024 renames mapped onto the catalog's name.
//   Checked against all catalog rows: the only two subclasses of one class that collapse together
//   are Bard "Dance" (core) and "College of Dance" (The Griffon's Saddlebag). No authored table keys
//   either, so nothing can be offered to the wrong one; revisit if one of them ever gets an entry.

const PREFIX = /^(oath of (the )?|circle of (the )?|college of (the )?|school of |way of (the )?|path of (the )?|warrior of (the )?|the )/;
const SUFFIX = /( domain| patron| \(legacy\))$/;

/**
 * 2024 renamed several subclasses. Keyed by canonical form, valued by the catalog's canonical form.
 * Only renames where the catalog holds the OLD name belong here.
 */
const RENAMES: Record<string, string> = {
  abjurer: "abjuration", conjurer: "conjuration", diviner: "divination", enchanter: "enchantment",
  evoker: "evocation", illusionist: "illusion", necromancer: "necromancy", transmuter: "transmutation",
  "draconic sorcery": "draconic bloodline", "wild magic sorcery": "wild magic",
  "aberrant sorcery": "aberrant mind", "clockwork sorcery": "clockwork soul",
  "four elements": "elements",
  // Heroes of Faerun (2024) and the Sword Coast guide name these two differently from the catalog
  // rows (subclasses.json: "Bladesinging", "Purple Dragon Knight (Banneret)").
  bladesinger: "bladesinging",
  "purple dragon knight": "purple dragon knight (banneret)", banneret: "purple dragon knight (banneret)",
};

export function canonicalSubclass(name: string | null | undefined): string {
  let n = String(name ?? "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) n = n.replace(PREFIX, "").replace(SUFFIX, "").trim();
  return RENAMES[n] ?? n;
}

/** True when two spellings name the same subclass. An empty name never matches anything. */
export function sameSubclass(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = canonicalSubclass(a);
  return x !== "" && x === canonicalSubclass(b);
}
