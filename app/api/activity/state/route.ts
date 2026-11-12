import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callAs, combatForWatcher, feedForWatcher, forWatcher, isUuid, placesFor, sessionFrom } from "@/lib/discord/activity";
import { activityHand } from "@/lib/discord/activity-view";

// GET /api/activity/state?campaign=<id>&since=<iso> (2026-11-11, push 34, audit P7)
//
// Everything the Discord Activity draws, read AS the caller's Six Axes profile (p158 activity_call), so
// the table's own rules apply: the scene they are on, its map, the tokens and fog they may see, the
// turn order, and the chat and rolls since `since`. A watcher (in the Discord server, not linked to a
// player or GM here) reads through a player's eyes with everything personal taken out
// (lib/discord/activity.ts forWatcher), and only when the GM has let people watch (push 41, p165).
// Polled by the Activity every couple of seconds.

// No `export const dynamic`: this project runs with cacheComponents on, which rejects it. A GET handler
// that reads the request (the Authorization header) is rendered per request anyway.

export async function GET(req: Request) {
  const s = sessionFrom(req);
  if (!s) return NextResponse.json({ error: "Your Discord session ended. Close the Activity and open it again." }, { status: 401 });
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaign");
  const since = url.searchParams.get("since");
  if (!isUuid(campaignId)) return NextResponse.json({ error: "Pick a campaign." }, { status: 400 });

  const admin = createAdminClient();
  let place;
  try { place = (await placesFor(admin, s)).find((p) => p.campaignId === campaignId); }
  catch { return NextResponse.json({ error: "Could not look up the campaign." }, { status: 500 }); }
  if (!place) return NextResponse.json({ error: "That campaign is not linked to this Discord server." }, { status: 403 });

  const base0 = { role: place.role, campaign: { id: campaignId, name: place.name }, me: { name: s.n, characters: [] as { id: string; name: string; init: number | null }[] } };
  // Push 41 (audit round 2, T7): someone in the server who is not at this table watches only when the GM
  // has turned watching on (Workspace, campaigns.activity_watchers, p165). Off by default.
  if (place.role === "watch") {
    const { data: w } = await admin.from("campaigns").select("activity_watchers").eq("id", campaignId).maybeSingle();
    if (!(w as { activity_watchers?: boolean } | null)?.activity_watchers) {
      return NextResponse.json({ ...base0, state: null, combat: null, feed: null, note: "This table is for its GM and players. To join in, sign in to Six Axes with Discord on the website or run /claim in this server. (The GM can let others watch from the Workspace.)" });
    }
  }

  let uid = place.profileId;
  if (!uid) {
    const { data } = await admin.rpc("activity_watch_profile", { p_campaign: campaignId });
    uid = typeof data === "string" ? data : null;
  }
  const base = base0;
  if (!uid) return NextResponse.json({ ...base, state: null, combat: null, feed: null, note: "Nobody has a character in this campaign yet, so there is nothing to show." });

  const safe = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
  const sinceOk = since && !Number.isNaN(Date.parse(since)) ? since : "";
  const [state, combat, feed, chars, cards] = await Promise.all([
    safe(callAs<Record<string, unknown>>(admin, uid, "tabletop_state", { campaign: campaignId })),
    safe(callAs<Record<string, unknown> | null>(admin, uid, "tabletop_combat", { campaign: campaignId })),
    safe(callAs<Record<string, unknown>>(admin, uid, "tabletop_feed", { campaign: campaignId, since: sinceOk, limit: 40 })),
    place.profileId
      ? admin.from("characters").select("id, name, snap:build->sheetSnapshot").eq("campaign_id", campaignId).eq("profile_id", place.profileId).eq("kind", "pc").order("name")
      : Promise.resolve({ data: [] }),
    // push 35: the caller's own hand (a watcher holds no cards)
    place.profileId && place.role !== "watch" ? safe(callAs<unknown>(admin, place.profileId, "tabletop_cards", { campaign: campaignId })) : Promise.resolve(null),
  ]);
  if (place.role === "watch") {
    return NextResponse.json({ ...base, state: forWatcher(state as { tokens?: Record<string, unknown>[] } | null), combat: combatForWatcher(combat as { order?: Record<string, unknown>[] } | null), feed: feedForWatcher(feed as { messages?: { whisper_to?: unknown; gm_only?: boolean }[] } | null) });
  }
  // each character's initiative bonus, from the sheet snapshot the Forge saves (push 28), for the
  // "Roll initiative" button
  const rows = ((chars as { data: unknown }).data ?? []) as { id: string; name: string; snap?: { init?: unknown } | null }[];
  const characters = rows.map((r) => {
    const v = Number(r.snap?.init);
    return { id: r.id, name: r.name, init: Number.isFinite(v) ? Math.max(-10, Math.min(30, Math.round(v))) : null };
  });
  return NextResponse.json({ ...base, me: { ...base.me, characters, hand: activityHand(cards) }, state, combat, feed });
}
