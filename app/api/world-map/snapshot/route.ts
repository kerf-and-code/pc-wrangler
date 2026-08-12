import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// World-map wiki snapshot upload, server-side. Same reason as the image route: storage RLS does not
// honour the browser session here, so the bytes go up with the service-role admin client after this
// route re-checks ownership (campaigns.gm_id = the signed-in user, the gate world_maps uses). On
// success it also marks the map published and records the URL, so the public wiki read can show it.
// A fresh path per publish (uuid) sidesteps CDN caching of an overwritten object.

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const campaignId = String(form.get("campaignId") || "").trim();
    const file = form.get("file");
    if (!campaignId || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing campaignId or file." }, { status: 400 });
    }
    if (file.type !== "image/png") {
      return NextResponse.json({ error: "Snapshot must be a PNG." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Snapshot must be under 12 MB." }, { status: 400 });
    }

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    // Owner gate: exactly what world_maps RLS checks.
    const { data: camp } = await supa.from("campaigns").select("gm_id").eq("id", campaignId).maybeSingle();
    if ((camp as { gm_id: string } | null)?.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    const admin = createAdminClient();
    const path = `${campaignId}/snapshot-${crypto.randomUUID()}.png`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage.from("campaign-maps").upload(path, bytes, { upsert: true, contentType: "image/png" });
    if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });

    const { data: pub } = admin.storage.from("campaign-maps").getPublicUrl(path);
    const url = pub.publicUrl;

    const upd = await admin.from("world_maps").update({ snapshot_url: url, published: true }).eq("campaign_id", campaignId);
    if (upd.error) return NextResponse.json({ error: `Saved the image but could not publish: ${upd.error.message}` }, { status: 500 });

    return NextResponse.json({ url });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/world-map/snapshot] failure:", detail, e);
    return NextResponse.json({ error: `Could not publish: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
