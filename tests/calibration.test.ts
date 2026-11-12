// tests/calibration.test.ts (2026-11-11, push 39: encounter calibration)
import { describe, expect, it } from "vitest";
import { byBand, fightResult, reading, spearman, type FightRow } from "@/lib/calibration";

const fight = (over: Partial<FightRow> = {}, cal: FightRow["calibration"] = null): FightRow => ({
  id: "f1", name: "Ogre ambush", rules: "2024", status: "ended", round: 3, created_at: "2026-11-11T00:00:00Z",
  ended_at: "2026-11-11T01:00:00Z", encounter_id: null,
  calibration: cal ?? {
    start: {
      p1: { kind: "pc", level: 3, hp: 30, maxHp: 30 }, p2: { kind: "pc", level: 3, hp: 20, maxHp: 25 },
      m1: { kind: "monster", cr: "2", hp: 59, maxHp: 59 },
    },
    downs: { p2: 1 },
    end: { round: 4, combatants: { p1: { hp: 18, maxHp: 30 }, p2: { hp: 0, maxHp: 25 }, m1: { hp: 0, maxHp: 59, defeated: true } } },
  },
  ...over,
});

describe("one fight", () => {
  it("predicts with the DMG math and measures the outcome", () => {
    const r = fightResult(fight())!;
    // 2024: two level 3s budget 300/450/800; one CR 2 is 450 XP -> Moderate
    expect(r.predicted).toMatchObject({ band: "Moderate", bandIndex: 1, foeXp: 450 });
    expect(r.rounds).toBe(4);
    // lost (30-18) + (20-0) = 32 of a 55 maximum
    expect(r.hpLost).toBeCloseTo(32 / 55, 5);
    expect(r.downs).toBe(1);
    expect(r.stillDown).toBe(1);
  });
  it("uses the 2014 multiplier", () => {
    const r = fightResult(fight({ rules: "2014" }))!;
    // one monster against a party of two: the small-party step takes x1 to x1.5, so 675 XP, Hard (450 to 799)
    expect(r.predicted).toMatchObject({ band: "Hard", foeXp: 675 });
  });
  it("says why there is no prediction instead of guessing", () => {
    const noCr = fight({}, { start: { p1: { kind: "pc", level: 3, hp: 30, maxHp: 30 }, m1: { kind: "monster", cr: null } }, end: { round: 1, combatants: {} } });
    expect(fightResult(noCr)?.why).toBe("1 monster has no CR");
    const noLevel = fight({}, { start: { p1: { kind: "pc", level: null }, m1: { kind: "monster", cr: "1" } }, end: { round: 1, combatants: {} } });
    expect(fightResult(noLevel)?.why).toBe("1 character has no level");
  });
  it("leaves out fights that were not measured", () => {
    expect(fightResult(fight({ status: "active" }))).toBeNull();
    expect(fightResult(fight({ rules: "pf2e" }))).toBeNull();
    expect(fightResult(fight({ calibration: {} }))).toBeNull();
  });
});

describe("summaries", () => {
  it("groups by predicted band", () => {
    const a = fightResult(fight())!, b = fightResult(fight({ id: "f2" }))!;
    const [s] = byBand([a, b]);
    expect(s).toMatchObject({ method: "2024", band: "Moderate", n: 2, medianRounds: 4, fightsWithADown: 2 });
  });
  it("ranks", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 5);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 5);
    expect(spearman([1, 1, 2, 2], [1, 2, 3, 4])).toBeGreaterThan(0.8);
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  it("concludes nothing below ten fights", () => {
    const r = reading([fightResult(fight())!], "2024");
    expect(r.n).toBe(1);
    expect(r.text).toMatch(/nothing is concluded/);
  });
});
