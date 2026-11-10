import type { SupabaseClient } from "@supabase/supabase-js";
import { signature } from "@/lib/addons/keys";
import { hookUrlUnsafe } from "@/lib/addons/safe-url";
import { discordMessage, isDiscordWebhook } from "@/lib/addons/discord";

// lib/addons/deliver.ts (2026-11-09)
//
// Phase 6b (p131): sends what is waiting in addon_outbox. Called with the service role by
// /api/addon/kick (one campaign, right after something happens at the table) and by the minute cron
// (everything). addon_claim hands each delivery to one sender only; addon_settle records the result and
// schedules a retry. Each hook gets its deliveries in order; hooks are sent to side by side.
//
// A delivery is a POST of JSON:
//   { id: "dlv_<n>", type: "roll" | "chat" | "turn" | "combat" | "ping", campaign: { id, name }, createdAt, data }
// with headers X-SixAxes-Event, X-SixAxes-Delivery and X-SixAxes-Signature (lib/addons/keys.ts).
// Any 2xx within 5 seconds counts. Redirects are not followed.
// A Discord channel webhook gets a readable message instead (lib/addons/discord.ts); when Discord says
// to slow down (429), the delivery is retried like any other failure.
//
// Audit L-B4 (push 7): the time budget is checked before EVERY send, not only between claims, and a
// claim takes at most CLAIM_BATCH deliveries. A send can take 5 seconds, so a send only starts with more
// than SEND_RESERVE_MS left; anything claimed but not started is left alone, its 45 second claim lapses
// and the minute cron sends it. Before this, 25 slow deliveries to one hook could outrun the function's
// time limit mid-batch and be sent twice.

const CLAIM_BATCH = 5;
const SEND_RESERVE_MS = 6000;

type Claimed = { id: number; hookId: string; event: string; payload: unknown; createdAt: string; attempts: number; url: string; secret: string; campaignId: string; campaignName: string };

async function sendOne(d: Claimed): Promise<{ ok: boolean; status: number; error: string | null }> {
  const unsafe = await hookUrlUnsafe(d.url);
  if (unsafe) return { ok: false, status: 0, error: unsafe };
  let body: string;
  if (isDiscordWebhook(d.url)) {
    const msg = discordMessage(d.event, d.campaignName, (d.payload ?? {}) as Parameters<typeof discordMessage>[2]);
    if (!msg) return { ok: true, status: 204, error: null };
    body = JSON.stringify(msg);
  } else {
    body = JSON.stringify({ id: `dlv_${d.id}`, type: d.event, campaign: { id: d.campaignId, name: d.campaignName }, createdAt: d.createdAt, data: d.payload });
  }
  const t = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(d.url, {
      method: "POST", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json", "User-Agent": "SixAxes-Webhooks/1",
        "X-SixAxes-Event": d.event, "X-SixAxes-Delivery": `dlv_${d.id}`, "X-SixAxes-Signature": signature(d.secret, t, body),
      },
      body,
    });
    void res.body?.cancel().catch(() => {});
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, error: null };
    if (res.status === 429) return { ok: false, status: 429, error: "The address asked to slow down; trying again shortly." };
    if (res.status >= 300 && res.status < 400) return { ok: false, status: res.status, error: "The address redirected; webhooks do not follow redirects." };
    return { ok: false, status: res.status, error: `The address answered ${res.status}.` };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, status: 0, error: name === "TimeoutError" ? "No answer within 5 seconds." : "Could not connect." };
  }
}

/** Sends due deliveries until none are left or the time budget runs out; how many were sent and failed. */
export async function drain(admin: SupabaseClient, campaignId: string | null, budgetMs: number): Promise<{ sent: number; failed: number }> {
  const until = Date.now() + budgetMs;
  const timeLeft = () => Date.now() + SEND_RESERVE_MS < until;
  let sent = 0, failed = 0;
  while (timeLeft()) {
    const { data, error } = await admin.rpc("addon_claim", { p_campaign: campaignId, p_limit: CLAIM_BATCH });
    if (error) throw new Error(`addon_claim: ${error.message}`);
    const batch = (data ?? []) as Claimed[];
    if (!batch.length) break;
    const byHook = new Map<string, Claimed[]>();
    for (const d of batch) byHook.set(d.hookId, [...(byHook.get(d.hookId) ?? []), d]);
    await Promise.all([...byHook.values()].map(async (list) => {
      for (const d of list) {
        if (!timeLeft()) return; // left claimed; the cron picks it up once the claim lapses
        const r = await sendOne(d);
        if (r.ok) sent++; else failed++;
        await admin.rpc("addon_settle", { p_id: d.id, p_ok: r.ok, p_status: r.status, p_error: r.error });
      }
    }));
  }
  return { sent, failed };
}
