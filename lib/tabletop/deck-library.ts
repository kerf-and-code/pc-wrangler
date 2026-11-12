// lib/tabletop/deck-library.ts (2026-11-11, push 35)
//
// The GM's deck library (p159 gm_card_decks): a deck saved from one table, added to any campaign the GM
// runs. These are the pure checks app/api/tabletop/deck-library uses on the way in and out, kept apart so
// they are tested on their own (tests/deck-library.test.ts).
//
// Pictures: a table's pictures live at <campaign>/<cards|decks>/<uuid>.<ext> in the private table-files
// bucket (p133). A library deck keeps its own copies at library/<owner>/<uuid>.<ext>, so deleting the
// campaign, or the deck at that table, never takes the library's pictures with it; adding the deck to a
// table copies them into that campaign's folder.

import type { Suit } from "@/lib/tabletop/cards";

export type LibraryCard = { name: string; body: string; suit: Suit | null; rank: string | null; image: string | null };
export type PictureExt = "png" | "jpg" | "webp" | "gif";

export const MAX_LIBRARY_DECKS = 50;
export const MAX_LIBRARY_CARDS = 200;

const SUITS = new Set<string>(["hearts", "diamonds", "clubs", "spades", "joker"]);
const RANK = /^(A|[2-9]|10|J|Q|K|R|B)$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EXT = "(png|jpg|webp|gif)";

export const isUuid = (s: unknown): s is string => typeof s === "string" && new RegExp(`^${UUID}$`, "i").test(s);

/** The file type at the end of a picture path, or null. */
export function extOf(path: string): PictureExt | null {
  const m = /\.(png|jpg|webp|gif)$/.exec(path);
  return m ? (m[1] as PictureExt) : null;
}

/** A picture in this owner's library folder. */
export function isLibraryPicture(owner: string, path: unknown): path is string {
  return typeof path === "string" && isUuid(owner) && new RegExp(`^library/${owner}/${UUID}\\.${EXT}$`).test(path);
}

/** A picture in this campaign's cards or decks folder. */
export function isCampaignPicture(campaignId: string, path: unknown): path is string {
  return typeof path === "string" && isUuid(campaignId) && new RegExp(`^${campaignId}/(cards|decks)/${UUID}\\.${EXT}$`).test(path);
}

/** A new path for a copy of `from`, in the owner's library or in a campaign's folder. */
export function libraryPathFor(owner: string, from: string, id: string = crypto.randomUUID()): string | null {
  const ext = extOf(from);
  return ext ? `library/${owner}/${id}.${ext}` : null;
}
export function campaignPathFor(campaignId: string, purpose: "cards" | "decks", from: string, id: string = crypto.randomUUID()): string | null {
  const ext = extOf(from);
  return ext ? `${campaignId}/${purpose}/${id}.${ext}` : null;
}

/** A table's cards (vtt_cards rows) as library cards, their pictures named by `copies` (old path to new). */
export function toLibraryCards(rows: { name: string; body: string | null; suit: string | null; rank: string | null; image_path: string | null }[], copies: Map<string, string>): LibraryCard[] {
  return rows.slice(0, MAX_LIBRARY_CARDS).map((r) => ({
    name: r.name, body: r.body ?? "",
    suit: r.suit && SUITS.has(r.suit) ? (r.suit as Suit) : null,
    rank: r.rank && RANK.test(r.rank) ? r.rank : null,
    image: r.image_path ? copies.get(r.image_path) ?? null : null,
  }));
}

/** A library deck's stored cards, checked before they become a table's cards. Anything that is not a
 *  card is an error (the row was written by this route, so it means the row was edited by hand); a
 *  picture outside the owner's folder is dropped. */
export function cleanLibraryCards(raw: unknown, owner: string): { cards: LibraryCard[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "That library deck has no cards." };
  if (raw.length > MAX_LIBRARY_CARDS) return { error: `That library deck has more than ${MAX_LIBRARY_CARDS} cards.` };
  const cards: LibraryCard[] = [];
  for (const c of raw) {
    const o = (c ?? {}) as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
    if (!name) return { error: "A card in that library deck has no name." };
    const body = typeof o.body === "string" ? o.body.slice(0, 600) : "";
    const suit = typeof o.suit === "string" && SUITS.has(o.suit) ? (o.suit as Suit) : null;
    const rank = typeof o.rank === "string" && RANK.test(o.rank) ? o.rank : null;
    const image = isLibraryPicture(owner, o.image) ? o.image : null;
    cards.push({ name, body, suit, rank, image });
  }
  return { cards };
}
