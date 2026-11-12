// tests/deck-library.test.ts (2026-11-11, push 35: cards the GM hands out, and the deck library)
import { describe, expect, it } from "vitest";
import {
  campaignPathFor, cleanLibraryCards, extOf, isCampaignPicture, isLibraryPicture, libraryPathFor, toLibraryCards,
} from "@/lib/tabletop/deck-library";
import { activityHand } from "@/lib/discord/activity-view";

const OWNER = "6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";
const OTHER = "11111111-2222-3333-4444-555555555555";
const CAMP = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PIC = "0a0b0c0d-1111-2222-3333-444455556666";

describe("picture paths", () => {
  it("reads the file type", () => {
    expect(extOf(`${CAMP}/cards/${PIC}.png`)).toBe("png");
    expect(extOf("x.bmp")).toBeNull();
  });
  it("knows a library picture from someone else's or a campaign's", () => {
    expect(isLibraryPicture(OWNER, `library/${OWNER}/${PIC}.webp`)).toBe(true);
    expect(isLibraryPicture(OWNER, `library/${OTHER}/${PIC}.webp`)).toBe(false);
    expect(isLibraryPicture(OWNER, `library/${OWNER}/../${PIC}.webp`)).toBe(false);
    expect(isLibraryPicture(OWNER, `${CAMP}/cards/${PIC}.png`)).toBe(false);
    expect(isLibraryPicture(OWNER, null)).toBe(false);
  });
  it("knows a campaign's card and deck pictures", () => {
    expect(isCampaignPicture(CAMP, `${CAMP}/cards/${PIC}.jpg`)).toBe(true);
    expect(isCampaignPicture(CAMP, `${CAMP}/decks/${PIC}.gif`)).toBe(true);
    expect(isCampaignPicture(CAMP, `${CAMP}/handouts/${PIC}.png`)).toBe(false);
    expect(isCampaignPicture(OTHER, `${CAMP}/cards/${PIC}.jpg`)).toBe(false);
  });
  it("makes new paths that keep the file type", () => {
    expect(libraryPathFor(OWNER, `${CAMP}/cards/${PIC}.png`, PIC)).toBe(`library/${OWNER}/${PIC}.png`);
    expect(campaignPathFor(CAMP, "decks", `library/${OWNER}/${PIC}.webp`, PIC)).toBe(`${CAMP}/decks/${PIC}.webp`);
    expect(libraryPathFor(OWNER, "nope")).toBeNull();
  });
});

describe("library cards", () => {
  it("turns a table's cards into library cards, with the copied pictures", () => {
    const from = `${CAMP}/cards/${PIC}.png`, to = `library/${OWNER}/${PIC}.png`;
    const out = toLibraryCards([
      { name: "Inspiration", body: "Reroll one d20.", suit: null, rank: null, image_path: from },
      { name: "Ace of Spades", body: null, suit: "spades", rank: "A", image_path: null },
    ], new Map([[from, to]]));
    expect(out).toEqual([
      { name: "Inspiration", body: "Reroll one d20.", suit: null, rank: null, image: to },
      { name: "Ace of Spades", body: "", suit: "spades", rank: "A", image: null },
    ]);
  });
  it("checks stored cards before they become a table's cards", () => {
    const ok = cleanLibraryCards([
      { name: "  Boon  ", body: "x".repeat(700), suit: "bogus", rank: "Z", image: `library/${OWNER}/${PIC}.png` },
      { name: "Bane", image: `library/${OTHER}/${PIC}.png` },
    ], OWNER);
    expect("cards" in ok && ok.cards[0]).toMatchObject({ name: "Boon", suit: null, rank: null, image: `library/${OWNER}/${PIC}.png` });
    expect("cards" in ok && ok.cards[0].body.length).toBe(600);
    // a picture outside the owner's folder is dropped
    expect("cards" in ok && ok.cards[1].image).toBeNull();
    expect(cleanLibraryCards([], OWNER)).toHaveProperty("error");
    expect(cleanLibraryCards("nope", OWNER)).toHaveProperty("error");
    expect(cleanLibraryCards([{ body: "no name" }], OWNER)).toHaveProperty("error");
    expect(cleanLibraryCards(Array.from({ length: 201 }, () => ({ name: "a" })), OWNER)).toHaveProperty("error");
  });
});

describe("the hand in the Discord Activity", () => {
  it("shows words only, which cards can be used, and which were given", () => {
    const hand = activityHand({
      decks: [{ id: "d1", name: "Boons", kind: "custom" }, { id: "d2", name: "Playing cards", kind: "standard" }],
      hand: [
        { id: "c1", deckId: "d1", name: "Inspiration", body: "Reroll one d20.", holder: "me", givenBy: "gm", picture: "/api/x" },
        { id: "c2", deckId: "d2", name: "Ace of Spades", body: "", holder: "me", givenBy: null },
      ],
    });
    expect(hand).toEqual([
      { id: "c1", name: "Inspiration", body: "Reroll one d20.", deck: "Boons", usable: true, gift: true },
      { id: "c2", name: "Ace of Spades", body: "", deck: "Playing cards", usable: false, gift: false },
    ]);
    expect(activityHand(null)).toEqual([]);
    expect(activityHand({ decks: [] })).toEqual([]);
  });
});
