import { NextResponse } from "next/server";
import { createPublicKey, verify as edVerify } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Discord interaction types
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
// Discord response (callback) types
const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const UPDATE_MESSAGE = 7;
const EPHEMERAL = 64;
// Component types
const ACTION_ROW = 1;
const BUTTON = 2;
const STRING_SELECT = 3;
// Button styles
const STYLE_SUCCESS = 3;
const STYLE_SECONDARY = 2;
const STYLE_DANGER = 4;

const BRASS = 0xc8a24b;

// Discord permission bits
const ADMINISTRATOR = BigInt(1) << BigInt(3);
const MANAGE_GUILD = BigInt(1) << BigInt(5);

// SPKI DER prefix for a raw 32-byte Ed25519 public key.
const DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

interface InteractionOption { name: string; value?: unknown }
interface InteractionData {
  name?: string;
  options?: InteractionOption[];
  custom_id?: string;
  values?: string[];
}
interface Interaction {
  type: number;
  data?: InteractionData;
  guild_id?: string;
  channel_id?: string;
  channel?: { id?: string };
  member?: { permissions?: string; user?: { id?: string } };
  user?: { id?: string };
}

function verifySignature(rawBody: string, signature: string | null, timestamp: string | null): boolean {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey || !signature || !timestamp) return false;
  try {
    const der = Buffer.concat([DER_PREFIX, Buffer.from(publicKey, "hex")]);
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return edVerify(null, Buffer.from(timestamp + rawBody, "utf8"), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

function ephemeral(content: string) {
  return NextResponse.json({ type: CHANNEL_MESSAGE_WITH_SOURCE, data: { content, flags: EPHEMERAL } });
}

function updateMessage(content: string) {
  return NextResponse.json({ type: UPDATE_MESSAGE, data: { content, components: [] } });
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false } },
  );
}

function discordUserId(interaction: Interaction): string {
  return interaction.member?.user?.id ?? interaction.user?.id ?? "";
}

function channelId(interaction: Interaction): string | null {
  return interaction.channel_id ?? interaction.channel?.id ?? null;
}

function isManager(interaction: Interaction): boolean {
  let perms = BigInt(0);
  try { perms = BigInt(interaction.member?.permissions ?? "0"); } catch { perms = BigInt(0); }
  return (perms & ADMINISTRATOR) !== BigInt(0) || (perms & MANAGE_GUILD) !== BigInt(0);
}

