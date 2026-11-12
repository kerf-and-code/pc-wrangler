import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callAs, isUuid, placesFor, sessionFrom } from "@/lib/discord/activity";

// POST /api/activity/move   body: { campaign, token, x, y } (2026-11-11, push 34, audit P7)
//
// A player (or the GM) in the Discord Activity moves a token, through the table's own
// tabletop_move_token run as their profile (p158): only tokens they control, only on their turn in a
// fight and as far as their movement allows, never through a wall. Watchers cannot move anything.

const friendly = (m: string): string =>
  /wait for your turn/.test(m) ? "Wait for your turn to move."
  : /wall/.test(m) ? "A wall is in the way."
  : /not enough movement left/.test(m) ? m.replace(/^.*?(not enough movement left: \d+ ft).*$/, "Not enough movement left this turn ($1).").replace("(not enough movement left: ", "(")
  : /too far for one move/.test(m) ? "That is too far for one move."
  : /speed is 0/.test(m) ? "Your speed is 0 right now."
  : /not yours/.test(m) ? "You can only move your own tokens."
  : /token not found/.test(m) ? "That token is gone."
  : "That move did not go through.";

export async function POST(req: Request) {
  const s = sessionFrom(req);
  if (!s) return NextResponse.json({ error: "Your Discord session ended. Close the Activity and open it again." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { campaign?: string; token?: string; x?: number; y?: number };
  if (!isUuid(b.campaign) || !isUuid(b.token) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    return NextResponse.json({ error: "That move did not make sense." }, { status: 400 });
  }
  const admin = createAdminClient();
  const place = (await placesFor(admin, s).catch(() => [])).find((p) => p.campaignId === b.campaign);
  if (!place || place.role === "watch" || !place.profileId) {
    return NextResponse.json({ error: "Watching only: sign in to Six Axes with Discord, or /claim your character, to play." }, { status: 403 });
  }
  try {
    await callAs(admin, place.profileId, "tabletop_move_token", { campaign: b.campaign, token: b.token, x: b.x, y: b.y });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: friendly(m) }, { status: 409 });
  }
}
