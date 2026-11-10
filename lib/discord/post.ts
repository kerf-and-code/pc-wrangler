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
//
// recapLink (2026-11-09) is the campaign's recap page (/recaps?share=...). Unlike a claim link it is
// one link for the whole table and binds nothing, so it is safe in a public channel; it gets its own
// field, before the claim note.
export async function postRecapToDiscord(
  channelId: string,
  campaignName: string,
  sessionNumber: number | null,
  recap: string,
  claimNote?: string | null,
  recapLink?: string | null,
): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !channelId) return false;

  const body = recap.trim();
  if (!body) return false;

  const title = sessionNumber != null
    ? `Previously on ${campaignName}, Session ${sessionNumber}`
    : `Previously on ${campaignName}`;

  const parts = chunkRecap(body, MAX_DESC);
  if (!parts.length) return false;

  try {
    for (let i = 0; i < parts.length; i++) {
      const embed: Record<string, unknown> = { description: parts[i], color: BRASS };
      if (i === 0) embed.title = title;
      // Last embed only: the reader reaches the end of the story before being asked for
      // anything.
      if (i === parts.length - 1 && (claimNote || recapLink)) {
        embed.fields = [
          ...(recapLink ? [{ name: "Read every recap", value: recapLink }] : []),
          ...(claimNote ? [{ name: "Your character", value: claimNote }] : []),
        ];
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

/** Where a recap was posted: the channel and the message ids, in order (sessions.discord_recap_post, p138). */
export type RecapPost = { channel: string; ids: string[] };

/**
 * Audit P10: posts the recap, or, when it was already posted to this channel, edits those messages in
 * place so a corrected recap does not appear twice. A longer recap adds messages after the old ones; a
 * shorter one deletes the leftovers. If the old messages are gone (deleted in Discord), it posts fresh.
 * Returns where it now lives, for the caller to store. postRecapToDiscord above stays for older callers.
 */
export async function postOrUpdateRecap(
  channelId: string,
  campaignName: string,
  sessionNumber: number | null,
  recap: string,
  claimNote: string | null,
  recapLink: string | null,
  previous: RecapPost | null,
): Promise<{ ok: boolean; post: RecapPost | null; updated: boolean }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const body = recap.trim();
  if (!token || !channelId || !body) return { ok: false, post: null, updated: false };
  const title = sessionNumber != null ? `Previously on ${campaignName}, Session ${sessionNumber}` : `Previously on ${campaignName}`;
  const parts = chunkRecap(body, MAX_DESC);
  const embeds = parts.map((text, i) => {
    const embed: Record<string, unknown> = { description: text, color: BRASS };
    if (i === 0) embed.title = title;
    if (i === parts.length - 1 && (claimNote || recapLink)) {
      embed.fields = [
        ...(recapLink ? [{ name: "Read every recap", value: recapLink }] : []),
        ...(claimNote ? [{ name: "Your character", value: claimNote }] : []),
      ];
    }
    return embed;
  });
  const headers = { Authorization: `Bot ${token}`, "content-type": "application/json" };
  const base = `${DISCORD_API}/channels/${channelId}/messages`;

  const postAll = async (): Promise<RecapPost | null> => {
    const ids: string[] = [];
    for (const embed of embeds) {
      const res = await fetch(base, { method: "POST", headers, body: JSON.stringify({ embeds: [embed] }) });
      if (!res.ok) return null;
      const msg = (await res.json().catch(() => null)) as { id?: string } | null;
      if (msg?.id) ids.push(msg.id);
    }
    return { channel: channelId, ids };
  };

  try {
    const old = previous && previous.channel === channelId && previous.ids.length ? previous.ids : null;
    if (!old) {
      const post = await postAll();
      return { ok: !!post, post, updated: false };
    }
    const ids: string[] = [];
    for (let i = 0; i < embeds.length; i++) {
      if (i < old.length) {
        const res = await fetch(`${base}/${old[i]}`, { method: "PATCH", headers, body: JSON.stringify({ embeds: [embeds[i]] }) });
        if (res.status === 404) {
          // The old post was deleted in Discord: start again with a fresh one.
          const post = await postAll();
          return { ok: !!post, post, updated: false };
        }
        if (!res.ok) return { ok: false, post: null, updated: false };
        ids.push(old[i]);
      } else {
        const res = await fetch(base, { method: "POST", headers, body: JSON.stringify({ embeds: [embeds[i]] }) });
        if (!res.ok) return { ok: false, post: null, updated: false };
        const msg = (await res.json().catch(() => null)) as { id?: string } | null;
        if (msg?.id) ids.push(msg.id);
      }
    }
    for (const extra of old.slice(embeds.length)) {
      await fetch(`${base}/${extra}`, { method: "DELETE", headers }).catch(() => null);
    }
    return { ok: true, post: { channel: channelId, ids }, updated: true };
  } catch {
    return { ok: false, post: null, updated: false };
  }
}
