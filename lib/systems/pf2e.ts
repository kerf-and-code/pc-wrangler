import type { RulesModule } from "./contract";

// Pathfinder 2e - the first CRUNCH module beyond D&D, and the real test of the plug-and-play seam.
//
// Built INCREMENTALLY. This first cut declares only the dice: d20-vs-dc with advantage OFF, because
// PF2e resolves with circumstance/status/item bonuses and four degrees of success (crit success on
// beat-DC-by-10 or a nat-20 bump; crit failure on miss-by-10 or a nat-1), not advantage/disadvantage.
//
// `character` and `adversary` are deliberately ABSENT for now. That means a PF2e campaign is
// creatable and rolls d20 today, while the D&D-shaped stat-block and encounter tools stay hidden
// (exactly like a narrative system) instead of showing D&D maths. Each capability is switched on HERE
// as its PF2e support is built, and the reusable machinery does the rest automatically:
//   - add `adversary` once the PF2e creature schema + encounter method land -> Monster Maker and the
//     encounter builder appear for PF2e and dispatch to PF2e logic;
//   - add `character` once the ancestry/class creator lands -> the creator appears.
// Nothing else needs editing: the system picker already lists it, and the nav gates off these fields.
export const pf2e: RulesModule = {
  id: "pf2e",
  label: "Pathfinder 2e",
  dice: { style: { kind: "d20-vs-dc", advantage: false }, label: "Roll d20" },
  // adversary ON: the PF2e Monster Maker (schema lib/pf2e/creature.ts) + the level-budget encounter
  // method (lib/pf2e/encounter.ts) are built, so these tools now appear for a PF2e campaign.
  adversary: { schemaId: "pf2e-creature", hasEncounterMath: true, encounterMethod: "pf2e", dataSource: "archives-of-nethys" },
  // character: still absent - the ancestry/class creator (step 3) is not built yet.
  axes: [],
  rulesRef: { id: "archives-of-nethys", label: "Archives of Nethys" },
};
