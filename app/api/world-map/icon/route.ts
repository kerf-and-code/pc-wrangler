import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// Personal POI icon upload, server-side (browser storage writes are not authenticated here, same as
// the world-map image route). Validates that the file is a plain, script-free SVG, enforces a small
// per-file cap and a ~1 MB per-campaign total budget, stores it with the service-role client, and
// records a map_icons row. Uploaded icons are rendered as <img> in the UI, so scripting is already
// neutralised; the script/handler check below is defence in depth.

const PER_FILE_MAX = 128 * 1024;         // 128 KB per icon, generous for an SVG
const CAMPAIGN_BUDGET = 1024 * 1024;     // ~1 MB total per campaign

function slugify(name: string): string {
  return name.toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "icon";
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const campaignId = String(form.get("campaignId") || "").trim();
    const file = form.get("file");
    const labelIn = String(form.get("label") || "").trim();
    if (!campaignId || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing campaignId or file." }, { status: 400 });
    }
    const isSvgType = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    if (!isSvgType) return NextResponse.json({ error: "Upload an SVG icon." }, { status: 400 });
    if (file.size > PER_FILE_MAX) return NextResponse.json({ error: "Each icon must be under 128 KB." }, { status: 400 });

    const text = await file.text();
    if (!/<svg[\s>]/i.test(text)) return NextResponse.json({ error: "That file is not a valid SVG." }, { status: 400 });
    if (/<script[\s>]/i.test(text) || /\son\w+\s*=/i.test(text) || /<foreignObject[\s>]/i.test(text)) {
      return NextResponse.json({ error: "That SVG contains scripts or event handlers and was rejected." }, { status: 400 });
    }

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: camp } = await supa.from("campaigns").select("gm_id").eq("id", campaignId).maybeSingle();
    if ((camp as { gm_id: string } | null)?.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    // Budget: existing bytes for this campaign + this file must stay under the cap.
    const { data: rows } = await supa.from("map_icons").select("bytes").eq("campaign_id", campaignId);
    const used = ((rows as { bytes: number }[]) || []).reduce((a, r) => a + (r.bytes || 0), 0);
    if (used + file.size > CAMPAIGN_BUDGET) {
      const leftKb = Math.max(0, Math.floor((CAMPAIGN_BUDGET - used) / 1024));
      return NextResponse.json({ error: `Icon budget is full (about ${leftKb} KB left of 1 MB). Remove some icons first.` }, { status: 400 });
    }

    const admin = createAdminClient();
    const path = `${campaignId}/icons/${crypto.randomUUID()}.svg`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage.from("campaign-maps").upload(path, bytes, { upsert: true, contentType: "image/svg+xml" });
    if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });
    const { data: pub } = admin.storage.from("campaign-maps").getPublicUrl(path);

    const key = slugify(file.name);
    const label = labelIn || key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    const ins = await admin.from("map_icons").insert({ campaign_id: campaignId, key, label, url: pub.publicUrl, bytes: file.size }).select("id, key, label, url, bytes").single();
    if (ins.error || !ins.data) return NextResponse.json({ error: `Save failed: ${ins.error?.message || "unknown"}` }, { status: 500 });

    return NextResponse.json({ icon: ins.data });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/world-map/icon] failure:", detail);
    return NextResponse.json({ error: `Could not upload: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
