// tests/content-policy.test.ts (2026-11-12, push 48: audit round 2, T4)
import { afterEach, describe, expect, it } from "vitest";
import { isNonSrd, nonSrdContentOn, subclassesWithContentPolicy, withContentPolicy } from "@/lib/content-policy";
import { loadSrd } from "@/lib/srd/srd";
import { monsterSourceTitle, MONSTER_SOURCES } from "@/lib/monster-sources";

const KEY = "NEXT_PUBLIC_NON_SRD_CONTENT";
afterEach(() => { delete process.env[KEY]; });

describe("non-SRD kill switch", () => {
  it("is on unless set to off", () => {
    expect(nonSrdContentOn()).toBe(true);
    process.env[KEY] = "off";
    expect(nonSrdContentOn()).toBe(false);
  });
  it("tells SRD records from the rest", () => {
    expect(isNonSrd({ source: "kc" })).toBe(true);
    expect(isNonSrd({ source_key: "kc-mm24" })).toBe(true);
    expect(isNonSrd({ source: "Eberron: Forge of the Artificer" })).toBe(true);
    expect(isNonSrd({ source: "SRD 5.2.1" })).toBe(false);
    expect(isNonSrd({ source_key: "srd-2024" })).toBe(false);
    expect(isNonSrd({ source_key: "tob" })).toBe(false); // open third-party bestiary
    expect(isNonSrd({})).toBe(false);
  });
  it("filters only when off", () => {
    const rows = [{ name: "a" }, { name: "b", source: "kc" }];
    expect(withContentPolicy(rows)).toHaveLength(2);
    process.env[KEY] = "off";
    expect(withContentPolicy(rows).map((r) => r.name)).toEqual(["a"]);
    expect(subclassesWithContentPolicy([{ subclass: "Champion" }, { subclass: "Echo Knight" }]).map((r) => r.subclass)).toEqual(["Champion"]);
  });
  it("loadSrd drops the book content when off", () => {
    const onSpells = loadSrd("spells", "2024").length;
    const onMonsters = loadSrd("monsters", "2024");
    expect(onMonsters.some((m) => String(m.source_key).startsWith("kc-"))).toBe(true);
    process.env[KEY] = "off";
    expect(loadSrd("spells", "2024").length).toBeLessThan(onSpells);
    const offMonsters = loadSrd("monsters", "2024");
    expect(offMonsters.length).toBeGreaterThan(0);
    expect(offMonsters.some((m) => String(m.source_key).startsWith("kc-"))).toBe(false);
    const subs = loadSrd("subclasses", "2024");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.length).toBeLessThanOrEqual(16);
  });
});

describe("monster source labels", () => {
  it("never names Kerf and Code as a publisher or a license", () => {
    for (const s of Object.values(MONSTER_SOURCES)) {
      expect(s.publisher).not.toBe("Kerf and Code");
      expect(s.license).not.toBe("Kerf and Code");
    }
    expect(MONSTER_SOURCES["kc-mm24"].license).toBe("Not open content");
    expect(monsterSourceTitle("kc-mm24")).toContain("Wizards of the Coast");
  });
});
