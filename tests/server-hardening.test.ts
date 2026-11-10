import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLL_KEY_PREFIX, hashRollKey, looksLikeRollKey, newRollKey } from "@/lib/vtt/ingest-keys";
import { drain } from "@/lib/addons/deliver";

// The webhook address check resolves DNS; the drain test only needs it to say "fine".
vi.mock("@/lib/addons/safe-url", () => ({ hookUrlUnsafe: async () => null }));

// Push 7, server hardening: roll keys (audit B12) and the webhook time budget (audit L-B4).

describe("roll keys", () => {
  it("makes keys of the right shape and stores only a hash", () => {
    const k = newRollKey();
    expect(k.startsWith(ROLL_KEY_PREFIX)).toBe(true);
    expect(looksLikeRollKey(k)).toBe(true);
    expect(hashRollKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRollKey(k)).toBe(hashRollKey(k));
    expect(newRollKey()).not.toBe(k);
  });
  it("ignores anything that is not a roll key", () => {
    expect(looksLikeRollKey("2930a13916")).toBe(false);
    expect(looksLikeRollKey("sxk_short")).toBe(false);
    expect(looksLikeRollKey(42)).toBe(false);
    expect(looksLikeRollKey("sxk_" + "a".repeat(100))).toBe(false);
  });
});

describe("webhook drain", () => {
  // A fake service client: addon_claim hands out `n` deliveries to one hook in batches, addon_settle counts.
  function fakeAdmin(n: number) {
    let next = 1;
    const claimLimits: number[] = [];
    const settled: number[] = [];
    const admin = {
      rpc: vi.fn(async (name: string, args: { p_limit?: number; p_id?: number }) => {
        if (name === "addon_claim") {
          claimLimits.push(args.p_limit ?? 0);
          const out = [];
          while (out.length < (args.p_limit ?? 0) && next <= n) {
            out.push({ id: next++, hookId: "h1", event: "ping", payload: {}, createdAt: "", attempts: 0,
              url: "https://hooks.example.com/x", secret: "whsec_t", campaignId: "c1", campaignName: "C" });
          }
          return { data: out, error: null };
        }
        settled.push(args.p_id ?? 0);
        return { data: null, error: null };
      }),
    };
    return { admin: admin as unknown as SupabaseClient, claimLimits, settled };
  }

  it("claims small batches and does not start a send without time for it", async () => {
    vi.useFakeTimers();
    const realFetch = globalThis.fetch;
    // Every send takes 4 seconds of (fake) time and succeeds.
    globalThis.fetch = vi.fn(async () => { vi.advanceTimersByTime(4000); return new Response(null, { status: 204 }); }) as typeof fetch;
    try {
      const { admin, claimLimits, settled } = fakeAdmin(25);
      const r = await drain(admin, "c1", 20000);
      expect(Math.max(...claimLimits)).toBeLessThanOrEqual(5);
      // 20 s budget, 6 s reserve, 4 s per send: at most 4 sends start, the rest stay for the cron.
      expect(r.sent).toBeLessThanOrEqual(4);
      expect(settled.length).toBe(r.sent + r.failed);
    } finally {
      globalThis.fetch = realFetch;
      vi.useRealTimers();
    }
  });
});
