import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normName } from "@/lib/vtt/name-route";

// POST /api/vtt/name-link  { campaignId, actorName, characterId: string | null, clear?: boolean }
// (2026-11-12, push 44: audit round 2, G12, T9, B14)
//
// The GM says where a name rolled under in Roll20 goes in this campaign: a character, or no one
// (characterId null, "not a player character"). The choice is saved in vtt_name_links (p167), so later
// Roll20 rolls under that name follow it (lib/vtt/name-route.ts), and every Roll20 row already stored in
// the campaign under that name is moved to match. A row moved off a character it was sent for loses its
// verified mark, because whoever vouched for it vouched for that character, not the new one.
// `clear: true` removes the choice and leaves the stored rows where they are.
//
// GMs of the campaign only (is_campaign_gm, so co-GMs too). Writes with the service role after that
// check; the table has no write policy for signed-in users.

const PAGE = 1000;
const MAX_PAGES = 50;
const CHUNK = 200;

export async function POST(req: NextRequest) {
  let body: { campaignId?: unknown; actorName?: unknown; characterId?: unknown; clear?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : "";
  const nameNorm = normName(body.actorName).slice(0, 200);
  const characterId = typeof body.characterId === "string" && body.characterId.trim() ? body.characterId.trim() : null;
  const clear = body.clear === true;
  if (!/^[0-9a-f-]{36}$/i.test(campaignId) || !nameNorm) {
    return NextResponse.json({ error: "Missing the campaign or the name." }, { status: 400 });
  }
  if (characterId && !/^[0-9a-f-]{36}$/i.test(characterId)) {
    return NextResponse.json({ error: "That character is not valid." }, { status: 400 });
  }

  const supa = await createClient();
  const { data: claimsData } = await supa.auth.getClaims();
  const uid = claimsData?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: isGm } = await supa.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only a GM of this campaign can choose where a name goes." }, { status: 403 });

  const admin = createAdminClient();

  if (clear) {
    const { error } = await admin.from("vtt_name_links").delete()
      .eq("campaign_id", campaignId).eq("source", "roll20").eq("name_norm", nameNorm);
    if (error) return NextResponse.json({ error: notReady(error.message) }, { status: 500 });
    return NextResponse.json({ ok: true, moved: 0 });
  }

  if (characterId) {
    const { data: ch } = await admin.from("characters").select("campaign_id").eq("id", characterId).maybeSingle();
    if ((ch as { campaign_id: string } | null)?.campaign_id !== campaignId) {
      return NextResponse.json({ error: "That character is not in this campaign." }, { status: 400 });
    }
  }

  const { error: upErr } = await admin.from("vtt_name_links").upsert({
    campaign_id: campaignId, source: "roll20", name_norm: nameNorm, character_id: characterId,
    created_by: uid, updated_at: new Date().toISOString(),
  }, { onConflict: "campaign_id,source,name_norm" });
  if (upErr) return NextResponse.json({ error: notReady(upErr.message) }, { status: 500 });

  // The rows already stored under this name that are not where the GM now says.
  const fromNobody: string[] = [];
  const fromSomeone: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin.from("vtt_events").select("id, actor_name, character_id")
      .eq("campaign_id", campaignId).eq("source", "roll20")
      .order("id", { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return NextResponse.json({ error: "Saved your choice, but could not read the earlier rolls. Try again." }, { status: 500 });
    const rows = (data ?? []) as { id: string; actor_name: string | null; character_id: string | null }[];
    for (const r of rows) {
      if (normName(r.actor_name) !== nameNorm || r.character_id === characterId) continue;
      (r.character_id ? fromSomeone : fromNobody).push(r.id);
    }
    if (rows.length < PAGE) break;
  }

  let moved = 0;
  for (let i = 0; i < fromNobody.length; i += CHUNK) {
    const ids = fromNobody.slice(i, i + CHUNK);
    const { error } = await admin.from("vtt_events").update({ character_id: characterId }).in("id", ids);
    if (error) return NextResponse.json({ error: `Saved your choice and moved ${moved} earlier rolls, then failed. Try again.` }, { status: 500 });
    moved += ids.length;
  }
  for (let i = 0; i < fromSomeone.length; i += CHUNK) {
    const ids = fromSomeone.slice(i, i + CHUNK);
    const { error } = await admin.from("vtt_events").update({ character_id: characterId, fidelity: "unverified" }).in("id", ids);
    if (error) return NextResponse.json({ error: `Saved your choice and moved ${moved} earlier rolls, then failed. Try again.` }, { status: 500 });
    moved += ids.length;
  }

  return NextResponse.json({ ok: true, moved });
}

function notReady(message: string): string {
  return /vtt_name_links/.test(message)
    ? "Choosing where a Roll20 name goes needs the p167 database update. Ask whoever runs your server to apply it."
    : "Could not save that. Try again.";
}
