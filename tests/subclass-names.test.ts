// tests/subclass-names.test.ts: one subclass, several spellings (audit A11). These are the twelve the
// D&D Beyond import reported as missing, plus the catalog's short names.
import { describe, expect, it } from "vitest";
import { canonicalSubclass, sameSubclass, subclassKey } from "@/lib/subclass-names";

describe("subclass names", () => {
  it.each([
    ["College of Eloquence", "Eloquence"], ["College of Glamour", "Glamour"], ["College of Valor", "Valor"],
    ["Light Domain", "Light"], ["Twilight Domain", "Twilight"], ["Circle of the Moon", "Moon"],
    ["Warrior of Mercy", "Mercy"], ["Aberrant Sorcery", "Aberrant Mind"], ["Draconic Sorcery", "Draconic Bloodline"],
    ["The Undead", "Undead"], ["Necromancer", "Necromancy"],
  ])("%s is the catalog's %s", (book, catalog) => {
    expect(sameSubclass(book, catalog)).toBe(true);
  });
  it("keys a class's subclass the same way for every spelling", () => {
    expect(subclassKey("Cleric", "Light Domain")).toBe(subclassKey("cleric", "Light"));
    expect(subclassKey("Druid", "Circle of the Moon")).toBe("druid|moon");
    expect(subclassKey("Cleric", "Light")).not.toBe(subclassKey("Wizard", "Light"));
  });
  it("never matches an empty name", () => {
    expect(canonicalSubclass("")).toBe("");
    expect(sameSubclass("", "")).toBe(false);
  });
});
