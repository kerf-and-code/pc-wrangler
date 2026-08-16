import type { RulesModule } from "./contract";

// The D&D 5e module descriptor - the first module behind the contract. For now this is the DATA half:
// it declares what 5e provides. The existing feature COMPONENTS (the Forge character creator, the
// stat-block builder, the encounter balancer, the d20 roller) get wired to this descriptor one at a
// time as they're refactored, so nothing about them changes yet.
export const dnd5e: RulesModule = {
  id: "dnd5e",
  label: "D&D 5e (2024)",
  dice: { style: { kind: "d20-vs-dc", advantage: true }, label: "Roll d20" },
  character: { schemaId: "dnd5e", hasImport: true, hasDerivation: true },
  adversary: { schemaId: "dnd5e", hasEncounterMath: true, dataSource: "open5e" },
  axes: [{ id: "arcana", label: "Arcana", blurb: "Rules mastery and character-build optimization." }],
  rulesRef: { id: "srd-open5e", label: "SRD (Open5e)" },
};