function optionValue(interaction: Interaction, name: string): string {
  return String(interaction.data?.options?.find((o) => o.name === name)?.value ?? "").trim();
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");

  if (!verifySignature(rawBody, signature, timestamp)) {
    return new NextResponse("invalid request signature", { status: 401 });
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(rawBody) as Interaction;
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  if (interaction.type === PING) {
    return NextResponse.json({ type: PONG });
  }

  if (interaction.type === APPLICATION_COMMAND) {
    const name = interaction.data?.name;
    if (name === "setup") return await handleSetup(interaction);
    if (name === "claim") return await handleClaim(interaction);
    if (name === "unclaim") return await handleUnclaim(interaction);
    if (name === "session") return await handleSession(interaction);
    if (name === "record") return await handleRecord(interaction);
    if (name === "stop") return await handleStop(interaction);
    return ephemeral("Unknown command.");
  }

  if (interaction.type === MESSAGE_COMPONENT) {
    const cid = interaction.data?.custom_id ?? "";
    if (cid.startsWith("claim:")) return await handleClaimSelect(interaction);
    if (cid.startsWith("rsvp:")) return await handleRsvpButton(interaction);
    if (cid.startsWith("consent:")) return await handleConsentButton(interaction);
    return ephemeral("Unknown action.");
  }

  return NextResponse.json({ type: PONG });
}

// Resolve the campaign for a command: explicit share code, else the linked channel.
async function resolveCampaign(interaction: Interaction, sb: ReturnType<typeof serviceClient>) {
  const code = (optionValue(interaction, "code") ?? "").trim().toLowerCase() || null;
  const chan = channelId(interaction);
  if (code) {
    const { data } = await sb.from("campaigns").select("id, name").eq("share_code", code).single();
    return data;
  }
  if (chan) {
    const { data } = await sb.from("campaigns").select("id, name").eq("discord_channel_id", chan).single();
    return data;
  }
  return null;
}

async function handleSetup(interaction: Interaction) {
  const guildId = interaction.guild_id ?? null;
  if (!guildId) {
    return ephemeral("Run /setup inside the server channel where you want recaps posted.");
  }
  if (!isManager(interaction)) {
    return ephemeral("You need the Manage Server permission to link recaps to this channel.");
  }

  const code = (optionValue(interaction, "code") ?? "").trim().toLowerCase();
  if (!code) {
    return ephemeral("Usage: /setup code:<your campaign share code>");
  }

  const chan = channelId(interaction);
  if (!chan) {
    return ephemeral("Could not read the channel. Run /setup directly in the target channel.");
  }

  const sb = serviceClient();
  const { data: campaign, error } = await sb
    .from("campaigns").select("id, name").eq("share_code", code).single();
  if (error || !campaign) {
    return ephemeral("No campaign found for that share code. Double-check the code from your app.");
  }

  const { error: upErr } = await sb
    .from("campaigns")
    .update({ discord_guild_id: guildId, discord_channel_id: chan })
    .eq("id", campaign.id);
  if (upErr) {
    return ephemeral("Could not save the channel link. Try again in a moment.");
  }

  return ephemeral(`Linked. Recaps for "${campaign.name}" will now post in this channel.`);
}

async function handleClaim(interaction: Interaction) {
  const sb = serviceClient();
  const campaign = await resolveCampaign(interaction, sb);
  if (!campaign) {
    return ephemeral("Run /claim in your campaign's channel, or add code:<your share code>.");
  }

  const { data: roster } = await sb
    .from("characters")
    .select("id, name")
    .eq("campaign_id", campaign.id)
    .eq("kind", "pc")
    .eq("active", true)
    .order("name")
    .limit(25);
  if (!roster || !roster.length) {
    return ephemeral("No player characters in this campaign yet. Ask your GM to add the roster.");
  }

  const options = roster.map((c: { id: string; name: string | null }) => ({
    label: (c.name || "Unnamed").slice(0, 100),
    value: c.id,
  }));

  return NextResponse.json({
    type: CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      flags: EPHEMERAL,
      content: `Which character are you in "${campaign.name}"?`,
      components: [
        {
          type: ACTION_ROW,
          components: [
            { type: STRING_SELECT, custom_id: `claim:${campaign.id}`, placeholder: "Pick your character", options },
          ],
        },
      ],
    },
  });
}

async function handleClaimSelect(interaction: Interaction) {
  const cid = interaction.data?.custom_id ?? "";
  const campaignId = cid.startsWith("claim:") ? cid.slice("claim:".length) : "";
  const characterId = interaction.data?.values?.[0] ?? "";
  const userId = discordUserId(interaction);
  if (!campaignId || !characterId || !userId) {
    return updateMessage("Something went wrong reading your selection. Try /claim again.");
  }

  const sb = serviceClient();
  const { data: character, error } = await sb
    .from("characters")
    .select("id, name, discord_user_id")
    .eq("id", characterId)
    .eq("campaign_id", campaignId)
    .single();
  if (error || !character) {
    return updateMessage("That character is not part of this campaign anymore.");
  }
  if (character.discord_user_id && character.discord_user_id !== userId) {
    return updateMessage(`"${character.name}" is already linked to someone else. Ask your GM if that's wrong.`);
  }

  await sb.from("characters").update({ discord_user_id: null })
    .eq("campaign_id", campaignId).eq("discord_user_id", userId).neq("id", characterId);

  const { error: upErr } = await sb.from("characters")
    .update({ discord_user_id: userId }).eq("id", characterId);
  if (upErr) {
    return updateMessage("Could not save your link. Try again in a moment.");
  }

  return updateMessage(`Linked. You're playing "${character.name}". Recaps and voice will attribute to you.`);
}

