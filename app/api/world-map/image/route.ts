import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// World-map background image upload, server-side. The browser storage client's session is not
// honoured by storage RLS here (auth.uid() comes through null on the storage request even though the
// same session authenticates DB calls), so a client upload is denied no matter the policy. This
// route re-checks ownership itself (campaigns.gm_id = the signed-in user, the same gate world_maps
// uses) and then writes with the service-role admin client, which is not subject to storage RLS.

const OK_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const campaignId = String(form.get("campaignId") || "").trim();
    const file = form.get("file");
    if (!campaignId || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing campaignId or file." }, { status: 400 });
    }
    if (!OK_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Use a PNG, JPG, or WebP image." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image must be under 8 MB." }, { status: 400 });
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
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${campaignId}/world/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage.from("campaign-maps").upload(path, bytes, { upsert: true, contentType: file.type });
    if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });

    const { data: pub } = admin.storage.from("campaign-maps").getPublicUrl(path);
    return NextResponse.json({ url: pub.publicUrl });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/world-map/image] failure:", detail, e);
    return NextResponse.json({ error: `Could not upload: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
