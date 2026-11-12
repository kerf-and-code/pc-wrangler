import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { drain } from "@/lib/addons/deliver";
import { withCronBeat } from "@/lib/cron-beat";

// app/api/cron/addon-deliver/route.ts (2026-11-09)
//
// Phase 6b (p131): every minute, send any webhook deliveries still waiting (retries, and anything no
// browser nudged), and clear out old ones. Vercel Cron sends Authorization: Bearer <CRON_SECRET>.

export const maxDuration = 60;

async function run(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: pruned } = await admin.rpc("addon_prune");
  const r = await drain(admin, null, 50000);
  return NextResponse.json({ ...r, pruned: pruned ?? 0 });
}

// Push 50 (audit round 2, T15): every run is stamped in cron_runs (lib/cron-beat.ts), so a job that
// stops is noticed.
export const GET = withCronBeat("addon-deliver", run);
