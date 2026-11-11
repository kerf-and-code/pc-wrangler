// tests/system-play.test.ts (push 22, audits G4 and G5)
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pf2eFeatSlots, pf2eMaxSpellRank, type Pf2eSheet } from "../lib/pf2e/character";
import { playTracks, playValue } from "../lib/play/system-tracks";
import type { DSSheet } from "../lib/drawsteel/character";

describe("PF2e feat slots", () => {
  const keys = (lv: number, cls: string) => pf2eFeatSlots(lv, cls).map((s) => s.key);
  it("follows the Player Core schedule", () => {
    expect(keys(1, "fighter")).toEqual(["ancestry-1", "class-1"]);
    expect(keys(1, "wizard")).toEqual(["ancestry-1"]);
    expect(keys(1, "rogue")).toEqual(["ancestry-1", "class-1", "skill-1"]);
    expect(keys(3, "cleric")).toEqual(["ancestry-1", "class-2", "skill-2", "general-3"]);
    const twenty = pf2eFeatSlots(20, "fighter");
    expect(twenty.filter((s) => s.type === "ancestry").length).toBe(5);
    expect(twenty.filter((s) => s.type === "class").length).toBe(11);
    expect(twenty.filter((s) => s.type === "skill").length).toBe(10);
    expect(twenty.filter((s) => s.type === "general").length).toBe(5);
  });
  it("caps spell rank by level", () => {
    expect([1, 2, 3, 9, 19, 20].map(pf2eMaxSpellRank)).toEqual([1, 1, 2, 5, 10, 10]);
  });
});

describe("the at-the-table tracks", () => {
  it("starts PF2e at full HP and one Hero Point, and clamps stored values to the new maximum", () => {
    const tracks = playTracks({ system: "pf2e", sheet: { hp: 20 } as Pf2eSheet });
    const hp = tracks.find((t) => t.key === "hp")!;
    expect(playValue(hp, undefined)).toBe(20);
    expect(playValue(hp, { values: { hp: 35 } })).toBe(20);
    expect(playValue(tracks.find((t) => t.key === "hero")!, undefined)).toBe(1);
  });
  it("lets Draw Steel Stamina go negative down to the winded value", () => {
    const st = playTracks({ system: "drawsteel", sheet: { stamina: 21, winded: 10, recoveries: 8, recoveryValue: 7, heroicResource: "Wrath" } as DSSheet });
    const stamina = st.find((t) => t.key === "stamina")!;
    expect(stamina.min).toBe(-10);
    expect(playValue(stamina, { values: { stamina: -30 } })).toBe(-10);
    expect(st.find((t) => t.key === "heroic")!.label).toBe("Wrath");
  });
});

describe("the PF2e picks index", () => {
  it("is built and holds feats, spells and gear", () => {
    const p = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "pf2e", "picks.json"), "utf8"));
    expect(p.feats.length).toBeGreaterThan(1000);
    expect(p.spells.some((s: [string, number]) => s[1] === 0)).toBe(true);
    expect(p.feats.every((f: unknown[]) => ["ancestry", "class", "skill", "general", "bonus"].includes(f[1] as string))).toBe(true);
  });
});
