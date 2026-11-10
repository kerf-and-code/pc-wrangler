import type { SupabaseClient } from "@supabase/supabase-js";
import { listAll, removeAll } from "@/lib/storage/purge";

// lib/campaign/purge.ts (2026-11-09)
//
// Erasing a campaign for good, shared by "Delete forever now" (app/api/gm/campaign/delete) and the daily
// purge of campaigns trashed more than 30 days ago (app/api/cron/campaign-purge). Audit T7 and F4.
//
// Order matters: the recording paths are read first, because once the rows are gone nothing knows
// them; then the rows go (deleteRows, supplied by the caller: the GM's own delete_campaign call, or the
// service role for the purge); then every file under <campaignId>/ in each bucket, plus those recordings.
// Takes the service-role client for storage.

// campaign-exports (p140) holds the GM's latest export zip.
const BUCKETS = ["session-audio", "campaign-maps", "table-files", "campaign-exports"] as const;

export type PurgeResult =
  | { ok: true; filesRemoved: number; failures: string[] }
  | { ok: false; stage: "read" | "rows"; error: string };

export async function purgeCampaign(
  admin: SupabaseClient, campaignId: string, deleteRows: () => Promise<string | null>,
): Promise<PurgeResult> {
  const { data: tracks, error: trErr } = await admin.from("audio_tracks").select("storage_path").eq("campaign_id", campaignId).not("storage_path", "is", null);
  if (trErr) return { ok: false, stage: "read", error: trErr.message };
  const audioPaths = ((tracks as { storage_path: string }[] | null) ?? []).map((t) => t.storage_path);

  const rowErr = await deleteRows();
  if (rowErr) return { ok: false, stage: "rows", error: rowErr };

  const failures: string[] = [];
  let filesRemoved = 0;
  for (const bucket of BUCKETS) {
    let paths: string[] = bucket === "session-audio" ? [...audioPaths] : [];
    try {
      paths = paths.concat(await listAll(admin, bucket, campaignId));
    } catch (e) {
      failures.push(e instanceof Error ? e.message : `${bucket}: could not list`);
    }
    const r = await removeAll(admin, bucket, paths);
    filesRemoved += r.removed;
    failures.push(...r.failures);
  }
  return { ok: true, filesRemoved, failures };
}
