// lib/party/coverage.ts
//
// The ONE shared party-coverage engine, used by both the in-app coverage read (app/gm/page.tsx) and the
// free no-login tool (components/party-coverage.tsx). It answers a single question every table asks: does
// the party have its bases covered, or is there a hole (no healer, no front line, no face)?
//
// TWO LAYERS, one model:
//   - The UNIVERSAL layer: seven roles that every supported system speaks. This is "basic balance" and it
//     works for D&D, Pathfinder 2e, Draw Steel, Daggerheart, Call of Cthulhu, and any generic d10-pool
//     game. Roles come from small per-system tables (class -> roles, domain -> roles, archetype -> roles),
//     or from the player just declaring them when a system has no class list.
//   - The DEEP D&D layer: the full 12 capability tags from the `class_capabilities` table, with
//     per-subclass and third-party resolution. This is the app's premium read. The 12 tags roll straight
//     up into the 7 universal roles (see DND_TAG_TO_ROLE), so D&D fits the universal model for free while
//     keeping its extra resolution.
//
// The free tool ships ONLY the universal layer (static class lists, no DB). The deep 12-tag read stays an
// app feature because it needs the live class_capabilities table (subclasses + third-party content). That
// split is the upsell, and it keeps third-party class data out of the free bundle.

// ----------------------------------------------------------------------------------------------------
// Universal role model (7 roles)
// ----------------------------------------------------------------------------------------------------

export type Role =
  | "defense"
  | "melee"
  | "ranged"
  | "control"
  | "healing"
  | "support"
  | "faceUtility";

export const ROLES: Role[] = [
  "defense",
  "melee",
  "ranged",
  "control",
  "healing",
  "support",
  "faceUtility",
];

export const ROLE_LABEL: Record<Role, string> = {
  defense: "Defense / Frontline",
  melee: "Melee",
  ranged: "Ranged",
  control: "Control",
  healing: "Healing",
  support: "Support",
  faceUtility: "Face & Utility",
};

// The question each role answers, for the "what a balanced party has" explainer.
export const ROLE_QUESTION: Record<Role, string> = {
  defense: "Someone to hold the line and take hits",
  melee: "Damage up close",
  ranged: "Damage and reach at a distance",
  control: "Shaping the fight: area effects and locking enemies down",
  healing: "Keeping the party on its feet",
  support: "Buffing allies and weakening enemies",
  faceUtility: "Talking, sneaking, and solving problems out of combat",
};

// How a gap reads when a role is missing.
export const ROLE_GAP: Record<Role, string> = {
  defense: "No front line to hold the line",
  melee: "No melee damage",
  ranged: "No ranged option",
  control: "No control or area effects",
  healing: "No healer",
  support: "No support or buffs",
  faceUtility: "No face or utility (social, stealth, problem-solving)",
};

// ----------------------------------------------------------------------------------------------------
// Deep D&D layer: the 12 capability tags from class_capabilities
// ----------------------------------------------------------------------------------------------------

export type DndTag =
  | "tank"
  | "melee"
  | "single_target"
  | "ranged"
  | "aoe"
  | "control"
  | "healing"
  | "support"
  | "face"
  | "stealth"
  | "detect_magic"
  | "utility";

export const DND_TAGS: DndTag[] = [
  "tank",
  "melee",
  "single_target",
  "ranged",
  "aoe",
  "control",
  "healing",
  "support",
  "face",
  "stealth",
  "detect_magic",
  "utility",
];

export const DND_TAG_LABEL: Record<DndTag, string> = {
  tank: "Tank",
  melee: "Melee",
  single_target: "Single-target damage",
  ranged: "Ranged",
  aoe: "Area damage",
  control: "Control",
  healing: "Healing",
  support: "Support",
  face: "Face",
  stealth: "Stealth",
  detect_magic: "Detect magic",
  utility: "Utility",
};

// Each of the 12 tags rolls up into exactly one of the 7 universal roles. Notes on the less-obvious ones:
//   - single_target is focused damage; we treat it as a melee/striker proxy so a striker never reads as
//     "no damage". The deep read still shows single_target on its own.
//   - aoe rolls into control (area effect = shaping the fight); the deep read keeps aoe separate.
//   - face / stealth / detect_magic / utility all roll into the combined Face & Utility role.
export const DND_TAG_TO_ROLE: Record<DndTag, Role> = {
  tank: "defense",
  melee: "melee",
  single_target: "melee",
  ranged: "ranged",
  aoe: "control",
  control: "control",
  healing: "healing",
  support: "support",
  face: "faceUtility",
  stealth: "faceUtility",
  detect_magic: "faceUtility",
  utility: "faceUtility",
};

