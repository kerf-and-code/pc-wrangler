const DISCORD_API = "https://discord.com/api/v10";
const MAX_DESC = 4000; // Discord embed description hard limit is 4096; leave headroom.
const BRASS = 0xc8a24b;

function chunkRecap(text: string, size: number): string[] {
  const paras = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    const candidate = cur ? `${cur}\n\n${p}` : p;
    if (candidate.length > size && cur) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = candidate;
    }
    while (cur.length > size) {
      chunks.push(cur.slice(0, size));
      cur = cur.slice(size);
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// Posts a recap into a Discord channel as one or more themed embeds.
// Returns true if every message posted, false on any failure or missing config.
//
// joinUrl is optional and, when given, adds a claim link to the END of the last embed.
//
// WHY IT IS WORTH THE FIVE LINES
//
// 25 of 53 active player characters are linked in Discord and have no web account. They
// are at the table every week, their voice is attributed, their rolls resolve, and not one
// of them can open a single page on the site. Everything player-facing that gets built
// reaches nobody until that changes.
//
// A recap they have just finished reading is the highest-intent moment they will ever be
// in, and right now the message simply ends. This is the only realistic path from Discord
// to an account: they sign up because they want to read more, not because they were asked.
//
// It goes in a FIELD rather than appended to the description, so it cannot interact with
// the 4000 character chunking and cannot push a long recap over the embed limit.
export async function postRecapToDiscord(
  channelId: string,
  campaignName: string,
  sessionNumber: number | null,
  recap: string,
  joinUrl?: string | null,
): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !channelId) return false;

  const body = recap.trim();
  if (!body) return false;

  const title = sessionNumber != null
    ? `Previously on ${campaignName} \u2014 Session ${sessionNumber}`
    : `Previously on ${campaignName}`;

  const parts = chunkRecap(body, MAX_DESC);
  if (!parts.length) return false;

  try {
    for (let i = 0; i < parts.length; i++) {
      const embed: Record<string, unknown> = { description: parts[i], color: BRASS };
      if (i === 0) embed.title = title;
      // Last embed only: the reader has reached the end of the story before being asked
      // for anything. Markdown links render in embed field values.
      if (i === parts.length - 1 && joinUrl) {
        embed.fields = [{
          name: "Your character",
          value: `[Claim your character](${joinUrl}) to read the full transcript, your own moments, and the party codex.`,
        }];
      }
      const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      });
      if (!res.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}
