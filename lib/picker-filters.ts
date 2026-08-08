// lib/picker-filters.ts
//
// The small amount of derivation the searchable pickers need.
//
// WHY ANY OF THIS EXISTS
//   The catalogs got big - 123 backgrounds, 223 feats, 249 magic items, 335 spells - and a plain
//   dropdown of 223 names is a scroll, not a choice. Filtering needs fields to filter ON, and two
//   of the four catalogs do not have them: a feat's ability increase is written in its prose, and a
//   magic item's rarity is glued to its attunement note. So these are derived once, here, rather
//   than re-parsed at every keystroke inside a component.

export const ABILITY_NAMES = [
  "Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma",
] as const;
export type AbilityName = (typeof ABILITY_NAMES)[number];

/**
 * Which abilities a background offers, from its "Intelligence, Wisdom, Charisma" string.
 * Straightforward, because 2024 backgrounds list them as a field.
 */
export function backgroundAbilities(raw: string | undefined): AbilityName[] {
  const t = String(raw || "").toLowerCase();
  return ABILITY_NAMES.filter((a) => t.includes(a.toLowerCase()));
}

/**
 * Which abilities a FEAT increases. There is no field for this - it lives in the description - so
 * the text is read for the phrasings the SRD actually uses.
 *
 * DELIBERATELY NARROW. It matches "increase your Dexterity", "your Dexterity score by 1" and
 * "Dexterity or Charisma score", and nothing else. A looser rule that matched any mention of an
 * ability would return half the catalog for every filter, and a filter that does not narrow is
 * worse than no filter - it costs a click and teaches the player it does not work.
 */
export function featAbilities(description: string | undefined): AbilityName[] {
  const text = String(description || "");
  if (!text) return [];

  // Sentence-scoped rather than regex-constructed. The first attempt built a RegExp from a template
  // string and got the escaping wrong - "\\s" in the source is a literal backslash, not
  // whitespace - so it silently matched nothing across all 223 feats and looked like missing data.
  // Splitting on sentences and asking two plain questions of each is harder to get quietly wrong.
  const out = new Set<AbilityName>();
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const lower = sentence.toLowerCase();
    // Only sentences that are actually ABOUT an increase. "Advantage on Charisma (Deception)
    // checks" mentions an ability without granting anything, and matching it would return most of
    // the catalog for every filter.
    if (!/\bincrease\b|\bscore by\b|\bscore increases\b/.test(lower)) continue;
    for (const a of ABILITY_NAMES) {
      if (lower.includes(a.toLowerCase())) out.add(a);
    }
  }
  return ABILITY_NAMES.filter((a) => out.has(a));
}

/**
 * "Very Rare (Requires attunement)" -> "Very Rare". The rarity field carries the attunement note
 * glued on, so grouping by the raw value produces a dozen near-duplicate buckets - "Rare", "Rare
 * (Requires attunement)", "Rare (Requires attunement by a spellcaster)" - and a filter that offers
 * all of them is a worse list than the one it was meant to shorten.
 */
export const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact", "Varies"];

export function normalizeRarity(raw: string | undefined): string {
  const t = String(raw || "").trim();
  if (!t) return "";
  // A range like "Uncommon (+1), Rare (+2)" is genuinely several rarities; it gets its own bucket
  // rather than being flattened to whichever appears first.
  if (/,/.test(t) && /\(\+\d/.test(t)) return "Varies";
  const head = t.replace(/\s*\(.*$/, "").trim();
  const hit = RARITY_ORDER.find((r) => r.toLowerCase() === head.toLowerCase());
  return hit || head;
}

/** Case- and punctuation-insensitive contains, for the search boxes. */
export function matches(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true;
  const n = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
  return n(haystack).includes(n(needle).trim());
}