export function rolesFromDndTags(tags: DndTag[]): Role[] {
  const set = new Set<Role>();
  for (const t of tags) {
    const r = DND_TAG_TO_ROLE[t];
    if (r) set.add(r);
  }
  return ROLES.filter((r) => set.has(r));
}

// ----------------------------------------------------------------------------------------------------
// Per-system role tables (the universal layer)
// ----------------------------------------------------------------------------------------------------

// D&D 5e base classes at the coarse 7-role level, for the FREE tool only (the app uses the deep table).
// Deliberately a rough baseline: any class can be built off-type, and subclasses shift things. The app's
// class_capabilities read is the authoritative version.
export const DND_CLASS_ROLES: Record<string, Role[]> = {
  artificer: ["support", "control", "ranged"],
  barbarian: ["melee", "defense"],
  bard: ["support", "faceUtility", "healing"],
  cleric: ["healing", "support", "control"],
  druid: ["control", "healing"],
  fighter: ["melee", "defense", "ranged"],
  monk: ["melee", "faceUtility"],
  paladin: ["defense", "melee", "support"],
  ranger: ["ranged", "faceUtility", "melee"],
  rogue: ["faceUtility", "melee", "ranged"],
  sorcerer: ["control", "ranged"],
  warlock: ["ranged", "control"],
  wizard: ["control", "faceUtility"],
};

// Pathfinder 2e classes (primary + secondary), from the community role framework. Grows as classes ship.
export const PF2E_CLASS_ROLES: Record<string, Role[]> = {
  fighter: ["melee", "defense"],
  rogue: ["faceUtility", "melee"],
  cleric: ["healing", "support"],
  wizard: ["control", "faceUtility"],
  champion: ["defense", "support"],
  barbarian: ["melee", "defense"],
  ranger: ["ranged", "melee"],
  bard: ["support", "faceUtility"],
  sorcerer: ["control", "ranged"],
  druid: ["control", "healing"],
  monk: ["melee", "faceUtility"],
  oracle: ["healing", "control"],
  witch: ["control", "support"],
  investigator: ["faceUtility", "melee"],
  swashbuckler: ["melee", "faceUtility"],
  alchemist: ["support", "ranged"],
  gunslinger: ["ranged", "melee"],
  magus: ["melee", "control"],
  kineticist: ["ranged", "control"],
  thaumaturge: ["melee", "faceUtility"],
  psychic: ["control", "ranged"],
  guardian: ["defense", "support"],
  commander: ["support", "control"],
};

// Draw Steel heroes (primary + secondary), from the nine class identities.
export const DRAWSTEEL_CLASS_ROLES: Record<string, Role[]> = {
  fury: ["melee", "defense"],
  censor: ["melee", "control"],
  shadow: ["melee", "faceUtility"],
  null: ["control", "defense"],
  talent: ["control", "ranged"],
  elementalist: ["control", "ranged"],
  conduit: ["healing", "support"],
  tactician: ["support", "defense"],
  troubadour: ["faceUtility", "support"],
};

// Daggerheart: derive class roles from the two domains each class carries (domains map onto roles). This
// mirrors the domain data in lib/daggerheart/rules-data.ts; kept here so the engine (and the free tool)
// stay self-contained.
export const DH_DOMAIN_ROLE: Record<string, Role[]> = {
  valor: ["defense"],
  blade: ["melee"],
  bone: ["ranged"],
  arcana: ["control"],
  codex: ["control", "faceUtility"],
  splendor: ["healing"],
  sage: ["healing", "faceUtility"],
  grace: ["faceUtility"],
  midnight: ["faceUtility"],
};

export const DH_CLASS_DOMAINS: Record<string, [string, string]> = {
  guardian: ["valor", "blade"],
  warrior: ["blade", "bone"],
  ranger: ["bone", "sage"],
  seraph: ["splendor", "valor"],
  wizard: ["codex", "splendor"],
  bard: ["codex", "grace"],
  rogue: ["grace", "midnight"],
  sorcerer: ["arcana", "midnight"],
  druid: ["arcana", "sage"],
};