async function handleUnclaim(interaction: Interaction) {
  const sb = serviceClient();
  const campaign = await resolveCampaign(interaction, sb);
  if (!campaign) {
    return ephemeral("Run /unclaim in your campaign's channel, or add code:<your share code>.");
  }

  const userId = discordUserId(interaction);
  if (!userId) {
    return ephemeral("Could not read your Discord account. Try again.");
  }

  // One character per user per campaign is enforced at claim time, but match on
  // discord_user_id so this always frees whatever the caller is linked to.
  const { data: claimed } = await sb
    .from("characters")
    .select("id, name")
    .eq("campaign_id", campaign.id)
    .eq("discord_user_id", userId);
  if (!claimed || !claimed.length) {
    return ephemeral(`You don't have a character linked in "${campaign.name}". Nothing to unclaim.`);
  }

  const { error: upErr } = await sb
    .from("characters")
    .update({ discord_user_id: null })
    .eq("campaign_id", campaign.id)
    .eq("discord_user_id", userId);
  if (upErr) {
    return ephemeral("Could not unlink you right now. Try again in a moment.");
  }

  const names = claimed.map((c: { id: string; name: string | null }) => c.name || "Unnamed").join(", ");
  const it = claimed.length > 1 ? "them" : "it";
  return ephemeral(`Unlinked you from ${names}. Anyone can /claim ${it} now.`);
}

async function handleSession(interaction: Interaction) {
  if (!interaction.guild_id) {
    return ephemeral("Run /session in your campaign's channel.");
  }
  if (!isManager(interaction)) {
    return ephemeral("You need the Manage Server permission to post the session RSVP.");
  }

  const sb = serviceClient();
  const campaign = await resolveCampaign(interaction, sb);
  if (!campaign) {
    return ephemeral("Run /session in your campaign's channel, or add code:<your share code>.");
  }

  const { data: sess } = await sb
    .from("sessions")
    .select("id, session_number, scheduled_at")
    .eq("campaign_id", campaign.id)
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!sess || !sess.scheduled_at) {
    return ephemeral("No upcoming session is scheduled. Set a time in the app first.");
  }

  const unix = Math.floor(new Date(sess.scheduled_at).getTime() / 1000);
  const heading = sess.session_number != null ? `Session ${sess.session_number}` : "Next session";
  const title = `${campaign.name}: ${heading}`.slice(0, 256);

  return NextResponse.json({
    type: CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [
        {
          title,
          description: `When: <t:${unix}:F> (<t:${unix}:R>)\n\nTap below to RSVP.`,
          color: BRASS,
        },
      ],
      components: [
        {
          type: ACTION_ROW,
          components: [
            { type: BUTTON, style: STYLE_SUCCESS, label: "Going", custom_id: `rsvp:${sess.id}:going` },
            { type: BUTTON, style: STYLE_SECONDARY, label: "Maybe", custom_id: `rsvp:${sess.id}:maybe` },
            { type: BUTTON, style: STYLE_DANGER, label: "Can't", custom_id: `rsvp:${sess.id}:declined` },
          ],
        },
      ],
    },
  });
}

