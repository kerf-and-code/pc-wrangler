import type { SupabaseClient } from "@supabase/supabase-js";

// lib/storage/purge.ts (2026-11-09)
//
// Deletes every object under a folder in a storage bucket, however deep. Storage lists one folder level at
// a time (sub-folders come back as entries with no id), so this walks the tree, then removes the files in
// batches. Used by campaign deletion (audit T7). Takes the service-role client.

const PAGE = 1000;
const BATCH = 100;

/** Every object path under `prefix` (no leading or trailing slash), recursively. */
export async function listAll(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const folders = [prefix];
  while (folders.length) {
    const dir = folders.pop()!;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin.storage.from(bucket).list(dir, { limit: PAGE, offset });
      if (error) throw new Error(`${bucket}/${dir}: ${error.message}`);
      for (const item of data ?? []) {
        const path = `${dir}/${item.name}`;
        if (item.id === null) folders.push(path);   // a sub-folder
        else out.push(path);
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

/** Removes the given paths in batches. Returns how many went and any failures. */
export async function removeAll(admin: SupabaseClient, bucket: string, paths: string[]): Promise<{ removed: number; failures: string[] }> {
  let removed = 0;
  const failures: string[] = [];
  const unique = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    const { error } = await admin.storage.from(bucket).remove(chunk);
    if (error) failures.push(`${bucket}: ${error.message} (${chunk.length} file(s))`);
    else removed += chunk.length;
  }
  return { removed, failures };
}
