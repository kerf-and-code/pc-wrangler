// lib/calendar.ts (push 16, audit F8)
//
// "Add to calendar" for one session, in the browser: a one-event .ics file the phone or computer hands
// to its calendar app. The subscribed feed for every session lives at /api/calendar/<token>.ics.
// Sessions have no length in the app, so an event is given three hours, the same as the feed.

const SESSION_HOURS = 3;

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function sessionIcs(opts: { id: string; title: string; start: string | Date; description?: string; url?: string }): string {
  const start = new Date(opts.start);
  const end = new Date(start.getTime() + SESSION_HOURS * 3600 * 1000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kerf and Code//Six Axes//EN",
    "BEGIN:VEVENT",
    `UID:${opts.id}@six-axes`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(opts.title)}`,
    ...(opts.description ? [`DESCRIPTION:${esc(opts.description)}`] : []),
    ...(opts.url ? [`URL:${opts.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";
}

/** Starts a download of one session as an .ics file. */
export function downloadSessionIcs(opts: { id: string; title: string; start: string | Date; description?: string; url?: string }): void {
  const blob = new Blob([sessionIcs(opts)], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${opts.title.replace(/[^\w -]+/g, "").trim().slice(0, 60) || "session"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
