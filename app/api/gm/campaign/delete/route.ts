import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAll, removeAll } from "@/lib/storage/purge";
import { opsAlert } from "@/lib/ops-alert";

export const maxDuration = 60;

// POST /api/gm/campaign/delete   body: { campaignId, confirm: <the campaign's name> } (2026-11-09)
//
// Audit T7. Deleting a campaign used to be one database call from the browser, which removed the rows but
// left every file behind: voice recordings in session-audio (which the 60-day retention job finds only
// through rows that no longer existed), and maps, portraits, sounds, tokens, handouts and card art in
// campaign-maps and table-files. A database function cannot reach storage, so the files go from here.
//
// Order, as in /api/me/delete:
//   1. Collect what only the database knows: the recording paths in audio_tracks.
//   2. delete_campaign (as the signed-in GM; it checks they are the GM), which removes the rows.
//   3. Remove the files: those recording paths plus everything under <campaignId>/ in each bucket.
// If step 3 partly fails the campaign is still gone; the leftovers are logged and alerted with the
// campaign id so they can be cleared, and the GM is told plainly rather than shown a clean success.

const BUCKETS = ["session-audio", "campaign-maps", "table-files"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { campaignId?: string; confirm?: string };
  const campaignId = (body.campaignId || "").trim();
  if (!UUID.test(campaignId)) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only this campaign's GM can delete it." }, { status: 403 });

  const admin = createAdminClient();
  const { data: camp } = await admin.from("campaigns").select("name").eq("id", campaignId).maybeSingle();
  const name = ((camp as { name: string | null } | null)?.name || "").trim();
  if ((body.confirm || "").trim() !== name) {
    return NextResponse.json({ error: "Type the campaign's name exactly to confirm." }, { status: 400 });
  }

  // 1. Recording paths, before the rows that hold them are gone.
  const { data: tracks, error: trErr } = await admin.from("audio_tracks").select("storage_path").eq("campaign_id", campaignId).not("storage_path", "is", null);
  if (trErr) return NextResponse.json({ error: "Could not read the campaign's recordings. Nothing was deleted; try again." }, { status: 500 });
  const audioPaths = ((tracks as { storage_path: string }[] | null) ?? []).map((t) => t.storage_path);

  // 2. The rows.
  const { error: delErr } = await supabase.rpc("delete_campaign", { p_campaign: campaignId });
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // 3. The files.
  const failures: string[] = [];
  let removed = 0;
  for (const bucket of BUCKETS) {
    let paths: string[] = bucket === "session-audio" ? [...audioPaths] : [];
    try {
      paths = paths.concat(await listAll(admin, bucket, campaignId));
    } catch (e) {
      failures.push(e instanceof Error ? e.message : `${bucket}: could not list`);
    }
    const r = await removeAll(admin, bucket, paths);
    removed += r.removed;
    failures.push(...r.failures);
  }

  if (failures.length) {
    await opsAlert("campaign delete", `campaign ${campaignId} deleted, but some files were left in storage`, failures.slice(0, 5));
    return NextResponse.json({
      ok: true, filesRemoved: removed, filesLeft: true,
      note: "The campaign is deleted. Some of its files could not be removed yet; we have been alerted and will clear them.",
    });
  }
  return NextResponse.json({ ok: true, filesRemoved: removed });
}
