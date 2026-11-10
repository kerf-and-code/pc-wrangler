import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCampaignExport } from "@/lib/campaign/export";
import { listAll, removeAll } from "@/lib/storage/purge";

export const maxDuration = 60;

// POST /api/gm/campaign/export   body: { campaignId } (2026-11-09)
//
// Audit F3: a GM downloads their whole campaign (lib/campaign/export.ts says what is in it). The zip
// is built here, kept in the private campaign-exports bucket (p140) under the campaign's folder, and
// handed back as a one-hour link: a response body this size would pass Vercel's limit. Only the newest
// export is kept; campaign purges remove it with the rest.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "campaign-exports";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { campaignId?: string };
  const campaignId = (body.campaignId || "").trim();
  if (!UUID.test(campaignId)) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only this campaign's GM can export it." }, { status: 403 });

  const admin = createAdminClient();
  try {
    const out = await buildCampaignExport(admin, campaignId);
    const old = await listAll(admin, BUCKET, campaignId).catch(() => [] as string[]);
    const path = `${campaignId}/${out.name}`;
    const up = await admin.storage.from(BUCKET).upload(path, out.zip, { contentType: "application/zip", upsert: true });
    if (up.error) {
      console.error("campaign export: upload failed (has p140 run?)", up.error.message);
      return NextResponse.json({ error: "Could not store the export. Try again in a few minutes." }, { status: 500 });
    }
    if (old.length) await removeAll(admin, BUCKET, old.filter((p) => p !== path));
    const { data: signed, error: sErr } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600, { download: out.name });
    if (sErr || !signed) return NextResponse.json({ error: "The export was made but the link could not be created. Try again." }, { status: 500 });
    return NextResponse.json({ url: signed.signedUrl, name: out.name, bytes: out.zip.length, counts: out.counts, skipped: out.skipped });
  } catch (e) {
    console.error("campaign export failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not build the export. Try again." }, { status: 500 });
  }
}
