// lib/name-aliases.ts
//
// One thing, several published names. The SRD prints a handful of spells without the wizard's name
// ("Hideous Laughter", "Arcane Hand"); the Player's Handbooks and D&D Beyond use the full name
// ("Tasha's Hideous Laughter", "Bigby's Hand"). Rather than carry a second copy of the spell under
// the other name (13 such duplicates were removed from spells-authored.json), the alternate name
// resolves to the one our data uses.
//
// The table is lib/srd/name-aliases.json (alternate name -> canonical name, per domain), so the
// plain-node compendium build reads the same data. Subclass renames live in lib/subclass-names.ts,
// because subclasses also need prefix/suffix stripping ("Oath of", "Domain") on top of renames.

import data from "./srd/name-aliases.json";

export type AliasDomain = "spells";

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

const TABLES: Record<AliasDomain, Record<string, string>> = {
  spells: (data as { spells: Record<string, string> }).spells,
};

// Normalized alternate name -> canonical name.
const BY_ALIAS: Record<AliasDomain, Map<string, string>> = {
  spells: new Map(Object.entries(TABLES.spells).map(([a, c]) => [norm(a), c])),
};

/** The name our data uses for `name`, or `name` unchanged when it is not a known alternate. */
export function canonicalName(domain: AliasDomain, name: string): string {
  return BY_ALIAS[domain].get(norm(name)) ?? name;
}

/** Every alternate name that resolves to `canonical` (empty when none). */
export function aliasesOf(domain: AliasDomain, canonical: string): string[] {
  const c = norm(canonical);
  return Object.entries(TABLES[domain]).filter(([, v]) => norm(v) === c).map(([a]) => a);
}

/** [alternate, canonical] pairs, for building lookup indexes. */
export function aliasPairs(domain: AliasDomain): [string, string][] {
  return Object.entries(TABLES[domain]);
}
