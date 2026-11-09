import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// app/api/tabletop/token-image/route.ts (2026-11-06, cleanup 2026-11-08)
//
// A token image upload. Stored in the public campaign-maps bucket under
// <campaign_id>/tokens/<uuid>.<ext> through the service role, after checking the caller may, so it does
// not depend on which storage policies cover which sub-path (the p18/p36 history shows those are easy to
// get wrong). PNG, JPEG, WebP or GIF, 5 MB at most.
//
// Who may: the campaign's GM, always. Since the token maker (2026-11-08, p120), also a player uploading
// for a token they control: the form then carries tokenId, and tabletop_can_edit_token decides.
//
// DELETE (audit A4, 2026-11-08): re-saving a token from the token maker used to leave the old picture
// in storage for ever. After a save the table sends the pictures it replaced (and, when a save fails,
// the ones it had just uploaded). Each is removed only when it is a file in this campaign's tokens
// folder and no token anywhere still shows it (as its picture or as an imported border), so a picture
// copied onto other tokens stays. Same permission rule as uploading.

export const maxDuration = 30;

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;

type Supa = Awaited<ReturnType<typeof createClient>>;

/** May the signed-in caller change pictures for this campaign (and token, for a player)? */
async function mayChange(supabase: Supa, campaignId: string, tokenId: string): Promise<string | null> {
  const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (isGm) return null;
  if (!UUID.test(tokenId)) return "Only the GM adds token images.";
  const { data: mayEdit } = await supabase.rpc("tabletop_can_edit_token", { p_token: tokenId, p_campaign: campaignId });
  return mayEdit ? null : "That token is not yours to change.";
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Send the image as a form upload." }, { status: 400 }); }
  const campaignId = String(form.get("campaignId") ?? "");
  const tokenId = String(form.get("tokenId") ?? "");
  const file = form.get("file");
  if (!UUID.test(campaignId)) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image." }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Use a PNG, JPEG, WebP or GIF image." }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That image is over 5 MB." }, { status: 413 });

  const refused = await mayChange(supabase, campaignId, tokenId);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });

  const admin = createAdminClient();
  const path = `${campaignId}/tokens/${crypto.randomUUID()}.${ext}`;
  const up = await admin.storage.from("campaign-maps").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });
  const url = admin.storage.from("campaign-maps").getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ ok: true, url });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { campaignId?: unknown; tokenId?: unknown; urls?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Send JSON." }, { status: 400 }); }
  const campaignId = String(body.campaignId ?? "");
  const tokenId = String(body.tokenId ?? "");
  if (!UUID.test(campaignId)) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });
  const urls = (Array.isArray(body.urls) ? body.urls : []).filter((u): u is string => typeof u === "string").slice(0, 4);
  if (!urls.length) return NextResponse.json({ ok: true, removed: 0 });

  const refused = await mayChange(supabase, campaignId, tokenId);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });

  const admin = createAdminClient();
  // the exact public address of this campaign's tokens folder, so only its files can be named
  const folder = admin.storage.from("campaign-maps").getPublicUrl(`${campaignId}/tokens/`).data.publicUrl;
  const paths: string[] = [];
  for (const url of new Set(urls)) {
    if (!url.startsWith(folder)) continue;
    const name = url.slice(folder.length);
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    // still shown by any token, as its picture or its imported border? then it stays
    const [a, b] = await Promise.all([
      admin.from("vtt_tokens").select("id", { count: "exact", head: true }).eq("image_url", url),
      admin.from("vtt_tokens").select("id", { count: "exact", head: true }).eq("style->frame->>importUrl", url),
    ]);
    if (a.error || b.error || (a.count ?? 1) > 0 || (b.count ?? 1) > 0) continue;
    paths.push(`${campaignId}/tokens/${name}`);
  }
  if (!paths.length) return NextResponse.json({ ok: true, removed: 0 });
  const rm = await admin.storage.from("campaign-maps").remove(paths);
  if (rm.error) return NextResponse.json({ error: `Could not remove: ${rm.error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, removed: paths.length });
}
