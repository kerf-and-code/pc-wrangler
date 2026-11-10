import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { postOrUpdateRecap, type RecapPost } from "@/lib/discord/post";

export const maxDuration = 30;

// Posts a session's saved recap to the campaign's linked Discord channel.
//
// Discord-only by design: it does not touch email, so it does not depend on
// RESEND_API_KEY. Email has its own route (/api/recap/send). This split is the
// fix for the pilot finding that a single combined share button confused GMs.
//
// The draft is shared, not duplicated: both buttons read sessions.recap, and the
// sessions page saves the textarea before calling either one. So whatever the GM
// sees on screen is exactly what goes out, to either destination.
//
// Nothing posts without a GM click.
//
// 2026-11-09: the caller must be the campaign's GM (checked here, not left to RLS), and the post ends
// with the campaign's recap page, where players read every recap without signing in.
//
// Push 1 (audit P10): posting again after an edit updates the messages already in Discord instead of
// posting the recap twice (their ids live in sessions.discord_recap_post, p138).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = body?.sessionId;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    }

    // RLS ensures the user can only read a session they own.
    const { data: session, error: sErr } = await supabase
      .from("sessions")
      .select("id, campaign_id, session_number, recap")
      .eq("id", sessionId)
      .single();
    if (sErr || !session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
    if (!session.recap || !session.recap.trim()) {
      return NextResponse.json({ error: "Save a recap before posting." }, { status: 422 });
    }

    const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: session.campaign_id });
    if (!isGm) {
      return NextResponse.json({ error: "Only the campaign's GM posts recaps." }, { status: 403 });
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("name, discord_channel_id, share_code")
      .eq("id", session.campaign_id)
      .single();

    const campaignName = campaign?.name || "Your campaign";
    const discordChannelId = campaign?.discord_channel_id || null;

    if (!discordChannelId) {
      return NextResponse.json(
        { error: "No linked Discord channel. Run /setup in the channel you want recaps posted to." },
        { status: 400 },
      );
    }

    // Points at the command rather than carrying a link, because an invite code is per
    // character and this message is read by the whole table. /mypage answers each player
    // privately with their own.
    // The campaign's recap page goes first: one link for the whole table, no sign-in needed.
    const recapLink = campaign?.share_code
      ? `${new URL(request.url).origin}/recaps?share=${encodeURIComponent(campaign.share_code)}`
      : null;
    const claimNote =
      "Run `/mypage` in this server to open your character on the web: the full session " +
      "transcript, your own moments, and the party codex.";

    // Where this recap was posted before, if anywhere. Read separately so a database without p138 still
    // posts (it just cannot update).
    const admin = createAdminClient();
    const { data: prevRow } = await admin.from("sessions").select("discord_recap_post").eq("id", session.id).maybeSingle();
    const previous = ((prevRow as { discord_recap_post?: RecapPost | null } | null)?.discord_recap_post) ?? null;

    const result = await postOrUpdateRecap(
      discordChannelId,
      campaignName,
      session.session_number,
      session.recap,
      claimNote,
      recapLink,
      previous && Array.isArray(previous.ids) ? previous : null,
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: "Could not post to Discord. Check the bot is in the server and the channel is correct." },
        { status: 502 },
      );
    }

    if (result.post) {
      const { error: saveErr } = await admin.from("sessions").update({ discord_recap_post: result.post }).eq("id", session.id);
      if (saveErr) console.error("recap/post-discord: could not store the message ids (has p138 run?)", saveErr.message);
    }
    return NextResponse.json({ discordPosted: true, updated: result.updated });
  } catch {
    return NextResponse.json({ error: "Could not post recap to Discord." }, { status: 500 });
  }
}