function rolesFromDomains(domains: [string, string]): Role[] {
  const set = new Set<Role>();
  for (const d of domains) for (const r of DH_DOMAIN_ROLE[d] ?? []) set.add(r);
  return ROLES.filter((r) => set.has(r));
}

// Call of Cthulhu: skill/occupation game, so parity comes from investigator archetypes rather than combat
// classes. Control and Support do not apply, and the system config below reflects that.
export const COC_ARCHETYPE_ROLES: Record<string, Role[]> = {
  combatant: ["melee", "ranged", "defense"],
  medic: ["healing"],
  face: ["faceUtility"],
  scholar: ["faceUtility"],
  investigator: ["faceUtility"],
  operator: ["faceUtility"],
};

// ----------------------------------------------------------------------------------------------------
// System configuration (drives the free tool's inputs and the relevant-role set)
// ----------------------------------------------------------------------------------------------------

export type CoverageSystem = "dnd" | "pf2e" | "drawsteel" | "daggerheart" | "coc" | "generic";

export type InputMode = "class" | "archetype" | "roles";

export interface CoverageOption {
  value: string;
  label: string;
  roles: Role[];
}

export interface SystemConfig {
  id: CoverageSystem;
  label: string;
  inputMode: InputMode;
  options: CoverageOption[]; // empty for inputMode "roles"
  relevantRoles: Role[]; // which of the 7 roles this system is scored against
  memberNoun: string; // "character", "hero", "investigator"
  note?: string; // an honest one-liner about coverage in this system
}

