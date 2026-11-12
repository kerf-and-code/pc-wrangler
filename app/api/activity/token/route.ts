import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activityConfigured, discordUser, exchangeCode, placesFor, signSession } from "@/lib/discord/activity";
import { allowHit } from "@/lib/rate-limit";

// POST /api/activity/token   body: { code, guildId } (2026-11-11, push 34, audit P7)
//
// The Discord Activity's sign-in. The Activity asks the Discord client for an OAuth code (scopes
// identify and guilds); this exchanges it with the app's client secret, asks Discord who it is and
// which servers they are in, and answers with a signed Activity session for that Discord user in
// that server, plus the campaigns linked to the server (/setup) and the user's role in each
// (lib/discord/activity.ts, p158). The access token goes back to the Activity for the Discord client's
// own authenticate step; the server keeps nothing.

export const maxDuration = 20;

export async function POST(req: Request) {
  if (!activityConfigured()) return NextResponse.json({ error: "The Discord Activity is not set up on this server yet." }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { code?: string; guildId?: string };
  const code = typeof b.code === "string" ? b.code.trim().slice(0, 200) : "";
  const guildId = typeof b.guildId === "string" ? b.guildId.trim() : "";
  if (!code) return NextResponse.json({ error: "Discord did not send a sign-in code." }, { status: 400 });
  if (!/^\d{5,25}$/.test(guildId)) {
    return NextResponse.json({ error: "Open Six Axes from a voice channel in your Discord server, not a direct message." }, { status: 400 });
  }
  // Push 42 (audit round 2, T22): each try is three calls to Discord with the app's own credentials, and
  // Discord slows down apps that send many bad ones. Counted per Discord server, not per address: inside
  // Discord the request comes through Discord's own proxy, so many people can share one address.
  if (!(await allowHit("activity-token", guildId, 60, 600)) || !(await allowHit("activity-token:all", "all", 2000, 3600))) {
    return NextResponse.json({ error: "Too many sign-in tries from here. Wait a few minutes and open Six Axes again." }, { status: 429 });
  }

  let accessToken: string, user: { id: string; name: string };
  try {
    accessToken = await exchangeCode(code);
    user = await discordUser(accessToken);
  } catch (e) {
    console.error("activity/token:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Discord sign-in did not go through. Close the Activity and open it again." }, { status: 502 });
  }

  // the server the Activity says it is in must be one the user is actually in
  const gr = await fetch("https://discord.com/api/v10/users/@me/guilds", { headers: { Authorization: `Bearer ${accessToken}` } });
  const guilds = (await gr.json().catch(() => [])) as { id?: string }[];
  if (!gr.ok || !Array.isArray(guilds) || !guilds.some((g) => g.id === guildId)) {
    return NextResponse.json({ error: "Could not confirm you are in this Discord server. Close the Activity and open it again." }, { status: 403 });
  }

  const session = signSession({ d: user.id, g: guildId, n: user.name });
  try {
    const places = await placesFor(createAdminClient(), { d: user.id, g: guildId, n: user.name, exp: 0 });
    return NextResponse.json({
      access_token: accessToken, session, user,
      campaigns: places.map((p) => ({ id: p.campaignId, name: p.name, role: p.role })),
    });
  } catch (e) {
    console.error("activity/token: identity", e instanceof Error ? e.message : e);
    const missing = e instanceof Error && /activity_identity/.test(e.message);
    return NextResponse.json({ error: missing ? "The Discord Activity is being set up. Try again in a few minutes." : "Could not look up your campaigns." }, { status: missing ? 503 : 500 });
  }
}
