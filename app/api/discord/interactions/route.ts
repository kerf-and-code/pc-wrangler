import { NextResponse } from "next/server";
import { createPublicKey, verify as edVerify } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { buildPollMessage } from "@/lib/schedule/poll-message";

// Discord interaction types
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const MODAL_SUBMIT = 5;
// Discord response (callback) types
const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const UPDATE_MESSAGE = 7;
const MODAL = 9;
const EPHEMERAL = 64;
// Component types
const ACTION_ROW = 1;
const BUTTON = 2;
const STRING_SELECT = 3;
const TEXT_INPUT = 4;
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
interface ModalComponent { type?: number; custom_id?: string; value?: string }
interface ModalRow { type?: number; components?: ModalComponent[] }
interface InteractionData {
  name?: string;
  options?: InteractionOption[];
  custom_id?: string;
  values?: string[];
  components?: ModalRow[];
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

function modalValue(interaction: Interaction, fieldId: string): string {
  for (const row of interaction.data?.components ?? []) {
    for (const comp of row.components ?? []) {
      if (comp.custom_id === fieldId) return String(comp.value ?? "").trim();
    }
  }
  return "";
}

// A modal that collects a new character's name (and optional class) so a player
// can add themselves when they aren't on the roster yet.
function claimModal(campaignId: string) {
  return NextResponse.json({
    type: MODAL,
    data: {
      custom_id: `claimnew:${campaignId}`,
      title: "Add your character",
      components: [
        { type: ACTION_ROW, components: [{ type: TEXT_INPUT, custom_id: "name", label: "Character name", style: 1, required: true, max_length: 80 }] },
        { type: ACTION_ROW, components: [{ type: TEXT_INPUT, custom_id: "class", label: "Class (optional)", style: 1, required: false, max_length: 60 }] },
      ],
    },
  });
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
    if (name === "retire") return await handleRetire(interaction);
    if (name === "session") return await handleSession(interaction);
    if (name === "record") return await handleRecord(interaction);
    if (name === "stop") return await handleStop(interaction);
    return ephemeral("Unknown command.");
  }

  if (interaction.type === MESSAGE_COMPONENT) {
    const cid = interaction.data?.custom_id ?? "";
    if (cid.startsWith("claim:")) return await handleClaimSelect(interaction);
    if (cid.startsWith("retire:")) return await handleRetireSelect(interaction);
    if (cid.startsWith("rsvp:")) return await handleRsvpButton(interaction);
    if (cid.startsWith("consent:")) return await handleConsentButton(interaction);
    if (cid.startsWith("sched:")) return await handleSchedButton(interaction);
    return ephemeral("Unknown action.");
  }

