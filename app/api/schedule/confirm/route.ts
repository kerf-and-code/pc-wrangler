import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/schedule/confirm  { pollId, slotIdx }
// Locks a poll slot: creates the next scheduled session, closes the poll,
// stores a weekly recurrence anchor if the poll was recurring, and updates the
// Discord message. No collision with /record's auto-open: this is a future
// scheduled session, distinct from the live one.
export async function POST(req: NextRequest) {
  let body: { pollId?: string; slotIdx?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const pollId = (body.pollId || "").trim();
  const slotIdx = Number(body.slotIdx);
  if (!pollId || !Number.isInteger(slotIdx)) {
    return NextResponse.json({ error: "Missing poll or slot." }, { status: 400 });
  }

  const supa = await createClient();
  const { data: claimsData } = await supa.auth.getClaims();
  const uid = claimsData?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: pollRow } = await admin
    .from("session_polls")
    .select("id, campaign_id, slots, status, recurring, channel_id, message_id")
    .eq("id", pollId)
    .maybeSingle();
  const poll = pollRow as {
    id: string; campaign_id: string; slots: string[]; status: string;
    recurring: boolean; channel_id: string | null; message_id: string | null;
  } | null;
  if (!poll) return NextResponse.json({ error: "Poll not found." }, { status: 404 });

  const { data: isGm } = await supa.rpc("is_campaign_gm", { p_campaign: poll.campaign_id });
  if (!isGm) return NextResponse.json({ error: "Only the campaign GM can confirm." }, { status: 403 });
  if (poll.status !== "open") return NextResponse.json({ error: "This poll is already closed." }, { status: 400 });

  const slot = poll.slots?.[slotIdx];
  if (!slot) return NextResponse.json({ error: "That slot no longer exists." }, { status: 400 });

  const { data: maxRow } = await admin
    .from("sessions")
    .select("session_number")
    .eq("campaign_id", poll.campaign_id)
    .order("session_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNum = (((maxRow as { session_number: number | null } | null)?.session_number) ?? 0) + 1;

  const { data: sessRow, error: sErr } = await admin
    .from("sessions")
    .insert({ campaign_id: poll.campaign_id, session_number: nextNum, status: "scheduled", scheduled_at: slot })
    .select("id")
    .single();
  if (sErr || !sessRow) return NextResponse.json({ error: "Could not create the session." }, { status: 500 });
  const sessionId = (sessRow as { id: string }).id;

  await admin.from("session_polls").update({ status: "closed", chosen_slot: slot, session_id: sessionId }).eq("id", pollId);
  if (poll.recurring) {
    await admin.from("campaigns").update({ recur_rule: { interval: "weekly", anchor: slot } }).eq("id", poll.campaign_id);
  }

  // Update the Discord poll message to a confirmation (best-effort).
  const token = process.env.DISCORD_BOT_TOKEN;
  if (token && poll.channel_id && poll.message_id) {
    const unix = Math.floor(new Date(slot).getTime() / 1000);
    await fetch(`https://discord.com/api/v10/channels/${poll.channel_id}/messages/${poll.message_id}`, {
      method: "PATCH",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "Session locked in",
          description: `See you <t:${unix}:F>.${poll.recurring ? "\n\nThis one recurs weekly." : ""}`,
          color: 0x5dbe9a,
        }],
        components: [],
      }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, sessionId, scheduledAt: slot });
}
