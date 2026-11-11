// lib/world-calendar.ts (2026-11-11, push 29, audit F15: in-game calendar)
//
// In-game time. A campaign may keep a calendar (campaigns.world_calendar, p154): its months, an
// optional week, and an era written after the year ("1203 AF"). Dates are stored as a DAY NUMBER
// counted from the first day of year 1 (day 0), on campaigns.world_day (today in the world) and
// sessions.world_day (the day a session started), so they sort and subtract without the calendar,
// and changing month names later never moves a date. Years before 1 work too (day numbers go
// negative). No leap years: a world's year is the same length every year.
//
// Pure: no React, no Supabase. Tested in tests/world-calendar.test.ts.

export type WorldMonth = { name: string; days: number };
export type WorldCalendar = {
  v: 1;
  preset: string;          // which preset it started from, or "custom"
  months: WorldMonth[];    // 1 to 24 months, each 1 to 400 days
  weekdays: string[];      // the names of the days of the week, in order; empty: no week
  era: string;             // written after the year, may be empty
};
export type WorldDate = { year: number; month: number; day: number };   // month 0-based, day 1-based

const GREG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const GREG_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const WEEK7 = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Presets the GM starts from. All are generic (no published setting's calendar), and every one can
 *  be renamed and reshaped afterwards. */
export const CALENDAR_PRESETS: { key: string; label: string; make: () => WorldCalendar }[] = [
  {
    key: "standard", label: "Real-world months (365 days, 7-day week)",
    make: () => ({ v: 1, preset: "standard", months: GREG.map((name, i) => ({ name, days: GREG_DAYS[i] })), weekdays: [...WEEK7], era: "" }),
  },
  {
    key: "twelve-thirty", label: "Twelve months of 30 days (360 days, 10-day week)",
    make: () => ({
      v: 1, preset: "twelve-thirty",
      months: Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 })),
      weekdays: Array.from({ length: 10 }, (_, i) => `Day ${i + 1}`), era: "",
    }),
  },
  {
    key: "thirteen", label: "Thirteen months of 28 days (364 days, 7-day week)",
    make: () => ({
      v: 1, preset: "thirteen",
      months: Array.from({ length: 13 }, (_, i) => ({ name: `Month ${i + 1}`, days: 28 })),
      weekdays: [...WEEK7], era: "",
    }),
  },
];

export function presetCalendar(key: string): WorldCalendar {
  return (CALENDAR_PRESETS.find((p) => p.key === key) ?? CALENDAR_PRESETS[0]).make();
}

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Reads a stored calendar, or null when there is none or it is unusable. Trims names, caps sizes. */
export function normalizeCalendar(raw: unknown): WorldCalendar | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const months: WorldMonth[] = [];
  for (const m of Array.isArray(o.months) ? o.months : []) {
    const mm = (m ?? {}) as Record<string, unknown>;
    const days = Math.round(Number(mm.days));
    if (!Number.isFinite(days) || days < 1 || days > 400) continue;
    months.push({ name: clean(mm.name, 40) || `Month ${months.length + 1}`, days });
    if (months.length >= 24) break;
  }
  if (!months.length) return null;
  const weekdays = (Array.isArray(o.weekdays) ? o.weekdays : []).map((w) => clean(w, 30)).filter(Boolean).slice(0, 14);
  return { v: 1, preset: clean(o.preset, 30) || "custom", months, weekdays, era: clean(o.era, 20) };
}

export const yearLength = (cal: WorldCalendar): number => cal.months.reduce((s, m) => s + m.days, 0);

/** Day number to date. Day 0 is the first day of the first month of year 1. */
export function toWorldDate(cal: WorldCalendar, dayNumber: number): WorldDate {
  const len = yearLength(cal);
  const n = Math.floor(dayNumber);
  const yearIdx = Math.floor(n / len);
  let rest = n - yearIdx * len;
  let month = 0;
  while (month < cal.months.length - 1 && rest >= cal.months[month].days) { rest -= cal.months[month].days; month++; }
  return { year: yearIdx + 1, month, day: rest + 1 };
}

/** Date to day number. Out-of-range months and days are clamped to the calendar. */
export function fromWorldDate(cal: WorldCalendar, d: WorldDate): number {
  const len = yearLength(cal);
  const month = Math.max(0, Math.min(cal.months.length - 1, Math.floor(d.month)));
  const day = Math.max(1, Math.min(cal.months[month].days, Math.floor(d.day)));
  let n = (Math.floor(d.year) - 1) * len;
  for (let i = 0; i < month; i++) n += cal.months[i].days;
  return n + day - 1;
}

/** The weekday's name, or null when the calendar has no week. Day 0 falls on the first weekday. */
export function weekdayOf(cal: WorldCalendar, dayNumber: number): string | null {
  const w = cal.weekdays.length;
  if (!w) return null;
  return cal.weekdays[((Math.floor(dayNumber) % w) + w) % w];
}

/** "Moonday, 14 Frostfall 1203 AF", or without the weekday. */
export function formatWorldDate(cal: WorldCalendar, dayNumber: number, opts: { weekday?: boolean } = {}): string {
  const d = toWorldDate(cal, dayNumber);
  const core = `${d.day} ${cal.months[d.month].name} ${d.year}${cal.era ? ` ${cal.era}` : ""}`;
  const wd = opts.weekday === false ? null : weekdayOf(cal, dayNumber);
  return wd ? `${wd}, ${core}` : core;
}

/** "12 days", "1 day", "3 years and 4 days" (a year being this calendar's year). */
export function spanText(cal: WorldCalendar, days: number): string {
  const n = Math.abs(Math.round(days));
  const len = yearLength(cal);
  const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  if (n < len) return plural(n, "day");
  const y = Math.floor(n / len), r = n - y * len;
  return r ? `${plural(y, "year")} and ${plural(r, "day")}` : plural(y, "year");
}

/** How a session sits after the one before it: "12 days after session 6", "the same day as
 *  session 6", "4 days before session 6" (a flashback). Null when either date is missing. */
export function sinceText(cal: WorldCalendar, day: number | null, prevDay: number | null, prevLabel: string): string | null {
  if (day == null || prevDay == null) return null;
  const d = day - prevDay;
  if (d === 0) return `the same day as ${prevLabel}`;
  return `${spanText(cal, d)} ${d > 0 ? "after" : "before"} ${prevLabel}`;
}

/** Months as the editor shows them: one per line, "Name, days". */
export function monthsToText(cal: WorldCalendar): string {
  return cal.months.map((m) => `${m.name}, ${m.days}`).join("\n");
}

/** Parses the editor's months: one per line, a name and a number of days ("Frostfall, 30" or
 *  "Frostfall 30"). Lines without a number are skipped; at most 24 months. */
export function textToMonths(text: string): WorldMonth[] {
  const out: WorldMonth[] = [];
  for (const line of (text || "").split(/\r?\n/)) {
    const m = /^\s*(.*?)[\s,;:]+(\d{1,3})\s*$/.exec(line);
    if (!m) continue;
    const days = Number(m[2]);
    if (days < 1 || days > 400) continue;
    out.push({ name: clean(m[1], 40) || `Month ${out.length + 1}`, days });
    if (out.length >= 24) break;
  }
  return out;
}
