// lib/current-session.ts
//
// Which session a GM page should open on. Every session page lists sessions newest number first,
// and weekly recurrence (app/gm/sessions ensureRecurrence) keeps one future "scheduled" session at
// the top of that list. Defaulting to the first row therefore opened Capture, Transcripts, Check-in
// and Record on an empty session that has not happened yet.
//
// Preference, newest first within each tier:
//   1. "live"   the session being played right now
//   2. "open"   opened and not yet closed
//   3. anything that is not merely "scheduled" (closed or otherwise played), i.e. the last one played
//   4. the first row, only when every session is still scheduled (a brand-new campaign)

export type SessionLike = { status?: string | null };

export function pickCurrentSession<T extends SessionLike>(rows: T[]): T | undefined {
  return rows.find((r) => r.status === "live")
    ?? rows.find((r) => r.status === "open")
    ?? rows.find((r) => r.status !== "scheduled")
    ?? rows[0];
}
