// lib/descriptions.ts
//
// One place that turns a piece of D&D content into readable description text for the UI. Some
// content already ships prose (magic items, spells, feats, 2014 equipment); some doesn't (2024
// mundane weapons/armor, backgrounds, skills), so for those we COMPOSE a description from the
// structured fields the SRD does carry. The Forge (and any future surface) calls describe*() so the
// "what does this do" text is consistent everywhere.
//
// Honest gaps this does NOT paper over:
//   - Weapon MASTERY effect text (Topple, Graze, …) is not in the SRD data — only the mastery NAME
//     is. We show the name; the effect text is a fill-later (a small static table when we add it).
//   - 2024 mundane gear beyond weapons/armor (Acid, rope) has only weight/cost; that's all we show.

// ---- shapes (loose; these mirror the SRD JSON, all fields optional so a partial row is safe) ----

export type ItemRecord = {
  name: string;
  category?: string;
  // magic item
  rarity?: string;
  attunement?: boolean;
  attunement_note?: string;
  description?: string;
  // weapon
  weapon_category?: string;
  weapon_range?: string;
  damage?: { dice?: string; type?: string };
  mastery?: string;
  properties?: string[];
  // armor
  armor_category?: string;
  armor_class?: string;
  strength_req?: string;
  stealth_disadvantage?: boolean;
  // mundane
  weight?: string | number;
  cost?: string;
};

export type BackgroundRecord = {
  name: string;
  ability_scores?: string;
  feat?: string;
  skill_proficiencies?: string;
  tool_proficiency?: string;
  equipment?: string;
  description?: string;
};

export type FeatRecord = { name: string; prerequisite?: string; description?: string };

export type SpeciesMechRecord = { name: string; ability_bonuses?: string; traits?: unknown; description?: string };

// A description is a short lead line (composed facts) plus optional longer prose. The UI can show
// the lead always and reveal `body` on expand.
export type Described = { lead: string; body?: string };

