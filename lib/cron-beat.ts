// lib/cron-beat.ts (2026-11-12, push 50: audit round 2, T15)
//
// Nothing used to notice when a scheduled job stopped. Each job in vercel.json now goes through
// withCronBeat, which stamps public.cron_runs (p171) every time it runs: last_ok_at when it answered
// under 400, last_error when it answered 400 or more or threw. An unauthorised call (401: a stranger,
// not the scheduler) is not recorded.
//
// The every-minute job (advance-jobs) also looks at every row and posts to the ops channel when a job
// has not succeeded for longer than LATE_AFTER allows, once every six hours while it stays late.
// /api/health/crons gives the same answer to an outside uptime monitor, because if the scheduler itself
// stops, advance-jobs stops with it and nothing inside the app can say so (docs/game-night-runbook.md).
//
// Every write here is best effort: a failed stamp never changes what the job itself answered.

import { createAdminClient } from "@/lib/supabase/admin";
import { opsAlert } from "@/lib/ops-alert";

/** How long each job may go without a good run before it counts as late. The daily jobs get two
 *  hours of slack over a day; the every-minute jobs ten minutes. Keep in step with vercel.json. */
export const LATE_AFTER: Record<string, number> = {
  "session-reminders": 26 * 3600_000,
  "audio-retention": 26 * 3600_000,
  "campaign-purge": 26 * 3600_000,
  "notification-digest": 26 * 3600_000,
  "advance-jobs": 10 * 60_000,
  "addon-deliver": 10 * 60_000,
};
const REALERT_MS = 6 * 3600_000;

export type CronRow = { name: string; last_ok_at: string | null; last_error_at: string | null; last_error: string | null; alerted_at: string | null };
export type LateJob = { name: string; lastOk: string | null; minutesLate: number; lastError: string | null };

/** The jobs that are late at `now`, from the cron_runs rows. Pure, so tests/cron-beat.test.ts can check it. */
export function lateJobs(rows: CronRow[], now: number = Date.now()): LateJob[] {
  const out: LateJob[] = [];
  for (const [name, limit] of Object.entries(LATE_AFTER)) {
    const r = rows.find((x) => x.name === name);
    if (!r) continue; // not seeded yet (before p171): nothing to compare against
    const ok = r.last_ok_at ? Date.parse(r.last_ok_at) : 0;
    const over = now - ok - limit;
    if (over > 0) out.push({ name, lastOk: r.last_ok_at, minutesLate: Math.round(over / 60_000), lastError: r.last_error });
  }
  return out;
}

async function stamp(name: string, ok: boolean, started: string, error: string | null): Promise<void> {
  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const row: Record<string, string | null> = ok
      ? { name, last_started_at: started, last_ok_at: now, alerted_at: null, updated_at: now }
      : { name, last_started_at: started, last_error_at: now, last_error: (error ?? "failed").slice(0, 500), updated_at: now };
    await admin.from("cron_runs").upsert(row, { onConflict: "name" });
  } catch (e) {
    console.error(`[cron-beat] could not stamp ${name}:`, e);
  }
}

/** Reads cron_runs and alerts on late jobs (at most once every six hours each). */
export async function checkLate(): Promise<LateJob[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("cron_runs").select("name, last_ok_at, last_error_at, last_error, alerted_at");
    if (error) return [];
    const rows = (data ?? []) as CronRow[];
    const late = lateJobs(rows);
    const now = Date.now();
    const due = late.filter((j) => {
      const r = rows.find((x) => x.name === j.name);
      return !r?.alerted_at || now - Date.parse(r.alerted_at) > REALERT_MS;
    });
    if (due.length) {
      await opsAlert("cron watch", `${due.length} scheduled job(s) late: ${due.map((j) => `${j.name} (${j.minutesLate} min late)`).join(", ")}`, due);
      await admin.from("cron_runs").update({ alerted_at: new Date(now).toISOString() }).in("name", due.map((j) => j.name));
    }
    return late;
  } catch (e) {
    console.error("[cron-beat] late check failed:", e);
    return [];
  }
}

/** Wraps a cron route's GET so every run is stamped. The every-minute advance-jobs also runs the late check. */
export function withCronBeat(name: keyof typeof LATE_AFTER, run: (req: Request) => Promise<Response>) {
  return async function GET(req: Request): Promise<Response> {
    const started = new Date().toISOString();
    let res: Response;
    try {
      res = await run(req);
    } catch (e) {
      await stamp(name, false, started, e instanceof Error ? e.message : String(e));
      throw e;
    }
    if (res.status !== 401) {
      await stamp(name, res.status < 400, started, res.status < 400 ? null : `answered ${res.status}`);
      if (name === "advance-jobs") await checkLate();
    }
    return res;
  };
}
