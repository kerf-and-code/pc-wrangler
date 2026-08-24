// Bastion rules dataset for the Bastion designer (2024 D&D bastion system). MECHANICS ONLY: facility
// names, levels, prerequisites, space sizes, hireling counts, orders, and gp/time costs, plus short
// in-house one-line summaries of each facility's benefit. None of the publisher's descriptive or
// benefit prose ships here - the notes are our own compression of the mechanics. Sourced from the
// bastion rules Terry provided; this is data + pure helpers, no React and no I/O, so it type-checks and
// unit-tests cleanly on its own.
//
// The designer uses this for: gating the facility picker by character level and prerequisites (the
// "level chooser" and "class chooser"), validating placement footprints (space -> squares), and the
// costs/summary panel. The ship/mobile bastion uses the `propulsion` flag to require a Helm.

// ---- structural constants ----------------------------------------------------------------------

export const BASTION_START_LEVEL = 5;   // characters gain a bastion at level 5
export const BASTION_TURN_DAYS = 7;     // a bastion turn is 7 in-game days by default

export type FacilitySpace = "Cramped" | "Roomy" | "Vast";
export const SPACE_SQUARES: Record<FacilitySpace, number> = { Cramped: 4, Roomy: 16, Vast: 36 };
export function spaceSquares(space: FacilitySpace): number { return SPACE_SQUARES[space]; }

export type BastionOrder = "Craft" | "Empower" | "Harvest" | "Maintain" | "Recruit" | "Research" | "Trade";
export const BASTION_ORDERS: BastionOrder[] = ["Craft", "Empower", "Harvest", "Maintain", "Recruit", "Research", "Trade"];

// Basic facilities: no game effect, pure verisimilitude. A bastion starts with two free (one Cramped,
// one Roomy). They CAN be bought and enlarged (unlike special facilities).
export const BASIC_FACILITIES: string[] = ["Bedroom", "Dining Room", "Parlor", "Courtyard", "Kitchen", "Storage"];

export const BASIC_ADD_COST: Record<FacilitySpace, { gp: number; days: number }> = {
  Cramped: { gp: 500, days: 20 },
  Roomy: { gp: 1000, days: 45 },
  Vast: { gp: 3000, days: 125 },
};

export const BASIC_ENLARGE_COST: { from: FacilitySpace; to: FacilitySpace; gp: number; days: number }[] = [
  { from: "Cramped", to: "Roomy", gp: 500, days: 25 },
  { from: "Roomy", to: "Vast", gp: 2000, days: 80 },
];

// Total special facilities a character has by level (they are gained through advancement, not bought).
export const SPECIAL_ACQUISITION: { level: number; total: number }[] = [
  { level: 5, total: 2 }, { level: 9, total: 4 }, { level: 13, total: 5 }, { level: 17, total: 6 },
];
export function specialFacilitySlotsAt(level: number): number {
  const lv = Math.floor(level) || 0;
  if (lv >= 17) return 6;
  if (lv >= 13) return 5;
  if (lv >= 9) return 4;
  if (lv >= 5) return 2;
  return 0;
}

// Defensive walls: 20 ft high, per 5-ft square. Not allowed on a mobile (ship) bastion.
export const DEFENSIVE_WALL = { gpPerSquare: 250, daysPerSquare: 10, heightFt: 20 } as const;

// Mobile / ship bastion: must be built in a vehicle form and include a propulsion special facility (a
// Helm). No defensive walls. The propulsion facilities are flagged `propulsion` below.
export const MOBILE_RULES = {
  requiresPropulsionFacility: true,
  allowsDefensiveWalls: false,
  note: "A mobile bastion must be built in a vehicle and include a propulsion facility (a Helm). Facilities may be sized slightly to fit, at the DM's discretion. No defensive walls.",
} as const;

// Free, placeable-anywhere features (no cost, no squares) - the builder offers these as annotations.
export const FREE_FEATURES: string[] = ["Closet", "Washroom", "Corridor", "Ramp", "Staircase", "Door", "Window"];

