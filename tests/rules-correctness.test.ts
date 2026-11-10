import { describe, expect, it } from "vitest";
import { casterLevel, multiclassSlots } from "@/lib/multiclass-slots";
import { subclassSpellsFor } from "@/lib/subclass-spells";
import authored2014 from "@/lib/srd/subclasses-authored-2014.json";
import authored2024 from "@/lib/srd/subclasses-authored-2024.json";

// Push 11, rules correctness.

describe("multiclass spell slots (audit B13)", () => {
  it("rounds half casters down in 2014 and up in 2024", () => {
    const pal3sorc3 = [{ casterType: "HALF" as const, level: 3 }, { casterType: "FULL" as const, level: 3 }];
    expect(casterLevel(pal3sorc3, "2014")).toBe(4);
    expect(casterLevel(pal3sorc3, "2024")).toBe(5);
    expect(multiclassSlots(casterLevel(pal3sorc3, "2024")).map((r) => r.level)).toContain(3);
  });
  it("still rounds each class on its own", () => {
    const pal3ran3 = [{ casterType: "HALF" as const, level: 3 }, { casterType: "HALF" as const, level: 3 }];
    expect(casterLevel(pal3ran3, "2014")).toBe(2);
    expect(casterLevel(pal3ran3, "2024")).toBe(4);
  });
  it("keeps third casters rounding down in both", () => {
    const ek4wiz2 = [{ casterType: "THIRD" as const, level: 4 }, { casterType: "FULL" as const, level: 2 }];
    expect(casterLevel(ek4wiz2, "2014")).toBe(3);
    expect(casterLevel(ek4wiz2, "2024")).toBe(3);
  });
});

type Rec = { class: string; name: string; features_by_level?: { level: number; features?: { name: string; desc?: string }[] }[] };

// Every authored subclass whose own text lists spells "always prepared at <class> levels" must grant
// them (audit G16): a missing list silently left those spells off the Spells tab. (Single spells a
// feature keeps prepared, like Find Steed, are features, not subclass spell lists, and not checked.)
describe("authored always-prepared spells (audit G16)", () => {
  for (const [edition, pool] of [["2014", authored2014], ["2024", authored2024]] as const) {
    const recs = (pool as unknown as Rec[]).filter((r) =>
      (r.features_by_level || []).some((row) => (row.features || []).some((f) => /always prepared at \w+ levels/i.test(f.desc || ""))));
    it.each(recs.map((r) => [r.class, r.name] as const))(`${edition} %s %s grants its spells`, (cls, name) => {
      expect(subclassSpellsFor(name, 20, {}, edition, cls).length).toBeGreaterThan(0);
    });
  }
});

describe("subclass spell lists stay with their class (audit G16)", () => {
  it("gives the Black Powder Domain cleric its list and the School of Black Powder wizard none of it", () => {
    expect(subclassSpellsFor("Black Powder Domain", 9, {}, "2014", "Cleric").map((s) => s.spell)).toContain("Fireball");
    expect(subclassSpellsFor("School of Black Powder", 9, {}, "2014", "Wizard")).toEqual([]);
  });
  it("level-gates the new lists", () => {
    expect(subclassSpellsFor("Oath of Zeal", 4, {}, "2014", "Paladin").map((s) => s.spell)).toEqual(["Detect Evil and Good", "Hunter's Mark"]);
  });
});
