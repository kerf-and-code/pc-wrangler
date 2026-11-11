import { describe, it, expect } from "vitest";
import {
  QUICK_CLASSES, QUICK_BACKGROUNDS, quickClass, standardScores, bestBackground, backgroundAsi,
  classEquipmentText, starterKit, quickBuild,
} from "@/lib/quick-build";
import backgrounds2024 from "@/lib/srd/backgrounds-2024.json";
import classesStructured2024 from "@/lib/srd/classes-2024-structured.json";
import equipment2024 from "@/lib/srd/equipment-2024.json";

type Bg = { name: string; ability_scores?: string; equipment?: string; tool_proficiency?: string };
const BGS = backgrounds2024 as unknown as Bg[];
const CORE = Object.fromEntries((classesStructured2024 as unknown as { name: string; core_traits?: string }[]).map((c) => [c.name, c.core_traits || ""]));
const CATALOG = (equipment2024 as unknown as { name: string }[]).map((e) => e.name);

describe("ability scores", () => {
  it("places the standard array in the class's order", () => {
    expect(standardScores(quickClass("Wizard")!.order)).toEqual({ int: 15, con: 14, dex: 13, wis: 12, cha: 10, str: 8 });
    expect(standardScores(quickClass("Fighter")!.order)).toEqual({ str: 15, con: 14, dex: 13, wis: 12, cha: 10, int: 8 });
  });
  it("covers every ability exactly once for every class", () => {
    for (const c of QUICK_CLASSES) expect([...c.order].sort()).toEqual(["cha", "con", "dex", "int", "str", "wis"]);
  });
});

describe("background", () => {
  it("picks a common background whose abilities suit the class", () => {
    expect(QUICK_BACKGROUNDS.every((n) => BGS.some((b) => b.name === n))).toBe(true);
    const fighter = bestBackground(quickClass("Fighter")!.order, BGS)!;
    expect(BGS.find((b) => b.name === fighter)!.ability_scores).toMatch(/Strength/);
    const wizard = bestBackground(quickClass("Wizard")!.order, BGS)!;
    expect(BGS.find((b) => b.name === wizard)!.ability_scores).toMatch(/Intelligence/);
    expect(bestBackground(["str", "dex", "con", "int", "wis", "cha"], [])).toBeNull();
    expect(bestBackground(quickClass("Wizard")!.order, BGS, "Wizard")).toBe("Sage");
    expect(bestBackground(quickClass("Cleric")!.order, BGS, "Cleric")).toBe("Acolyte");
    // every class's own background puts its +2 on the class's main ability
    for (const c of QUICK_CLASSES) {
      const rec = BGS.find((b) => b.name === c.bg)!;
      expect(rec, c.bg).toBeTruthy();
      expect(backgroundAsi(c.order, rec.ability_scores)[c.order[0]]).toBe(2);
    }
  });
  it("puts +2 on the class's best of the three and +1 on the next", () => {
    expect(backgroundAsi(quickClass("Cleric")!.order, "Intelligence, Wisdom, Charisma")).toEqual({ wis: 2, cha: 1 });
    expect(backgroundAsi(quickClass("Rogue")!.order, "Dexterity, Constitution, Intelligence")).toEqual({ dex: 2, con: 1 });
    expect(backgroundAsi(quickClass("Rogue")!.order, undefined)).toEqual({});
  });
});

describe("starting gear", () => {
  it("takes option A of the class and the background, with their gold", () => {
    const soldier = BGS.find((b) => b.name === "Soldier");
    const kit = starterKit(classEquipmentText(CORE.Fighter), soldier, CATALOG);
    expect(kit.items.length).toBeGreaterThan(4);
    expect(kit.items.every((i) => typeof i.n === "string" && i.n.length > 0)).toBe(true);
    expect(kit.coins.gp).toBeGreaterThan(0);
    // the Soldier's gaming set is a choice, left to the player
    expect(kit.choose.some((c) => /gaming set/i.test(c))).toBe(true);
  });
  it("finds a starting equipment line for every quick class", () => {
    for (const c of QUICK_CLASSES) {
      if (!CORE[c.name]) continue;
      expect(classEquipmentText(CORE[c.name])).toBeTruthy();
    }
  });
  it("mends the words the class data splits, so they match the catalog", () => {
    const druid = starterKit(classEquipmentText(CORE.Druid), undefined, CATALOG);
    expect(druid.items.map((i) => i.n)).toContain("Leather Armor");
    expect(classEquipmentText("| Starting Equipment | (A) 20 Ar rows and an Ar cane Focus |")).toBe(" (A) 20 Arrows and an Arcane Focus ");
  });
  it("copes with nothing to grant", () => {
    expect(starterKit(undefined, undefined, CATALOG)).toEqual({ items: [], coins: {}, choose: [] });
  });
});

describe("the saved build", () => {
  it("is a level 1 2024 build with the choices in the Forge's shape", () => {
    const kit = { items: [{ n: "Dagger" }], coins: { gp: 15 }, choose: ["Musical Instrument of your choice"] };
    const b = quickBuild({ className: "Bard", species: "Elf", background: "Entertainer", bgAbilityScores: "Strength, Dexterity, Charisma", kit, aim: "College of Lore" }) as Record<string, unknown>;
    expect(b.edition).toBe("2024");
    expect(b.level).toBe(1);
    expect(b.meta).toEqual({ species: "Elf", className: "Bard", subclass: "", background: "Entertainer" });
    expect(b.abilities).toEqual({ cha: 15, dex: 14, con: 13, wis: 12, int: 10, str: 8 });
    expect(b.bgAsi).toEqual({ cha: 2, dex: 1 });
    expect(b.gear).toEqual({ items: [{ n: "Dagger" }] });
    expect(b.coins).toEqual({ gp: 15 });
    expect(b.quick).toMatchObject({ choose: ["Musical Instrument of your choice"], aim: "College of Lore" });
  });
});
