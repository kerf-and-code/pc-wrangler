// tests/area-targets.test.ts (2026-11-11, push 36: the tabletop's area targets reach the Combat page)
import { describe, expect, it } from "vitest";
import { areaTargets, markArea, type Combatant } from "@/lib/combat";

const c = (id: string, extra: Partial<Combatant> = {}): Combatant => ({
  id, kind: "pc", name: id, initiative: 10, initBonus: 0, hp: 10, maxHp: 10, tempHp: 0, ac: 12, conditions: [], hidden: false, defeated: false, ...extra,
});

describe("area targets", () => {
  it("marks the combatants inside and clears an older marking", () => {
    const before = [c("dragon"), c("vox", { areaTarget: 5 }), c("eight"), c("five")];
    const after = markArea(before, ["eight", "five"], 10);
    expect(after.map((x) => x.areaTarget ?? null)).toEqual([null, null, 10, 10]);
    expect(areaTargets(after)).toEqual(["eight", "five"]);
  });
  it("leaves out the attacker and the defeated", () => {
    const cs = markArea([c("dragon"), c("vox"), c("eight", { defeated: true })], ["dragon", "vox", "eight"], 7);
    expect(areaTargets(cs, "dragon")).toEqual(["vox"]);
  });
  it("is empty with no marking, and an empty list clears it", () => {
    expect(areaTargets([c("a"), c("b")])).toEqual([]);
    const cs = markArea([c("a"), c("b")], ["a"], 3);
    expect(areaTargets(markArea(cs, [], 0))).toEqual([]);
  });
  it("keeps everything else about each combatant", () => {
    const [x] = markArea([c("a", { hp: 4, conditions: ["prone"] })], ["a"], 1);
    expect(x).toMatchObject({ hp: 4, conditions: ["prone"], areaTarget: 1 });
  });
});
