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

/**
 * Columns that are a spendable pool, and what a SHORT REST gives back.
 *
 * The recovery rule is not uniform and the difference matters at the table: Channel Divinity comes
 * back one use at a time, Focus Points come back entirely, and rages need a long rest. A single
 * "short rest" button that treated them alike would be wrong for two of the three, which is worse
 * than the button not existing.
 */
export const RESOURCE_COLUMNS = new Map<string, { shortRest: "all" | "one" | "none" }>([
  ["Rages", { shortRest: "none" }],
  ["Channel Divinity", { shortRest: "one" }],
  ["Second Wind", { shortRest: "all" }],
  ["Focus Points", { shortRest: "all" }],
  ["Sorcery Points", { shortRest: "none" }],
  ["Favored Enemy", { shortRest: "none" }],
  ["Spell Slots", { shortRest: "all" }],   // Warlock pact magic
]);

/** Spell slot columns, which are resources too but belong in their own row. */
export const SLOT_COLUMNS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

export type Resource = {
  key: string;
  label: string;
  max: number;
  /** What a short rest returns: everything, one use, or nothing. */
  shortRest: "all" | "one" | "none";
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
    const rule = RESOURCE_COLUMNS.get(col);
    if (!rule) continue;
    const max = asCount(raw);
    if (max === null) continue;
    out.push({ key: col, label: col, max, shortRest: rule.shortRest });
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
    // Class spell slots return on a LONG rest. Warlock pact slots are the exception and they come
    // through resourcesFor as "Spell Slots", not through here.
    out.push({ key: `slot-${col}`, label: `${col} level`, max, shortRest: "none" });
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

/**
 * What a SHORT rest returns, applied to the spent map.
 *
 * Only touches resources it knows the rule for. A pool the tracker cannot classify is left exactly
 * as it was rather than optimistically cleared - being handed back uses you have not earned is the
 * error that loses a fight.
 */
export function afterShortRest(
  pools: Resource[], spent: Record<string, number>,
): Record<string, number> {
  const next = { ...spent };
  for (const r of pools) {
    const used = next[r.key] || 0;
    if (!used) continue;
    if (r.shortRest === "all") delete next[r.key];
    else if (r.shortRest === "one") {
      if (used <= 1) delete next[r.key];
      else next[r.key] = used - 1;
    }
  }
  return next;
}
