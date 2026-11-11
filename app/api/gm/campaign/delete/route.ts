import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeCampaign } from "@/lib/campaign/purge";
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { campaignId?: string; confirm?: string };
  const campaignId = (body.campaignId || "").trim();
  if (!UUID.test(campaignId)) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  // Deleting is an owner action (p149): a co-GM is a GM of the campaign but cannot delete it.
  const admin = createAdminClient();
  const { data: camp } = await admin.from("campaigns").select("name, gm_id").eq("id", campaignId).maybeSingle();
  if ((camp as { gm_id: string } | null)?.gm_id !== user.id) {
    return NextResponse.json({ error: "Only the campaign's owner can delete it." }, { status: 403 });
  }
  const name = ((camp as { name: string | null } | null)?.name || "").trim();
  if ((body.confirm || "").trim() !== name) {
    return NextResponse.json({ error: "Type the campaign's name exactly to confirm." }, { status: 400 });
  }

  // Paths first, then the rows (as the signed-in GM: delete_campaign checks it), then the files.
  const result = await purgeCampaign(admin, campaignId, async () => {
    const { error } = await supabase.rpc("delete_campaign", { p_campaign: campaignId });
    return error ? error.message : null;
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.stage === "read"
      ? "Could not read the campaign's recordings. Nothing was deleted; try again."
      : result.error }, { status: 500 });
  }
  const failures = result.failures;
  const removed = result.filesRemoved;

  if (failures.length) {
    await opsAlert("campaign delete", `campaign ${campaignId} deleted, but some files were left in storage`, failures.slice(0, 5));
    return NextResponse.json({
      ok: true, filesRemoved: removed, filesLeft: true,
      note: "The campaign is deleted. Some of its files could not be removed yet; we have been alerted and will clear them.",
    });
  }
  return NextResponse.json({ ok: true, filesRemoved: removed });
}