const clean = (s?: unknown): string => (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();

// ---- items (weapons, armor, gear, magic) --------------------------------------------------------

export function describeItem(rec: ItemRecord | undefined): Described | null {
  if (!rec) return null;

  // Magic item: prose is authoritative. Lead with rarity + attunement, body is the description.
  if (rec.description && rec.category !== "Weapon" && rec.category !== "Armor") {
    const bits: string[] = [];
    if (rec.rarity) bits.push(rec.rarity);
    if (rec.attunement) bits.push(rec.attunement_note ? `Attunement: ${clean(rec.attunement_note)}` : "Requires attunement");
    return { lead: bits.join(" · ") || (rec.category || "Item"), body: clean(rec.description) };
  }

  // 2024 weapon: compose from structured fields.
  if (rec.category === "Weapon" || rec.damage || rec.weapon_category) {
    const bits: string[] = [];
    const cat = [rec.weapon_category, rec.weapon_range].filter(Boolean).join(" ");
    if (cat) bits.push(cat);
    if (rec.damage?.dice) bits.push(`${rec.damage.dice}${rec.damage.type ? ` ${rec.damage.type}` : ""}`);
    if (rec.mastery) bits.push(`Mastery: ${rec.mastery}`);
    if (rec.properties?.length) bits.push(rec.properties.join(", "));
    const lead = bits.join(" · ") || "Weapon";
    return { lead, body: rec.description ? clean(rec.description) : undefined };
  }

  // 2024 armor: compose.
  if (rec.category === "Armor" || rec.armor_class || rec.armor_category) {
    const bits: string[] = [];
    if (rec.armor_category) bits.push(rec.armor_category);
    if (rec.armor_class) bits.push(`AC ${rec.armor_class}`);
    if (rec.strength_req) bits.push(rec.strength_req);
    if (rec.stealth_disadvantage) bits.push("Stealth disadvantage");
    return { lead: bits.join(" · ") || "Armor", body: rec.description ? clean(rec.description) : undefined };
  }

  // Mundane gear / tools: prose if present (2014), else weight + cost.
  if (rec.description) {
    const meta = [rec.cost, rec.weight ? `${rec.weight} lb` : null].filter(Boolean).join(" · ");
    return { lead: meta || (rec.category || "Gear"), body: clean(rec.description) };
  }
  const meta = [rec.category, rec.cost, rec.weight ? `${rec.weight} lb` : null].filter(Boolean).join(" · ");
  return { lead: meta || "Gear" };
}

// ---- feats --------------------------------------------------------------------------------------

export function describeFeat(rec: FeatRecord | undefined): Described | null {
  if (!rec) return null;
  const lead = rec.prerequisite ? `Prerequisite: ${clean(rec.prerequisite)}` : "Feat";
  return { lead, body: rec.description ? clean(rec.description) : undefined };
}

// ---- backgrounds (2024 has no prose; compose from what it grants) --------------------------------

export function describeBackground(rec: BackgroundRecord | undefined): Described | null {
  if (!rec) return null;
  if (rec.description) {
    return { lead: composeBackgroundLead(rec) || "Background", body: clean(rec.description) };
  }
  const lead = composeBackgroundLead(rec);
  return { lead: lead || "Background" };
}

function composeBackgroundLead(rec: BackgroundRecord): string {
  const bits: string[] = [];
  if (rec.skill_proficiencies) bits.push(`Skills: ${clean(rec.skill_proficiencies)}`);
  if (rec.tool_proficiency && clean(rec.tool_proficiency).toLowerCase() !== "none")
    bits.push(`Tools: ${clean(rec.tool_proficiency)}`);
  if (rec.feat) bits.push(`Feat: ${clean(rec.feat)}`);
  if (rec.ability_scores) bits.push(`Abilities: ${clean(rec.ability_scores)}`);
  return bits.join(" · ");
}

// ---- species (mechanics rows carry ability bonuses; some carry traits/description prose) ---------

export function describeSpecies(rec: SpeciesMechRecord | undefined): Described | null {
  if (!rec) return null;
  const bits: string[] = [];
  if (typeof rec.ability_bonuses === "string" && rec.ability_bonuses) bits.push(rec.ability_bonuses);
  const lead = bits.join(" · ") || "Species";
  // traits may be a plain string (2014-style) OR an array of { name, desc } (2024 species JSON).
  // Compose the array into readable prose; fall back to a string description if present.
  const body = traitsToText(rec.traits) || (typeof rec.description === "string" ? clean(rec.description) : "") || undefined;
  return { lead, body };
}

// Normalize a species/feature traits field (string, or array of {name, desc}) into one string.
function traitsToText(traits: unknown): string {
  if (!traits) return "";
  if (typeof traits === "string") return clean(traits);
  if (Array.isArray(traits)) {
    return traits
      .map((t) => {
        if (typeof t === "string") return clean(t);
        if (t && typeof t === "object") {
          const name = clean((t as { name?: string }).name);
          const desc = clean((t as { desc?: string }).desc);
          return name && desc ? `${name}: ${desc}` : (name || desc);
        }
        return "";
      })
      .filter(Boolean)
      .join("  ·  ");
  }
  return "";
}

// ---- skills (not in the SRD JSON as rows; a small static table of the standard 18) ---------------

// key -> one-line description. Keys match derive-sheet's SKILLS.
const SKILL_TEXT: Record<string, string> = {
  acrobatics: "Keep your balance, tumble, and stay on your feet in tricky footing.",
  animal: "Calm, handle, or read the intentions of a beast.",
  arcana: "Recall lore about spells, magic items, and the planes.",
  athletics: "Climb, jump, swim, grapple — raw physical exertion.",
  deception: "Convincingly hide the truth in word or action.",
  history: "Recall lore about events, people, kingdoms, and wars.",
  insight: "Read a creature's true intentions, mood, or honesty.",
  intimidation: "Influence someone through threats or hostile pressure.",
  investigation: "Deduce from clues, search for hidden details, reason it out.",
  medicine: "Stabilize the dying and diagnose an illness.",
  nature: "Recall lore about terrain, plants, animals, and weather.",
  perception: "Notice what's around you — spot, hear, or otherwise sense.",
  performance: "Delight an audience with music, dance, acting, or story.",
  persuasion: "Influence someone with tact, grace, or good faith.",
  religion: "Recall lore about deities, rites, holy symbols, and cults.",
  sleight: "Palm an object, plant something, or pick a pocket unseen.",
  stealth: "Move unseen and unheard; hide from notice.",
  survival: "Track, forage, navigate the wilds, and predict weather.",
};

export function describeSkill(key: string, ability?: string): Described | null {
  const text = SKILL_TEXT[key];
  if (!text) return null;
  return { lead: ability ? ability.toUpperCase() : "Skill", body: text };
}
