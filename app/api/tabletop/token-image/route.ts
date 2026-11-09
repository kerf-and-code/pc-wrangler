import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// app/api/tabletop/token-image/route.ts (2026-11-06)
//
// A token image upload. Stored in the public campaign-maps bucket under
// <campaign_id>/tokens/<uuid>.<ext> through the service role, after checking the caller may, so it does
// not depend on which storage policies cover which sub-path (the p18/p36 history shows those are easy to
// get wrong). PNG, JPEG, WebP or GIF, 5 MB at most.
//
// Who may: the campaign's GM, always. Since the token maker (2026-11-08, p120), also a player uploading
// for a token they control: the form then carries tokenId, and tabletop_can_edit_token decides.

export const maxDuration = 30;

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Send the image as a form upload." }, { status: 400 }); }
  const campaignId = String(form.get("campaignId") ?? "");
  const tokenId = String(form.get("tokenId") ?? "");
  const file = form.get("file");
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image." }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Use a PNG, JPEG, WebP or GIF image." }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That image is over 5 MB." }, { status: 413 });

  const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) {
    if (!/^[0-9a-f-]{36}$/i.test(tokenId)) return NextResponse.json({ error: "Only the GM adds token images." }, { status: 403 });
    const { data: mayEdit } = await supabase.rpc("tabletop_can_edit_token", { p_token: tokenId, p_campaign: campaignId });
    if (!mayEdit) return NextResponse.json({ error: "That token is not yours to change." }, { status: 403 });
  }

  const admin = createAdminClient();
  const path = `${campaignId}/tokens/${crypto.randomUUID()}.${ext}`;
  const up = await admin.storage.from("campaign-maps").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });
  const url = admin.storage.from("campaign-maps").getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ ok: true, url });
}
