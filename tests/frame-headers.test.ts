// tests/frame-headers.test.ts (2026-11-12, push 41, audit round 2 B12)
//
// Which addresses another site may frame. Only the Discord Activity (the root, which proxy.ts rewrites
// to /activity, and /activity itself, each with Discord's frame_id) may be framed, and only by Discord.
// Every other path keeps frame-ancestors 'self' and X-Frame-Options, whatever its query. Matched with
// the same path matcher Next uses for next.config headers.
import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { FRAME_RULES } from "../next.config";

type Rule = (typeof FRAME_RULES)[number];

/** The headers a request ends up with: every matching rule applies, a later one wins on the same key. */
function headersFor(path: string, query: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of FRAME_RULES as Rule[]) {
    const match = getPathMatch(r.source, { strict: true, removeUnnamedParams: true });
    if (!match(path)) continue;
    const has = "has" in r && r.has ? r.has : [];
    const missing = "missing" in r && r.missing ? r.missing : [];
    if (!has.every((h) => h.key in query)) continue;
    if (missing.some((h) => h.key in query)) continue;
    for (const h of r.headers) out[h.key] = h.value;
  }
  return out;
}

const framedByDiscord = (h: Record<string, string>) =>
  /frame-ancestors https:\/\/discord\.com/.test(h["Content-Security-Policy"] ?? "") && !("X-Frame-Options" in h);
const lockedDown = (h: Record<string, string>) =>
  /frame-ancestors 'self'/.test(h["Content-Security-Policy"] ?? "") && h["X-Frame-Options"] === "SAMEORIGIN";

describe("who may frame a page", () => {
  it("lets Discord frame the Activity's two addresses when Discord's frame_id is there", () => {
    expect(framedByDiscord(headersFor("/", { frame_id: "x" }))).toBe(true);
    expect(framedByDiscord(headersFor("/activity", { frame_id: "x" }))).toBe(true);
  });
  it("keeps those two addresses locked without frame_id", () => {
    expect(lockedDown(headersFor("/"))).toBe(true);
    expect(lockedDown(headersFor("/activity"))).toBe(true);
  });
  it("never lets another site frame any other page, even with frame_id", () => {
    for (const p of ["/gm", "/gm/sessions", "/me/settings", "/admin", "/tabletop/abc", "/activity/x", "/activityx", "/api/activity/state"]) {
      expect(lockedDown(headersFor(p, { frame_id: "x" })), p).toBe(true);
      expect(lockedDown(headersFor(p)), p).toBe(true);
    }
  });
  it("still sends the other security headers everywhere", () => {
    for (const [p, q] of [["/", { frame_id: "x" }], ["/gm", {}], ["/activity", {}]] as const) {
      const h = headersFor(p, q);
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
      expect(h["Permissions-Policy"]).toMatch(/camera=\(\)/);
    }
  });
});
