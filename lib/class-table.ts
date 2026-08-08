// lib/class-table.ts
//
// One progression table out of two different fetched shapes.
//
// WHY THERE ARE TWO SHAPES AT ALL
//   The structured class data comes from two sources because no single one publishes both rulesets:
//
//     2014  5e-bits/5e-database  -> progression: [{ level, prof_bonus, class_specific: {...} }]
//                                  already per-level, one row per level
//     2024  Open5e               -> class_table: [{ name, by_level: { "1": "+2", "5": "+3" } }]
//                                  one entry per COLUMN, each holding a level map
//
//   The second is a pivot of the first. Rather than teach the panel both, this turns either into
//   one row per level with a column bag - so the renderer stays a table renderer and the difference
//   between the two fetches lives in exactly one file.
//
// SPARSE LEVELS ARE FILLED FORWARD
//   Open5e lists a column value only at the level it CHANGES: proficiency bonus appears at 1 and 5
//   and 9, not at 2, 3 and 4. Read literally that draws a table with holes in it, which reads as
//   missing data rather than as "unchanged". Each column carries its last value forward instead.

export type ClassTableRow = { level: number; columns: Record<string, string> };

type Structured2024 = {
  class_table?: { name?: string; type?: string; by_level?: Record<string, unknown> }[];
  features_by_level?: { level: number }[];
};

type Structured2014 = {
  progression?: {
    level?: number;
    prof_bonus?: unknown;
    class_specific?: Record<string, unknown>;
  }[];
};

/** "rage_count" -> "Rage Count". The fetched keys are snake_case; a table header should not be. */
export function humanColumn(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bDc\b/g, "DC")
    .replace(/\bHp\b/g, "HP");
}

const asText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    // 2014's class_specific occasionally nests, e.g. { spell_slots_level_1: 2 } inside a bag.
    const inner = Object.values(v as Record<string, unknown>).filter((x) => x !== null && x !== undefined);
    return inner.length ? inner.map(String).join(" / ") : "";
  }
  return String(v);
};

export function classTable(rec: unknown, maxLevel = 20): ClassTableRow[] {
  if (!rec || typeof rec !== "object") return [];
  const a = rec as Structured2024;
  const b = rec as Structured2014;

  const byLevel = new Map<number, Record<string, string>>();
  const columnOrder: string[] = [];

  const put = (level: number, col: string, value: string) => {
    if (!Number.isFinite(level) || level < 1 || level > maxLevel) return;
    if (!value) return;
    if (!columnOrder.includes(col)) columnOrder.push(col);
    const row = byLevel.get(level) || {};
    row[col] = value;
    byLevel.set(level, row);
  };

  // --- 2024: one entry per column, each a level map -----------------------------------------
  for (const col of a.class_table || []) {
    const label = humanColumn(col.name || col.type || "");
    for (const [lv, v] of Object.entries(col.by_level || {})) {
      put(Number(lv), label, asText(v));
    }
  }

  // --- 2014: one entry per level ------------------------------------------------------------
  for (const row of b.progression || []) {
    const lv = Number(row.level);
    if (row.prof_bonus !== undefined) put(lv, "Proficiency Bonus", asText(row.prof_bonus));
    for (const [k, v] of Object.entries(row.class_specific || {})) {
      put(lv, humanColumn(k), asText(v));
    }
  }

  if (byLevel.size === 0) return [];

  const top = Math.max(...byLevel.keys(), ...(a.features_by_level || []).map((f) => f.level || 0));
  const out: ClassTableRow[] = [];
  const carried: Record<string, string> = {};

  for (let lv = 1; lv <= Math.min(top, maxLevel); lv++) {
    const here = byLevel.get(lv) || {};
    for (const col of columnOrder) {
      if (here[col] !== undefined) carried[col] = here[col];
    }
    // A column that has not appeared yet stays blank rather than borrowing a later value.
    const columns: Record<string, string> = {};
    for (const col of columnOrder) {
      if (carried[col] !== undefined) columns[col] = carried[col];
    }
    out.push({ level: lv, columns });
  }
  return out;
}

/** The column headers, in the order the source listed them. */
export function classTableColumns(rows: ClassTableRow[]): string[] {
  const seen: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r.columns)) if (!seen.includes(k)) seen.push(k);
  }
  return seen;
}
