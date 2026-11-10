// lib/analytics-paths.ts (2026-11-09)
//
// Which pages analytics may count (audit T3). Never a player, share-code or sign-in page: their
// addresses carry share codes and tokens. Used by components/analytics.tsx.

const PRIVATE = ["/play", "/me", "/recaps", "/lore", "/map", "/world", "/chat", "/schedule", "/initiative", "/record",
  "/vibe", "/x", "/join", "/setup", "/claim", "/journal", "/table", "/tabletop", "/auth", "/enter"];

/** Whether a page may be counted: never a player, share-code or sign-in page. */
export function isTrackable(path: string): boolean {
  return !PRIVATE.some((p) => path === p || path.startsWith(p + "/"));
}

/** An address with its query string and hash removed (origin plus path), for analytics. */
export function bareUrl(url: string): string {
  try { const u = new URL(url); return u.origin + u.pathname; } catch { return ""; }
}
