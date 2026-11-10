// lib/auth/safe-next.ts (2026-11-09)
//
// Audit B10: where a sign-in or email-confirm link may send someone afterwards. Only a path on this
// site: one leading "/", never "//" or a backslash (browsers read both as another host), no control
// characters. Anything else ("https://evil.example", "@evil.example", ".evil.example") falls back to the
// default, so a genuine Six Axes link can never be turned into a hop to a look-alike page.

export function safeNext(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}