async function handleRsvpButton(interaction: Interaction) {
  const cid = interaction.data?.custom_id ?? "";
  const parts = cid.split(":");
  const sessionId = parts[1] ?? "";
  const status = parts[2] ?? "";
  const userId = discordUserId(interaction);
  const valid = status === "going" || status === "maybe" || status === "declined";
  if (!sessionId || !valid || !userId) {
    return ephemeral("Something went wrong with that RSVP. Try again.");
  }

  const sb = serviceClient();
  const { data: session } = await sb
    .from("sessions").select("id, campaign_id").eq("id", sessionId).maybeSingle();
  if (!session) {
    return ephemeral("That session no longer exists.");
  }

  const { data: character } = await sb
    .from("characters")
    .select("id, name, profile_id")
    .eq("campaign_id", session.campaign_id)
    .eq("discord_user_id", userId)
    .eq("kind", "pc")
    .eq("active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!character) {
    return ephemeral("Link your character first with /claim in this channel, then tap again.");
  }

  const { data: existing } = await sb
    .from("attendance")
    .select("id")
    .eq("session_id", sessionId)
    .eq("character_id", character.id)
    .maybeSingle();

  if (existing) {
    await sb.from("attendance")
      .update({ status, campaign_id: session.campaign_id }).eq("id", existing.id);
  } else {
    await sb.from("attendance").insert({
      campaign_id: session.campaign_id,
      session_id: sessionId,
      profile_id: character.profile_id,
      status,
      character_id: character.id,
    });
  }

  const label = status === "going" ? "Going" : status === "maybe" ? "Maybe" : "Can't make it";
  return ephemeral(`Got it, you're marked **${label}** as ${character.name}.`);
}