// ---- prerequisites -----------------------------------------------------------------------------

export type PrereqKind =
  | "none"
  | "arcane-focus"        // can use an Arcane Focus or a tool as a Spellcasting Focus
  | "holy-druidic-focus"  // can use a Holy Symbol or Druidic Focus as a Spellcasting Focus
  | "spellcasting-focus"  // can use any Spellcasting Focus
  | "artisan-tools-focus" // can use Artisan's Tools as a Spellcasting Focus
  | "expertise"           // Expertise in a skill
  | "martial-feature"     // Fighting Style or Unarmored Defense feature
  | "skill-proficiency"   // proficiency in a named skill
  | "faction"             // membership in a faction (setting content)
  | "renown";             // renown score with a house (setting content)

export interface FacilityPrereq {
  kind: PrereqKind;
  label: string;            // exact requirement text, shown in the UI
  skill?: string;           // for skill-proficiency
  faction?: string;         // for faction
  house?: string;           // for renown ("any" = any dragonmarked house)
  renownReq?: number;       // for renown
  extra?: FacilityPrereq;   // a second requirement that must ALSO be met (e.g. Red Wizard Necropolis)
}

const P_NONE: FacilityPrereq = { kind: "none", label: "None" };
const P_ARCANE: FacilityPrereq = { kind: "arcane-focus", label: "Can use an Arcane Focus or a tool as a Spellcasting Focus" };
const P_HOLY: FacilityPrereq = { kind: "holy-druidic-focus", label: "Can use a Holy Symbol or Druidic Focus as a Spellcasting Focus" };
const P_SPELLFOCUS: FacilityPrereq = { kind: "spellcasting-focus", label: "Can use a Spellcasting Focus" };
const P_ARTISAN: FacilityPrereq = { kind: "artisan-tools-focus", label: "Can use Artisan's Tools as a Spellcasting Focus" };
const P_EXPERTISE: FacilityPrereq = { kind: "expertise", label: "Expertise in a skill" };
const P_MARTIAL: FacilityPrereq = { kind: "martial-feature", label: "Fighting Style or Unarmored Defense feature" };
const pSkill = (s: string): FacilityPrereq => ({ kind: "skill-proficiency", label: `Proficiency in the ${s} skill`, skill: s });
const pFaction = (f: string, extra?: FacilityPrereq): FacilityPrereq => ({ kind: "faction", label: `Membership in the ${f}`, faction: f, extra });
const pRenown = (house: string, n: number): FacilityPrereq =>
  ({ kind: "renown", label: house === "any" ? `Renown ${n}+ with any dragonmarked house` : `Renown ${n}+ with ${house}`, house, renownReq: n });

// ---- facilities --------------------------------------------------------------------------------

export type FacilitySource = "base" | "forgotten-realms" | "eberron" | "ravenloft";
export const SOURCE_LABEL: Record<FacilitySource, string> = {
  base: "Core", "forgotten-realms": "Forgotten Realms", eberron: "Eberron", ravenloft: "Ravenloft",
};

export interface SpecialFacility {
  id: string;
  name: string;
  level: 5 | 9 | 13 | 17;
  prereq: FacilityPrereq;
  space: FacilitySpace;
  hirelings: number;
  hirelingsNote?: string;   // when the count is a minimum or grows (War Room)
  order: BastionOrder;
  source: FacilitySource;
  note: string;             // in-house one-line mechanics summary (not the book's prose)
  enlargeToVastGp?: number; // cost to enlarge to Vast, for facilities that allow it
  propulsion?: boolean;     // a Helm: qualifies a mobile/ship bastion
  noMapSpace?: boolean;     // occupies no squares on the map (Liminal Space)
  alwaysHaunted?: boolean;  // always counts as Haunted
}

