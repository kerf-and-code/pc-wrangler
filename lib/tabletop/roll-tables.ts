// lib/tabletop/roll-tables.ts (2026-11-08)
//
// Rollable tables (phase 5r, gap 2 in the tabletop audit doc). A table is plain text, one entry per
// line, so a GM can paste one straight out of a book or type a quick list. The parser here is the one
// source of truth: the editor's preview, the server's roll (app/api/tabletop/table-roll) and the tests
// all use it, so what the preview says is what the roll does.
//
// Two kinds of table, told apart by their lines:
//
//   NUMBERED (a book table). Every line starts with a number or a range: "1 Goblins", "2-3 Wolves",
//   "01-05 A merchant", "96-00 A dragon" (00 means 100). En dashes and "to" work too. The die is the
//   smallest that covers the last number (1d6 for 1..6, 1d100 for 1..100), and the ranges must start at
//   1, run upward and not overlap. A first line naming the dice ("2d6", or "Dice: 2d6") sets the dice
//   instead, for bell-curve tables like 2 to 12; the ranges then start wherever the dice do.
//
//   WEIGHTED (a quick list). Any other text. Each line is one entry, picked evenly, unless it starts
//   with a weight: "3x Bandits" is three times as likely as a line with none.
//
// Blank lines and lines starting with "#" or "//" are ignored.

export const MAX_ENTRIES = 200;
export const MAX_TEXT = 300;
export const MAX_BODY = 20000;
const MAX_WEIGHT_TOTAL = 1000;      // lib/dice rolls dice of up to 1000 sides

export type RangeEntry = { lo: number; hi: number; text: string };
export type WeightEntry = { w: number; text: string };
export type ParsedTable =
  | { kind: "numbered"; dice: string; lo: number; hi: number; entries: RangeEntry[]; gaps: number[] }
  | { kind: "weighted"; dice: string; total: number; entries: WeightEntry[] };
export type ParseResult = { ok: true; table: ParsedTable } | { ok: false; error: string };

const DICE_LINE = /^(?:dice\s*:?\s*)?(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?$/i;
const RANGE_LINE = /^(\d{1,3})(?:\s*(?:-|\u2013|\u2014|to)\s*(\d{1,3}))?(?:\s*[.:)|]\s*|\s+)(\S.*)$/i;
const WEIGHT_LINE = /^(\d{1,3})\s*[x\u00d7]\s+(\S.*)$/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
const num = (s: string) => (s === "00" ? 100 : Number(s));

/** The lowest and highest totals a dice expression like 2d6+1 can roll. */
function diceRange(count: number, sides: number, sign: string | undefined, mod: number): [number, number] {
  const m = sign === "-" ? -mod : mod;
  return [count + m, count * sides + m];
}

