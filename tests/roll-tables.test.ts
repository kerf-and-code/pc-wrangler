// tests/roll-tables.test.ts: the rollable-table parser (lib/tabletop/roll-tables.ts), which the editor
// preview and the server roll share.
import { describe, expect, it } from "vitest";
import { describeTable, entryFor, parseTable, type ParsedTable } from "@/lib/tabletop/roll-tables";

const ok = (body: string): ParsedTable => {
  const r = parseTable(body);
  if (!r.ok) throw new Error(r.error);
  return r.table;
};

describe("numbered tables", () => {
  it("reads a d6 table and picks by range", () => {
    const t = ok("1 Goblins\n2-3 Wolves\n4-5. Bandits\n6) An owlbear");
    expect(t.kind).toBe("numbered");
    expect(t.dice).toBe("1d6");
    expect([1, 2, 3, 4, 5, 6].map((n) => entryFor(t, n))).toEqual(["Goblins", "Wolves", "Wolves", "Bandits", "Bandits", "An owlbear"]);
  });
  it("reads a pasted d100 table with en dashes and 00", () => {
    const t = ok("01\u201340 Nothing\n41\u201390 Tracks\n91\u201300 A dragon");
    expect(t.dice).toBe("1d100");
    expect(entryFor(t, 100)).toBe("A dragon");
    expect(entryFor(t, 40)).toBe("Nothing");
  });
  it("takes the dice from a first line, for a 2d6 table", () => {
    const t = ok("Dice: 2d6\n2-4 Ambush\n5-9 Quiet road\n10-12 A traveller");
    expect(t.dice).toBe("2d6");
    if (t.kind === "numbered") expect([t.lo, t.hi, t.gaps.length]).toEqual([2, 12, 0]);
  });
  it("reports gaps instead of guessing", () => {
    const t = ok("1 A\n2 B\n5-6 C");
    if (t.kind !== "numbered") throw new Error("expected numbered");
    expect(t.gaps).toEqual([3, 4]);
    expect(entryFor(t, 3)).toBeNull();
    expect(describeTable(t)).toMatch(/Nothing on 3, 4/);
  });
  it("refuses numbers past the dice", () => {
    const r = parseTable("2d6\n2-7 A\n8-13 B");
    expect(r.ok).toBe(false);
  });
});

describe("weighted lists", () => {
  it("treats plain lines as equally likely", () => {
    const t = ok("Rain\nFog\nSun");
    expect(t.kind).toBe("weighted");
    expect(t.dice).toBe("1d3");
    expect([1, 2, 3].map((n) => entryFor(t, n))).toEqual(["Rain", "Fog", "Sun"]);
  });
  it("honours weights", () => {
    const t = ok("3x Bandits\nA dragon");
    expect(t.dice).toBe("1d4");
    expect([1, 2, 3, 4].map((n) => entryFor(t, n))).toEqual(["Bandits", "Bandits", "Bandits", "A dragon"]);
  });
  it("is a list, not a table, when numbered lines do not start at 1 or run upward", () => {
    expect(ok("3 goblins\n2 orcs").kind).toBe("weighted");
    expect(ok("2 Goblins\n3 Orcs").kind).toBe("weighted");
  });
  it("ignores blank and comment lines, and a single entry needs no dice", () => {
    const t = ok("# my table\n\nOnly this");
    expect(t.dice).toBe("");
    expect(entryFor(t, 1)).toBe("Only this");
  });
  it("refuses an empty table and weights over 1000", () => {
    expect(parseTable("  \n# nothing").ok).toBe(false);
    expect(parseTable("999x A\n2x B").ok).toBe(false);
  });
});
