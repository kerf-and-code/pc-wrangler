// lib/format.ts (polish pass, audit U24)
//
// One way to show a date or a time everywhere. Bare toLocaleString() showed seconds and a numeric
// date whose order changes by locale ("11/10/2026, 2:28:07 PM" here, "10/11/2026" elsewhere), and
// pages had three different option sets for a short date. These use the reader's own language and
// time zone, months as words, never seconds, and leave out the year when it is this year.

type When = string | number | Date | null | undefined;

function toDate(v: When): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function yearIfNeeded(d: Date): Intl.DateTimeFormatOptions {
  return d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" };
}

/** "Nov 10", or "Nov 10, 2025" for another year. Empty for a missing or bad value. */
export function fmtDate(v: When): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...yearIfNeeded(d) }) : "";
}

/** "Tue, Nov 10, 2:28 PM", with the year when it is not this year. */
export function fmtDateTime(v: When, opts: { weekday?: boolean } = {}): string {
  const d = toDate(v);
  if (!d) return "";
  return d.toLocaleString(undefined, {
    ...(opts.weekday === false ? {} : { weekday: "short" }),
    month: "short", day: "numeric", ...yearIfNeeded(d), hour: "numeric", minute: "2-digit",
  });
}

/** "2:28 PM". */
export function fmtTime(v: When): string {
  const d = toDate(v);
  return d ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", then the date. Future times get the date and time. */
export function fmtRelative(v: When, now: Date = new Date()): string {
  const d = toDate(v);
  if (!d) return "";
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (s < 0) return fmtDateTime(d);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return "yesterday";
  return fmtDate(d);
}