  if (interaction.type === MODAL_SUBMIT) {
    const cid = interaction.data?.custom_id ?? "";
    if (cid.startsWith("claimnew:")) return await handleClaimModal(interaction);
    return ephemeral("Unknown submission.");
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


// Absolute base for links we put in Discord messages. Mirrors the pattern in
// app/api/transcribe/callback/route.ts. Discord renders a bare path as plain text, so
// the disclosure link has to be absolute or it is not a link at all.
function siteBase(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.TRANSCRIBE_CALLBACK_BASE ||
    "https://pc-wrangler.vercel.app"
  ).replace(/\/$/, "");
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
    .limit(24);
  // No roster yet: let the player add their own character straight away.
  if (!roster || !roster.length) {
    return claimModal(campaign.id);
  }

  const options = roster.map((c: { id: string; name: string | null }) => ({
    label: (c.name || "Unnamed").slice(0, 100),
    value: c.id,
  }));
  options.push({ label: "My character isn't listed\u2026", value: "__new__" });

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
  if (characterId === "__new__") {
    return campaignId ? claimModal(campaignId) : updateMessage("Something went wrong. Try /claim again.");
  }
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

  return NextResponse.json({
    type: UPDATE_MESSAGE,
    data: {
      content:
        `Linked \u2014 you're playing "${character.name}". Recaps and voice will attribute to you.\n\n` +
        "One thing before you play: this campaign records its sessions so your GM can build recaps and table analytics.\n\n" +
        // The 60-day deletion is the strongest thing we can tell someone whose voice we
        // are about to record, and it was nowhere near the moment they actually consent.
        // Consent given without the material facts is not informed consent, it is a
        // button press.
        "\u2022 Your audio is **deleted automatically 60 days after recording**. The transcript stays; the recording does not.\n" +
        "\u2022 You can opt out any time by asking your GM, and they can exclude you from any session.\n" +
        `\u2022 Full details: ${siteBase()}/ai-recording\n\n` +
        "Tap **I consent** to agree to be recorded for this campaign.",
      components: [
        {
          type: ACTION_ROW,
          components: [
            { type: BUTTON, style: STYLE_SUCCESS, label: "I consent", custom_id: `consent:${campaignId}` },
          ],
        },
      ],
    },
  });
}

async function handleClaimModal(interaction: Interaction) {
  const cid = interaction.data?.custom_id ?? "";
  const campaignId = cid.startsWith("claimnew:") ? cid.slice("claimnew:".length) : "";
  const userId = discordUserId(interaction);
  const name = modalValue(interaction, "name");
  const klass = modalValue(interaction, "class");
  if (!campaignId || !userId) {
    return ephemeral("Something went wrong. Try /claim again.");
  }
  if (!name) {
    return ephemeral("A character name is required. Run /claim and try again.");
  }

  const sb = serviceClient();
  const { data: campaign } = await sb.from("campaigns").select("id, name").eq("id", campaignId).maybeSingle();
  if (!campaign) {
    return ephemeral("That campaign no longer exists.");
  }

  // One character per user per campaign: drop any existing claim first.
  await sb.from("characters").update({ discord_user_id: null })
    .eq("campaign_id", campaignId).eq("discord_user_id", userId);

  const { data: created, error } = await sb.from("characters").insert({
    campaign_id: campaignId,
    kind: "pc",
    name,
    class: klass || null,
    active: true,
    visibility: "player",
    discord_user_id: userId,
  }).select("id, name").single();
  if (error || !created) {
    return ephemeral("Could not add your character. Ask your GM to add you to the roster.");
  }

  return ephemeral(`Added and linked. You're playing "${created.name}". Recaps and voice will attribute to you.`);
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

// GM only: take a character off the active roster.
//
// WHY THIS IS NOT /unclaim
//
// /unclaim is a PLAYER action and clears discord_user_id: it frees the character so
// someone else can claim it, while the character itself stays in the campaign. When a
// player leaves the group that is not enough, because the character remains active and
// keeps appearing in the /claim picker, on the roster, and in any consent or attendance
// check. And a player who has already left will never run /unclaim themselves, which is
// the whole reason this exists.
//
// WHAT IT CHANGES, AND WHAT IT DELIBERATELY DOES NOT
//
//   active = false            removes them from the roster and every picker
//   discord_user_id = null    frees the Discord link, same as /unclaim
//
//   profile_id                LEFT ALONE. That is the web-account link, and clearing it
//                             would orphan the character's contribution to player-level
//                             pooling in the disposition model. Retiring a character
//                             should not rewrite the history of the sessions they played.
//   recording_consents        LEFT ALONE. Consent was given for audio already recorded,
//                             and leaving the group does not retroactively withdraw it.
//                             A player who wants their audio deleted is making a deletion
//                             request, which is a different thing.
//
// REVERSIBLE. Setting active back to true restores them; the player then re-runs /claim.
async function handleRetire(interaction: Interaction) {
  if (!interaction.guild_id) {
    return ephemeral("Run /retire in your campaign's channel.");
  }
  // default_member_permissions gates this in Discord's UI, but a server admin can
  // override that per-command, so the permission is checked here too.
  if (!isManager(interaction)) {
    return ephemeral("Only the GM can retire a character. You need the Manage Server permission.");
  }

  const sb = serviceClient();
  const campaign = await resolveCampaign(interaction, sb);
  if (!campaign) {
    return ephemeral("Run /retire in your campaign's channel, or add code:<your share code>.");
  }

  // Discord select menus allow at most 25 options.
  const { data: roster } = await sb
    .from("characters")
    .select("id, name")
    .eq("campaign_id", campaign.id)
    .eq("kind", "pc")
    .eq("active", true)
    .order("name")
    .limit(25);

  if (!roster || !roster.length) {
    return ephemeral(`No active characters in "${campaign.name}" to retire.`);
  }

  const options = roster.map((c: { id: string; name: string | null }) => ({
    label: (c.name || "Unnamed").slice(0, 100),
    value: c.id,
  }));

  return NextResponse.json({
    type: CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      flags: EPHEMERAL,
      content: `Which character should leave "${campaign.name}"? They stop appearing on the roster and in /claim. Their past sessions, transcripts, and recaps are untouched.`,
      components: [
        {
          type: ACTION_ROW,
          components: [
            { type: STRING_SELECT, custom_id: `retire:${campaign.id}`, placeholder: "Pick a character to retire", options },
          ],
        },
      ],
    },
  });
}

async function handleRetireSelect(interaction: Interaction) {
  // A component callback is a SEPARATE request and can be replayed, so the permission
  // check runs again here rather than being trusted from the command that opened the menu.
  if (!isManager(interaction)) {
    return updateMessage("Only the GM can retire a character.");
  }

  const cid = interaction.data?.custom_id ?? "";
  const campaignId = cid.startsWith("retire:") ? cid.slice("retire:".length) : "";
  const characterId = interaction.data?.values?.[0] ?? "";
  if (!campaignId || !characterId) {
    return updateMessage("Something went wrong reading your selection. Try /retire again.");
  }

  const sb = serviceClient();

  // Scoped to the campaign from the custom_id, so a replayed interaction cannot retire a
  // character belonging to some other campaign.
  const { data: character } = await sb
    .from("characters")
    .select("id, name, active")
    .eq("id", characterId)
    .eq("campaign_id", campaignId)
    .single();

  if (!character) {
    return updateMessage("That character is no longer in this campaign.");
  }
  if (!character.active) {
    return updateMessage(`${character.name || "That character"} is already retired.`);
  }

  const { error: upErr } = await sb
    .from("characters")
    .update({ active: false, discord_user_id: null })
    .eq("id", characterId)
    .eq("campaign_id", campaignId);

  if (upErr) {
    return updateMessage("Could not retire them right now. Try again in a moment.");
  }

  return updateMessage(
    `${character.name || "That character"} has left the campaign. They are off the roster and out of /claim, ` +
    "and their recorded sessions are unchanged. Reactivate them from the app if they come back.",
  );
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

// Scheduling poll: a player toggled their availability for a slot. Flip it and
// re-render the message with fresh tallies. custom_id = sched:<pollId>:<slotIdx>.
async function handleSchedButton(interaction: Interaction) {
  const cid = interaction.data?.custom_id ?? "";
  const [, pollId, slotRaw] = cid.split(":");
  const slotIdx = parseInt(slotRaw ?? "", 10);
  const userId = discordUserId(interaction);
  if (!pollId || !Number.isFinite(slotIdx) || !userId) return updateMessage("Something went wrong.");

  const sb = serviceClient();
  const { data: pollRow } = await sb
    .from("session_polls")
    .select("id, campaign_id, slots, status")
    .eq("id", pollId)
    .maybeSingle();
  const poll = pollRow as { id: string; campaign_id: string; slots: string[]; status: string } | null;
  if (!poll) return updateMessage("This poll no longer exists.");
  if (poll.status !== "open") return updateMessage("This poll is closed.");

  const { data: chRow } = await sb
    .from("characters")
    .select("id")
    .eq("campaign_id", poll.campaign_id)
    .eq("discord_user_id", userId)
    .maybeSingle();
  const characterId = (chRow as { id: string } | null)?.id ?? null;

  const { data: existingRow } = await sb
    .from("poll_responses")
    .select("id, available")
    .eq("poll_id", pollId)
    .eq("discord_user_id", userId)
    .maybeSingle();
  const existing = existingRow as { id: string; available: number[] } | null;
  const set = new Set<number>(existing?.available || []);
  if (set.has(slotIdx)) set.delete(slotIdx);
  else set.add(slotIdx);
  const available = Array.from(set).sort((a, b) => a - b);

  if (existing) {
    await sb.from("poll_responses").update({ available, character_id: characterId, updated_at: new Date().toISOString() }).eq("id", existing.id);
  } else {
    await sb.from("poll_responses").insert({ poll_id: pollId, discord_user_id: userId, character_id: characterId, available });
  }

  const { data: allResp } = await sb.from("poll_responses").select("available").eq("poll_id", pollId);
  const responses = (allResp as { available: number[] }[]) || [];
  const counts = (poll.slots || []).map((_, i) => responses.filter((r) => (r.available || []).includes(i)).length);

  const message = buildPollMessage(pollId, poll.slots, counts);
  return NextResponse.json({ type: UPDATE_MESSAGE, data: message });
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

  // Don't double-start. Guard by GUILD, not campaign: one bot per guild can hold
  // one voice channel, so at most one capture may be open per guild. A campaign
  // scoped check let a second /record that resolved to a different campaign in the
  // same guild start a competing recording (and, mid-reconnect, in whatever channel
  // the requester happened to be sitting in). 'stopping' counts as open too, since
  // the sidecar is still finalizing. Fail CLOSED if the check itself errors.
  const { data: running, error: guardErr } = await sb
    .from("capture_control")
    .select("id, status, session_id, heartbeat_at, updated_at")
    .eq("guild_id", interaction.guild_id)
    .in("status", ["requested", "active", "stopping"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (guardErr) {
    return ephemeral("Could not verify the current recording state. Try again in a moment.");
  }

  // ADOPT AN ORPHANED ROW RATHER THAN REFUSING.
  //
  // The guard above is right when a recording is genuinely in progress, and a trap when it
  // is not. If the sidecar dies holding a row (OOM, a Fly restart, a crash mid-finalize)
  // the row stays 'active' forever with no process behind it, and capture_control_one_open
  // _per_guild is a UNIQUE index over exactly these three statuses. So the GM is locked out
  // of /record at the DATABASE level, and the message tells them to run /stop, which under
  // the new lifecycle no longer closes anything. That is how a table loses the second half
  // of a game.
  //
  // heartbeat_at is what separates the two cases: the sidecar writes it every poll tick for
  // rows it is holding, so a fresh heartbeat means a live process owns this and a stale one
  // means nobody does. Falls back to updated_at while the sidecar half of this is still in
  // flight, which is correct-but-blunt: updated_at only moves on state TRANSITIONS, so a
  // healthy long recording looks stale by that measure. The window is therefore generous.
  const STALE_MS = 15 * 60 * 1000;
  if (running) {
    const row = running as {
      id: string; status: string; session_id: string | null;
      heartbeat_at: string | null; updated_at: string | null;
    };
    const beat = row.heartbeat_at ?? row.updated_at;
    const ageMs = beat ? Date.now() - new Date(beat).getTime() : Number.POSITIVE_INFINITY;

    if (ageMs < STALE_MS) {
      return ephemeral("Six Axes is already recording in this server. Use /stop first, then /record.");
    }

    // Orphan. Retire it so the unique index frees up, then fall through and open a fresh
    // request. Retiring rather than reusing keeps the audit trail honest: the dead capture
    // is visibly abandoned, not silently rewritten.
    const { error: adoptErr } = await sb
      .from("capture_control")
      .update({
        status: "done",
        error: "orphaned: no sidecar heartbeat, adopted by a later /record",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .in("status", ["requested", "active", "stopping"]);
    if (adoptErr) {
      return ephemeral("A previous recording is stuck and could not be cleared. Try again in a moment.");
    }
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
  // the session that is actually underway if there is one, else open the next
  // number automatically.
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
        .insert({
          campaign_id: campaign.id,
          session_number: n,
          started_at: new Date().toISOString(),
          // LIVE, not the 'scheduled' default. /record means it is being played right
          // now. chat_locked() only closes party chat when a session reads 'live', so
          // 'scheduled' left table-talk open through every recorded game.
          status: "live",
        })
        .select("id, session_number")
        .single();
      if (sErr || !created) {
        return ephemeral(`Could not open session ${n}. Try again, or start it in the app.`);
      }
      sess = created as { id: string; session_number: number | null };
    }
  } else {
    // Reuse a session that is ACTUALLY UNDERWAY, not merely one that has not ended.
    //
    // The old check was `ended_at is null` alone. A session scheduled for NEXT FRIDAY
    // also has ended_at null: it simply has not happened yet. So an impromptu game on
    // Tuesday would have recorded straight into next Friday's session, and with
    // recurring scheduling queueing several, `order by created_at desc` would pick the
    // most recently CREATED one, which need not even be the nearest.
    //
    // A session genuinely in progress has started_at set and ended_at null.
    sess = (await sb
      .from("sessions")
      .select("id, session_number")
      .eq("campaign_id", campaign.id)
      .not("started_at", "is", null)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
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
        .insert({
          campaign_id: campaign.id,
          session_number: nextNo,
          started_at: new Date().toISOString(),
          status: "live",   // see the note above: /record means it is being played now
        })
        .select("id, session_number")
        .single();
      if (sErr || !created) {
        return ephemeral("Could not open a session automatically. Start one in the app, then run /record again.");
      }
      sess = created as { id: string; session_number: number | null };
    }
  }

  // If we reused a session sitting as 'scheduled' (confirmed from a poll, then started
  // with /record rather than in the app), mark it live. It is being played, and
  // chat_locked() depends on the status saying so.
  await sb
    .from("sessions")
    .update({ status: "live" })
    .eq("id", sess.id)
    .in("status", ["scheduled"]);

  const { error } = await sb.from("capture_control").insert({
    campaign_id: campaign.id,
    session_id: sess.id,
    guild_id: interaction.guild_id,
    requested_by_discord_id: requesterId,
    status: "requested",
  });
  if (error) {
    // 23505 = unique violation on capture_control_one_open_per_guild: another
    // capture opened for this guild between the guard check above and this insert.
    // The database is the final word, so treat the race as "already recording"
    // rather than a generic failure.
    if ((error as { code?: string }).code === "23505") {
      return ephemeral("Six Axes is already recording in this server. Use /stop first, then /record.");
    }
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
            "Six Axes is capturing each speaker's audio to help your GM build recaps and table analytics. " +
            "Consent is handled when players claim their character; anyone who has opted out is excluded from this session. " +
            "Ask your GM to change opt-outs or to delete a recording at any time.",
          color: BRASS,
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
    .select("id, session_id")
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

  // /stop ENDS THE RECORDING. IT NO LONGER CLOSES THE SESSION.
  //
  // It used to do both, which was right while a stop always meant the game was over. It is
  // wrong once the bot can lose its voice connection mid-game: the GM runs /stop, /record,
  // and expects to carry on in the SAME session. Closing here made that impossible, because
  // /record only reuses a session with ended_at null, so the second /record opened a new
  // session number and split one evening across two rows and two recaps.
  //
  // Closing is now an explicit GM act on the Session Log, through /api/session/close, which
  // moves status and ended_at together and refuses while a recording is still open.
  //
  // THE COST, STATED PLAINLY. This reopens the three failure modes closing here was added
  // to fix: next week's /record reusing an unclosed session, idle D&D Beyond rolls landing
  // in a finished game through /api/vtt/ingest, and the pipeline running against a session
  // the database still calls live. All three now depend on the GM remembering to close,
  // which is why the reminder below is part of the change rather than decoration.
  return ephemeral(
    "Stopping the recording. Transcription and extraction will run on their own.\n\n" +
    "The session stays OPEN, so you can /record again to add more to it. " +
    "When the game is finished, close it on the Session Log: while it is open, party chat " +
    "stays hidden and D&D Beyond rolls keep landing in this session.",
  );
}

async function handleConsentButton(interaction: Interaction) {
  const cid = interaction.data?.custom_id ?? "";
  const campaignId = cid.startsWith("consent:") ? cid.slice("consent:".length) : "";
  const userId = discordUserId(interaction);
  if (!campaignId || !userId) {
    return ephemeral("Something went wrong logging your consent. Try again.");
  }

  const sb = serviceClient();
  const { data: character } = await sb
    .from("characters")
    .select("id, name, profile_id")
    .eq("campaign_id", campaignId)
    .eq("discord_user_id", userId)
    .eq("kind", "pc")
    .eq("active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!character) {
    return ephemeral("Link your character first with /claim, then tap I consent.");
  }

  // Standing (blanket) consent for the whole campaign: session_id is null.
  // Per-session exclusion is the GM's opt-out, not a player action.
  const { data: existing } = await sb
    .from("recording_consents")
    .select("id")
    .eq("campaign_id", campaignId)
    .is("session_id", null)
    .eq("character_id", character.id)
    .maybeSingle();

  if (existing) {
    await sb.from("recording_consents")
      .update({ consented: true, method: "discord_claim", profile_id: character.profile_id })
      .eq("id", existing.id);
  } else {
    await sb.from("recording_consents").insert({
      campaign_id: campaignId,
      session_id: null,
      character_id: character.id,
      profile_id: character.profile_id,
      consented: true,
      method: "discord_claim",
    });
  }

  return ephemeral(`Thanks, ${character.name}. You consent to be recorded for this campaign. You can opt out any time through your GM.`);
}