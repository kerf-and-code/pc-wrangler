// lib/species-choices.ts
//
// Pull the option list out of a species trait's prose.
//
// WHY THIS IS EXTRACTION AND NOT AUTHORING
//   The 2024 species traits ask the player to choose, and then - usefully - list what the choices
//   are, in one of two shapes:
//
//     a markdown table   "| Dragon | Damage Type | |---|---| | Black | Acid | | Blue | Lightning |"
//     a bold bullet list "- **Cloud's Jaunt (Cloud Giant)**. As a Bonus Action, you ..."
//
//   So the options do not have to be typed out by hand, which matters for more than effort: a hand
//   copy is a second source that drifts from the first the moment the data is refetched, and drifts
//   silently. Reading them out of the same string the player is shown means the picker and the
//   rules text cannot disagree.
//
// WHAT IT DOES WHEN IT CANNOT
//   Returns an empty list. The caller shows the prose and no picker, which is honest - an empty
//   dropdown under a trait that clearly asks for a decision is worse than no dropdown at all.
//   Elven Lineage is exactly this case today: it points at a table that is not in its own desc.

export type TraitOption = {
  name: string;
  detail?: string;
  /**
   * The remaining table columns, in order. Elven Lineages and Fiendish Legacies are four-column
   * tables - lineage, then the spell gained at levels 1, 3 and 5 - so the columns ARE the
   * progression and joining them into one string threw that away. `detail` keeps the joined form
   * for display; this keeps the structure for anything that needs to act on it.
   */
  columns?: string[];
};

/**
 * Markdown table rows. The data has them run together on one line with inconsistent spacing
 * ("| Brass |Fire| |Bronze | Lightning |"), so this splits on the pipe rather than trusting rows to
 * sit on their own lines.
 */
function fromTable(desc: string): TraitOption[] {
  // The separator row is also the COLUMN COUNT. Assuming two columns was wrong: Draconic Ancestors
  // has two (Dragon | Damage Type) but Elven Lineages has four (Lineage | level 1 | 3 | 5), so
  // stepping in pairs slid one column left on every row after the first and offered "Faerie Fire"
  // and "Detect Magic" as if they were lineages.
  const sep = desc.match(/\|(?:\s*-{2,}\s*\|)+/);
  if (!sep) return [];
  const cols = (sep[0].match(/-{2,}/g) || []).length;
  if (cols < 2) return [];

  const cells = desc
    .slice((sep.index ?? 0) + sep[0].length)
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const out: TraitOption[] = [];
  for (let i = 0; i + cols - 1 < cells.length; i += cols) {
    const name = cells[i];
    // The first column is the thing being chosen; the rest is what it grants.
    if (!/^[A-Za-z][A-Za-z' -]{1,28}$/.test(name)) continue;
    const rest = cells.slice(i + 1, i + cols);
    const detail = rest.filter(Boolean).join(" \u00b7 ");
    out.push({ name, detail: detail || undefined, columns: rest });
  }
  return out;
}

/** Bold bullet lists: "- **Cloud's Jaunt (Cloud Giant)**. As a Bonus Action ..." */
function fromBullets(desc: string): TraitOption[] {
  const out: TraitOption[] = [];
  const re = /[-*]\s*\*\*(.+?)\*\*\.?\s*([^\n-][^\n]{0,160})?/g;
  for (let m = re.exec(desc); m; m = re.exec(desc)) {
    const label = m[1].trim();
    if (!label || label.length > 60) continue;
    out.push({ name: label, detail: (m[2] || "").trim() || undefined });
  }
  return out;
}

/** Does this trait ask the player to decide anything. */
export function traitAsksAChoice(desc: string): boolean {
  return /\bchoose\b|\byour choice\b|\bone of the following\b/i.test(desc || "");
}

/**
 * The spells a lineage-style option grants, keyed by the character level they arrive at.
 *
 * The table's header row names the levels ("Level 1 Benefit", "Level 3", "Level 5"), but headers
 * are stripped before the rows are read, so the POSITION is used instead: 5e grants these at 1, 3
 * and 5 without exception, and inventing a header parser for three fixed numbers would be more
 * ways to be wrong, not fewer.
 */
export function lineageSpells(option: TraitOption | undefined): { level: number; spell: string }[] {
  const cols = option?.columns || [];
  const levels = [1, 3, 5];
  const out: { level: number; spell: string }[] = [];
  cols.slice(0, 3).forEach((raw, i) => {
    const spell = (raw || "").trim();
    // A cell that is not a spell name - a dash, a note, a sentence - is skipped rather than
    // offered: a "spell" the catalog has never heard of is worse than a missing row.
    if (!spell || spell.length > 40 || /^[-\u2014\u2013]$/.test(spell)) return;
    out.push({ level: levels[i], spell });
  });
  return out;
}

export function traitOptions(desc: string): TraitOption[] {
  if (!desc || !traitAsksAChoice(desc)) return [];
  const table = fromTable(desc);
  if (table.length >= 2) return table;
  const bullets = fromBullets(desc);
  if (bullets.length >= 2) return bullets;
  return [];
}
