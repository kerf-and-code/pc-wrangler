// lib/tabletop/cards.ts (2026-11-09)
//
// Phase 6a (p130): the cards in a new deck, and how a card reads. A deck is either a standard deck of
// playing cards (52, plus two jokers if wanted) or the GM's own cards, one per line: "Name | text".
// The server keeps every card and where it is; these only build a new deck and name cards.
// Phase 6d (p133): a card can have a picture; nameFromFile names a card after its picture's file, so a
// GM can make a deck from a folder of pictures.

export type Suit = "hearts" | "diamonds" | "clubs" | "spades" | "joker";
export type CardFace = { name: string; body: string; suit: Suit | null; rank: string | null };

export const SUITS: Exclude<Suit, "joker">[] = ["spades", "hearts", "diamonds", "clubs"];
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const RANK_NAME: Record<string, string> = { A: "Ace", J: "Jack", Q: "Queen", K: "King" };
const SUIT_NAME: Record<Suit, string> = { hearts: "Hearts", diamonds: "Diamonds", clubs: "Clubs", spades: "Spades", joker: "Joker" };
export const SUIT_SYMBOL: Record<Suit, string> = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠", joker: "★" };

export const MAX_CARDS = 200;

/** A standard deck: 52 cards, and a red and a black joker when asked. */
export function standardDeck(jokers: boolean): CardFace[] {
  const out: CardFace[] = [];
  for (const suit of SUITS) for (const rank of RANKS) out.push({ name: `${RANK_NAME[rank] ?? rank} of ${SUIT_NAME[suit]}`, body: "", suit, rank });
  if (jokers) out.push({ name: "Red Joker", body: "", suit: "joker", rank: "R" }, { name: "Black Joker", body: "", suit: "joker", rank: "B" });
  return out;
}

/**
 * The GM's own cards, one per line: "Name | what it does" (the text is optional). Blank lines are
 * skipped; "3x Name | text" makes three of that card. Names are cut to 80 characters and text to 600.
 */
export function parseCustomDeck(text: string): { cards: CardFace[]; problems: string[] } {
  const cards: CardFace[] = [], problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const bar = line.indexOf("|");
    let name = (bar >= 0 ? line.slice(0, bar) : line).trim();
    const body = (bar >= 0 ? line.slice(bar + 1) : "").trim().slice(0, 600);
    let copies = 1;
    const m = /^(\d{1,2})\s*x\s+(.+)$/i.exec(name);
    if (m) { copies = Number(m[1]); name = m[2].trim(); }
    if (!name) { problems.push(`Line ${i + 1} has no name.`); return; }
    if (copies < 1) { problems.push(`Line ${i + 1} asks for no copies.`); return; }
    for (let k = 0; k < copies; k++) cards.push({ name: name.slice(0, 80), body, suit: null, rank: null });
  });
  if (cards.length > MAX_CARDS) problems.push(`That is ${cards.length} cards; a deck holds ${MAX_CARDS} at most.`);
  return { cards: cards.slice(0, MAX_CARDS), problems };
}

export const isRed = (suit: Suit | null | undefined, rank?: string | null) => suit === "hearts" || suit === "diamonds" || (suit === "joker" && rank === "R");

/** A fair shuffle (Fisher and Yates) with the browser's strong random numbers, for a new deck's order. */
export function shuffled<T>(items: T[], rand: (n: number) => number = cryptoInt): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function cryptoInt(n: number): number {
  const buf = new Uint32Array(1), lim = Math.floor(0x100000000 / n) * n;
  let x: number;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= lim);
  return x % n;
}

/** A card's name from its picture's file name: "03_the-high_priestess.png" is "the high priestess". */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/^\d+[\s._-]+(?=\D)/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Card").slice(0, 80);
}

/** How card names are matched to picture files: case, hyphens, underscores, extra spaces and a leading
 *  "the", "a" or "an" ignored, so tower.png finds The Tower. */
export const cardKey = (name: string) => name.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(the|a|an) (?=\S)/, "");
