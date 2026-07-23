import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { postRecapToDiscord } from "@/lib/discord/post";

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

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("name, discord_channel_id, share_code")
      .eq("id", session.campaign_id)
      .single();

    const campaignName = campaign?.name || "Your campaign";
    const discordChannelId = campaign?.discord_channel_id || null;

    // The share code is how a player reaches their own character without an account yet.
    // Origin comes from the request so this works in preview deployments and locally
    // without another environment variable to keep in sync.
    //
    // CONFIRM THE PATH before relying on this: the repo has app/join, app/table/[code] and
    // app/x/[code], and only one of them is the front door for a player arriving cold with
    // a share code. Set RECAP_JOIN_PATH to override without editing this file.
    const shareCode = (campaign as { share_code?: string | null } | null)?.share_code || null;
    const joinPath = process.env.RECAP_JOIN_PATH || "/table";
    const joinUrl = shareCode
      ? `${new URL(request.url).origin}${joinPath}/${encodeURIComponent(shareCode)}`
      : null;

    if (!discordChannelId) {
      return NextResponse.json(
        { error: "No linked Discord channel. Run /setup in the channel you want recaps posted to." },
        { status: 400 },
      );
    }

    const posted = await postRecapToDiscord(
      discordChannelId,
      campaignName,
      session.session_number,
      session.recap,
      joinUrl,
    );

    if (!posted) {
      return NextResponse.json(
        { error: "Could not post to Discord. Check the bot is in the server and the channel is correct." },
        { status: 502 },
      );
    }

    // claimLinkIncluded is reported so a campaign with no share code is visible as such
    // rather than quietly posting a recap with no way back to the site.
    return NextResponse.json({ discordPosted: true, claimLinkIncluded: Boolean(joinUrl) });
  } catch {
    return NextResponse.json({ error: "Could not post recap to Discord." }, { status: 500 });
  }
}
