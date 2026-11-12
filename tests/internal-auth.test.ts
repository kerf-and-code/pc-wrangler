// tests/internal-auth.test.ts (2026-11-12, push 42, audit round 2 T5)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INTERNAL_HEADER, LEGACY_UNTIL, internalHeaders, isInternal, trackCallbackQuery, verifyTrackCallback } from "@/lib/internal-auth";

const NOW = Date.parse("2026-11-12T20:00:00Z");
const LATER = LEGACY_UNTIL + 1000;

function req(url: string, headers: Record<string, string> = {}) {
  return { headers: new Headers(headers), nextUrl: new URL(url) };
}

describe("callback URLs and internal calls", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.TRANSCRIBE_CALLBACK_SECRET = "cb-secret";
    process.env.INTERNAL_JOB_SECRET = "job-secret";
  });
  afterEach(() => { process.env = { ...env }; });

  it("signs a provider callback for one track, without the secret in it", () => {
    const q = trackCallbackQuery("track-1", NOW)!;
    expect(q).not.toContain("cb-secret");
    expect(verifyTrackCallback(new URLSearchParams(q), NOW)).toEqual({ ok: true, trackId: "track-1" });
  });

  it("refuses the signature on another track, a changed expiry, or after it expires", () => {
    const p = new URLSearchParams(trackCallbackQuery("track-1", NOW)!);
    const other = new URLSearchParams(p); other.set("track", "track-2");
    expect(verifyTrackCallback(other, NOW).ok).toBe(false);
    const stretched = new URLSearchParams(p); stretched.set("exp", String(Number(p.get("exp")) + 3600));
    expect(verifyTrackCallback(stretched, NOW).ok).toBe(false);
    expect(verifyTrackCallback(p, NOW + 49 * 3600 * 1000).ok).toBe(false);
  });

  it("still takes the old ?k= form until the changeover date, and not after", () => {
    const old = new URLSearchParams({ track: "track-1", k: "cb-secret" });
    expect(verifyTrackCallback(old, NOW).ok).toBe(true);
    expect(verifyTrackCallback(old, LATER).ok).toBe(false);
    expect(verifyTrackCallback(new URLSearchParams({ track: "track-1", k: "wrong" }), NOW).ok).toBe(false);
    expect(isInternal(req("https://x/api/extract/run?job=1&k=cb-secret"), NOW)).toBe(true);
    expect(isInternal(req("https://x/api/extract/run?job=1&k=cb-secret"), LATER)).toBe(false);
  });

  it("trusts our own calls by the header, with the internal secret only", () => {
    expect(internalHeaders()[INTERNAL_HEADER]).toBe("job-secret");
    expect(isInternal(req("https://x/api/extract/run?job=1", { [INTERNAL_HEADER]: "job-secret" }), LATER)).toBe(true);
    expect(isInternal(req("https://x/api/extract/run?job=1", { [INTERNAL_HEADER]: "cb-secret" }), LATER)).toBe(false);
    expect(isInternal(req("https://x/api/extract/run?job=1"), LATER)).toBe(false);
  });

  it("falls back to the callback secret for internal calls until INTERNAL_JOB_SECRET is set", () => {
    delete process.env.INTERNAL_JOB_SECRET;
    expect(internalHeaders()[INTERNAL_HEADER]).toBe("cb-secret");
  });
});
