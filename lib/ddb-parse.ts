// ---------------------------------------------------------------------------
// lib/ddb-parse.ts
//
// Reads a D&D Beyond character-sheet PDF in the BROWSER, via its form fields.
//
// D&D Beyond exports the sheet as a filled form: every page carries Widget annotations whose
// fieldName is stable and whose fieldValue is the value. pdf.js exposes exactly that through
// page.getAnnotations(), so none of this needs glyph coordinates, a tokenizer, or a y-flip.
//
// STRUCTURE, and why: the ONLY function that touches pdf.js is loadFieldsFromPdf(). Everything
// after it is a pure function over a plain DdbFields object, so the whole parse can be unit-tested
// against field data captured from real PDFs with no browser and no pdf.js in the loop.
//
// The output is structurally compatible with the DdbSheet that lib/ddb-import.ts consumes, so
// ddbToBuild(await parseSheet(pdf), ctx) works with no change to that file. This one carries extra
// fields it does not know about yet (save_prof, defenses, currency, per-item qty/weight), which is
// fine: TypeScript structural typing ignores the extras.
//
// FLATTENED EXPORTS: a PDF printed without form fields has no widgets and nothing to read. That
// case is detected up front (hasFormFields) and reported rather than silently returning an empty
// sheet; the Python coordinate parser remains the reference implementation for that fallback.
// ---------------------------------------------------------------------------

// Minimal structural types for the bits of pdf.js used here, so this file type-checks standalone
// and does not pin a pdfjs-dist version.
export type PdfAnnotation = {
  subtype?: string;
  fieldType?: string;
  fieldName?: string;
  fieldValue?: string | string[] | null;
  rect?: number[];
};
export type PdfPageLike = { getAnnotations(opts?: { intent?: string }): Promise<PdfAnnotation[]> };
export type PdfDocumentLike = { numPages: number; getPage(pageNumber: number): Promise<PdfPageLike> };

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export type DdbClass = { class: string; level: number };
export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type DdbSpell = {
  name: string; level: number | null; source: string | null;
  always_prepared: boolean; ritual: boolean; detail: string | null;
  save_hit: string | null; casting_time: string | null; range: string | null;
  components: string | null; duration: string | null; page_ref: string | null; notes: string | null;
};

export type DdbItem = {
  name: string; detail: string | null; attuned: boolean;
  qty: number | null; weight: string | null;
};

export type DdbSheet = {
  identity: {
    name: string | null; class_level_raw: string | null; classes: DdbClass[];
    primary_class: string | null; total_level: number | null; species: string | null;
    background: string | null; player_name: string | null; experience: string | null;
  };
  abilities: Record<AbilityKey, number | null>;
  saves: Record<AbilityKey, number | null>;
  save_prof: AbilityKey[];
  skills: { skill: string; modifier: number | null; prof: "proficient" | "expertise" | null }[];
  combat: {
    armor_class: number | null; initiative: number | null; proficiency_bonus: number | null;
    speed: string | null; max_hp: number | null; hit_dice: string | null;
    passive_perception: number | null; passive_insight: number | null; passive_investigation: number | null;
  };
  defenses: {
    raw: string | null; resistances: string[]; immunities: string[];
    senses: string | null; save_modifiers: string | null;
  };
  currency: Record<"cp" | "sp" | "ep" | "gp" | "pp", number | null>;
  proficiencies: Record<string, string>;
  attacks: { name: string; hit: string | null; damage: string | null; notes: string | null }[];
  features: { name: string; source: string | null; desc: string }[];
  bio: Record<string, string | null>;
  spells: { save_dc: number | null; attack_bonus: string | null; slots: Record<string, number>; list: DdbSpell[] };
  equipment: DdbItem[];
  _meta: { source: string; field_count: number; pages: number };
};

/**
 * merged   - field name -> value across the whole document. Safe ONLY for single-instance fields
 *            (the page-1 stat block, bio, proficiencies).
 * perPage  - one map per page, in page order. REQUIRED for the indexed families, because the
 *            template reuses names across pages: a 4-page sheet carries FeaturesTraits4/5/6 on
 *            page 3 AND AGAIN on page 4, and restarts "Eq Name" at 26 on both. Merging flat
 *            silently drops the later page.
 * ordered  - [page, -yTop, name, value] in reading order, for the spell table.
 */
export type DdbFields = {
  merged: Map<string, string>;
  perPage: Map<string, string>[];
  ordered: { page: number; top: number; name: string; value: string }[];
};

