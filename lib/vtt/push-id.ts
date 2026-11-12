// lib/vtt/push-id.ts (2026-11-12, push 44: audit round 2, B11 and T10)
//
// Roll20 keeps its chat in Firebase, and a Roll20 chat message id ("-P6DCMtQdQv71tOt0F9w") is a Firebase
// push id: its first eight characters are the time the message was written, in milliseconds, in
// Firebase's 64-character alphabet. Checked against real Roll20 chat: "-P6DCMtQ..." decodes to
// 2026-11-12 05:22:54 UTC, the message stamped 9:22PM Pacific.
//
// /api/vtt/ingest reads a Roll20 roll's time from its id, not from the time the extension says, so chat
// history the extension sees late (Roll20 loading older messages, a reconnect) keeps the time it was
// rolled, and a roll from before the session started is not counted in it. The extension does the
// same, so it does not send such history at all.

const ALPHABET = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
// a time outside these years is not a push id
const MIN_MS = Date.UTC(2015, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

/** The time (ms since 1970) in a Firebase push id, or null when the id is not one. */
export function pushIdTime(id: unknown): number | null {
  if (typeof id !== "string" || id.length !== 20) return null;
  let t = 0;
  for (let i = 0; i < 8; i++) {
    const v = ALPHABET.indexOf(id.charAt(i));
    if (v < 0) return null;
    t = t * 64 + v;
  }
  for (let i = 8; i < 20; i++) if (ALPHABET.indexOf(id.charAt(i)) < 0) return null;
  return t >= MIN_MS && t < MAX_MS ? t : null;
}
