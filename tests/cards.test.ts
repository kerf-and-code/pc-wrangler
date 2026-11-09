import { describe, expect, it } from "vitest";
import { MAX_CARDS, isRed, parseCustomDeck, shuffled, standardDeck } from "@/lib/tabletop/cards";

// Phase 6a: building a new deck.
describe("standard deck", () => {
  it("has 52 distinct cards, or 54 with jokers", () => {
    const d = standardDeck(false);
    expect(d.length).toBe(52);
    expect(new Set(d.map((c) => c.name)).size).toBe(52);
    expect(standardDeck(true).length).toBe(54);
    expect(d.find((c) => c.rank === "Q" && c.suit === "hearts")?.name).toBe("Queen of Hearts");
    expect(d.find((c) => c.rank === "10" && c.suit === "spades")?.name).toBe("10 of Spades");
  });
  it("knows red from black", () => {
    expect(isRed("hearts")).toBe(true); expect(isRed("clubs")).toBe(false);
    expect(isRed("joker", "R")).toBe(true); expect(isRed("joker", "B")).toBe(false);
  });
});

describe("custom deck", () => {
  it("reads one card per line, with optional text and copies", () => {
    const { cards, problems } = parseCustomDeck("The Tower | Something falls.\n\n  The Star  \n3x Blank | nothing\n2X  Coin");
    expect(problems).toEqual([]);
    expect(cards.map((c) => c.name)).toEqual(["The Tower", "The Star", "Blank", "Blank", "Blank", "Coin", "Coin"]);
    expect(cards[0].body).toBe("Something falls.");
    expect(cards[1].body).toBe("");
  });
  it("flags lines with no name and caps the size", () => {
    expect(parseCustomDeck(" | only text").problems[0]).toMatch(/no name/);
    const big = parseCustomDeck("99x A\n99x B\n99x C");
    expect(big.cards.length).toBe(MAX_CARDS);
    expect(big.problems[0]).toMatch(/at most/);
  });
  it("keeps a name with a pipe-free colon intact", () => {
    expect(parseCustomDeck("Rule 1: run").cards[0].name).toBe("Rule 1: run");
  });
});

describe("shuffle", () => {
  it("keeps every card and moves them", () => {
    const a = Array.from({ length: 54 }, (_, i) => i), s = shuffled(a);
    expect([...s].sort((x, y) => x - y)).toEqual(a);
    expect(s).not.toEqual(a);
  });
  it("is fair: each card lands in each place about equally often", () => {
    let seed = 3; const rand = (n: number) => { seed = (seed * 16807) % 2147483647; return seed % n; };
    const counts = [0, 0, 0, 0];
    for (let k = 0; k < 40000; k++) counts[shuffled([0, 1, 2, 3], rand).indexOf(0)]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(400);
  });
});
