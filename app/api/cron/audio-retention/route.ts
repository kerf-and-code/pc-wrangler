// Audio retention cron: deletes session audio older than 60 days.
//
// Implements the Part A locked decision. Runs daily via vercel.json.
//
// Order of operations matters. The storage object is deleted FIRST, then the
// row is marked purged. If the storage delete fails, the row stays due and the
// next run retries it. The reverse order would mark audio deleted that is still
// sitting in the bucket, which is exactly the lie the policy must not tell.
//
// Transcripts and extracted events are deliberately NOT deleted. The analysis
// survives; the raw voices do not. That is the design.
//
// Note: no `export const dynamic`. This project runs with cacheComponents ON,
// which forbids that route segment config. Route handlers are dynamic by
// default, so it was never needed.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const BUCKET = "session-audio";
const BATCH = 100;

export async function GET(request: Request) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set.
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: due, error: dueErr } = await admin
    .from("v_audio_due_for_purge")
    .select("track_id, storage_path, campaign_id, created_at")
    .limit(BATCH);

  if (dueErr) {
    return NextResponse.json({ error: dueErr.message, stage: "select" }, { status: 500 });
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, due: 0, purged: 0 });
  }

  let purged = 0;
  const failures: Array<{ track_id: string; reason: string }> = [];

  for (const row of due) {
    const trackId = row.track_id as string;
    const path = row.storage_path as string;

    // 1. Delete the object.
    const { error: rmErr } = await admin.storage.from(BUCKET).remove([path]);
    if (rmErr) {
      failures.push({ track_id: trackId, reason: `storage: ${rmErr.message}` });
      continue;
    }

    // 2. Only now mark it purged.
    const { error: markErr } = await admin.rpc("mark_audio_purged", { p_track_id: trackId });
    if (markErr) {
      // The object is gone but the row is not marked. It stays due and will be
      // retried next run; removing an already-absent object is a no-op, so the
      // retry converges. Surface it anyway.
      failures.push({ track_id: trackId, reason: `mark: ${markErr.message}` });
      continue;
    }

    purged += 1;
  }

  return NextResponse.json({
    ok: failures.length === 0,
    due: due.length,
    purged,
    failures,
    more: due.length === BATCH,
  });
}
