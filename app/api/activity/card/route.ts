import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callAs, isUuid, placesFor, sessionFrom } from "@/lib/discord/activity";

// POST /api/activity/card   body: { campaign, card, action: "use" | "play" } (2026-11-11, push 35)
//
// A player (or the GM) in the Discord Activity uses a card from their hand (p159 tabletop_card_use: chat
// says what it was, and it goes back to its deck's discards) or plays it face up on the table
// (tabletop_card_move). Both run as their Six Axes profile (activity_call), so only their own cards
// move. Watchers hold no cards.

const friendly = (m: string): string =>
  /not yours/.test(m) ? "That card is not in your hand any more."
  : /card not found/.test(m) ? "That card is gone."
  : "That did not go through.";

export async function POST(req: Request) {
  const s = sessionFrom(req);
  if (!s) return NextResponse.json({ error: "Your Discord session ended. Close the Activity and open it again." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { campaign?: string; card?: string; action?: string };
  if (!isUuid(b.campaign) || !isUuid(b.card) || (b.action !== "use" && b.action !== "play")) {
    return NextResponse.json({ error: "That did not make sense." }, { status: 400 });
  }
  const admin = createAdminClient();
  const place = (await placesFor(admin, s).catch(() => [])).find((p) => p.campaignId === b.campaign);
  if (!place || place.role === "watch" || !place.profileId) {
    return NextResponse.json({ error: "Watching only: sign in to Six Axes with Discord, or /claim your character, to play." }, { status: 403 });
  }
  try {
    if (b.action === "use") await callAs(admin, place.profileId, "tabletop_card_use", { card: b.card });
    else await callAs(admin, place.profileId, "tabletop_card_move", { card: b.card, to: "table", face_up: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: friendly(e instanceof Error ? e.message : String(e)) }, { status: 409 });
  }
}
