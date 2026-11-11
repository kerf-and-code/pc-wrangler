// tests/feat-effects.test.ts (push 20, audit G15)
import { describe, expect, it } from "vitest";
import { deriveSheet, featTotals, type Build, type RulesContext } from "../lib/srd/derive-sheet";
import feats2014 from "../lib/srd/feats-2014.json";
import feats2024 from "../lib/srd/feats-2024.json";

const effectsOf = (list: unknown) => Object.fromEntries((list as { name: string; effects?: object }[])
  .filter((f) => f.effects).map((f) => [f.name.toLowerCase(), f.effects!]));

const ctx = (ruleset: "2014" | "2024", withFx = true) => ({
  ruleset, classes: { Fighter: { hitDie: 10 } }, species: { Human: { speed: 30 } }, subclasses: {}, itemEffects: {}, itemVariants: {},
  items: { "Chain Mail": { kind: "Armor", sub: "Heavy", baseAC: 16, dexCap: 0 } },
  ...(withFx ? { featEffects: effectsOf(ruleset === "2014" ? feats2014 : feats2024) } : {}),
}) as unknown as RulesContext;

const build = (o: Record<string, unknown> = {}): Build => ({
  level: 4, abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
  meta: { species: "Human", className: "Fighter", subclass: "", background: "" },
  armorBase: 10, armorMisc: 0, saveProf: [], skillProf: [], skillExpert: [], gear: { items: [] },
  effects: [], epicChoices: {}, spells: { cantrips: [], known: [] }, ...o,
} as unknown as Build);

describe("feat effects by name", () => {
  it("counts Tough once, even when an old choice stored its hit points too", () => {
    const none = deriveSheet(build(), ctx("2024")).hpMax;
    const named = deriveSheet(build({ feats: ["Tough"] }), ctx("2024")).hpMax;
    const legacy = deriveSheet(build({ feats: ["Tough"], epicChoices: { 4: [{ name: "Tough", isFeat: true, mods: { hpPerLevel: 2 } }] } }), ctx("2024")).hpMax;
    expect(named - none).toBe(8);
    expect(legacy).toBe(named);
  });
  it("applies speed feats, Boon of Fortitude and Alert", () => {
    const base = deriveSheet(build(), ctx("2024"));
    const s = deriveSheet(build({ feats: ["Speedy", "Boon of Fortitude", "Alert"] }), ctx("2024"));
    expect(s.speed - base.speed).toBe(10);
    expect(s.hpMax - base.hpMax).toBe(40);
    expect(s.initiative - base.initiative).toBe(2);
    const old = deriveSheet(build({ feats: ["Alert", "Mobile"] }), ctx("2014"));
    const oldBase = deriveSheet(build(), ctx("2014"));
    expect(old.initiative - oldBase.initiative).toBe(5);
    expect(old.speed - oldBase.speed).toBe(10);
  });
  it("gives Defense its +1 only in body armor", () => {
    const bare = deriveSheet(build({ feats: ["Defense"] }), ctx("2024")).ac;
    const bareBase = deriveSheet(build(), ctx("2024")).ac;
    expect(bare).toBe(bareBase);
    const armored = build({ feats: ["Defense"], gear: { items: [{ n: "Chain Mail", eq: true }] } });
    const plain = build({ gear: { items: [{ n: "Chain Mail", eq: true }] } });
    expect(deriveSheet(armored, ctx("2024")).ac - deriveSheet(plain, ctx("2024")).ac).toBe(1);
  });
  it("still models Tough and Alert without a feat table, as before", () => {
    const c = ctx("2014", false);
    expect(featTotals(["Tough", "Alert"], c)).toMatchObject({ hpPerLevel: 2, initiative: 5 });
    const legacy = build({ epicChoices: { 4: [{ name: "Mobile", isFeat: true, mods: { speed: 10 } }] }, feats: ["Mobile"] });
    expect(deriveSheet(legacy, c).speed).toBe(40);
  });
});