const f = (
  id: string, name: string, level: 5 | 9 | 13 | 17, prereq: FacilityPrereq, space: FacilitySpace,
  hirelings: number, order: BastionOrder, source: FacilitySource, note: string,
  opts?: Partial<Pick<SpecialFacility, "enlargeToVastGp" | "propulsion" | "noMapSpace" | "alwaysHaunted" | "hirelingsNote">>,
): SpecialFacility => ({ id, name, level, prereq, space, hirelings, order, source, note, ...opts });

export const SPECIAL_FACILITIES: SpecialFacility[] = [
  // ---- Core (base game) ----
  f("arcane_study", "Arcane Study", 5, P_ARCANE, "Roomy", 1, "Craft", "base",
    "Weekly Identify charm; Craft an Arcane Focus, a blank book, or (L9+) a Common/Uncommon Arcana magic item."),
  f("armory", "Armory", 5, P_NONE, "Roomy", 1, "Trade", "base",
    "Stock arms (100 gp +100/defender, halved with a Smithy) so Defenders roll d8s instead of d6s in an attack; spent after each attack."),
  f("barrack", "Barrack", 5, P_NONE, "Roomy", 1, "Recruit", "base",
    "Quarters for up to 12 Bastion Defenders (25 if Vast); Recruit adds up to 4 at a time.", { enlargeToVastGp: 2000 }),
  f("garden", "Garden", 5, P_NONE, "Roomy", 1, "Harvest", "base",
    "Choose Decorative/Food/Herb/Poison; Harvest yields its goods. Vast is two gardens plus a hireling.", { enlargeToVastGp: 2000 }),
  f("library", "Library", 5, P_NONE, "Roomy", 1, "Research", "base",
    "Research a topic for up to three accurate, previously-unknown facts."),
  f("sanctuary", "Sanctuary", 5, P_HOLY, "Roomy", 1, "Craft", "base",
    "Weekly Healing Word charm; Craft a Holy Symbol or Druidic Focus."),
  f("smithy", "Smithy", 5, P_NONE, "Roomy", 2, "Craft", "base",
    "Craft with Smith's Tools, or (L9+) a Common/Uncommon Armament magic item; halves the Armory's cost."),
  f("storehouse", "Storehouse", 5, P_NONE, "Roomy", 1, "Trade", "base",
    "Buy/sell trade goods (value cap rises with level); sell at a markup that grows with level."),
  f("workshop", "Workshop", 5, P_NONE, "Roomy", 3, "Craft", "base",
    "Six Artisan's Tools; Craft gear or (L9+) a Common/Uncommon Implement; a Short Rest grants Heroic Inspiration. Vast adds tools and 2 hirelings.", { enlargeToVastGp: 2000 }),
  f("gaming_hall", "Gaming Hall", 9, P_NONE, "Vast", 4, "Trade", "base",
    "Run a gambling den for a weekly payout (1d100 winnings table)."),
  f("greenhouse", "Greenhouse", 9, P_NONE, "Roomy", 1, "Harvest", "base",
    "Three daily Lesser Restoration fruits; Harvest a greater Potion of Healing or a poison."),
  f("laboratory", "Laboratory", 9, P_NONE, "Roomy", 1, "Craft", "base",
    "Craft with Alchemist's Supplies, or a poison at half cost."),
  f("sacristy", "Sacristy", 9, P_HOLY, "Roomy", 1, "Craft", "base",
    "Craft Holy Water or a Relic magic item; regain a spell slot (5th or lower) on a Short Rest, once per Long Rest."),
  f("scriptorium", "Scriptorium", 9, P_NONE, "Roomy", 1, "Craft", "base",
    "Copy books, scribe a Cleric/Wizard Spell Scroll (3rd or lower), or print paperwork."),
  f("stable", "Stable", 9, P_NONE, "Roomy", 1, "Trade", "base",
    "Houses 3 Large mounts (6 if Vast); buy/sell mounts at a growing markup; long-stabled mounts grant Animal Handling advantage.", { enlargeToVastGp: 2000 }),
  f("teleportation_circle", "Teleportation Circle", 9, P_NONE, "Roomy", 1, "Recruit", "base",
    "A permanent teleportation circle; invite a friendly NPC spellcaster to cast a spell for you."),
  f("theater", "Theater", 9, P_NONE, "Vast", 4, "Empower", "base",
    "Stage a production; contributors earn a Theater die (d6 up to d10) to add to a d20 test."),
  f("training_area", "Training Area", 9, P_NONE, "Vast", 4, "Empower", "base",
    "Choose a trainer; a week of training grants a skill/tool/weapon/combat benefit for 7 days."),
  f("trophy_room", "Trophy Room", 9, P_NONE, "Roomy", 1, "Research", "base",
    "Research any topic for facts, or search for a Common implement magic item."),
  f("archive", "Archive", 13, P_NONE, "Roomy", 1, "Research", "base",
    "Legend Lore-style research; a reference book grants Study advantage in one skill. Vast adds two more books.", { enlargeToVastGp: 2000 }),
  f("meditation_chamber", "Meditation Chamber", 13, P_NONE, "Cramped", 1, "Empower", "base",
    "Reroll a Bastion event; a week of meditation grants advantage on two random saving throws for 7 days."),
  f("menagerie", "Menagerie", 13, P_NONE, "Vast", 2, "Recruit", "base",
    "Houses up to four Large creatures as Bastion Defenders; Recruit beasts priced by Challenge Rating."),
  f("observatory", "Observatory", 13, P_SPELLFOCUS, "Roomy", 1, "Empower", "base",
    "Weekly Contact Other Plane charm; a week of study may grant a Charm (Darkvision, Heroism, or Vitality)."),
  f("pub", "Pub", 13, P_NONE, "Roomy", 1, "Research", "base",
    "A spy network locates a known creature within 50 miles; one magical beverage on tap. Vast serves two and adds staff.", { enlargeToVastGp: 2000 }),
  f("reliquary", "Reliquary", 13, P_HOLY, "Cramped", 1, "Harvest", "base",
    "Weekly Greater Restoration charm; Harvest a reusable talisman that substitutes spell components (up to 1,000 gp)."),
  f("demiplane", "Demiplane", 17, P_ARCANE, "Vast", 1, "Empower", "base",
    "A door to an extradimensional stone room; a Long Rest there grants Temp HP equal to 5x your level; fabricate small objects."),
  f("guildhall", "Guildhall", 17, P_EXPERTISE, "Vast", 1, "Recruit", "base",
    "Run a guild (Adventurers/Bakers/Brewers/Masons/Shipbuilders/Thieves); Recruit sends members on assignments."),
  f("sanctum", "Sanctum", 17, P_HOLY, "Roomy", 4, "Empower", "base",
    "Weekly Heal charm; Fortifying Rites grant a beneficiary daily Temp HP equal to your level; always have Word of Recall to the Sanctum."),
  f("war_room", "War Room", 17, P_MARTIAL, "Vast", 2, "Recruit", "base",
    "Veteran lieutenants (up to 10) reduce Defender losses; muster armies of Guards.", { hirelingsNote: "starts at 2; grows as you recruit lieutenants" }),

  // ---- Forgotten Realms ----
  f("amethyst_dragon_den", "Amethyst Dragon Den", 5, pFaction("Purple Dragon Knights"), "Vast", 1, "Empower", "forgotten-realms",
    "A week of psionic training grants Resistance to Psychic damage for 7 days."),
  f("harper_hideout", "Harper Hideout", 5, pFaction("Harpers"), "Roomy", 1, "Empower", "forgotten-realms",
    "A hidden, Alarm-warded safehouse (relocatable; reach grows with level); Empower hosts a Harper who trains a skill for 7 days."),
  f("red_wizard_necropolis", "Red Wizard Necropolis", 5, pFaction("Red Wizards", P_SPELLFOCUS), "Roomy", 1, "Recruit", "forgotten-realms",
    "Houses up to 8 Undead Bastion Defenders (they return 14 days after being destroyed); Recruit up to 4 at a time."),
  f("zhentarim_travel_station", "Zhentarim Travel Station", 5, pFaction("Zhentarim"), "Vast", 2, "Research", "forgotten-realms",
    "Stables 4 Large mounts; a Long Rest raises your group's travel pace one step; Research aids an upcoming journey (Survival advantage)."),
  f("emerald_enclave_grove", "Emerald Enclave Grove", 9, pFaction("Emerald Enclave"), "Vast", 2, "Recruit", "forgotten-realms",
    "Houses nature creatures as Bastion Defenders; Recruit invites one (even die = it accepts)."),
  f("lords_alliance_noble_residence", "Lords' Alliance Noble Residence", 9, pFaction("Lords' Alliance"), "Vast", 1, "Recruit", "forgotten-realms",
    "A Long Rest grants Heroic Inspiration; Recruit hosts a visiting noble who reveals a known creature's location."),
  f("order_gauntlet_tournament_field", "Order of the Gauntlet Tournament Field", 9, pFaction("Order of the Gauntlet"), "Vast", 1, "Empower", "forgotten-realms",
    "A resident Knight reduces Defender losses; Empower holds a tournament (2,000 gp) that raises your Order renown by 1."),
  f("cult_dragon_archive", "Cult of the Dragon Archive", 13, pFaction("Cult of the Dragon"), "Roomy", 1, "Research", "forgotten-realms",
    "Legend Lore research; Study advantage on dragon/Tiamat/Cult lore. Vast adds two reference books.", { enlargeToVastGp: 2000 }),

  // ---- Eberron ----
  f("dragonmark_outpost", "Dragonmark Outpost", 5, pRenown("any", 10), "Roomy", 1, "Empower", "eberron",
    "+1 renown on build; with a Dragonmark feat, a Long Rest grants an extra 2nd-level slot for marked spells; Empower calls in a house favor."),
  f("kundarak_vault", "Kundarak Vault", 9, pRenown("House Kundarak", 15), "Cramped", 1, "Trade", "eberron",
    "An extradimensional vault reachable from any Kundarak bank; Trade buys/sells goods (cap rises with level) at a growing markup."),
  f("navigators_helm", "Navigator's Helm", 9, P_NONE, "Cramped", 1, "Empower", "eberron",
    "Propels a mobile bastion built in a waterborne vehicle; Empower sails it 8 hours/day for the turn.", { propulsion: true }),
  f("orien_helm", "Orien Helm", 9, pRenown("House Orien", 15), "Cramped", 1, "Empower", "eberron",
    "Propels a mobile bastion built in a lightning-rail cart (30 mph, 8 hours/day, along conductor-stone routes).", { propulsion: true }),
  f("artificers_forge", "Artificer's Forge", 13, P_ARTISAN, "Roomy", 2, "Craft", "eberron",
    "Two magewrights speed magic-item crafting; Craft a Common/Uncommon item; charged items regain +1 extra charge."),
  f("inquisitives_agency", "Inquisitive's Agency", 13, P_NONE, "Roomy", 1, "Research", "eberron",
    "Research profiles a person within 10 miles (whereabouts, spending, meetings, papers) over a 7-day window."),
  f("lyrandar_helm", "Lyrandar Helm", 13, pRenown("House Lyrandar", 25), "Cramped", 1, "Empower", "eberron",
    "Propels a mobile bastion built in an elemental airship or galleon; Empower flies/sails it for the turn.", { propulsion: true }),
  f("manifest_zone", "Manifest Zone", 13, P_SPELLFOCUS, "Vast", 1, "Empower", "eberron",
    "Linked to an Eberron plane (chosen on build); Empower grants a plane-themed Manifest Charm."),
  f("museum", "Museum", 13, P_NONE, "Roomy", 1, "Research", "eberron",
    "Legend Lore research; a displayed treasure grants a themed Charm. Vast holds two treasures and adds hirelings.", { enlargeToVastGp: 2000 }),
  f("construct_forge", "Construct Forge", 17, P_ARTISAN, "Vast", 2, "Recruit", "eberron",
    "Recruit crafts a Construct Defender by time/cost (Animated Armor up to Shield Guardian or Warforged Titan)."),

  // ---- Ravenloft ----
  f("rookery", "Rookery", 5, P_NONE, "Cramped", 1, "Craft", "ravenloft",
    "Ravens track intruders; Craft a Mist Talisman to a known Domain of Dread; send messenger ravens anywhere."),
  f("seance_parlor", "Seance Parlor", 5, P_NONE, "Cramped", 1, "Research", "ravenloft",
    "Research (fortune telling) grants Heroic Inspiration; a Long Rest grants a free Speak with Dead."),
  f("ancient_altar", "Ancient Altar", 9, P_NONE, "Cramped", 1, "Empower", "ravenloft",
    "Weekly Hunger of Hadar charm; Empower runs a ritual (1,000 gp or a blood sacrifice) to purge a Haunted facility."),
  f("cabinet_of_curiosities", "Cabinet of Curiosities", 9, P_NONE, "Cramped", 1, "Trade", "ravenloft",
    "Trade sends the hireling to buy magic items (28 days); rarity by investment, quantity by Haunted facility count, with a curse chance."),
  f("infirmary", "Infirmary", 9, pSkill("Medicine"), "Roomy", 2, "Craft", "ravenloft",
    "Craft Antitoxin or upgrade Potions of Healing; Triage rerolls Defender-loss dice. Vast adds hirelings and capacity.", { enlargeToVastGp: 2000 }),
  f("lightning_generator", "Lightning Generator", 13, P_NONE, "Roomy", 1, "Empower", "ravenloft",
    "A Long Rest grants a 3-charge Telekinesis charm (costs 8d6 lightning); cheaper Raise Dead/Resurrection; Empower animates a large object."),
  f("spirit_vault", "Spirit Vault", 13, P_NONE, "Roomy", 1, "Research", "ravenloft",
    "Always Haunted; a Long Rest grants an Exorcism or Malediction charm; Research questions imprisoned spirits (Contact Other Plane).", { alwaysHaunted: true }),
  f("liminal_space", "Liminal Space", 17, P_NONE, "Vast", 1, "Recruit", "ravenloft",
    "Always Haunted; takes no map space (entrances appear in closets and shadows); grants a Dark Gift feat; Recruit summons entity Defenders.", { noMapSpace: true, alwaysHaunted: true }),
];

