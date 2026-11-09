// lib/addons/discord.ts (2026-11-09)
//
// Phase 6c: webhooks straight into a Discord channel. A Discord webhook address does not take Six Axes'
// JSON (it wants a message to post), so the sender writes one: who rolled what, whose turn it is, a
// fight starting or ending. Mentions are switched off, so a line of chat can never ping @everyone or a
// role. Discord does not check signatures; the headers are sent anyway and ignored.

const HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

/** Whether an address is a Discord channel webhook (discord.com/api/webhooks/<id>/<token>). */
export function isDiscordWebhook(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && HOSTS.has(u.hostname.toLowerCase()) && /^\/api(\/v\d+)?\/webhooks\/\d+\/[\w-]+\/?$/.test(u.pathname);
  } catch { return false; }
}

type Data = {
  who?: string; kind?: string; text?: string; secret?: boolean; addon?: string | null;
  roll?: { label?: string | null; notation?: string | null; total?: number | null; natural?: number | null; table?: { name?: string; result?: string } | null };
  round?: number; current?: { name?: string; kind?: string } | null; state?: string; name?: string; message?: string;
};

// Discord reads * _ ~ ` | > as formatting; names and chat are shown as typed.
const plain = (s: unknown) => String(s ?? "").replace(/([\\*_~`|>])/g, "\\$1").replace(/@/g, "@\u200b");

/** The Discord message for one table event, or null for events with nothing to say. */
export function discordMessage(event: string, campaignName: string, d: Data): { username: string; content: string; allowed_mentions: { parse: string[] } } | null {
  let content: string | null = null;
  const who = plain(d.who || "Someone"), via = d.addon ? ` (via ${plain(d.addon)})` : "", secret = d.secret ? " (GM only)" : "";
  if (event === "roll" && d.roll) {
    const r = d.roll;
    if (r.table) content = `**${who}** rolls on ${plain(r.table.name)}: **${plain(r.table.result)}**${r.total != null ? ` (${r.total})` : ""}${secret}${via}`;
    else {
      const detail = [r.notation ? plain(r.notation) : null, r.natural != null && /d20/i.test(r.notation ?? "") ? `rolled ${r.natural}` : null].filter(Boolean).join(", ");
      content = `**${who}** rolls ${r.label ? `${plain(r.label)}: ` : ""}**${r.total ?? "?"}**${detail ? ` (${detail})` : ""}${r.natural === 20 && /d20/i.test(r.notation ?? "") ? ". Natural 20!" : ""}${secret}${via}`;
    }
  } else if (event === "chat") {
    content = d.kind === "emote" ? `*${who} ${plain(d.text)}*${via}` : `**${who}:** ${plain(d.text)}${via}`;
  } else if (event === "turn") {
    content = d.current?.name ? `Round ${d.round ?? 1}: **${plain(d.current.name)}**'s turn` : `Round ${d.round ?? 1}: the next turn`;
  } else if (event === "combat") {
    content = d.state === "started" ? `The fight **${plain(d.name || "Combat")}** begins.` : `The fight **${plain(d.name || "Combat")}** is over.`;
  } else if (event === "ping") {
    content = `Six Axes is connected: this channel will get ${plain(campaignName)}'s table events.`;
  }
  if (!content) return null;
  return { username: `Six Axes: ${campaignName}`.slice(0, 80), content: content.slice(0, 2000), allowed_mentions: { parse: [] } };
}