// ---------------------------------------------------------------------------
// pdf.js boundary
// ---------------------------------------------------------------------------

function fieldValueToString(v: string | string[] | null | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? v.join("\n") : String(v);
}

/** True when the document carries text form fields at all. False means a flattened export. */
export async function hasFormFields(pdf: PdfDocumentLike): Promise<boolean> {
  const limit = Math.min(pdf.numPages, 3);
  for (let n = 1; n <= limit; n++) {
    const annots = await (await pdf.getPage(n)).getAnnotations();
    if (annots.some((a) => a.subtype === "Widget" && a.fieldType === "Tx" && a.fieldName)) return true;
  }
  return false;
}

export async function loadFieldsFromPdf(pdf: PdfDocumentLike): Promise<DdbFields> {
  const merged = new Map<string, string>();
  const perPage: Map<string, string>[] = [];
  const ordered: DdbFields["ordered"] = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const pageFields = new Map<string, string>();
    perPage.push(pageFields);
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== "Widget" || a.fieldType !== "Tx") continue;
      // Field names carry stray whitespace in this template ("DEXmod ", "Stealth ",
      // "Wpn2 AtkBonus "), so trim the ends. Do NOT collapse interior spaces: "CLASS  LEVEL"
      // genuinely contains a double space.
      const name = (a.fieldName ?? "").trim();
      if (!name) continue;
      const value = fieldValueToString(a.fieldValue);
      const prev = pageFields.get(name);
      if (prev === undefined || (!prev.trim() && value.trim())) pageFields.set(name, value);
      const prevM = merged.get(name);
      if (prevM === undefined || (!prevM.trim() && value.trim())) merged.set(name, value);
      const top = a.rect && a.rect.length >= 4 ? -a.rect[3] : 0;
      ordered.push({ page: pageNo, top, name, value });
    }
  }
  ordered.sort((x, y) => (x.page - y.page) || (x.top - y.top));
  return { merged, perPage, ordered };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ABILITIES: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];

function S(f: Map<string, string>, key: string): string | null {
  const v = (f.get(key) ?? "").trim();
  return v || null;
}

