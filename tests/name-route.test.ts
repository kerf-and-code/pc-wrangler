// tests/name-route.test.ts (2026-11-11, push 38: Roll20 rolls routed by the name they were rolled under)
// Push 44: the GM's links, two PCs with one name, and NPC names that block a player character.
import { describe, expect, it } from "vitest";
import { matchKind, normName, routeByName, type NamedCharacter, type NameLink } from "@/lib/vtt/name-route";

const chars: NamedCharacter[] = [
  { id: "mira", name: "Mira Ashgrove", campaignId: "A" },
  { id: "bob", name: "Bobertas Vox", campaignId: "A" },
  { id: "bob2", name: "Bobert", campaignId: "A" },
  { id: "mira-b", name: "Mira Ashgrove", campaignId: "B" },
  { id: "tov", name: "Tov", campaignId: "B" },
];
const ts = new Map([["A", 100], ["B", 200]]);

describe("names", () => {
  it("compares names the way Roll20 shows them", () => {
    expect(normName("Mira Ashgrove:")).toBe("mira ashgrove");
    expect(normName("  Mira   Ashgrove (GM) ")).toBe("mira ashgrove");
    expect(normName("\"Tov\"")).toBe("tov");
    expect(normName(null)).toBe("");
  });
  it("routes a full name, the newest live campaign winning a tie", () => {
    expect(routeByName("Mira Ashgrove", chars, ts)?.id).toBe("mira-b");
    expect(routeByName("Mira Ashgrove", chars, new Map([["A", 300], ["B", 200]]))?.id).toBe("mira");
    expect(routeByName("Tov (GM)", chars, ts)?.id).toBe("tov");
  });
  it("routes a first name only when one character in a campaign has it", () => {
    expect(routeByName("Bobertas", chars, ts)?.id).toBe("bob");
    expect(routeByName("Mira", chars, ts)?.id).toBe("mira-b");
    expect(routeByName("Bobert", chars, ts)?.id).toBe("bob2");
    // a fuller name in Roll20 than in Six Axes
    expect(routeByName("Tov Ironhand", chars, ts)?.id).toBe("tov");
    expect(routeByName("Bobert Wildman", chars, ts)?.id).toBe("bob2");
  });
  it("routes nowhere for a stranger or no name", () => {
    expect(routeByName("Goblin 3", chars, ts)).toBeNull();
    expect(routeByName("", chars, ts)).toBeNull();
    expect(routeByName("Mira Ashgrove", [], ts)).toBeNull();
  });
});

describe("push 44", () => {
  it("sends nowhere when two player characters share a full name (B14)", () => {
    const twins: NamedCharacter[] = [
      { id: "t1", name: "Ash", campaignId: "A" },
      { id: "t2", name: "Ash", campaignId: "A" },
    ];
    expect(routeByName("Ash", twins, ts)).toBeNull();
  });
  it("never hands an NPC's name to a player character (T9)", () => {
    const withNpc: NamedCharacter[] = [
      { id: "grim", name: "Grim", campaignId: "A", kind: "pc" },
      { id: "wolf", name: "Grim Wolf", campaignId: "A", kind: "npc" },
      { id: "mira", name: "Mira Ashgrove", campaignId: "A", kind: "pc" },
      { id: "mira-npc", name: "Mira", campaignId: "A", kind: "npc" },
    ];
    expect(routeByName("Grim Wolf", withNpc, ts)).toBeNull();
    expect(routeByName("Mira", withNpc, ts)).toBeNull();
    expect(routeByName("Grim", withNpc, ts)?.id).toBe("grim");
    expect(routeByName("Mira Ashgrove", withNpc, ts)?.id).toBe("mira");
  });
  it("follows the GM's link before any name rule (G12)", () => {
    const links: NameLink[] = [
      { campaignId: "A", nameNorm: "breena stumbleduck", characterId: "bob" },
      { campaignId: "A", nameNorm: "bobert wildman", characterId: null },
    ];
    expect(routeByName("Breena Stumbleduck", chars, ts, links)?.id).toBe("bob");
    expect(routeByName("Bobert Wildman", chars, ts, links)).toBeNull();
    // a link in one campaign does not stop a fit in another
    expect(routeByName("Tov", chars, ts, [{ campaignId: "A", nameNorm: "tov", characterId: null }])?.id).toBe("tov");
  });
  it("a link to a character that is gone sends that campaign nowhere", () => {
    // B's link points at a deleted character, so B yields nothing and A's first-name fit wins
    expect(routeByName("Mira", chars, ts, [{ campaignId: "B", nameNorm: "mira", characterId: "gone" }])?.id).toBe("mira");
    expect(routeByName("Tov", chars, ts, [{ campaignId: "B", nameNorm: "tov", characterId: "gone" }])).toBeNull();
  });
  it("says whether a row went by its full name", () => {
    expect(matchKind("Bobert Wildman", "Bobert")).toBe("partial");
    expect(matchKind("Tov (GM)", "Tov")).toBe("exact");
  });
});
