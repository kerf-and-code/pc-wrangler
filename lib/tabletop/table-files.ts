import type { createClient } from "@/lib/supabase/client";

// lib/tabletop/table-files.ts (2026-11-09)
//
// Phase 6d (p133): the browser side of the GM's table pictures (picture handouts, card faces, deck
// backs). /api/tabletop/table-file hands out a signed upload link for a new path in the private
// table-files bucket and the picture goes straight to storage; the table shows pictures through the
// same route, which checks who may see them. Pictures nothing uses any more are cleared after a handout
// is taken back or a deck deleted.

type Supa = ReturnType<typeof createClient>;
export type PicturePurpose = "handouts" | "cards" | "decks";
export const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;

/** Why this file cannot be a table picture, or null. */
export function pictureProblem(f: File): string | null {
  if (!PICTURE_TYPES.includes(f.type)) return `${f.name}: use a PNG, JPEG, WebP or GIF image.`;
  if (f.size > MAX_PICTURE_BYTES) return `${f.name} is over 10 MB.`;
  return null;
}

/** Uploads one picture; its storage path, or what went wrong. */
export async function uploadPicture(supabase: Supa, campaignId: string, purpose: PicturePurpose, file: File): Promise<{ path: string } | { error: string }> {
  const bad = pictureProblem(file);
  if (bad) return { error: bad };
  const res = await fetch("/api/tabletop/table-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, purpose, type: file.type }) });
  const j = (await res.json().catch(() => ({}))) as { path?: string; token?: string; error?: string };
  if (!res.ok || !j.path || !j.token) return { error: j.error || `Could not start the upload (${res.status}).` };
  const up = await supabase.storage.from("table-files").uploadToSignedUrl(j.path, j.token, file, { contentType: file.type });
  if (up.error) return { error: `${file.name} did not upload: ${up.error.message}` };
  return { path: j.path };
}

/** Uploads several, three at a time, reporting progress; the paths in the same order (null where one failed). */
export async function uploadPictures(supabase: Supa, campaignId: string, purpose: PicturePurpose, files: File[], onProgress?: (done: number) => void): Promise<{ paths: (string | null)[]; errors: string[] }> {
  const paths: (string | null)[] = files.map(() => null), errors: string[] = [];
  let next = 0, done = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const r = await uploadPicture(supabase, campaignId, purpose, files[i]);
      if ("path" in r) paths[i] = r.path; else errors.push(r.error);
      onProgress?.(++done);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { paths, errors };
}

/** Asks the server to remove pictures nothing uses any more (it checks; anything still shown stays). */
export async function clearPictures(campaignId: string, paths: (string | null | undefined)[]): Promise<void> {
  const list = paths.filter((p): p is string => !!p);
  if (!list.length) return;
  await fetch("/api/tabletop/table-file", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, paths: list }) }).catch(() => {});
}

/** The address the table shows a picture at (the server checks who may see it). */
export const pictureUrl = (campaignId: string, path: string) => `/api/tabletop/table-file?c=${campaignId}&p=${path}`;