function I(f: Map<string, string>, key: string): number | null {
  const v = S(f, key);
  if (!v) return null;
  const m = v.replace(/,/g, "").match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

const ABIL_FIELD: Record<AbilityKey, string> = {
  str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA",
};
const SAVE_FIELD: Record<AbilityKey, [string, string]> = {
  str: ["ST Strength", "StrProf"], dex: ["ST Dexterity", "DexProf"],
  con: ["ST Constitution", "ConProf"], int: ["ST Intelligence", "IntProf"],
  wis: ["ST Wisdom", "WisProf"], cha: ["ST Charisma", "ChaProf"],
};
// The template's skill field names are irregular: the value is "Animal" but the marker is
// "AnimalHandlingProf"; the value is "SleightofHand" but the marker is "SleightOfHandProf".
const SKILL_FIELD: [string, string, string][] = [
  ["Acrobatics", "Acrobatics", "AcrobaticsProf"],
  ["Animal Handling", "Animal", "AnimalHandlingProf"],
  ["Arcana", "Arcana", "ArcanaProf"],
  ["Athletics", "Athletics", "AthleticsProf"],
  ["Deception", "Deception", "DeceptionProf"],
  ["History", "History", "HistoryProf"],
  ["Insight", "Insight", "InsightProf"],
  ["Intimidation", "Intimidation", "IntimidationProf"],
  ["Investigation", "Investigation", "InvestigationProf"],
  ["Medicine", "Medicine", "MedicineProf"],
  ["Nature", "Nature", "NatureProf"],
  ["Perception", "Perception", "PerceptionProf"],
  ["Performance", "Performance", "PerformanceProf"],
  ["Persuasion", "Persuasion", "PersuasionProf"],
  ["Religion", "Religion", "ReligionProf"],
  ["Sleight of Hand", "SleightofHand", "SleightOfHandProf"],
  ["Stealth", "Stealth", "StealthProf"],
  ["Survival", "Survival", "SurvivalProf"],
];
const BIO_FIELD: [string, string][] = [
  ["gender", "GENDER"], ["age", "AGE"], ["size", "SIZE"], ["height", "HEIGHT"],
  ["weight", "WEIGHT"], ["alignment", "ALIGNMENT"], ["faith", "FAITH"],
  ["skin", "SKIN"], ["eyes", "EYES"], ["hair", "HAIR"],
  ["personality", "PersonalityTraits"], ["ideals", "Ideals"], ["bonds", "Bonds"],
  ["flaws", "Flaws"], ["backstory", "Backstory"], ["appearance", "Appearance"],
  ["allies_organizations", "AlliesOrganizations"], ["notes", "AdditionalNotes1"],
];

const FEATURE_SOURCE = /\s*[\u2022\u00b7]\s*([A-Za-z][A-Za-z0-9-]*(?:\s+\d+)?)\s*$/;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function parseIdentity(f: Map<string, string>): DdbSheet["identity"] {
  const raw = S(f, "CLASS  LEVEL") ?? S(f, "CLASS LEVEL");
  const classes: DdbClass[] = [];
  if (raw) {
    for (const part of raw.split("/")) {
      const m = part.trim().match(/^(.+?)\s+(\d+)$/);
      if (m) classes.push({ class: m[1].trim(), level: Number(m[2]) });
    }
  }
  return {
    name: S(f, "CharacterName"),
    class_level_raw: raw,
    classes,
    primary_class: classes.length ? classes[0].class : null,
    total_level: classes.length ? classes.reduce((t, c) => t + c.level, 0) : null,
    species: S(f, "RACE"),
    background: S(f, "BACKGROUND"),
    player_name: S(f, "PLAYER NAME"),
    experience: S(f, "EXPERIENCE POINTS"),
  };
}

function parseAbilities(f: Map<string, string>): Record<AbilityKey, number | null> {
  const out = {} as Record<AbilityKey, number | null>;
  for (const a of ABILITIES) out[a] = I(f, ABIL_FIELD[a]);
  return out;
}

function parseSaves(f: Map<string, string>): Record<AbilityKey, number | null> {
  const out = {} as Record<AbilityKey, number | null>;
  for (const a of ABILITIES) out[a] = I(f, SAVE_FIELD[a][0]);
  return out;
}

/** D&D Beyond marks a proficient save with a bullet in <Abil>Prof, so it is stated, not inferred. */
function parseSaveProf(f: Map<string, string>): AbilityKey[] {
  return ABILITIES.filter((a) => (f.get(SAVE_FIELD[a][1]) ?? "").trim() !== "");
}

function parseSkills(f: Map<string, string>): DdbSheet["skills"] {
  return SKILL_FIELD.map(([label, valKey, profKey]) => {
    const mark = (f.get(profKey) ?? "").trim().toUpperCase();
    const prof = mark === "E" ? "expertise" : mark ? "proficient" : null;
    return { skill: label, modifier: I(f, valKey), prof: prof as "proficient" | "expertise" | null };
  });
}

function parseCombat(f: Map<string, string>): DdbSheet["combat"] {
  return {
    armor_class: I(f, "AC"),
    initiative: I(f, "Init"),
    proficiency_bonus: I(f, "ProfBonus"),
    speed: S(f, "Speed"),
    max_hp: I(f, "MaxHP"),
    hit_dice: S(f, "Total"),
    passive_perception: I(f, "Passive1"),
    passive_insight: I(f, "Passive2"),
    passive_investigation: I(f, "Passive3"),
  };
}

function parseDefenses(f: Map<string, string>): DdbSheet["defenses"] {
  const raw = S(f, "Defenses") ?? "";
  const resistances: string[] = [];
  const immunities: string[] = [];
  for (const line of raw.split("\n")) {
    const m = line.trim().match(/^(Resistances|Immunities|Vulnerabilities)\s*-\s*(.+)$/i);
    if (!m) continue;
    const vals = m[2].split(/,|\band\b/).map((x) => x.trim()).filter(Boolean);
    if (/^resist/i.test(m[1])) resistances.push(...vals);
    else immunities.push(...vals);
  }
  return {
    raw: raw || null,
    resistances,
    immunities,
    senses: S(f, "AdditionalSenses"),
    save_modifiers: S(f, "SaveModifiers"),
  };
}

function parseCurrency(f: Map<string, string>): DdbSheet["currency"] {
  return { cp: I(f, "CP"), sp: I(f, "SP"), ep: I(f, "EP"), gp: I(f, "GP"), pp: I(f, "PP") };
}

/** ProficienciesLang is one field holding "=== ARMOR === ... === WEAPONS === ..." sections. */
function parseProficiencies(f: Map<string, string>): Record<string, string> {
  const blob = f.get("ProficienciesLang") ?? "";
  const out: Record<string, string> = {};
  const parts = blob.split(/===\s*([A-Z &]+?)\s*===/);
  for (let i = 1; i < parts.length - 1; i += 2) {
    const key = parts[i].trim().toLowerCase();
    const val = parts[i + 1].replace(/\s+/g, " ").trim();
    if (key && val) out[key] = val;
  }
  return out;
}

function parseAttacks(f: Map<string, string>): DdbSheet["attacks"] {
  const out: DdbSheet["attacks"] = [];
  for (let i = 1; i <= 11; i++) {
    const name = i === 1 ? S(f, "Wpn Name") : S(f, `Wpn Name ${i}`);
    if (!name) continue;
    out.push({
      name,
      hit: S(f, `Wpn${i} AtkBonus`),
      damage: S(f, `Wpn${i} Damage`),
      notes: S(f, `Wpn Notes ${i}`),
    });
  }
  return out;
}

/**
 * FeaturesTraits1..N carry the features section as multi-line text, in order, with real newlines,
 * so the "* name / bullet sub-option / | continuation" state machine applies directly: no column
 * stitching, no page-header exclusion, no y-bounds.
 *
 * Collected PER PAGE because the indices restart: a 4-page sheet has FeaturesTraits4/5/6 twice.
 */
function parseFeatures(perPage: Map<string, string>[]): DdbSheet["features"] {
  const blobs: string[] = [];
  for (const pf of perPage) {
    const keys = [...pf.keys()]
      .filter((k) => /^FeaturesTraits\d+$/.test(k))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    for (const k of keys) blobs.push(pf.get(k)!);
  }
  const feats: DdbSheet["features"] = [];
  let curName: string | null = null;
  let curSrc: string | null = null;
  let curBody: string[] = [];
  const flush = () => {
    if (curName) feats.push({ name: curName, source: curSrc, desc: curBody.join(" ").trim() });
  };
  for (const line of blobs.join("\n").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/^\*\s+(.*)/);
    if (m) {
      flush();
      const sm = m[1].match(FEATURE_SOURCE);
      curName = m[1].replace(FEATURE_SOURCE, "").trim();
      curSrc = sm ? sm[1] : null;
      curBody = [];
    } else if (/^\|\s+/.test(s)) {
      curBody.push(s.replace(/^\|\s+/, ""));
    } else if (curName && !s.startsWith("===")) {
      curBody.push(s);
    }
  }
  flush();

  // First-wins dedupe, EXCEPT an entry carrying text beats an earlier empty one: D&D Beyond lists
  // a name once as a bare class-roster entry and again with the granted content.
  const best = new Map<string, DdbSheet["features"][number]>();
  const order: string[] = [];
  for (const ft of feats) {
    const key = ft.name.toLowerCase();
    if (!key || ft.name.length <= 1) continue;
    const prev = best.get(key);
    if (!prev) { best.set(key, ft); order.push(key); }
    else if (!prev.desc && ft.desc) best.set(key, ft);
  }
  return order.map((k) => best.get(k)!);
}