async function handleRecord(interaction: Interaction) {
  if (!interaction.guild_id) {
    return ephemeral("Run /record in your campaign's channel while you're in a voice channel.");
  }
  if (!isManager(interaction)) {
    return ephemeral("You need the Manage Server permission to start recording.");
  }

  const sb = serviceClient();
  const campaign = await resolveCampaign(interaction, sb);
  if (!campaign) {
    return ephemeral("Run /record in your campaign's channel, or add code:<your share code>.");
  }

  // Don't double-start.
  const { data: running } = await sb
    .from("capture_control")
    .select("id")
    .eq("campaign_id", campaign.id)
    .in("status", ["requested", "active"])
    .limit(1)
    .maybeSingle();
  if (running) {
    return ephemeral("A recording is already requested or running for this campaign. Use /stop first.");
  }

  // Auto-link the requester as the campaign narrator, so their own voice is
  // captured as GM narration with no separate setup step. Fills in only if they
  // haven't already linked (via a prior /record or the Narrator voice card).
  const requesterId = discordUserId(interaction);
  if (requesterId) {
    const { data: gm } = await sb
      .from("gm_identities")
      .select("id")
      .eq("campaign_id", campaign.id)
      .eq("discord_user_id", requesterId)
      .maybeSingle();
    if (!gm) {
      await sb.from("gm_identities").insert({
        campaign_id: campaign.id,
        discord_user_id: requesterId,
        display_name: "the GM",
      });
    }
  }

  // Pick the session to record into. An explicit session:<n> records into that
  // exact session (reused if it exists, opened if it doesn't), which is how you
  // recover from a false start without inflating the count. With no option, reuse
  // the open session if there is one, else open the next number automatically.
  const sessionOpt = optionValue(interaction, "session");
  let sess: { id: string; session_number: number | null } | null = null;

  if (sessionOpt) {
    const n = parseInt(sessionOpt, 10);
    if (!Number.isFinite(n) || n < 1) {
      return ephemeral("Session must be a positive number, like session:2.");
    }
    const { data: found } = await sb
      .from("sessions")
      .select("id, session_number")
      .eq("campaign_id", campaign.id)
      .eq("session_number", n)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (found) {
      sess = found as { id: string; session_number: number | null };
    } else {
      const { data: created, error: sErr } = await sb
        .from("sessions")
        .insert({ campaign_id: campaign.id, session_number: n, started_at: new Date().toISOString() })
        .select("id, session_number")
        .single();
      if (sErr || !created) {
        return ephemeral(`Could not open session ${n}. Try again, or start it in the app.`);
      }
      sess = created as { id: string; session_number: number | null };
    }
  } else {
    sess = (await sb
      .from("sessions")
      .select("id, session_number")
      .eq("campaign_id", campaign.id)
      .is("ended_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()).data as { id: string; session_number: number | null } | null;

    if (!sess) {
      const { data: last } = await sb
        .from("sessions")
        .select("session_number")
        .eq("campaign_id", campaign.id)
        .order("session_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextNo = ((last as { session_number: number | null } | null)?.session_number ?? 0) + 1;
      const { data: created, error: sErr } = await sb
        .from("sessions")
        .insert({ campaign_id: campaign.id, session_number: nextNo, started_at: new Date().toISOString() })
        .select("id, session_number")
        .single();
      if (sErr || !created) {
        return ephemeral("Could not open a session automatically. Start one in the app, then run /record again.");
      }
      sess = created as { id: string; session_number: number | null };
    }
  }

  const { error } = await sb.from("capture_control").insert({
    campaign_id: campaign.id,
    session_id: sess.id,
    guild_id: interaction.guild_id,
    requested_by_discord_id: requesterId,
    status: "requested",
  });
  if (error) {
    return ephemeral("Could not start the recording request. Try again in a moment.");
  }

  const heading = sess.session_number != null ? `Session ${sess.session_number}` : "this session";
  return NextResponse.json({
    type: CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [
        {
          title: `Recording ${heading} \u2014 ${campaign.name}`.slice(0, 256),
          description:
            "Six Axes will capture each speaker's audio to help your GM build recaps and table analytics. " +
            "Tap **I consent** to log your agreement to be recorded. If you don't consent, please leave the voice " +
            "channel. You can ask your GM to delete the recording at any time.",
          color: BRASS,
        },
      ],
      components: [
        {
          type: ACTION_ROW,
          components: [
            { type: BUTTON, style: STYLE_SUCCESS, label: "I consent", custom_id: `consent:${sess.id}` },
          ],
        },
      ],
    },
  });
}

async function handleStop(interaction: Interaction) {
  if (!interaction.guild_id) {
    return ephemeral("Run /stop in your campaign's channel.");
  }
  if (!isManager(interaction)) {
    return ephemeral("You need the Manage Server permission to stop recording.");
  }

  const sb = serviceClient();
  const campaign = await resolveCampaign(interaction, sb);
  if (!campaign) {
    return ephemeral("Run /stop in your campaign's channel, or add code:<your share code>.");
  }

  const { data: active } = await sb
    .from("capture_control")
    .select("id")
    .eq("campaign_id", campaign.id)
    .in("status", ["requested", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!active) {
    return ephemeral("Nothing is recording for this campaign right now.");
  }

  await sb.from("capture_control")
    .update({ status: "stopping", updated_at: new Date().toISOString() })
    .eq("id", active.id);

  return ephemeral("Stopping the recording. The bot will finish up and process the audio.");
}

async function handleConsentButton(interaction: Interaction) {
  const cid = interaction.data?.custom_id ?? "";
  const sessionId = cid.startsWith("consent:") ? cid.slice("consent:".length) : "";
  const userId = discordUserId(interaction);
  if (!sessionId || !userId) {
    return ephemeral("Something went wrong logging your consent. Try again.");
  }

  const sb = serviceClient();
  const { data: session } = await sb
    .from("sessions").select("id, campaign_id").eq("id", sessionId).maybeSingle();
  if (!session) {
    return ephemeral("That session no longer exists.");
  }

  const { data: character } = await sb
    .from("characters")
    .select("id, name, profile_id")
    .eq("campaign_id", session.campaign_id)
    .eq("discord_user_id", userId)
    .eq("kind", "pc")
    .eq("active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!character) {
    return ephemeral("Link your character first with /claim, then tap I consent.");
  }

  const { data: existing } = await sb
    .from("recording_consents")
    .select("id")
    .eq("session_id", sessionId)
    .eq("character_id", character.id)
    .maybeSingle();

  if (existing) {
    await sb.from("recording_consents")
      .update({
        consented: true,
        method: "discord_button",
        profile_id: character.profile_id,
        campaign_id: session.campaign_id,
      })
      .eq("id", existing.id);
  } else {
    await sb.from("recording_consents").insert({
      campaign_id: session.campaign_id,
      session_id: sessionId,
      character_id: character.id,
      profile_id: character.profile_id,
      consented: true,
      method: "discord_button",
    });
  }

  return ephemeral(`Thanks, ${character.name}. Your consent to be recorded is logged.`);
}
