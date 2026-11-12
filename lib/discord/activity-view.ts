// lib/discord/activity-view.ts (2026-11-11, push 34, audit P7: the Discord Activity)
//
// Small pure helpers for the Activity's page (components/activity/activity-app.tsx), kept apart so
// they are tested on their own (tests/discord-activity.test.ts).

export type FeedMessage = {
  id: string; created_at: string; kind: string; as_name: string | null; body: string;
  roll: { label?: string; notation?: string; total?: number; natural?: number | null; dice?: { sides: number; value: number; kept: boolean }[] } | null;
  gm_only?: boolean; whisper_to?: string[] | null;
};

/** New chat and rolls added to what the page holds: no repeats, oldest first, the last `keep` only. */
export function mergeMessages(prev: FeedMessage[], add: FeedMessage[] | null | undefined, keep = 80): FeedMessage[] {
  if (!add?.length) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of add) if (m && typeof m.id === "string") byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)).slice(-keep);
}

/** The newest message time, to ask the server only for what came after it. */
export function sinceOf(list: FeedMessage[]): string {
  return list.length ? list[list.length - 1].created_at : "";
}

/** Inside Discord every request has to stay on the Activity's own address, which Discord forwards by
 *  its URL mappings. Pictures stored in Supabase are fetched through the "/sb" mapping (to the project's
 *  host); anything else from another site cannot load there, so it is dropped (the token is drawn
 *  plain). Outside Discord a URL is used as it is. */
export function proxiedUrl(url: string | null | undefined, supabaseUrl: string | undefined, inDiscord: boolean): string | null {
  if (!url) return null;
  if (!inDiscord) return url;
  if (url.startsWith("/") || url.startsWith("data:") || url.startsWith("blob:")) return url;
  try {
    const u = new URL(url), sb = supabaseUrl ? new URL(supabaseUrl) : null;
    if (sb && u.host === sb.host) return `/sb${u.pathname}${u.search}`;
  } catch { /* not a URL */ }
  return null;
}

/** A card in the player's hand, as the Activity shows it (push 35): its words only. Card pictures are
 *  served to a signed-in website session (app/api/tabletop/table-file), which the Activity does not have,
 *  so they are left out. `usable`: one of the GM's own cards (a boon, a bane, inspiration), which the
 *  player can Use; playing cards are only played. `gift`: someone else put it in their hand. */
export type HandCard = { id: string; name: string; body: string; deck: string; usable: boolean; gift: boolean };
export function activityHand(cards: unknown): HandCard[] {
  const t = (cards ?? null) as {
    decks?: { id: string; name: string; kind: string }[];
    hand?: { id: string; deckId: string; name?: string; body?: string; holder?: string | null; givenBy?: string | null }[];
  } | null;
  if (!t || !Array.isArray(t.hand)) return [];
  const decks = new Map((t.decks ?? []).map((d) => [d.id, d]));
  return t.hand.map((c) => {
    const d = decks.get(c.deckId);
    return { id: c.id, name: c.name || "A card", body: c.body ?? "", deck: d?.name ?? "", usable: d?.kind === "custom", gift: !!c.givenBy && c.givenBy !== c.holder };
  });
}

/** A die button's notation, with advantage or disadvantage on a d20 and a modifier. */
export function diceNotation(sides: number, count = 1, mod = 0, adv: "flat" | "adv" | "dis" = "flat"): string {
  const m = mod ? (mod > 0 ? `+${mod}` : `${mod}`) : "";
  if (sides === 20 && count === 1 && adv !== "flat") return `2d20${adv === "adv" ? "kh1" : "kl1"}${m}`;
  return `${Math.max(1, Math.min(20, count))}d${sides}${m}`;
}

/** The roll's words for the log: "Mira: Initiative 17 (1d20+3)". */
export function rollLine(m: FeedMessage): string {
  const who = m.as_name || "Someone";
  if (m.kind !== "roll" || !m.roll) return `${who}: ${m.body}`;
  const label = m.roll.label || m.body || "Roll";
  return `${who}: ${label} ${m.roll.total ?? "?"}${m.roll.notation ? ` (${m.roll.notation})` : ""}`;
}
