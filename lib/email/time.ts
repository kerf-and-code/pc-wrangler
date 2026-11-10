// lib/email/time.ts (2026-11-09)
//
// Audit U2: a session time in an email, in the campaign's own time zone with the zone named
// ("Tue, Nov 10, 7:00 PM PST"). It used to be toUTCString(), which put a Tuesday 7 pm Pacific game on
// Wednesday at 03:00 GMT. With no time zone stored yet (or a bad one), it says UTC plainly.

export function isTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export function formatSessionTime(iso: string, timeZone?: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "soon";
  const tz = isTimeZone(timeZone) ? timeZone : "UTC";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(d);
}
