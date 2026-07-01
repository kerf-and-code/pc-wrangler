// One-time (re-runnable) registration of Six Axes slash commands with Discord.
//
// Run from the repo root with env vars set:
//   DISCORD_APP_ID=...  DISCORD_BOT_TOKEN=...  node scripts/register-discord-commands.mjs
//
// For instant registration to a single test server (global takes up to ~1h to
// propagate), also set DISCORD_TEST_GUILD_ID=<your server id>.
//
// This PUTs the full command set, so re-running it updates/replaces cleanly.

const APP_ID = process.env.DISCORD_APP_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const TEST_GUILD = process.env.DISCORD_TEST_GUILD_ID;

if (!APP_ID || !TOKEN) {
  console.error("Set DISCORD_APP_ID and DISCORD_BOT_TOKEN before running.");
  process.exit(1);
}

const CODE_OPTION_REQUIRED = {
  name: "code",
  description: "Your campaign share code from the app.",
  type: 3, // STRING
  required: true,
};

const CODE_OPTION_OPTIONAL = {
  name: "code",
  description: "Campaign share code (optional if run in the campaign's channel).",
  type: 3, // STRING
  required: false,
};

const commands = [
  {
    name: "setup",
    description: "Link this channel to your Six Axes campaign so recaps post here.",
    options: [CODE_OPTION_REQUIRED],
  },
  {
    name: "claim",
    description: "Link your Discord account to your character in this campaign.",
    options: [CODE_OPTION_OPTIONAL],
  },
  {
    name: "session",
    description: "Post the next scheduled session with RSVP buttons.",
    options: [CODE_OPTION_OPTIONAL],
  },
];

const url = TEST_GUILD
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${TEST_GUILD}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const res = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify(commands),
});

if (res.ok) {
  const scope = TEST_GUILD ? `guild ${TEST_GUILD} (instant)` : "globally (up to ~1h to appear)";
  console.log(`Registered ${commands.length} command(s) ${scope}.`);
} else {
  console.error("Registration failed:", res.status, await res.text());
  process.exit(1);
}
