import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPollMessage } from "@/lib/schedule/poll-message";

// POST /api/schedule/poll  { campaignId, slots: ISO[], recurring }
// Creates a scheduling poll and posts it to the linked Discord channel.
export async function POST(req: NextRequest) {
  let body: { campaignId?: string; slots?: string[]; recurring?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const campaignId = (body.campaignId || "").trim();
  const slots = Array.isArray(body.slots)
    ? body.slots.filter((s) => typeof s === "string" && s).slice(0, 5)
    : [];
  const recurring = !!body.recurring;
  if (!campaignId || slots.length === 0) {
    return NextResponse.json({ error: "Pick at least one time slot." }, { status: 400 });
  }

  const supa = await createClient();
  const { data: claimsData } = await supa.auth.getClaims();
  const uid = claimsData?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: isGm } = await supa.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only the campaign GM can post a poll." }, { status: 403 });

  const admin = createAdminClient();
  const { data: campRow } = await admin
    .from("campaigns")
    .select("discord_channel_id")
    .eq("id", campaignId)
    .maybeSingle();
  const channelId = (campRow as { discord_channel_id: string | null } | null)?.discord_channel_id;
  if (!channelId) {
    return NextResponse.json({ error: "Link your Discord channel with /setup first, so players can respond there." }, { status: 400 });
  }

  const { data: pollRow, error: pErr } = await admin
    .from("session_polls")
    .insert({ campaign_id: campaignId, created_by: uid, slots, recurring, channel_id: channelId, status: "open" })
    .select("id")
    .single();
  if (pErr || !pollRow) {
    return NextResponse.json({ error: "Could not create the poll." }, { status: 500 });
  }
  const pollId = (pollRow as { id: string }).id;

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "Discord bot is not configured." }, { status: 500 });

  const message = buildPollMessage(pollId, slots, slots.map(() => 0));
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Poll saved, but posting to Discord failed. Check the bot's channel access." }, { status: 502 });
  }
  const posted = (await res.json().catch(() => ({}))) as { id?: string };
  if (posted.id) {
    await admin.from("session_polls").update({ message_id: posted.id }).eq("id", pollId);
  }

  return NextResponse.json({ ok: true, pollId });
}
