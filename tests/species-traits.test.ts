import { describe, expect, it } from "vitest";
import { shownSpeciesTraits } from "@/lib/descriptions";
import { parseFeatures } from "@/lib/ddb-parse";
import { speciesTraitsFromSheet } from "@/lib/ddb-import";

// Audit: species traits.
describe("shownSpeciesTraits", () => {
  it("uses SRD text when there is some, and adds the player's own", () => {
    const out = shownSpeciesTraits([{ name: "Darkvision", desc: "SRD text" }], [["Darkvision", "summary"]], [{ name: "Lucky Charm", desc: "Mine", from: "player" }]);
    expect(out.map((t) => t.name)).toEqual(["Darkvision", "Lucky Charm"]);
    expect(out[0].desc).toBe("SRD text");
  });
  it("falls back to the bundled summary when there is no SRD text", () => {
    expect(shownSpeciesTraits([], [["Celestial Resistance", "Resistance to necrotic and radiant damage."]], undefined))
      .toEqual([{ name: "Celestial Resistance", desc: "Resistance to necrotic and radiant damage." }]);
  });
  it("lets an own trait with the same name replace the built-in one, and skips empty ones", () => {
    const out = shownSpeciesTraits([], [["Healing Hands", "summary"]], [{ name: "healing hands", desc: "From my sheet", from: "sheet" }, { name: " ", desc: "" }]);
    expect(out).toEqual([{ name: "healing hands", desc: "From my sheet" }]);
  });
});

describe("species traits from a D&D Beyond sheet", () => {
  const blob = [
    "=== SPECIES TRAITS ===",
    "* Darkvision • PHB-2024 186",
    "| You can see in dim light within 60 feet.",
    "* Celestial Resistance • PHB-2024 186",
    "| Resistance to necrotic and radiant damage.",
    "=== CLASS FEATURES ===",
    "* Rage • PHB-2024 51",
    "| Bonus action.",
  ].join("\n");
  it("records the heading each feature sits under", () => {
    const f = parseFeatures([new Map([["FeaturesTraits1", blob]])]);
    expect(f.map((x) => [x.name, x.section])).toEqual([
      ["Darkvision", "SPECIES TRAITS"], ["Celestial Resistance", "SPECIES TRAITS"], ["Rage", "CLASS FEATURES"],
    ]);
  });
  it("keeps only the species (or racial) traits for the character", () => {
    const f = parseFeatures([new Map([["FeaturesTraits1", blob.replace("SPECIES TRAITS", "RACIAL TRAITS")]])]);
    const own = speciesTraitsFromSheet(f);
    expect(own.map((t) => t.name)).toEqual(["Darkvision", "Celestial Resistance"]);
    expect(own[0]).toEqual({ name: "Darkvision", desc: "You can see in dim light within 60 feet.", from: "sheet" });
  });
});
