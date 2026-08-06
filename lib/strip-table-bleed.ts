/**
 * Strip the class progression TABLE that OCR bled into a feature description.
 *
 * THE PROBLEM
 *   The SRD class data was read out of a PDF, and the progression table landed inside the prose of
 *   the first feature. On the Druid it arrives mid-sentence:
 *
 *     "The information below details Druid Features Proficiency Bonus Wild Shape Prepared Spells
 *      --Spell Slots per Spell Level-- Level Class Features Cantrips 1 2 3 4 ... 20 +6 Archdruid
 *      4 4 22 4 3 3 3 3 2 2 1 1 how you use those rules with Druid spells, which appear on the
 *      Druid spell list later in the class's description. Cantrips. You know two cantrips ..."
 *
 * WHY THE OLD FIX WAS NOT ENOUGH
 *   It cut at the literal marker " Features Level", which is Fighter's and Barbarian's header. Six
 *   other classes lay out their columns differently - Druid's reads "Features Proficiency Bonus
 *   Wild Shape Prepared Spells" - so the marker never matched and the whole table rendered. Checked
 *   against the real data: of twelve classes, that marker caught two.
 *
 *   It also TRUNCATED at the marker. That is right when the table sits at the end, and wrong here:
 *   everything after the Druid table is real rules text about cantrips, slots and prepared spells,
 *   and cutting would have thrown it away. This EXCISES the table and splices the sentence back
 *   together instead.
 *
 * HOW IT DECIDES
 *   By density rather than by a marker, so it does not need to know each class's column layout. A
 *   token counts as tabular if it is nothing but digits, signs and dashes. The scan walks forward
 *   from the first tabular token, hopping over short stretches of prose - a table row is
 *   "1 +2 Spellcasting, Druidic, Primal Order - 2 4 2", so feature names sit BETWEEN the numbers -
 *   and only excises when the span holds at least 20 tabular tokens. A sentence that merely
 *   mentions a few numbers never reaches that, which is why Monk, Rogue, Ranger, Sorcerer and
 *   Warlock come through untouched.
 */

const TABULAR = /^[\d+\-\u2014\u2013\u2212/]+$/;

// Words that make up a table HEADER. When a table is found, these are absorbed backwards from its
// start so "Druid Features Proficiency Bonus Wild Shape Prepared Spells" goes with it rather than
// being left stranded in the sentence.
const HEADER_WORDS = new Set([
  "features", "feature", "proficiency", "bonus", "level", "levels", "cantrips", "known",
  "slots", "spell", "spells", "prepared", "rages", "damage", "points", "die", "dice",
  "class", "per", "wild", "shape", "sneak", "attack", "martial", "arts", "ki", "focus",
  "invocations", "rests", "uses", "score", "improvement", "sorcery", "arcane", "recovery",
  "max", "of", "and", "points,",
]);

// Em and en dashes have to come off both ends, not just brackets and punctuation: the table header
// arrives as "--Spell Slots per Spell Level--" with the dashes fused to the words, so without this
// "Spell" and "Level" never match HEADER_WORDS and the header is left stranded in the sentence.
const bare = (t: string) =>
  t.replace(/^[("'\u201c\u2014\u2013\u2212-]+|[),.;:"'\u201d\u2014\u2013\u2212-]+$/g, "");

/** How far the scan will look past a prose word before deciding the table has ended. */
const HOP = 12;
/** Below this many tabular tokens a span is prose that happens to contain numbers. */
const MIN_TABULAR = 20;

export function stripTableBleed(desc: string): string {
  if (!desc) return "";
  const toks = desc.split(/\s+/);
  const isTab = toks.map((t) => TABULAR.test(bare(t)));

  const spans: [number, number][] = [];
  let i = 0;
  while (i < toks.length) {
    if (!isTab[i]) { i += 1; continue; }

    // Extend while another tabular token appears within HOP, so interleaved feature names do not
    // end the run early.
    let end = i;
    let cursor = i;
    for (;;) {
      let next = -1;
      for (let k = cursor + 1; k < Math.min(cursor + HOP + 1, toks.length); k++) {
        if (isTab[k]) { next = k; break; }
      }
      if (next === -1) break;
      cursor = next;
      end = next;
    }

    let count = 0;
    for (let k = i; k <= end; k++) if (isTab[k]) count += 1;

    if (count >= MIN_TABULAR) {
      let start = i;
      while (start > 0 && HEADER_WORDS.has(bare(toks[start - 1]).toLowerCase())) start -= 1;
      // The class name usually sits immediately before "Features" ("Druid Features Proficiency...").
      // Take one capitalised word too, but only when a header word was actually consumed - so a
      // sentence ending in a name is never eaten.
      if (start < i && start > 0 && /^[A-Z][a-z]+$/.test(bare(toks[start - 1]))) start -= 1;
      spans.push([start, end]);
      i = end + 1;
    } else {
      i = end + 1;
    }
  }

  if (spans.length === 0) return desc.replace(/\s+/g, " ").trim();

  const kept: string[] = [];
  let prev = 0;
  for (const [s, e] of spans) {
    kept.push(...toks.slice(prev, s));
    prev = e + 1;
  }
  kept.push(...toks.slice(prev));

  return kept
    .join(" ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
