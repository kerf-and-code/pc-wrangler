import { describe, it, expect } from "vitest";
import {
  presetCalendar, normalizeCalendar, yearLength, toWorldDate, fromWorldDate, weekdayOf, formatWorldDate,
  spanText, sinceText, monthsToText, textToMonths, CALENDAR_PRESETS,
} from "@/lib/world-calendar";

describe("presets", () => {
  it("have the year lengths their labels promise", () => {
    expect(yearLength(presetCalendar("standard"))).toBe(365);
    expect(yearLength(presetCalendar("twelve-thirty"))).toBe(360);
    expect(yearLength(presetCalendar("thirteen"))).toBe(364);
    expect(presetCalendar("nope").preset).toBe("standard");
    for (const p of CALENDAR_PRESETS) expect(normalizeCalendar(p.make())).toEqual(p.make());
  });
});

describe("day numbers and dates", () => {
  const cal = presetCalendar("standard");
  it("puts day 0 on the first day of year 1", () => {
    expect(toWorldDate(cal, 0)).toEqual({ year: 1, month: 0, day: 1 });
    expect(toWorldDate(cal, 31)).toEqual({ year: 1, month: 1, day: 1 });
    expect(toWorldDate(cal, 364)).toEqual({ year: 1, month: 11, day: 31 });
    expect(toWorldDate(cal, 365)).toEqual({ year: 2, month: 0, day: 1 });
  });
  it("round-trips any day, including years before 1", () => {
    for (const n of [0, 1, 58, 59, 200, 364, 365, 545123, -1, -365, -366, -1000]) {
      expect(fromWorldDate(cal, toWorldDate(cal, n))).toBe(n);
    }
    expect(toWorldDate(cal, -1)).toEqual({ year: 0, month: 11, day: 31 });
  });
  it("clamps an impossible day to the month", () => {
    expect(fromWorldDate(cal, { year: 1, month: 1, day: 31 })).toBe(fromWorldDate(cal, { year: 1, month: 1, day: 28 }));
    expect(fromWorldDate(cal, { year: 1, month: 99, day: 1 })).toBe(fromWorldDate(cal, { year: 1, month: 11, day: 1 }));
  });
  it("names the weekday, counting from day 0, and formats with the era", () => {
    expect(weekdayOf(cal, 0)).toBe("Monday");
    expect(weekdayOf(cal, 8)).toBe("Tuesday");
    expect(weekdayOf(cal, -1)).toBe("Sunday");
    const era = { ...presetCalendar("twelve-thirty"), weekdays: [], era: "AF" };
    expect(formatWorldDate(era, fromWorldDate(era, { year: 1203, month: 2, day: 14 }))).toBe("14 Month 3 1203 AF");
    expect(formatWorldDate(cal, 8)).toBe("Tuesday, 9 January 1");
    expect(formatWorldDate(cal, 8, { weekday: false })).toBe("9 January 1");
  });
});

describe("spans", () => {
  const cal = presetCalendar("twelve-thirty");
  it("says how far apart two dates are", () => {
    expect(spanText(cal, 1)).toBe("1 day");
    expect(spanText(cal, 12)).toBe("12 days");
    expect(spanText(cal, 360)).toBe("1 year");
    expect(spanText(cal, 725)).toBe("2 years and 5 days");
  });
  it("relates a session to the one before it", () => {
    expect(sinceText(cal, 112, 100, "session 6")).toBe("12 days after session 6");
    expect(sinceText(cal, 100, 100, "session 6")).toBe("the same day as session 6");
    expect(sinceText(cal, 96, 100, "session 6")).toBe("4 days before session 6");
    expect(sinceText(cal, null, 100, "session 6")).toBeNull();
  });
});

describe("the calendar editor", () => {
  it("reads months one per line, with or without a comma", () => {
    expect(textToMonths("Frostfall, 30\nThaw 31\n\nno days here\nLong Night: 5\nBad, 0")).toEqual([
      { name: "Frostfall", days: 30 }, { name: "Thaw", days: 31 }, { name: "Long Night", days: 5 },
    ]);
    const cal = presetCalendar("thirteen");
    expect(textToMonths(monthsToText(cal))).toEqual(cal.months);
  });
  it("cleans a stored calendar and refuses an empty one", () => {
    expect(normalizeCalendar(null)).toBeNull();
    expect(normalizeCalendar({ months: [] })).toBeNull();
    expect(normalizeCalendar({ months: [{ name: "", days: 0 }] })).toBeNull();
    const c = normalizeCalendar({ months: [{ name: "  Thaw  ", days: "20" }, { days: 10 }], weekdays: [" A ", "", "B"], era: " AF " })!;
    expect(c).toEqual({ v: 1, preset: "custom", months: [{ name: "Thaw", days: 20 }, { name: "Month 2", days: 10 }], weekdays: ["A", "B"], era: "AF" });
  });
});
