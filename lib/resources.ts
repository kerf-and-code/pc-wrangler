// lib/resources.ts
//
// The countable things a character spends and gets back: rages, Channel Divinity, Focus Points,
// spell slots.
//
// WHY THE CLASS TABLE CANNOT JUST BE READ WHOLESALE
//   Its columns are a mix of three different kinds of number, and only one of them is a resource:
//
//     a POOL that depletes    Rages, Channel Divinity, Second Wind, Focus Points, Sorcery Points
//     a DIE SIZE              Bardic Die, Martial Arts, Sneak Attack
//     a STANDING VALUE        Proficiency Bonus, Rage Damage, Unarmoed Movement, Weapon Mastery
//
//   A tracker built by taking every column would offer to spend a player's Proficiency Bonus. So
//   the resource columns are named explicitly. That list is short and closed, and adding to it is
//   safe; guessing from the column name is not - "Weapon Mastery" and "Eldritch Invocations" are
//   counts of things KNOWN, which read exactly like counts of things available.
//
//   ("Unarmoed Movement" is spelled that way in the source data. Left alone: matching the data as
//   published beats correcting it here and then failing to match on the next fetch.)

/** Columns that are a spendable pool. Everything else in a class table is not. */
export const RESOURCE_COLUMNS = new Set([
  "Rages",
  "Channel Divinity",
  "Second Wind",
  "Focus Points",
  "Sorcery Points",
  "Favored Enemy",
  "Spell Slots",          // Warlock pact magic
]);

/** Spell slot columns, which are resources too but belong in their own row. */
export const SLOT_COLUMNS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

export type Resource = {
  key: string;
  label: string;
  max: number;
  /** Warlock slots all come back on a short rest; most of the rest are long-rest. */
  note?: string;
};

const asCount = (v: string | undefined): number | null => {
  const t = String(v ?? "").trim();
  if (!t || t === "\u2014" || t === "-") return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The resources a character has at this level, from their class table row.
 *
 * Returns [] rather than guessing when the row is missing. A tracker that invents a maximum is
 * worse than no tracker: a player who trusts it will run out of rages a turn early, or late.
 */
export function resourcesFor(
  row: { level: number; columns: Record<string, string> } | undefined,
): Resource[] {
  if (!row) return [];
  const out: Resource[] = [];
  for (const [col, raw] of Object.entries(row.columns)) {
    if (!RESOURCE_COLUMNS.has(col)) continue;
    const max = asCount(raw);
    if (max === null) continue;
    out.push({ key: col, label: col, max });
  }
  return out;
}

/** Spell slots per level, as their own list. */
export function slotsFor(
  row: { level: number; columns: Record<string, string> } | undefined,
): Resource[] {
  if (!row) return [];
  const out: Resource[] = [];
  for (const col of SLOT_COLUMNS) {
    const max = asCount(row.columns[col]);
    if (max === null) continue;
    out.push({ key: `slot-${col}`, label: `${col} level`, max });
  }
  return out;
}

/**
 * How many of a resource are left.
 *
 * Spent counts are stored rather than remaining, because the MAXIMUM moves: a barbarian levelling
 * from 2 to 3 gains a rage, and a stored "remaining 2" would silently become wrong while a stored
 * "spent 1" stays true.
 */
export const remaining = (r: Resource, spent: Record<string, number>): number =>
  Math.max(0, r.max - (spent[r.key] || 0));

/** Everything back. What a long rest does to almost all of these. */
export const clearAll = (): Record<string, number> => ({});
