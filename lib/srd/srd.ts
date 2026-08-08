// lib/srd/srd.ts
//
// The single entry point the builders use to read SRD data. It resolves the three-mode
// ruleset toggle (2024-only, 2014-only, or both) and, in "both" mode, unions the two
// per-edition files with a " (legacy)" suffix on any 2014 entry whose name collides with a
// 2024 one. See the builders project decision: extraction stays per-edition and clean; the
// merge happens here at load time so there is exactly one place that knows the rule.
//
// WHY A SUFFIX AND NOT A MERGE. A 2024 Fireball and a 2014 Fireball are different rules with
// the same name. We keep both and disambiguate rather than trying to reconcile them, because
// a GM in mix-and-match mode genuinely wants access to either version. Names that differ
// across editions (2024 "Goblin Warrior" vs 2014 "Goblin") are NOT collisions and both
// appear unsuffixed - that is correct, they are different entries.
//
// Import the JSON directly; these files ship in the bundle at lib/srd/<domain>-<year>.json.

import spells2024 from "./spells-2024.json";
import spells2014 from "./spells-2014.json";
import equipment2024 from "./equipment-2024.json";
import equipment2014 from "./equipment-2014.json";
import monsters2024 from "./monsters-2024.json";
import monsters2014 from "./monsters-2014.json";
import magicItems2024 from "./magic-items-2024.json";
import magicItems2014 from "./magic-items-2014.json";
import feats2024 from "./feats-2024.json";
import feats2014 from "./feats-2014.json";
import backgrounds2024 from "./backgrounds-2024.json";
import backgrounds2014 from "./backgrounds-2014.json";
import classes2024 from "./classes-2024.json";
import classes2014 from "./classes-2014.json";
import species2024 from "./species-2024.json";
import species2014 from "./species-2014.json";
import subclasses from "./subclasses.json";
// The Open5e / 5e-bits fetch (fetch_srd.py). SEPARATE domains rather than replacing classes-*.json,
// because the two hold different things: the originals carry the catalog fields the pickers filter
// on (partnered, partner, source), and these carry the progression TABLE and clean per-level
// feature text the originals never had. Swapping one for the other would trade a known gap for an
// unknown one; reading both means each is used for what it is good at.
import classesStructured2024 from "./classes-2024-structured.json";
import classesStructured2014 from "./classes-2014-structured.json";

export type Ruleset = "2024" | "2014" | "both";

// Domains that are flat lists keyed on `name`.
export type FlatDomain =
  | "spells" | "equipment" | "monsters" | "magic-items"
  | "feats" | "backgrounds" | "classes" | "classes-structured";

// species has its own shape; subclasses is edition-agnostic.
export type Domain = FlatDomain | "species" | "subclasses";

type Named = { name: string;[k: string]: unknown };
type SpeciesFile = { species: Named[]; variants: Named[] };
// Subclasses are keyed on `subclass`, not `name`, and are edition-agnostic (defined by
// source book). They get their own type rather than being forced into Named.
type Subclass = { subclass: string; class: string; partnered: boolean; partner: string | null;[k: string]: unknown };

const FLAT: Record<FlatDomain, { "2024": Named[]; "2014": Named[] }> = {
  spells: { "2024": spells2024 as unknown as Named[], "2014": spells2014 as unknown as Named[] },
  equipment: { "2024": equipment2024 as unknown as Named[], "2014": equipment2014 as unknown as Named[] },
  monsters: { "2024": monsters2024 as unknown as Named[], "2014": monsters2014 as unknown as Named[] },
  "magic-items": { "2024": magicItems2024 as unknown as Named[], "2014": magicItems2014 as unknown as Named[] },
  feats: { "2024": feats2024 as unknown as Named[], "2014": feats2014 as unknown as Named[] },
  backgrounds: { "2024": backgrounds2024 as unknown as Named[], "2014": backgrounds2014 as unknown as Named[] },
  classes: { "2024": classes2024 as unknown as Named[], "2014": classes2014 as unknown as Named[] },
  "classes-structured": {
    "2024": classesStructured2024 as unknown as Named[],
    "2014": classesStructured2014 as unknown as Named[],
  },
};

const SPECIES: { "2024": SpeciesFile; "2014": SpeciesFile } = {
  "2024": species2024 as unknown as SpeciesFile,
  "2014": species2014 as unknown as SpeciesFile,
};

// Union two name-keyed lists, suffixing " (legacy)" onto any `older` entry whose name
// already exists in `primary`. Entries unique to either side pass through unchanged.
function mergeNamed(primary: Named[], older: Named[]): Named[] {
  const taken = new Set(primary.map((x) => x.name));
  const out = [...primary];
  for (const x of older) {
    out.push(taken.has(x.name) ? { ...x, name: `${x.name} (legacy)` } : x);
  }
  return out;
}

// Overloads so callers get the right return type per domain.
export function loadSrd(domain: FlatDomain, mode: Ruleset): Named[];
export function loadSrd(domain: "species", mode: Ruleset): SpeciesFile;
export function loadSrd(domain: "subclasses", mode: Ruleset): Subclass[];
export function loadSrd(domain: Domain, mode: Ruleset): Named[] | SpeciesFile | Subclass[] {
  // Subclasses are a single edition-agnostic catalog: mode does not apply.
  if (domain === "subclasses") return subclasses as unknown as Subclass[];

  if (domain === "species") {
    if (mode === "2024") return SPECIES["2024"];
    if (mode === "2014") return SPECIES["2014"];
    return {
      species: mergeNamed(SPECIES["2024"].species, SPECIES["2014"].species),
      variants: mergeNamed(SPECIES["2024"].variants, SPECIES["2014"].variants),
    };
  }

  const pair = FLAT[domain];
  if (mode === "2024") return pair["2024"];
  if (mode === "2014") return pair["2014"];
  return mergeNamed(pair["2024"], pair["2014"]);
}

// Convenience: the partners a campaign has enabled filter partnered content. Pass the
// campaign's enabled partner names; WotC-core entries (partnered !== true) always pass.
export function filterByPartners<T extends { partnered?: boolean; partner?: string | null }>(
  rows: T[],
  enabledPartners: string[],
): T[] {
  const enabled = new Set(enabledPartners);
  return rows.filter((r) => !r.partnered || (r.partner != null && enabled.has(r.partner)));
}