// ---- lookups + gating --------------------------------------------------------------------------

export function facilityById(id: string): SpecialFacility | undefined {
  return SPECIAL_FACILITIES.find((x) => x.id === id);
}

export const PROPULSION_FACILITY_IDS: string[] = SPECIAL_FACILITIES.filter((x) => x.propulsion).map((x) => x.id);

// The builder's gating context. Focus/feature flags drive the "class chooser"; level drives the "level
// chooser". Faction/renown are campaign-specific and NOT enforced unless enforceFactionRenown is set,
// since the app can't know a character's memberships - the requirement is shown and the GM confirms it.
export interface BuilderContext {
  level: number;
  arcaneFocus?: boolean;
  holyDruidicFocus?: boolean;
  spellcastingFocus?: boolean;
  artisanToolsFocus?: boolean;
  expertise?: boolean;
  martialFeature?: boolean;
  skills?: string[];
  allowedSources?: FacilitySource[];   // which content is offered; default ["base"]
  enforceFactionRenown?: boolean;       // default false: faction/renown shown but not hard-gated
  factions?: string[];
  renown?: Record<string, number>;
}

export function meetsPrereq(p: FacilityPrereq, ctx: BuilderContext): boolean {
  const one = (q: FacilityPrereq): boolean => {
    switch (q.kind) {
      case "none": return true;
      case "arcane-focus": return !!ctx.arcaneFocus;
      case "holy-druidic-focus": return !!ctx.holyDruidicFocus;
      case "spellcasting-focus":
        return !!(ctx.spellcastingFocus || ctx.arcaneFocus || ctx.holyDruidicFocus || ctx.artisanToolsFocus);
      case "artisan-tools-focus": return !!ctx.artisanToolsFocus;
      case "expertise": return !!ctx.expertise;
      case "martial-feature": return !!ctx.martialFeature;
      case "skill-proficiency": return !!(q.skill && ctx.skills?.includes(q.skill));
      case "faction":
        return ctx.enforceFactionRenown ? !!(q.faction && ctx.factions?.includes(q.faction)) : true;
      case "renown": {
        if (!ctx.enforceFactionRenown) return true;
        const need = q.renownReq ?? 0;
        if (q.house === "any") return Object.values(ctx.renown ?? {}).some((v) => v >= need);
        return (ctx.renown?.[q.house ?? ""] ?? 0) >= need;
      }
      default: return true;
    }
  };
  return one(p) && (p.extra ? meetsPrereq(p.extra, ctx) : true);
}

