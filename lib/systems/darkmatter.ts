import type { RulesModule } from "./contract";

// Dark Matter (Mage Hand Press) - a science-fiction setting BUILT ON D&D 5e. Mechanically it IS 5e:
// d20 + modifier vs a DC with advantage/disadvantage, the same character math, and 5e-style stat blocks.
// So it reuses the whole D&D toolset rather than introducing a new dice style: the roller, the Forge,
// the Monster Maker, and the XP-budget encounter builder all dispatch to their D&D behavior for any
// system that is not one of the bespoke ones (pf2e / daggerheart / drawsteel / lancer), and Dark Matter
// is deliberately not bespoke. Declaring the capabilities here is what lights up those tools in the nav
// for a Dark Matter campaign and gives it its own label and rules reference.
//
// LICENSING: only the OPEN 5e mechanics engine is shared (the System Reference Document 5.1 is released
// by Wizards of the Coast under CC-BY-4.0). Mage Hand Press's own Dark Matter setting content - its
// classes, species, gear, and monsters - is proprietary and is NOT shipped here; a group uses the 5e
// engine and supplies that content themselves. Shipping MHP's material would need their permission.
export const darkmatter: RulesModule = {
  id: "darkmatter",
  label: "Dark Matter",
  dice: { style: { kind: "d20-vs-dc", advantage: true }, label: "Roll d20" },
  character: { schemaId: "dnd5e-pc", hasImport: true, hasDerivation: true },
  adversary: { schemaId: "dnd5e-statblock", hasEncounterMath: true, encounterMethod: "dnd5e", dataSource: "open5e" },
  axes: [],
  rulesRef: { id: "dnd-srd-5.1-cc-by", label: "D&D 5e SRD 5.1 (CC-BY-4.0)" },
};
