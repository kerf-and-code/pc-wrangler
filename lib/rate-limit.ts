// lib/rate-limit.ts (2026-11-12, push 42: audit round 2, T22)
//
// A small counter for routes anyone can call without signing in (the contact form, the pilot application,
// the Discord Activity's sign-in), so a script cannot use up the email quota or get the app's Discord
// credentials rate-limited. Backed by rate_hit() (p166). It fails OPEN, with a log line, when the
// database cannot answer: a real visitor is never refused because the counter is down.

import { createAdminClient } from "@/lib/supabase/admin";

/** The caller's address. Vercel overwrites x-forwarded-for, so a client cannot fake it. */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "").trim() || "unknown";
}

/** Records one hit and says whether it was within `max` hits per `windowSeconds` for this bucket and key. */
export async function allowHit(bucket: string, key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_hit", {
      p_bucket: bucket, p_key: key, p_max: max, p_window_seconds: windowSeconds,
    });
    if (error) { console.error("rate-limit: rate_hit failed (has p166 run?)", error.message); return true; }
    return data !== false;
  } catch (e) {
    console.error("rate-limit:", e instanceof Error ? e.message : e);
    return true;
  }
}

/** Per address and in total: both must allow. */
export async function allowPublic(bucket: string, req: Request, perIp: { max: number; windowSeconds: number }, total: { max: number; windowSeconds: number }): Promise<boolean> {
  if (!(await allowHit(bucket, clientIp(req), perIp.max, perIp.windowSeconds))) return false;
  return allowHit(`${bucket}:all`, "all", total.max, total.windowSeconds);
}
