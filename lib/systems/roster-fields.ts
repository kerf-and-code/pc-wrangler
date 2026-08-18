// What the GM workspace roster's quick add/edit should show for a campaign's system. The workspace
// stores a lightweight character row with the D&D-shaped denorm columns (name, class, subclass, species,
// level); this maps each non-D&D system's actual choices onto those columns with the right LABELS and
// OPTION LISTS, so the roster reflects what a character in that system can really pick instead of always
// showing D&D classes and species.
//
// D&D-family systems (5e / 2014 / 5.5e / dnd5e, and Dark Matter which is 5e-compatible) return null: the
// workspace keeps its existing rich D&D roster (species + variant + subclass catalog + coverage). Every
// other system gets a spec. Full accuracy where the option data exists (Lancer, Draw Steel, Daggerheart);
// an honest free-text field where it doesn't yet (PF2e's catalog isn't wired here; CoC/Vampire are
// narrative and have no class/level catalog), to be upgraded as those systems are built out.

import { LANCER_FRAME_LIST } from "@/lib/lancer/rules-data";
import { DS_CLASS_LIST, DS_ANCESTRY_LIST, DS_KIT_LIST } from "@/lib/drawsteel/rules-data";
import { DH_CLASS_LIST, DH_ANCESTRY_LIST } from "@/lib/daggerheart/rules-data";
import { PF2_RULES } from "@/lib/pf2e/rules-data";

// A roster field writes one of the character row's columns. `options` empty = a free-text input (the
// GM types it); otherwise a constrained select. `optional` fields may be left blank.
export interface RosterField {
  col: "class" | "subclass" | "species";
  label: string;
  options: { value: string; label: string }[];
  optional?: boolean;
}

export interface RosterSpec {
  fields: RosterField[];                                  // the non-name, non-level identity fields, in order
  level: { show: boolean; label: string; min: number; max: number };
}

const opt = <T extends { name: string }>(xs: T[], fmt?: (x: T) => string) =>
  xs.map((x) => ({ value: x.name, label: fmt ? fmt(x) : x.name }));

// D&D and its 5e-compatible settings resolve here and keep the existing workspace roster.
const DND_FAMILY = new Set(["5e", "2014", "5.5e", "dnd5e", "darkmatter"]);

export function getRosterFields(system: string | null | undefined): RosterSpec | null {
  const sys = system || "5e";
  if (DND_FAMILY.has(sys)) return null;

  switch (sys) {
    case "lancer":
      return {
        fields: [
          { col: "class", label: "Frame", options: opt(LANCER_FRAME_LIST, (f) => f.licenseLevel ? `${f.name} (LL${f.licenseLevel})` : f.name) },
        ],
        level: { show: true, label: "License level", min: 0, max: 12 },
      };
    case "drawsteel":
      return {
        fields: [
          { col: "class", label: "Class", options: opt(DS_CLASS_LIST) },
          { col: "species", label: "Ancestry", options: opt(DS_ANCESTRY_LIST), optional: true },
          { col: "subclass", label: "Kit", options: opt(DS_KIT_LIST), optional: true },
        ],
        level: { show: true, label: "Level", min: 1, max: 10 },
      };
    case "daggerheart":
      return {
        fields: [
          { col: "class", label: "Class", options: opt(DH_CLASS_LIST) },
          { col: "species", label: "Ancestry", options: opt(DH_ANCESTRY_LIST), optional: true },
        ],
        level: { show: true, label: "Level", min: 1, max: 10 },
      };
    case "coc7e":
      // Call of Cthulhu investigators have an occupation and no levels.
      return {
        fields: [{ col: "class", label: "Occupation", options: [] }],
        level: { show: false, label: "Level", min: 1, max: 20 },
      };
    case "poold10":
      // The generic d10 pool (unbranded Vampire): a character concept, no levels.
      return {
        fields: [{ col: "class", label: "Concept", options: [] }],
        level: { show: false, label: "Level", min: 1, max: 20 },
      };
    case "pf2e":
      return {
        fields: [
          { col: "class", label: "Class", options: opt(Object.values(PF2_RULES.classes)) },
          { col: "species", label: "Ancestry", options: opt(Object.values(PF2_RULES.ancestries)), optional: true },
        ],
        level: { show: true, label: "Level", min: 1, max: 20 },
      };
    default:
      // Any other non-D&D system: a name, a free-text role, and a level.
      return {
        fields: [{ col: "class", label: "Class", options: [] }],
        level: { show: true, label: "Level", min: 1, max: 20 },
      };
  }
}