function parseBio(f: Map<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, field] of BIO_FIELD) out[key] = S(f, field);
  return out;
}

/**
 * Spell rows are the spellName#/spellSource#/... families. The level a row belongs to comes from a
 * SEPARATE family (spellHeader#), and only page position says which rows a header governs, so walk
 * in reading order and carry the current header forward.
 *
 * Slot counts, however, pair BY INDEX: spellSlotHeaderN sits ABOVE spellHeaderN on the page, so
 * carrying "current level" forward assigns every count to the previous level.
 */
function parseSpells(f: Map<string, string>, ordered: DdbFields["ordered"]): DdbSheet["spells"] {
  const spells: DdbSheet["spells"] = {
    save_dc: I(f, "spellSaveDC0"),
    attack_bonus: S(f, "spellAtkBonus0"),
    slots: {},
    list: [],
  };

  for (const [key, val] of f) {
    const m = key.match(/^spellHeader(\d+)$/);
    if (!m || !val.trim()) continue;
    const label = val.toUpperCase();
    if (label.includes("CANTRIP")) continue;
    const lm = label.match(/(\d+)/);
    const sm = (f.get(`spellSlotHeader${m[1]}`) ?? "").match(/(\d+)\s+Slots/);
    if (lm && sm) spells.slots[lm[1]] = Number(sm[1]);
  }

  let curLevel: number | null = null;
  for (const { name, value } of ordered) {
    const v = (value ?? "").trim();
    if (/^spellHeader\d+$/.test(name) && v) {
      const label = v.toUpperCase();
      if (label.includes("CANTRIP")) curLevel = 0;
      else {
        const m = label.match(/(\d+)/);
        curLevel = m ? Number(m[1]) : null;
      }
      continue;
    }
    if (/^spellSlotHeader\d+$/.test(name)) continue;
    const m = name.match(/^spellName(\d+)$/);
    if (!m || !v) continue;
    const i = m[1];
    const ritual = /\s*\[R\]\s*$/.test(v);
    const spellName = ritual ? v.replace(/\s*\[R\]\s*$/, "").trim() : v;
    const parts = [
      S(f, `spellSaveHit${i}`), S(f, `spellCastingTime${i}`), S(f, `spellRange${i}`),
      S(f, `spellComponents${i}`), S(f, `spellDuration${i}`), S(f, `spellPage${i}`),
      S(f, `spellNotes${i}`),
    ].filter(Boolean) as string[];
    spells.list.push({
      name: spellName,
      level: curLevel,
      source: S(f, `spellSource${i}`),
      always_prepared: (f.get(`spellPrepared${i}`) ?? "").trim().toUpperCase() === "P",
      ritual,
      detail: parts.length ? parts.join(" ") : null,
      save_hit: S(f, `spellSaveHit${i}`),
      casting_time: S(f, `spellCastingTime${i}`),
      range: S(f, `spellRange${i}`),
      components: S(f, `spellComponents${i}`),
      duration: S(f, `spellDuration${i}`),
      page_ref: S(f, `spellPage${i}`),
      notes: S(f, `spellNotes${i}`),
    });
  }
  return spells;
}

