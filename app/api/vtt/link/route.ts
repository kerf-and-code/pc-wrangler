import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// GET  /api/vtt/link?share_code=...   -> { characters: [{ id, name, linked }] }
// POST /api/vtt/link                  -> { share_code, ddb_character_id, character_id }
//
// Lets a player self-link their D&D Beyond character id to a campaign character
// from the Table Tap page (the /claim pattern, third use). Linking also
// retroactively attributes any vtt_events that arrived before the link existed.

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

async function campaignByCode(sb: ReturnType<typeof serviceClient>, raw: unknown) {
  const code = cleanString(raw, 64)?.toLowerCase() ?? null;
  if (!code) return null;
  const { data } = await sb.from("campaigns").select("id, name").eq("share_code", code).single();
  return data ?? null;
}

export async function GET(request: NextRequest) {
  const sb = serviceClient();
  const campaign = await campaignByCode(sb, request.nextUrl.searchParams.get("share_code"));
  if (!campaign) {
    return NextResponse.json({ error: "Unknown share code." }, { status: 404 });
  }
  const { data: chars } = await sb
    .from("characters")
    .select("id, name, ddb_character_id")
    .eq("campaign_id", campaign.id)
    .eq("kind", "pc")
    .eq("active", true)
    .order("name");
  const characters = (chars ?? []).map((c: any) => ({
    id: c.id as string,
    name: (c.name ?? "Unnamed") as string,
    linked: c.ddb_character_id !== null && c.ddb_character_id !== "",
  }));
  return NextResponse.json({ characters });
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sb = serviceClient();
  const campaign = await campaignByCode(sb, body?.share_code);
  if (!campaign) {
    return NextResponse.json({ error: "Unknown share code." }, { status: 404 });
  }

  const ddbId = cleanString(body?.ddb_character_id, 64);
  const characterId = cleanString(body?.character_id, 64);
  if (!ddbId || !characterId) {
    return NextResponse.json(
      { error: "Expected { share_code, ddb_character_id, character_id }." },
      { status: 400 }
    );
  }

  const { data: character } = await sb
    .from("characters")
    .select("id, name, ddb_character_id, kind, active")
    .eq("id", characterId)
    .eq("campaign_id", campaign.id)
    .maybeSingle();
  if (!character || character.kind !== "pc" || character.active !== true) {
    return NextResponse.json({ error: "That character is not available in this campaign." }, { status: 404 });
  }

  // Integrity guards: no stealing a character already linked to a different
  // DDB id, and one DDB id links to at most one character per campaign.
  if (character.ddb_character_id && character.ddb_character_id !== ddbId) {
    return NextResponse.json(
      { error: "That character is already linked to a different D&D Beyond character." },
      { status: 409 }
    );
  }
  const { data: existing } = await sb
    .from("characters")
    .select("id, name")
    .eq("campaign_id", campaign.id)
    .eq("ddb_character_id", ddbId)
    .neq("id", character.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: `That D&D Beyond character is already linked to ${existing.name}.` },
      { status: 409 }
    );
  }

  if (character.ddb_character_id !== ddbId) {
    const { error: upErr } = await sb
      .from("characters")
      .update({ ddb_character_id: ddbId })
      .eq("id", character.id);
    if (upErr) {
      return NextResponse.json({ error: "Could not save the link. Try again." }, { status: 500 });
    }
  }

  // Retroactively attribute events that arrived before the link existed.
  const { data: backfilled } = await sb
    .from("vtt_events")
    .update({ character_id: character.id })
    .eq("campaign_id", campaign.id)
    .eq("ddb_character_id", ddbId)
    .is("character_id", null)
    .select("id");

  return NextResponse.json({
    linked: true,
    character_id: character.id,
    character_name: character.name,
    backfilled: (backfilled ?? []).length,
  });
}
