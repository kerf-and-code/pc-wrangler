// tests/gm-allowlist.test.ts (2026-11-12, push 41.5: GM access by email)
import { describe, expect, it } from "vitest";
import { onAllowlist, parseAllowlist, verifiedEmails } from "@/lib/gm-allowlist";

const list = parseAllowlist(" GM@Example.com, other@example.com ;third@example.com,,not-an-email ");

describe("GM_EMAILS", () => {
  it("reads a comma (or space, or semicolon) separated list, ignoring case and junk", () => {
    expect([...list].sort()).toEqual(["gm@example.com", "other@example.com", "third@example.com"]);
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist("").size).toBe(0);
  });

  it("lets in a confirmed account email on the list, whatever its case", () => {
    expect(onAllowlist({ email: "Gm@example.COM", email_confirmed_at: "2026-11-12T00:00:00Z" }, list)).toBe(true);
  });

  it("does not let in an unconfirmed account email, so typing a listed address is not enough", () => {
    expect(onAllowlist({ email: "gm@example.com", email_confirmed_at: null }, list)).toBe(false);
  });

  it("counts each linked sign-in by its own verified email: either one on the list is enough", () => {
    const user = {
      email: "player@gmail.com", email_confirmed_at: "2026-11-12T00:00:00Z",
      identities: [
        { identity_data: { email: "player@gmail.com", email_verified: true } },
        { identity_data: { email: "other@example.com", email_verified: true } },
      ],
    };
    expect(verifiedEmails(user).sort()).toEqual(["other@example.com", "player@gmail.com"]);
    expect(onAllowlist(user, list)).toBe(true);
  });

  it("ignores a linked sign-in whose provider has not verified the email", () => {
    const user = { email: null, identities: [{ identity_data: { email: "gm@example.com", email_verified: false } }] };
    expect(onAllowlist(user, list)).toBe(false);
  });

  it("never lets in an anonymous account or anyone when the list is empty", () => {
    expect(onAllowlist({ is_anonymous: true, email: "gm@example.com", email_confirmed_at: "x" }, list)).toBe(false);
    expect(onAllowlist({ email: "gm@example.com", email_confirmed_at: "x" }, new Set())).toBe(false);
  });
});
