import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// GET  /api/vtt/self-link?share_code=CODE
//   -> { campaign_name, characters: [{ id, name, ddb_character_id }] }
// POST /api/vtt/self-link { share_code, ddb_character_id, character_id }
//   -> { linked: true, character_name, backfilled }
//
// Share-code auth, same trust posture as /api/vtt/ingest: anyone with the
// campaign code can link a D&D Beyond character id to a roster character. This
// lets a player self-link from the browser extension popup without signing in.
// Unlike /api/vtt/link (GM-only, links by actor_name for one session), this
// writes characters.ddb_character_id so future rolls auto-attribute at ingest
// time, and backfills existing unattributed rows for that DDB id.

const MAX = 64;

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

async function campaignFromShare(
  sb: ReturnType<typeof serviceClient>,
  shareCode: string
) {
  const { data } = await sb
    .from("campaigns")
    .select("id, name")
    .eq("share_code", shareCode)
    .single();
  return data as { id: string; name: string } | null;
}

export async function GET(request: NextRequest) {
  const shareCode =
    cleanString(request.nextUrl.searchParams.get("share_code"), MAX)?.toLowerCase() ?? null;
  if (!shareCode) {
    return NextResponse.json({ error: "Missing share_code." }, { status: 400 });
  }

  const sb = serviceClient();
  const campaign = await campaignFromShare(sb, shareCode);
  if (!campaign) {
    return NextResponse.json({ error: "Unknown share code." }, { status: 404 });
  }

  const { data: chars } = await sb
    .from("characters")
    .select("id, name, ddb_character_id")
    .eq("campaign_id", campaign.id)
    .order("name", { ascending: true });

  return NextResponse.json({
    campaign_name: campaign.name,
    characters: (chars ?? []).map((c: any) => ({
      id: String(c.id),
      name: c.name ? String(c.name) : "Unnamed",
      ddb_character_id: c.ddb_character_id ? String(c.ddb_character_id) : null,
    })),
  });
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const shareCode = cleanString(body?.share_code, MAX)?.toLowerCase() ?? null;
  const ddbId = cleanString(body?.ddb_character_id, MAX);
  const characterId = cleanString(body?.character_id, MAX);
  if (!shareCode || !ddbId || !characterId) {
    return NextResponse.json(
      { error: "Expected { share_code, ddb_character_id, character_id }." },
      { status: 400 }
    );
  }

  const sb = serviceClient();
  const campaign = await campaignFromShare(sb, shareCode);
  if (!campaign) {
    return NextResponse.json({ error: "Unknown share code." }, { status: 404 });
  }

  // Confirm the target character belongs to this campaign.
  const { data: charRow } = await sb
    .from("characters")
    .select("id, name, campaign_id")
    .eq("id", characterId)
    .maybeSingle();
  const ch = charRow as { id: string; name: string | null; campaign_id: string } | null;
  if (!ch || ch.campaign_id !== campaign.id) {
    return NextResponse.json({ error: "Character is not in this campaign." }, { status: 400 });
  }

  // A DDB id maps to one character. Clear it from any other character in the
  // campaign first, then assign it to the target, so relinking moves it cleanly.
  await sb
    .from("characters")
    .update({ ddb_character_id: null })
    .eq("campaign_id", campaign.id)
    .eq("ddb_character_id", ddbId)
    .neq("id", characterId);

  const { error: linkErr } = await sb
    .from("characters")
    .update({ ddb_character_id: ddbId })
    .eq("id", characterId)
    .eq("campaign_id", campaign.id);
  if (linkErr) {
    return NextResponse.json({ error: "Link failed. Try again." }, { status: 500 });
  }

  // Backfill: attribute existing unlinked rows for this DDB id in this campaign.
  const { data: backfilled } = await sb
    .from("vtt_events")
    .update({ character_id: characterId })
    .eq("campaign_id", campaign.id)
    .eq("ddb_character_id", ddbId)
    .is("character_id", null)
    .select("id");

  return NextResponse.json({
    linked: true,
    character_name: ch.name ?? "your character",
    backfilled: Array.isArray(backfilled) ? backfilled.length : 0,
  });
}
