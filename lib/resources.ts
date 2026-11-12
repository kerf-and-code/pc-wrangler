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
// Push 47 (audit round 2, G9): Rages and Second Wind were wrong for 2024. The 2024 SRD says of both "You
// regain one expended use when you finish a Short Rest, and you regain all expended uses when you finish
// a Long Rest" (lib/srd/classes-2024-structured.json). The 2014 columns, which the 2014 data names
// differently, follow the 2014 SRD text: rages come back only on a long rest, Channel Divinity, ki and
// Action Surge on a short or long rest, Indomitable on a long rest.
export const RESOURCE_COLUMNS = new Map<string, { shortRest: "all" | "one" | "none" }>([
  ["Rages", { shortRest: "one" }],
  ["Channel Divinity", { shortRest: "one" }],
  ["Second Wind", { shortRest: "one" }],
  ["Focus Points", { shortRest: "all" }],
  ["Sorcery Points", { shortRest: "none" }],
  ["Favored Enemy", { shortRest: "none" }],
  ["Spell Slots", { shortRest: "all" }],   // Warlock pact magic
  // 2014 (5e-bits) column names
  ["Rage Count", { shortRest: "none" }],
  ["Ki Points", { shortRest: "all" }],
  ["Channel Divinity Charges", { shortRest: "all" }],
  ["Action Surges", { shortRest: "all" }],
  ["Indomitable Uses", { shortRest: "none" }],
]);

/** What a column is called on the sheet (the 2014 data's names read oddly as labels). */
const LABEL: Record<string, string> = {
  "Rage Count": "Rages", "Channel Divinity Charges": "Channel Divinity", "Action Surges": "Action Surge", "Indomitable Uses": "Indomitable",
};

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
  // a lone dash of any width means "none" (the source data writes a long dash; 0x2014)
  if (!t || t === "-" || (t.length === 1 && t.charCodeAt(0) === 0x2014)) return null;
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
    // the 2014 data writes a 20th-level barbarian's unlimited rages as 9999: nothing to track
    if (max === null || max >= 99) continue;
    out.push({ key: col, label: LABEL[col] ?? col, max, shortRest: rule.shortRest });
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
 * Resources a SPECIES grants, which no class table can describe.
 *
 * Goliath's Giant Ancestry gives uses equal to proficiency bonus - a number that lives on the
 * derived sheet, not in any column - so the max is computed rather than read. Authored for the same
 * reason the subclass spell table is: the species data carries prose, and a species absent from
 * here simply grants no tracked resource.
 */
export const SPECIES_RESOURCES: Record<string, { label: string; from: "proficiency"; shortRest: "all" | "one" | "none" }> = {
  "Giant Ancestry": { label: "Giant Ancestry", from: "proficiency", shortRest: "none" },
};

export function speciesResources(traitNames: string[], proficiencyBonus: number): Resource[] {
  const out: Resource[] = [];
  for (const name of traitNames) {
    const def = SPECIES_RESOURCES[name];
    if (!def) continue;
    const max = def.from === "proficiency" ? proficiencyBonus : 0;
    if (max > 0) out.push({ key: name, label: def.label, max, shortRest: def.shortRest });
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

/**
 * Push 47 (audit round 2, G9): class pools that neither edition's class table lists, from the SRD
 * feature text of each edition (lib/srd/classes-20xx-structured.json):
 *
 *   Bardic Inspiration  uses equal to the Charisma modifier (at least 1); back on a long rest, and from
 *                       level 5 (Font of Inspiration) on a short rest too
 *   Wild Shape          twice; 2014 back on a short or long rest, 2024 one back on a short rest
 *   Action Surge        2024 only (2014 has the "Action Surges" column): once, twice from level 17,
 *                       back on a short or long rest
 *   Indomitable         2024 only (2014 has the column): once at 9, twice at 13, three times at 17,
 *                       back on a long rest
 *   Second Wind         2014 only (2024 has the column): once, back on a short or long rest
 *   Arcane Recovery     once, back on a long rest
 *   Sorcerous Restoration  2024, level 5: once, back on a long rest
 * Lay on Hands is added by the Forge itself.
 */
export function classPools(ruleset: "2014" | "2024", classes: { name: string; level: number }[], chaMod: number): Resource[] {
  const out: Resource[] = [];
  const add = (r: Resource) => { const at = out.findIndex((x) => x.key === r.key); if (at < 0) out.push(r); else if (out[at].max < r.max) out[at] = r; };
  for (const c of classes) {
    const n = (c.name || "").toLowerCase(), lv = Math.max(0, Math.floor(c.level || 0));
    if (!lv) continue;
    if (n === "bard") add({ key: "Bardic Inspiration", label: "Bardic Inspiration", max: Math.max(1, chaMod), shortRest: lv >= 5 ? "all" : "none" });
    if (n === "druid" && lv >= 2) add({ key: "Wild Shape", label: "Wild Shape", max: 2, shortRest: ruleset === "2014" ? "all" : "one" });
    if (n === "fighter" && ruleset === "2024") {
      if (lv >= 2) add({ key: "Action Surge", label: "Action Surge", max: lv >= 17 ? 2 : 1, shortRest: "all" });
      if (lv >= 9) add({ key: "Indomitable", label: "Indomitable", max: lv >= 17 ? 3 : lv >= 13 ? 2 : 1, shortRest: "none" });
    }
    if (n === "fighter" && ruleset === "2014") add({ key: "Second Wind", label: "Second Wind", max: 1, shortRest: "all" });
    if (n === "wizard") add({ key: "Arcane Recovery", label: "Arcane Recovery", max: 1, shortRest: "none" });
    if (n === "sorcerer" && ruleset === "2024" && lv >= 5) add({ key: "Sorcerous Restoration", label: "Sorcerous Restoration", max: 1, shortRest: "none" });
  }
  return out;
}
