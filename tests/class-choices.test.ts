// tests/class-choices.test.ts (push 21, audit G14): the right edition's choices, and nothing doubled.
import { describe, expect, it } from "vitest";
import { CLASS_CHOICES, choicesFor, choiceKey, resolveChoice } from "../lib/class-choices";

const features = (cls: string, sub: string, lv: number, ed: string) => choicesFor(cls, sub, lv, ed).map((c) => c.feature);

describe("class choices by edition", () => {
  it("does not offer 2024 choices to a 2014 character", () => {
    const f = features("Fighter", "Champion", 10, "2014");
    expect(f).not.toContain("Weapon Mastery");
    expect(f).toContain("Fighting Style");
    expect(f).toContain("Additional Fighting Style");
    expect(choicesFor("Fighter", "Champion", 9, "2014").some((c) => c.feature === "Additional Fighting Style")).toBe(false);
    expect(choicesFor("Fighter", "Champion", 7, "2024").some((c) => c.feature === "Additional Fighting Style")).toBe(true);
    const style = choicesFor("Fighter", "", 1, "2014").find((c) => c.feature === "Fighting Style")!;
    expect(style.kind).toBe("option");
    expect(style.filter?.named?.map((o) => o.name)).toEqual(["Archery", "Defense", "Dueling", "Great Weapon Fighting", "Protection", "Two-Weapon Fighting"]);
    expect(features("Wizard", "", 2, "2014")).not.toContain("Scholar");
    expect(features("Bard", "", 2, "2014")).not.toContain("Expertise");
    expect(features("Bard", "", 3, "2014")).toContain("Expertise");
    expect(features("Bard", "", 2, "2024")).toContain("Expertise");
  });

  it("gives warlocks the invocation list of their edition at the SRD levels", () => {
    const lv = (ed: string) => choicesFor("Warlock", "", 20, ed).filter((c) => c.feature.startsWith("Eldritch Invocations")).map((c) => [c.level, c.choose]);
    expect(lv("2014")).toEqual([[2, 2], [5, 1], [7, 1], [9, 1], [12, 1], [15, 1], [18, 1]]);
    const names2014 = choicesFor("Warlock", "", 2, "2014").find((c) => c.feature.startsWith("Eldritch Invocations"))!.filter!.named!.map((o) => o.name);
    expect(names2014).toContain("Beast Speech");
    expect(names2014).not.toContain("Lessons of the First Ones");
    expect(features("Warlock", "", 3, "2014")).toContain("Pact Boon");
  });

  it("treats the both-editions catalogue as 2024", () => {
    expect(features("Fighter", "", 1, "both")).toContain("Weapon Mastery");
  });

  it("keeps Mystic Arcanum, Spell Mastery and Signature Spells on their class list", () => {
    const spells = [
      { name: "True Seeing", level: "6", classes: ["Warlock", "Wizard"] }, { name: "Heal", level: "6", classes: ["Cleric"] },
      { name: "Shield", level: "1", classes: ["Wizard"] }, { name: "Cure Wounds", level: "1", classes: ["Cleric"] },
    ];
    const data = { skills: [], weapons: [], tools: [], spells, proficientSkills: [], feats: [] };
    const arc = choicesFor("Warlock", "", 11, "2024").find((c) => c.feature === "Mystic Arcanum")!;
    expect(resolveChoice(arc, data).map((o) => o.value)).toEqual(["True Seeing"]);
    const sm = choicesFor("Wizard", "", 18, "2014").find((c) => c.feature === "Spell Mastery (level 1)")!;
    expect(resolveChoice(sm, data).map((o) => o.value)).toEqual(["Shield"]);
    expect(choicesFor("Warlock", "", 17, "2014").filter((c) => c.feature.startsWith("Mystic Arcanum")).length).toBe(4);
  });

  it("never gives one character two choices with the same storage key", () => {
    for (const ed of ["2014", "2024"]) {
      const seen = new Map<string, number>();
      for (const c of CLASS_CHOICES.filter((x) => !x.edition || x.edition === ed)) {
        const k = choiceKey(c);
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
    }
  });

  it("has no empty named lists", () => {
    for (const c of CLASS_CHOICES) if (c.kind === "option") expect((c.filter?.named ?? []).length).toBeGreaterThan(0);
  });
});
