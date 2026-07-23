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
// claimNote is optional and, when given, is added to the END of the last embed.
//
// WHY IT IS TEXT AND NOT A URL
//
// A claim link cannot go here. claim_character_invite matches characters.invite_code, one
// code per character, so a single message read by seven players cannot carry a link that
// works for any of them. Worse, an invite code binds the character to whoever opens it, so
// posting one publicly would let anyone in the server take it.
//
// So this points at /mypage, which replies to each player privately with their own link.
//
// It goes in a FIELD rather than appended to the description, so it cannot interact with
// the 4000 character chunking or push a long recap over the embed limit.
export async function postRecapToDiscord(
  channelId: string,
  campaignName: string,
  sessionNumber: number | null,
  recap: string,
  claimNote?: string | null,
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
      // Last embed only: the reader reaches the end of the story before being asked for
      // anything.
      if (i === parts.length - 1 && claimNote) {
        embed.fields = [{ name: "Your character", value: claimNote }];
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
