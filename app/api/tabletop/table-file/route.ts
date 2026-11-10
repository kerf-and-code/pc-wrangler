import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// app/api/tabletop/table-file/route.ts (2026-11-09)
//
// Phase 6d (p133): pictures the GM uploads for the table (picture handouts, card faces, deck backs),
// kept in the PRIVATE table-files bucket at <campaign>/<handouts|cards|decks>/<uuid>.<ext>.
//
//   GET    ?c=<campaign>&p=<path>  shows a picture: tabletop_file_ok decides whether the signed-in person
//          may see it now (a handout shown to them, a card they can see, any deck's back); if so, a
//          redirect to a link that works for an hour. Anything else is "not found", so nobody learns
//          which pictures exist.
//   POST   { campaignId, purpose, type }  the GM starts an upload: a signed upload link for a new path,
//          so the picture goes straight to storage (past the request size limit), as map uploads do.
//   DELETE { campaignId, paths }  the GM clears pictures nothing uses any more (after hiding a handout or
//          deleting a deck). Only files in this campaign's folders, and only when tabletop_file_in_use
//          says no handout, card or deck still shows them.

export const maxDuration = 15;

const UUID = /^[0-9a-f-]{36}$/i;
const PATH = /^[0-9a-f-]{36}\/(handouts|cards|decks)\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const PURPOSES = new Set(["handouts", "cards", "decks"]);
const BUCKET = "table-files";
const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = u.searchParams.get("c") ?? "", p = u.searchParams.get("p") ?? "";
  if (!UUID.test(c) || !PATH.test(p) || !p.startsWith(`${c}/`)) return notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in first.", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { data: ok } = await supabase.rpc("tabletop_file_ok", { p_campaign: c, p_path: p });
  if (ok !== true) return notFound();
  // Audit B19 (push 6): a short link, never cached, so a picture the GM hides stops opening within two
  // minutes (it stayed viewable for up to an hour).
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(p, 120);
  if (error || !data?.signedUrl) return notFound();
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}

async function gmOf(campaignId: string): Promise<NextResponse | null> {
  if (!UUID.test(campaignId)) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: campaignId });
  return isGm ? null : NextResponse.json({ error: "Only the GM adds pictures." }, { status: 403 });
}

export async function POST(req: Request) {
  let b: { campaignId?: string; purpose?: string; type?: string } = {};
  try { b = await req.json(); } catch { /* guarded below */ }
  const campaignId = typeof b.campaignId === "string" ? b.campaignId : "";
  const ext = TYPES[String(b.type ?? "")];
  if (!PURPOSES.has(String(b.purpose))) return NextResponse.json({ error: "Unknown kind of picture." }, { status: 400 });
  if (!ext) return NextResponse.json({ error: "Use a PNG, JPEG, WebP or GIF image." }, { status: 415 });
  const refused = await gmOf(campaignId);
  if (refused) return refused;
  const path = `${campaignId}/${b.purpose}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    const missing = /bucket/i.test(error?.message ?? "") && /not found/i.test(error?.message ?? "");
    return NextResponse.json({ error: missing ? "Table pictures are not set up yet (the p133 migration)." : `Could not start the upload: ${error?.message ?? "no link"}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, path: data.path, token: data.token });
}

export async function DELETE(req: Request) {
  let b: { campaignId?: string; paths?: unknown } = {};
  try { b = await req.json(); } catch { /* guarded below */ }
  const campaignId = typeof b.campaignId === "string" ? b.campaignId : "";
  const refused = await gmOf(campaignId);
  if (refused) return refused;
  const asked = (Array.isArray(b.paths) ? b.paths : []).filter((p): p is string => typeof p === "string" && PATH.test(p) && p.startsWith(`${campaignId}/`));
  const admin = createAdminClient();
  const gone: string[] = [];
  for (const p of [...new Set(asked)].slice(0, 300)) {
    const { data: used, error } = await admin.rpc("tabletop_file_in_use", { p_path: p });
    if (!error && used === false) gone.push(p);
  }
  if (gone.length) {
    const rm = await admin.storage.from(BUCKET).remove(gone);
    if (rm.error) return NextResponse.json({ error: `Could not remove: ${rm.error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, removed: gone.length });
}
