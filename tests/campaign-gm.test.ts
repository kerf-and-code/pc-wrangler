// tests/campaign-gm.test.ts (push 18, co-GMs)
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gmCampaignsFilter, isCampaignGm } from "../lib/campaign-gm";

const OWNER = "00000000-0000-0000-0000-00000000000a";
const COGM = "00000000-0000-0000-0000-00000000000b";
const CAMP = "11111111-1111-1111-1111-111111111111";
const CAMP2 = "22222222-2222-2222-2222-222222222222";

type Row = Record<string, unknown>;

/** A tiny stand-in for the query builder: filters rows by eq / in, answers maybeSingle and await. */
function fakeClient(tables: Record<string, Row[]>, calls: string[] = []): SupabaseClient {
  return {
    from(table: string) {
      calls.push(table);
      let rows = [...(tables[table] ?? [])];
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
        in: (k: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[k])); return q; },
        is: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (ok: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const tables = {
  campaigns: [{ id: CAMP, gm_id: OWNER }, { id: CAMP2, gm_id: OWNER }],
  memberships: [
    { campaign_id: CAMP, profile_id: OWNER, role: "gm", active: true, id: "m1" },
    { campaign_id: CAMP, profile_id: COGM, role: "co-gm", active: true, id: "m2" },
    { campaign_id: CAMP2, profile_id: COGM, role: "co-gm", active: false, id: "m3" },
  ],
};

describe("isCampaignGm", () => {
  it("passes the owner without a membership lookup when the owner is known", async () => {
    const calls: string[] = [];
    expect(await isCampaignGm(fakeClient(tables, calls), CAMP, OWNER, OWNER)).toBe(true);
    expect(calls).toEqual([]);
  });
  it("passes an active co-GM and looks the owner up when not given", async () => {
    expect(await isCampaignGm(fakeClient(tables), CAMP, COGM)).toBe(true);
  });
  it("refuses an inactive co-GM, a stranger, a missing campaign and a bad id", async () => {
    expect(await isCampaignGm(fakeClient(tables), CAMP2, COGM)).toBe(false);
    expect(await isCampaignGm(fakeClient(tables), CAMP, "00000000-0000-0000-0000-00000000000c")).toBe(false);
    expect(await isCampaignGm(fakeClient(tables), CAMP, COGM, null)).toBe(false);
    expect(await isCampaignGm(fakeClient(tables), "not-a-uuid", OWNER)).toBe(false);
  });
});

describe("gmCampaignsFilter", () => {
  it("is just the owner filter when the account co-GMs nothing", async () => {
    expect(await gmCampaignsFilter(fakeClient(tables), OWNER)).toBe(`gm_id.eq.${OWNER}`);
  });
  it("adds the active co-GM campaigns", async () => {
    expect(await gmCampaignsFilter(fakeClient(tables), COGM)).toBe(`gm_id.eq.${COGM},id.in.(${CAMP})`);
  });
});
