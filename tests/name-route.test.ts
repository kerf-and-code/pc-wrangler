// tests/name-route.test.ts (2026-11-11, push 38: Roll20 rolls routed by the name they were rolled under)
import { describe, expect, it } from "vitest";
import { normName, routeByName, type NamedCharacter } from "@/lib/vtt/name-route";

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