export function parseTable(body: string): ParseResult {
  if (body.length > MAX_BODY) return { ok: false, error: `That table is too long (over ${MAX_BODY.toLocaleString()} characters).` };
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  if (!lines.length) return { ok: false, error: "Add at least one entry, one per line." };

  // an explicit dice line first?
  let explicit: { count: number; sides: number; sign?: string; mod: number } | null = null;
  const dm = DICE_LINE.exec(lines[0]);
  if (dm) {
    const count = dm[1] === "" ? 1 : Number(dm[1]), sides = Number(dm[2]);
    if (count < 1 || count > 20 || sides < 2 || sides > 1000) return { ok: false, error: "The dice line needs 1 to 20 dice of 2 to 1000 sides, like 2d6." };
    explicit = { count, sides, sign: dm[3], mod: dm[4] ? Number(dm[4]) : 0 };
    lines.shift();
    if (!lines.length) return { ok: false, error: "Add the entries under the dice line, one per line." };
  }
  if (lines.length > MAX_ENTRIES) return { ok: false, error: `A table can have at most ${MAX_ENTRIES} entries.` };

  const ranged = lines.map((l) => RANGE_LINE.exec(l));
  const allRanged = ranged.every((m, i) => !!m && !WEIGHT_LINE.test(lines[i]));
  if (allRanged) {
    const entries: RangeEntry[] = ranged.map((m) => {
      const lo = num(m![1]), hi = m![2] !== undefined ? num(m![2]) : lo;
      return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), text: clean(m![3]) };
    });
    const ascending = entries.every((e, i) => i === 0 || e.lo > entries[i - 1].hi);
    const [minT, maxT] = explicit ? diceRange(explicit.count, explicit.sides, explicit.sign, explicit.mod) : [1, entries[entries.length - 1].hi];
    const looksNumbered = ascending && (explicit ? true : entries[0].lo === 1);
    if (looksNumbered) {
      if (explicit && (entries[0].lo < minT || entries[entries.length - 1].hi > maxT)) {
        return { ok: false, error: `Those numbers run past what the dice can roll (${minT} to ${maxT}).` };
      }
      if (!explicit && maxT < 2) return { ok: false, error: "A numbered table needs numbers up to at least 2." };
      if (!explicit && maxT > 1000) return { ok: false, error: "Numbers go up to 1000 at most (00 counts as 100)." };
      const gaps: number[] = [];
      for (let t = minT; t <= maxT && gaps.length < 20; t++) if (!entries.some((e) => t >= e.lo && t <= e.hi)) gaps.push(t);
      const dice = explicit
        ? `${explicit.count}d${explicit.sides}${explicit.mod ? `${explicit.sign}${explicit.mod}` : ""}`
        : `1d${maxT}`;
      return { ok: true, table: { kind: "numbered", dice, lo: minT, hi: maxT, entries, gaps } };
    }
    if (explicit) return { ok: false, error: "With a dice line, number the entries upward without overlaps, like 2 Goblins, 3-5 Wolves." };
  }
  if (explicit) return { ok: false, error: "With a dice line, start every entry with its number or range, like 3-5 Wolves." };

  // weighted
  const entries: WeightEntry[] = lines.map((l) => {
    const m = WEIGHT_LINE.exec(l);
    return m ? { w: Math.max(1, Number(m[1])), text: clean(m[2]) } : { w: 1, text: clean(l) };
  });
  const total = entries.reduce((s, e) => s + e.w, 0);
  if (total > MAX_WEIGHT_TOTAL) return { ok: false, error: `The weights add up to ${total}; keep them to ${MAX_WEIGHT_TOTAL} in all.` };
  return { ok: true, table: { kind: "weighted", dice: total >= 2 ? `1d${total}` : "", total, entries } };
}

/**
 * The entry a rolled total lands on: for a numbered table, the range holding it (null in a gap); for a
 * weighted one, the total is a 1..sum draw and walks the weights. A one-entry weighted table has no
 * dice and always gives its entry (pass 1).
 */
export function entryFor(t: ParsedTable, total: number): string | null {
  if (t.kind === "numbered") return t.entries.find((e) => total >= e.lo && total <= e.hi)?.text ?? null;
  let left = total;
  for (const e of t.entries) { left -= e.w; if (left <= 0) return e.text; }
  return null;
}

/** One line for the editor: what the table will do. */
export function describeTable(t: ParsedTable): string {
  if (t.kind === "numbered") {
    const base = `Rolls ${t.dice}, ${t.entries.length} ${t.entries.length === 1 ? "entry" : "entries"}`;
    return t.gaps.length ? `${base}. Nothing on ${t.gaps.slice(0, 6).join(", ")}${t.gaps.length > 6 ? " and more" : ""}: a roll there finds no entry.` : `${base}.`;
  }
  const weighted = t.entries.some((e) => e.w !== 1);
  return `Picks one of ${t.entries.length} ${t.entries.length === 1 ? "entry" : "entries"}${weighted ? ", by their weights" : ", each as likely"}.`;
}
