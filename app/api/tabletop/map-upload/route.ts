import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// app/api/tabletop/map-upload/route.ts (2026-11-07)
//
// Phase 4d: the GM uploads a map image (a module's battle map) for the tabletop. The browser has already
// cropped it to the grid the GM lined up and squared it off (components/map-upload.tsx), so this route
// only hands out a signed upload URL: the image goes straight to storage, past the request size limit a
// serverless route has. Stored in the public campaign-maps bucket under
// <campaign_id>/uploads/<uuid>.<ext>, after checking the caller is the campaign's GM, the same bucket and
// rule as token images (app/api/tabletop/token-image/route.ts).

export const maxDuration = 15;

const TYPES: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let b: { campaignId?: string; type?: string } = {};
  try { b = await req.json(); } catch { /* guarded below */ }
  const campaignId = typeof b.campaignId === "string" ? b.campaignId : "";
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });
  const ext = TYPES[String(b.type ?? "")];
  if (!ext) return NextResponse.json({ error: "Use a WebP, JPEG or PNG image." }, { status: 415 });

  const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only the GM uploads maps." }, { status: 403 });

  const admin = createAdminClient();
  const path = `${campaignId}/uploads/${crypto.randomUUID()}.${ext}`;
  const { data: signed, error } = await admin.storage.from("campaign-maps").createSignedUploadUrl(path);
  if (error || !signed) return NextResponse.json({ error: `Could not start the upload: ${error?.message ?? "no URL"}` }, { status: 500 });
  const url = admin.storage.from("campaign-maps").getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ ok: true, path: signed.path, token: signed.token, url });
}
