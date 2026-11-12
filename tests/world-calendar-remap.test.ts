// tests/world-calendar-remap.test.ts (push 46, audit round 2 B8): a reshaped calendar keeps every date
import { describe, expect, it } from "vitest";
import { fromWorldDate, presetCalendar, remapDay, sameShape, toWorldDate, type WorldCalendar } from "@/lib/world-calendar";

const std = presetCalendar("standard");
const longer: WorldCalendar = { ...std, months: std.months.map((m, i) => (i === 1 ? { ...m, days: 35 } : m)) };

describe("remapDay", () => {
  it("keeps the year, month and day when a month changes length", () => {
    const day = fromWorldDate(std, { year: 1203, month: 9, day: 14 });
    const moved = remapDay(std, longer, day);
    expect(toWorldDate(longer, moved)).toEqual({ year: 1203, month: 9, day: 14 });
    // without the remap the same number reads as a different year
    expect(toWorldDate(longer, day).year).not.toBe(1203);
  });
  it("clamps to a shorter month and to fewer months", () => {
    const day = fromWorldDate(std, { year: 5, month: 11, day: 31 });
    const short: WorldCalendar = { ...std, months: std.months.slice(0, 10).map((m) => ({ ...m, days: 30 })) };
    expect(toWorldDate(short, remapDay(std, short, day))).toEqual({ year: 5, month: 9, day: 30 });
  });
  it("tells a rename from a reshape", () => {
    expect(sameShape(std, { ...std, months: std.months.map((m) => ({ ...m, name: m.name + "x" })) })).toBe(true);
    expect(sameShape(std, longer)).toBe(false);
  });
});
