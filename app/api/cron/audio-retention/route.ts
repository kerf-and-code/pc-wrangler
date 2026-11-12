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
// Push 8:
//   T9  It used to delete at most 100 recordings a day, so a busy day left a backlog that only grew and
//       audio was kept past the 60 days promised. Now it works through batches until nothing is due or
//       the time budget is spent, and alerts if anything is still due at the end.
//   T8  It also empties storage_purge_queue (p144): files whose rows are gone (an account deletion whose
//       storage step failed) and self-recordings whose upload was never registered (after a day's grace).
//
// Note: no `export const dynamic`. This project runs with cacheComponents ON,
// which forbids that route segment config. Route handlers are dynamic by
// default, so it was never needed.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { opsAlert } from "@/lib/ops-alert";
import { withCronBeat } from "@/lib/cron-beat";

export const maxDuration = 60;

const BUCKET = "session-audio";
const BATCH = 100;
const BUDGET_MS = 45000; // leave room inside the 60 s limit for the queue step and the reply
const QUEUE_BATCH = 200;

type Failure = { track_id: string; reason: string };

async function run(request: Request) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set.
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const until = Date.now() + BUDGET_MS;

  let due = 0;
  let purged = 0;
  let more = false;
  const failures: Failure[] = [];
  const failedIds = new Set<string>();

  // 1. Tracks past 60 days, batch after batch. A track that failed this run is not tried again until the next.
  while (true) {
    if (Date.now() > until) { more = true; break; }
    let q = admin
      .from("v_audio_due_for_purge")
      .select("track_id, storage_path, campaign_id, created_at")
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (failedIds.size) q = q.not("track_id", "in", `(${[...failedIds].join(",")})`);
    const { data: rows, error: dueErr } = await q;

    if (dueErr) {
      await opsAlert("cron audio-retention", "could not list audio due for deletion", dueErr.message);
      return NextResponse.json({ error: dueErr.message, stage: "select", purged }, { status: 500 });
    }
    if (!rows || rows.length === 0) break;
    due += rows.length;

    for (const row of rows) {
      const trackId = row.track_id as string;
      const path = row.storage_path as string;

      // 1a. Delete the object.
      const { error: rmErr } = await admin.storage.from(BUCKET).remove([path]);
      if (rmErr) {
        failures.push({ track_id: trackId, reason: `storage: ${rmErr.message}` });
        failedIds.add(trackId);
        continue;
      }

      // 1b. Only now mark it purged.
      const { error: markErr } = await admin.rpc("mark_audio_purged", { p_track_id: trackId });
      if (markErr) {
        // The object is gone but the row is not marked. It stays due and will be
        // retried next run; removing an already-absent object is a no-op, so the
        // retry converges. Surface it anyway.
        failures.push({ track_id: trackId, reason: `mark: ${markErr.message}` });
        failedIds.add(trackId);
        continue;
      }

      purged += 1;
    }
    if (rows.length < BATCH) break;
  }

  // 2. The purge queue: files with no row to purge them through.
  const queue = await drainQueue(admin);

  // Audit T1: deletion is a promise to players, so a failure alerts and fails the run (it used to be a 200).
  if (failures.length) {
    await opsAlert("cron audio-retention", `${failures.length} of ${due} recording(s) could not be deleted`, failures.slice(0, 5));
  }
  if (more) {
    await opsAlert("cron audio-retention", "ran out of time with recordings still due; the rest go tomorrow", { purged });
  }
  if (queue.failed > 0) {
    await opsAlert("cron audio-retention", `${queue.failed} queued file(s) could not be deleted`, queue.errors.slice(0, 5));
  }
  const ok = failures.length === 0 && queue.failed === 0;
  return NextResponse.json({ ok, due, purged, failures, more, queue }, { status: ok ? 200 : 500 });
}

/** Deletes queued files that are due. An unregistered upload is skipped (and unqueued) if a track now owns it. */
async function drainQueue(admin: ReturnType<typeof createAdminClient>): Promise<{ removed: number; failed: number; errors: string[] }> {
  const out = { removed: 0, failed: 0, errors: [] as string[] };
  const { data, error } = await admin
    .from("storage_purge_queue")
    .select("id, bucket, path, reason")
    .lte("not_before", new Date().toISOString())
    .order("id", { ascending: true })
    .limit(QUEUE_BATCH);
  if (error) { out.failed += 1; out.errors.push(`list: ${error.message}`); return out; }
  const rows = (data ?? []) as { id: number; bucket: string; path: string; reason: string }[];
  if (!rows.length) return out;

  // An upload whose track did get registered is not an orphan: just take it off the queue.
  const uploadPaths = rows.filter((r) => r.reason === "upload").map((r) => r.path);
  const owned = new Set<string>();
  if (uploadPaths.length) {
    const { data: tracks } = await admin.from("audio_tracks").select("storage_path").in("storage_path", uploadPaths).is("purged_at", null);
    for (const t of (tracks ?? []) as { storage_path: string }[]) owned.add(t.storage_path);
  }

  for (const r of rows) {
    if (r.reason === "upload" && owned.has(r.path)) {
      await admin.from("storage_purge_queue").delete().eq("id", r.id);
      continue;
    }
    const { error: rmErr } = await admin.storage.from(r.bucket).remove([r.path]);
    if (rmErr) {
      out.failed += 1;
      out.errors.push(`${r.bucket}/${r.path}: ${rmErr.message}`);
      await admin.from("storage_purge_queue").update({ last_error: rmErr.message.slice(0, 300) }).eq("id", r.id);
      continue;
    }
    await admin.from("storage_purge_queue").delete().eq("id", r.id);
    out.removed += 1;
  }
  return out;
}

// Push 50 (audit round 2, T15): every run is stamped in cron_runs (lib/cron-beat.ts), so a job that
// stops is noticed.
export const GET = withCronBeat("audio-retention", run);