// Facilities a character can take right now: offered source, level reached, and prerequisites met.
export function availableFacilities(ctx: BuilderContext): SpecialFacility[] {
  const sources = ctx.allowedSources ?? ["base"];
  return SPECIAL_FACILITIES.filter(
    (x) => sources.includes(x.source) && x.level <= ctx.level && meetsPrereq(x.prereq, ctx),
  );
}

// ---- class capability defaults -----------------------------------------------------------------
// A best-effort default map from a 2024 PHB class to the focus/feature flags a bastion cares about, so
// the "class chooser" can pre-fill the gating toggles. These are DEFAULTS the GM can override in the
// UI (subclasses, feats, and multiclassing change what a character can actually use).
export type ClassCaps = Pick<BuilderContext,
  "arcaneFocus" | "holyDruidicFocus" | "spellcastingFocus" | "artisanToolsFocus" | "expertise" | "martialFeature">;

export const CLASS_CAPABILITIES: Record<string, ClassCaps> = {
  Artificer: { arcaneFocus: true, artisanToolsFocus: true, spellcastingFocus: true },
  Barbarian: { martialFeature: true },
  Bard: { arcaneFocus: true, spellcastingFocus: true, expertise: true },
  Cleric: { holyDruidicFocus: true, spellcastingFocus: true },
  Druid: { holyDruidicFocus: true, spellcastingFocus: true },
  Fighter: { martialFeature: true },
  Monk: { martialFeature: true },
  Paladin: { holyDruidicFocus: true, spellcastingFocus: true, martialFeature: true },
  Ranger: { holyDruidicFocus: true, spellcastingFocus: true },
  Rogue: { expertise: true },
  Sorcerer: { arcaneFocus: true, spellcastingFocus: true },
  Warlock: { arcaneFocus: true, spellcastingFocus: true },
  Wizard: { arcaneFocus: true, spellcastingFocus: true },
};

export function capabilitiesForClass(className: string | null | undefined): ClassCaps {
  return (className && CLASS_CAPABILITIES[className]) || {};
}

// ---- bastion events (reference only; for a future bastion-turn feature, not the map builder) ----
export const BASTION_EVENTS: { min: number; max: number; name: string }[] = [
  { min: 1, max: 50, name: "All Is Well" },
  { min: 51, max: 55, name: "Attack" },
  { min: 56, max: 58, name: "Criminal Hireling" },
  { min: 59, max: 63, name: "Extraordinary Opportunity" },
  { min: 64, max: 72, name: "Friendly Visitors" },
  { min: 73, max: 76, name: "Guest" },
  { min: 77, max: 79, name: "Lost Hirelings" },
  { min: 80, max: 83, name: "Magical Discovery" },
  { min: 84, max: 91, name: "Refugees" },
  { min: 92, max: 98, name: "Request for Aid" },
  { min: 99, max: 100, name: "Treasure" },
];
