// tests/roll-core-manual.test.ts (push 45, audit round 2 B4): a typed total answers a save and nothing else
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tableRoll } from "@/lib/tabletop/roll-core";

// every refusal below happens before the database is touched; a call would throw here
const admin = new Proxy({}, { get() { throw new Error("database touched"); } }) as unknown as SupabaseClient;
const who = { userId: "u", isGm: false, openSession: async () => null };

describe("typed totals", () => {
  it("refuses a typed total with no save", async () => {
    const r = await tableRoll(admin, who, { campaignId: "c", notation: "1d20", manual: 30 });
    expect(r.status).toBe(400);
  });
  it("refuses a typed total with no character to save for", async () => {
    const r = await tableRoll(admin, who, { campaignId: "c", notation: "1d20", manual: 30, saveFor: "s" });
    expect(r.status).toBe(400);
  });
  it("refuses a typed total sent as initiative or as a save effect", async () => {
    expect((await tableRoll(admin, who, { campaignId: "c", manual: 30, saveFor: "s", initiative: true })).status).toBe(400);
    expect((await tableRoll(admin, who, { campaignId: "c", manual: 30, saveFor: "s", saveAgainst: { targets: ["x"] } })).status).toBe(400);
  });
});
