// tests/format.test.ts (polish pass, audit U24)
import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, fmtRelative, fmtTime } from "../lib/format";

describe("format", () => {
  it("returns nothing for a missing or bad value", () => {
    for (const v of [null, undefined, "", "not a date"]) {
      expect(fmtDate(v)).toBe("");
      expect(fmtDateTime(v)).toBe("");
      expect(fmtTime(v)).toBe("");
      expect(fmtRelative(v)).toBe("");
    }
  });

  it("never shows seconds", () => {
    const d = new Date(2026, 10, 10, 14, 28, 7);
    expect(fmtTime(d)).not.toMatch(/:07/);
    expect(fmtDateTime(d)).not.toMatch(/:07/);
  });

  it("adds the year only for another year", () => {
    const thisYear = new Date(new Date().getFullYear(), 0, 15);
    const lastYear = new Date(new Date().getFullYear() - 1, 0, 15);
    expect(fmtDate(thisYear)).not.toMatch(String(thisYear.getFullYear()));
    expect(fmtDate(lastYear)).toMatch(String(lastYear.getFullYear()));
  });

  it("reads recent times in words", () => {
    const now = new Date(2026, 10, 10, 12, 0, 0);
    expect(fmtRelative(new Date(2026, 10, 10, 11, 59, 40), now)).toBe("just now");
    expect(fmtRelative(new Date(2026, 10, 10, 11, 55, 0), now)).toBe("5 minutes ago");
    expect(fmtRelative(new Date(2026, 10, 10, 9, 0, 0), now)).toBe("3 hours ago");
    expect(fmtRelative(new Date(2026, 10, 9, 10, 0, 0), now)).toBe("yesterday");
  });
});
