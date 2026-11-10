import { describe, expect, it } from "vitest";
import { formatSessionTime, isTimeZone } from "@/lib/email/time";
import { signUnsubscribe, unsubscribeUrl, verifyUnsubscribe } from "@/lib/email/unsubscribe";

// Push 1: email times (U2) and unsubscribe links (T12).
describe("formatSessionTime", () => {
  it("prints the campaign's own time, with the zone named", () => {
    // 03:00 UTC on Wednesday is 7 pm Tuesday in Los Angeles (PST)
    expect(formatSessionTime("2026-11-11T03:00:00Z", "America/Los_Angeles")).toBe("Tue, Nov 10, 7:00 PM PST");
  });
  it("says UTC plainly when no or a bad zone is stored", () => {
    expect(formatSessionTime("2026-11-11T03:00:00Z", null)).toBe("Wed, Nov 11, 3:00 AM UTC");
    expect(formatSessionTime("2026-11-11T03:00:00Z", "Not/AZone")).toBe("Wed, Nov 11, 3:00 AM UTC");
    expect(isTimeZone("Europe/London")).toBe(true);
  });
});

describe("unsubscribe links", () => {
  const secret = "test-secret";
  it("verifies its own signature, case-insensitive on the address", () => {
    const sig = signUnsubscribe("Bobert@Example.com", "reminders", secret);
    expect(verifyUnsubscribe("bobert@example.com", "reminders", sig, secret)).toBe(true);
  });
  it("refuses another address, another kind or a bad signature", () => {
    const sig = signUnsubscribe("a@example.com", "recaps", secret);
    expect(verifyUnsubscribe("b@example.com", "recaps", sig, secret)).toBe(false);
    expect(verifyUnsubscribe("a@example.com", "all", sig, secret)).toBe(false);
    expect(verifyUnsubscribe("a@example.com", "recaps", sig.slice(1), secret)).toBe(false);
    expect(verifyUnsubscribe("a@example.com", "everything", sig, secret)).toBe(false);
  });
  it("builds a link the route can read back", () => {
    const u = new URL(unsubscribeUrl("https://sixaxes.app/", "A@Example.com", "all", secret));
    expect(u.pathname).toBe("/api/email/unsubscribe");
    expect(verifyUnsubscribe(u.searchParams.get("e")!, u.searchParams.get("k")!, u.searchParams.get("s")!, secret)).toBe(true);
  });
});
