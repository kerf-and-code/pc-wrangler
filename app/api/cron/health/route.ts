import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lateJobs, type CronRow } from "@/lib/cron-beat";

// GET /api/cron/health (2026-11-12, push 50: audit round 2, T15)
//
// For an outside uptime monitor (docs/game-night-runbook.md). Answers 200 with {"ok":true} when every
// scheduled job has run within its allowance (lib/cron-beat.ts LATE_AFTER), and 503 with the late
// jobs' names otherwise. It is the one check that still works when Vercel's scheduler itself stops,
// because the monitor calls it from outside. Not a scheduled job itself, and it says nothing secret:
// job names and how late they are. Lives under /api/cron so the sign-in gate leaves it alone.

export async function GET() {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("cron_runs").select("name, last_ok_at, last_error_at, last_error, alerted_at");
    if (error) return NextResponse.json({ ok: false, error: "cron_runs unreadable (has p171 run?)" }, { status: 503 });
    const late = lateJobs((data ?? []) as CronRow[]).map((j) => ({ name: j.name, minutesLate: j.minutesLate }));
    return NextResponse.json({ ok: late.length === 0, late, checkedAt: new Date().toISOString() }, { status: late.length ? 503 : 200, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "check failed" }, { status: 503 });
  }
}