/**
 * Eq Name#/Eq Qty#/Eq Weight# rows. Quantity and weight are their OWN fields, so there is no
 * name/qty splitting and no duplicate collapsing: every row is distinct, which keeps repeated
 * stacks (six daggers, three potions of healing) instead of merging them.
 *
 * Collected PER PAGE because the indices restart on a third equipment page.
 */
function parseEquipment(perPage: Map<string, string>[]): DdbItem[] {
  const attuned = new Set<string>();
  for (const pf of perPage) {
    for (const [k, v] of pf) {
      if (/^Attuned Name\s*\d+$/.test(k) && v.trim()) attuned.add(v.trim().toLowerCase());
    }
  }
  const items: DdbItem[] = [];
  for (const pf of perPage) {
    const idx = [...pf.keys()]
      .filter((k) => /^Eq Name\s*\d+$/.test(k))
      .map((k) => Number(k.match(/\d+/)![0]))
      .sort((a, b) => a - b);
    for (const i of idx) {
      const name = S(pf, `Eq Name${i}`);
      if (!name) continue;
      const qty = S(pf, `Eq Qty${i}`);
      const weight = S(pf, `Eq Weight${i}`);
      const detailParts = [qty, weight].filter(Boolean) as string[];
      const qtyDigits = qty ? qty.replace(/,/g, "") : "";
      items.push({
        name,
        detail: detailParts.length ? detailParts.join(" ") : null,
        attuned: attuned.has(name.toLowerCase()),
        qty: /^\d+$/.test(qtyDigits) ? Number(qtyDigits) : null,
        weight,
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Pure: build the sheet from already-captured fields. Unit-testable with no pdf.js. */
export function parseSheetFromFields(fields: DdbFields): DdbSheet {
  const { merged, perPage, ordered } = fields;
  return {
    identity: parseIdentity(merged),
    abilities: parseAbilities(merged),
    saves: parseSaves(merged),
    save_prof: parseSaveProf(merged),
    skills: parseSkills(merged),
    combat: parseCombat(merged),
    defenses: parseDefenses(merged),
    currency: parseCurrency(merged),
    proficiencies: parseProficiencies(merged),
    attacks: parseAttacks(merged),
    features: parseFeatures(perPage),
    bio: parseBio(merged),
    spells: parseSpells(merged, ordered),
    equipment: parseEquipment(perPage),
    _meta: { source: "dndbeyond_pdf_fields", field_count: merged.size, pages: perPage.length },
  };
}

export class FlattenedSheetError extends Error {
  constructor() {
    super(
      "This PDF has no form fields. D&D Beyond sheets normally export as a filled form; a flattened " +
        "or re-printed PDF cannot be read this way. Re-export from D&D Beyond without flattening.",
    );
    this.name = "FlattenedSheetError";
  }
}

/** Read a DdbSheet from an open pdf.js document. Throws FlattenedSheetError if it has no fields. */
export async function parseSheet(pdf: PdfDocumentLike): Promise<DdbSheet> {
  if (!(await hasFormFields(pdf))) throw new FlattenedSheetError();
  return parseSheetFromFields(await loadFieldsFromPdf(pdf));
}
