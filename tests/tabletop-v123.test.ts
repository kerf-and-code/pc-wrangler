import { describe, it, expect } from "vitest";
import { pcCombatant, pcSheetStats } from "@/lib/combat";
import { tokensInTemplate, type TemplateGeom } from "@/lib/tabletop/geometry";
import { templateLight } from "@/lib/tabletop/effects";

// Push 28: PCs join a fight with their sheet's numbers (V3), a template targets everyone inside it
// (V1), and fire or radiant templates light their surroundings (V2).

describe("pcSheetStats and pcCombatant (V3)", () => {
  it("brings AC, HP, initiative, speed and attacks from the saved sheet", () => {
    const c = pcCombatant({ id: "c1", name: "Bobert", snap: { darkvision: 60, ac: 16, hpMax: 44, init: 3, speed: 30, attacks: 2 }, play: { hp: 30, temp: 5 } });
    expect(c).toMatchObject({ kind: "pc", characterId: "c1", ac: 16, maxHp: 44, hp: 30, tempHp: 5, initBonus: 3, speed: 30, attacksPerAction: 2, initiative: null });
  });
  it("treats a missing or null tracker as full HP, and caps HP at the maximum", () => {
    expect(pcSheetStats({ snap: { hpMax: 20 }, play: {} }).hp).toBe(20);
    expect(pcSheetStats({ snap: { hpMax: 20 }, play: { hp: null } }).hp).toBe(20);
    expect(pcSheetStats({ snap: { hpMax: 20 }, play: { hp: 99 } }).hp).toBe(20);
    expect(pcSheetStats({ snap: { hpMax: 20 }, play: { hp: 0 } }).hp).toBe(0);
  });
  it("leaves everything empty for a sheet saved before push 28", () => {
    const c = pcCombatant({ id: "c2", name: "Old", snap: { darkvision: 0 }, play: { hp: 12 } });
    expect(c).toMatchObject({ hp: null, maxHp: null, tempHp: 0, ac: null, initBonus: 0 });
    expect(c.speed).toBeUndefined();
    expect(c.attacksPerAction).toBeUndefined();
    expect(pcCombatant({ id: "c3", name: "None" })).toMatchObject({ hp: null, ac: null, initBonus: 0 });
  });
  it("ignores numbers that are out of range or not numbers", () => {
    const s = pcSheetStats({ snap: { ac: 0, hpMax: "x", init: 99, speed: -5, attacks: 1 }, play: "nope" });
    expect(s).toEqual({ maxHp: null, hp: null, tempHp: 0, ac: null, initBonus: 0, speed: null, attacksPerAction: 1 });
    expect(pcCombatant({ id: "c4", name: "One", snap: { attacks: 1 } }).attacksPerAction).toBeUndefined();
  });
});

describe("tokensInTemplate (V1)", () => {
  const toks = [
    { id: "centre", x: 10.5, y: 10.5, size: 1 },
    { id: "edge", x: 13.5, y: 10.5, size: 1 },      // its near edge is 3 squares from the centre
    { id: "far", x: 14.5, y: 10.5, size: 1 },
    { id: "big", x: 7, y: 10.5, size: 2 },          // a large creature whose edge pokes in
  ];
  it("finds every token a 15 ft radius touches, by any part of it", () => {
    const fireball: TemplateGeom = { shape: "circle", x: 10.5, y: 10.5, size_ft: 15, width_ft: 5, rot: 0 };
    expect(tokensInTemplate(fireball, 5, toks).sort()).toEqual(["big", "centre", "edge"]);
  });
  it("follows a cone's direction", () => {
    const cone: TemplateGeom = { shape: "cone", x: 10, y: 10.5, size_ft: 20, width_ft: 5, rot: 0 };
    expect(tokensInTemplate(cone, 5, toks).sort()).toEqual(["centre", "edge", "far"]);
    expect(tokensInTemplate({ ...cone, rot: 180 }, 5, toks)).toEqual(["big"]);
  });
  it("does not catch a token the template only grazes at a corner", () => {
    const sq: TemplateGeom = { shape: "square", x: 0, y: 1, size_ft: 5, width_ft: 5, rot: 0 };   // covers x 0..1, y 0.5..1.5
    expect(tokensInTemplate(sq, 5, [{ id: "a", x: 0.5, y: 1, size: 1 }, { id: "b", x: 1.5, y: 2.5, size: 1 }])).toEqual(["a"]);
  });
});

describe("templateLight (V2)", () => {
  it("lights a brazier about as far as a torch", () => {
    const brazier = { shape: "square" as const, x: 5, y: 5.5, size_ft: 5, width_ft: 5, rot: 0, effect: "fire" };
    const L = templateLight(brazier, 5)!;
    expect(L.x).toBeCloseTo(5.5);
    expect(L.y).toBeCloseTo(5.5);
    expect(L.bright).toBeCloseTo(Math.SQRT1_2 + 2);
    expect(L.r).toBeCloseTo(Math.SQRT1_2 + 4);
  });
  it("lights radiant areas less far, and nothing else lights", () => {
    const circle = { shape: "circle" as const, x: 3, y: 3, size_ft: 10, width_ft: 5, rot: 0 };
    const L = templateLight({ ...circle, effect: "radiant" }, 5)!;
    expect(L.x).toBeCloseTo(3);
    expect(L.bright).toBeCloseTo(3);
    expect(L.r).toBeCloseTo(5);
    expect(templateLight({ ...circle, effect: "cold" }, 5)).toBeNull();
    expect(templateLight({ ...circle, effect: null }, 5)).toBeNull();
    expect(templateLight(circle, 5)).toBeNull();
  });
});
