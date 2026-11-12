// tests/sheet-2014-and-attacks.test.ts (push 47, audit round 2 G1, G9, G10)
import { describe, expect, it } from "vitest";
import { classTable } from "@/lib/class-table";
import { afterShortRest, classPools, resourcesFor, slotsFor } from "@/lib/resources";
import { isMonkWeapon, weaponAttack, type WeaponRecord } from "@/lib/play/attacks";
import classes2014 from "@/lib/srd/classes-2014-structured.json";
import classes2024 from "@/lib/srd/classes-2024-structured.json";

const rec14 = (n: string) => (classes2014 as { name: string }[]).find((c) => c.name === n);
const rec24 = (n: string) => (classes2024 as { name: string }[]).find((c) => c.name === n);
const row = (rec: unknown, lv: number) => classTable(rec).find((r) => r.level === lv);

describe("2014 sheets (G1)", () => {
  it("a 2014 wizard has spell slots", () => {
    const s = slotsFor(row(rec14("Wizard"), 5)).map((r) => [r.key, r.max]);
    expect(s).toEqual([["slot-1st", 4], ["slot-2nd", 3], ["slot-3rd", 2]]);
  });
  it("a 2014 warlock has pact slots that come back on a short rest", () => {
    const r = row(rec14("Warlock"), 5)!;
    expect(r.columns["Slot Level"]).toBe("3rd");
    expect(slotsFor(r)).toEqual([]);
    expect(resourcesFor(r).find((p) => p.key === "Spell Slots")).toMatchObject({ max: 2, shortRest: "all" });
  });
  it("2014 class pools come from the 2014 columns", () => {
    expect(resourcesFor(row(rec14("Barbarian"), 5)).find((p) => p.label === "Rages")).toMatchObject({ max: 3, shortRest: "none" });
    expect(resourcesFor(row(rec14("Monk"), 5)).find((p) => p.key === "Ki Points")).toMatchObject({ max: 5, shortRest: "all" });
    expect(resourcesFor(row(rec14("Barbarian"), 20)).find((p) => p.label === "Rages")).toBeUndefined();
  });
});

describe("pools and short rests (G9)", () => {
  it("2024 rages and Second Wind come back one at a time", () => {
    const rages = resourcesFor(row(rec24("Barbarian"), 5)).find((p) => p.key === "Rages")!;
    expect(rages.shortRest).toBe("one");
    expect(afterShortRest([rages], { Rages: 3 })).toEqual({ Rages: 2 });
    expect(resourcesFor(row(rec24("Fighter"), 5)).find((p) => p.key === "Second Wind")!.shortRest).toBe("one");
  });
  it("adds the pools no table lists", () => {
    const keys = (r: "2014" | "2024", n: string, lv: number, cha = 0) => classPools(r, [{ name: n, level: lv }], cha).map((p) => `${p.key}:${p.max}:${p.shortRest}`);
    expect(keys("2024", "Bard", 3, 3)).toEqual(["Bardic Inspiration:3:none"]);
    expect(keys("2024", "Bard", 5, -1)).toEqual(["Bardic Inspiration:1:all"]);
    expect(keys("2024", "Fighter", 17)).toEqual(["Action Surge:2:all", "Indomitable:3:none"]);
    expect(keys("2014", "Fighter", 17)).toEqual(["Second Wind:1:all"]);
    expect(keys("2014", "Druid", 2)).toEqual(["Wild Shape:2:all"]);
    expect(keys("2024", "Druid", 2)).toEqual(["Wild Shape:2:one"]);
  });
});

describe("attack abilities (G10)", () => {
  const mods = { str: 0, dex: 3, con: 1, int: 2, wis: 4, cha: 5 };
  const quarterstaff: WeaponRecord = { name: "Quarterstaff", weapon_category: "Simple", weapon_range: "Melee", damage: { dice: "1d6", type: "Bludgeoning" }, properties: ["Versatile (1d8)"] };
  const greatsword: WeaponRecord = { name: "Greatsword", weapon_category: "Martial", weapon_range: "Melee", damage: { dice: "2d6", type: "Slashing" }, properties: ["Heavy", "Two-Handed"] };
  it("a monk's weapon uses the better of STR and DEX", () => {
    expect(isMonkWeapon(quarterstaff)).toBe(true);
    expect(isMonkWeapon(greatsword)).toBe(false);
    expect(weaponAttack(quarterstaff, mods, 2, "Simple weapons", 0, "q", { martialArts: true }).ability).toBe("dex");
    expect(weaponAttack(quarterstaff, mods, 2, "Simple weapons").ability).toBe("str");
  });
  it("a chosen ability is used and said", () => {
    const r = weaponAttack(greatsword, mods, 2, "Martial weapons", 0, "g", { chosen: "cha" });
    expect(r.ability).toBe("cha");
    expect(r.toHit).toBe(7);
    expect(r.damage).toBe("2d6+5");
    expect(r.notes).toEqual(["uses CHA (your choice)"]);
  });
});
