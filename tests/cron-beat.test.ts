// tests/cron-beat.test.ts (2026-11-12, push 50: audit round 2, T15)
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("not in tests"); } }));
vi.mock("@/lib/ops-alert", () => ({ opsAlert: async () => {} }));

import { lateJobs, LATE_AFTER, type CronRow } from "@/lib/cron-beat";

const now = Date.parse("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const row = (name: string, okAgo: number | null): CronRow => ({ name, last_ok_at: okAgo == null ? null : ago(okAgo), last_error_at: null, last_error: null, alerted_at: null });

describe("cron watch", () => {
  it("covers the six jobs in vercel.json", () => {
    expect(Object.keys(LATE_AFTER).sort()).toEqual(["addon-deliver", "advance-jobs", "audio-retention", "campaign-purge", "notification-digest", "session-reminders"]);
  });
  it("is quiet when everything ran in time", () => {
    const rows = [row("advance-jobs", 60_000), row("session-reminders", 20 * 3600_000)];
    expect(lateJobs(rows, now)).toEqual([]);
  });
  it("names a job that went quiet, and by how much", () => {
    const late = lateJobs([row("advance-jobs", 25 * 60_000), row("audio-retention", 30 * 3600_000)], now);
    expect(late.map((j) => j.name).sort()).toEqual(["advance-jobs", "audio-retention"]);
    expect(late.find((j) => j.name === "advance-jobs")?.minutesLate).toBe(15);
  });
  it("counts a job that never succeeded as late, and skips one with no row", () => {
    expect(lateJobs([row("campaign-purge", null)], now).map((j) => j.name)).toEqual(["campaign-purge"]);
    expect(lateJobs([], now)).toEqual([]);
  });
});