function opt(value: string, roles: Role[]): CoverageOption {
  return { value, label: titleCase(value), roles };
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fromTable(table: Record<string, Role[]>): CoverageOption[] {
  return Object.keys(table)
    .sort()
    .map((k) => opt(k, table[k]));
}

const DH_OPTIONS: CoverageOption[] = Object.keys(DH_CLASS_DOMAINS)
  .sort()
  .map((k) => opt(k, rolesFromDomains(DH_CLASS_DOMAINS[k])));

const COC_OPTIONS: CoverageOption[] = [
  { value: "combatant", label: "Combatant (Soldier, Police, Criminal)", roles: COC_ARCHETYPE_ROLES.combatant },
  { value: "medic", label: "Medic (Doctor, Nurse)", roles: COC_ARCHETYPE_ROLES.medic },
  { value: "face", label: "Face (Author, Dilettante, Salesman)", roles: COC_ARCHETYPE_ROLES.face },
  { value: "scholar", label: "Scholar (Professor, Antiquarian, Librarian)", roles: COC_ARCHETYPE_ROLES.scholar },
  { value: "investigator", label: "Investigator (Detective, Reporter)", roles: COC_ARCHETYPE_ROLES.investigator },
  { value: "operator", label: "Operator (Engineer, Driver, Pilot)", roles: COC_ARCHETYPE_ROLES.operator },
];

const COC_ROLES: Role[] = ["defense", "melee", "ranged", "healing", "faceUtility"];

export const SYSTEMS: SystemConfig[] = [
  {
    id: "dnd",
    label: "D&D 5e",
    inputMode: "class",
    options: fromTable(DND_CLASS_ROLES),
    relevantRoles: ROLES,
    memberNoun: "character",
    note: "Basic read here. In the app, D&D coverage is class-and-subclass aware, includes third-party classes, and fills in from your players' actual characters.",
  },
  {
    id: "pf2e",
    label: "Pathfinder 2e",
    inputMode: "class",
    options: fromTable(PF2E_CLASS_ROLES),
    relevantRoles: ROLES,
    memberNoun: "character",
    note: "Pathfinder 2e blurs roles on purpose, so treat these as typical, not locked.",
  },
  {
    id: "drawsteel",
    label: "Draw Steel",
    inputMode: "class",
    options: fromTable(DRAWSTEEL_CLASS_ROLES),
    relevantRoles: ROLES,
    memberNoun: "hero",
  },
  {
    id: "daggerheart",
    label: "Daggerheart",
    inputMode: "class",
    options: DH_OPTIONS,
    relevantRoles: ROLES,
    memberNoun: "character",
    note: "Roles come from each class's two domains.",
  },
  {
    id: "coc",
    label: "Call of Cthulhu",
    inputMode: "archetype",
    options: COC_OPTIONS,
    relevantRoles: COC_ROLES,
    memberNoun: "investigator",
    note: "Investigation, not combat: coverage means a fighter, a medic, a talker, and a scholar. Control and support don't apply.",
  },
  {
    id: "generic",
    label: "Other / d10 pool",
    inputMode: "roles",
    options: [],
    relevantRoles: ROLES,
    memberNoun: "character",
    note: "No class list for this system, so pick each character's roles by hand.",
  },
];

export function systemConfig(id: CoverageSystem): SystemConfig {
  return SYSTEMS.find((s) => s.id === id) ?? SYSTEMS[0];
}

export function rolesForOption(system: CoverageSystem, value: string): Role[] {
  const cfg = systemConfig(system);
  return cfg.options.find((o) => o.value === value)?.roles ?? [];
}

// class value (as stored on a character row) -> universal roles, for the app's roster read. The roster
// stores each system's class NAME; we normalize case/whitespace so "Fury" and "fury" both resolve. Only
// systems with a real class list map (D&D, PF2e, Draw Steel, Daggerheart); free-text-class systems (CoC
// occupation, d10 concept) return [] and simply get no coverage panel.
const CLASS_TABLES: Partial<Record<CoverageSystem, Record<string, Role[]>>> = {
  dnd: DND_CLASS_ROLES,
  pf2e: PF2E_CLASS_ROLES,
  drawsteel: DRAWSTEEL_CLASS_ROLES,
};

export function rolesForClass(system: CoverageSystem, className: string): Role[] {
  const key = className.trim().toLowerCase();
  if (!key) return [];
  if (system === "daggerheart") {
    const domains = DH_CLASS_DOMAINS[key];
    return domains ? rolesFromDomains(domains) : [];
  }
  const table = CLASS_TABLES[system];
  return table ? table[key] ?? [] : [];
}

// Which classes in a system can fill a given role, for the "fill with" suggestion next to a gap.
export function classesForRole(system: CoverageSystem, role: Role, limit = 4): string[] {
  const out: string[] = [];
  for (const o of systemConfig(system).options) {
    if (o.roles.includes(role)) out.push(o.label);
    if (out.length >= limit) break;
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------
// Coverage computation
// ----------------------------------------------------------------------------------------------------

export interface PartyMember {
  label?: string;
  roles: Role[];
}

export interface Coverage {
  relevant: Role[];
  present: Role[];
  missing: Role[];
  contributors: Record<Role, string[]>; // role -> member labels covering it
}

function emptyContributors(): Record<Role, string[]> {
  const out = {} as Record<Role, string[]>;
  for (const r of ROLES) out[r] = [];
  return out;
}

export function computeCoverage(system: CoverageSystem, members: PartyMember[]): Coverage {
  const relevant = systemConfig(system).relevantRoles;
  const contributors = emptyContributors();
  members.forEach((m, i) => {
    const label = m.label && m.label.trim() ? m.label.trim() : defaultLabel(system, i);
    for (const r of m.roles) contributors[r].push(label);
  });
  const present = relevant.filter((r) => contributors[r].length > 0);
  const missing = relevant.filter((r) => contributors[r].length === 0);
  return { relevant, present, missing, contributors };
}

function defaultLabel(system: CoverageSystem, i: number): string {
  const noun = systemConfig(system).memberNoun;
  return `${titleCase(noun)} ${i + 1}`;
}

// ----------------------------------------------------------------------------------------------------
// Deep D&D coverage (app only): takes class_capabilities-derived tag lists per party member
// ----------------------------------------------------------------------------------------------------

export interface DndMember {
  label?: string;
  capabilities: DndTag[];
}

export interface DndDeepCoverage {
  present: DndTag[];
  missing: DndTag[];
  contributors: Record<DndTag, string[]>;
  role: Coverage; // the 7-role rollup, so the app can show both views
}

export function dndDeepCoverage(members: DndMember[]): DndDeepCoverage {
  const contributors = {} as Record<DndTag, string[]>;
  for (const t of DND_TAGS) contributors[t] = [];
  const roleMembers: PartyMember[] = members.map((m, i) => {
    const label = m.label && m.label.trim() ? m.label.trim() : `Character ${i + 1}`;
    for (const cap of m.capabilities) {
      if (contributors[cap]) contributors[cap].push(label);
    }
    return { label, roles: rolesFromDndTags(m.capabilities) };
  });
  const present = DND_TAGS.filter((t) => contributors[t].length > 0);
  const missing = DND_TAGS.filter((t) => contributors[t].length === 0);
  const role = computeCoverage("dnd", roleMembers);
  return { present, missing, contributors, role };
}
