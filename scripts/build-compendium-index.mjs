// scripts/build-compendium-index.mjs
//
// Builds the offline voice-compendium data from the SRD files the Forge already ships
// (lib/srd/*.json), with NO duplication of source data: this reads those files and emits two
// compact artifacts per ruleset into public/compendium/:
//
//   index-<ed>.json    - one lookup entry per term (spell / magic-item / equipment / condition),
//                        each with a compact display card plus `spoken` alias phrases.
//   grammar-<ed>.json  - the flat list of spoken phrases (+ "[unk]"), fed to Vosk as a grammar
//                        so recognition is constrained to our known vocabulary.
//
// WHY `spoken` ALIASES. Vosk's small model has a FIXED lexicon; a grammar can only restrict it to
// a subset, it cannot add invented words. So a spell like "Tasha's Hideous Laughter" is keyed for
// recognition on its plain-English tail ("hideous laughter") - the possessive proper noun is
// stripped for the spoken form and kept only for display. The runtime fuzzy-matches whatever Vosk
// returns back to these `spoken` phrases.
//
// Run (from the repo root):
//   node scripts/build-compendium-index.mjs 2014
//   node scripts/build-compendium-index.mjs 2024
//   node scripts/build-compendium-index.mjs both
// Overridable for testing: SRD_DIR and OUT_DIR env vars.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRD_DIR = process.env.SRD_DIR || path.join(ROOT, "lib", "srd");
const OUT_DIR = process.env.OUT_DIR || path.join(ROOT, "public", "compendium");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const readMaybe = (p) => (fs.existsSync(p) ? readJson(p) : null);

// ---- text helpers --------------------------------------------------------------------------------
const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/\s*\(legacy\)\s*/g, " ").replace(/\s+/g, " ").trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Spoken forms Vosk can plausibly produce: the plain-text name, and (when the name opens with a
// possessive proper noun) its tail. Punctuation and apostrophes are dropped for the spoken form.
function spokenForms(name) {
  const set = new Set();
  const base = norm(name);
  const speak = (s) => s.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const full = speak(base);
  if (full) set.add(full);
  const m = base.match(/^[a-z]+'s\s+(.+)$/); // "tasha's hideous laughter" -> "hideous laughter"
  if (m) { const tail = speak(m[1]); if (tail.length >= 3) set.add(tail); }
  return [...set];
}

// ---- damage summary ------------------------------------------------------------------------------
function damageSummary(dmg) {
  if (!dmg || typeof dmg !== "object") return null;
  const type = dmg.damage_type?.name ?? null;
  const map = dmg.damage_at_slot_level || dmg.damage_at_character_level || null;
  let base = null;
  if (map && typeof map === "object") {
    const keys = Object.keys(map).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    if (keys.length) base = map[String(keys[0])];
  }
  return type || base || map ? { type, base, scaling: map } : null;
}

// ---- per-domain entry builders -------------------------------------------------------------------
function spellEntry(s, ruleset) {
  return {
    id: `spell:${slug(s.name)}`,
    name: s.name,
    category: "spell",
    ruleset,
    spoken: spokenForms(s.name),
    display: {
      level: s.level,
      school: s.school ?? null,
      castingTime: s.casting_time ?? null,
      range: s.range ?? null,
      components: s.components ?? null,
      duration: s.duration ?? null,
      concentration: !!s.concentration,
      ritual: !!s.ritual,
      attackType: s.attack_type ?? null,
      classes: Array.isArray(s.classes) ? s.classes : [],
      damage: damageSummary(s.damage),
      description: s.description ?? null,
    },
  };
}
function itemEntry(it, ruleset, variantsByName) {
  const v = variantsByName.get(norm(it.name)) || null;
  return {
    id: `magic-item:${slug(it.name)}`,
    name: it.name,
    category: "magic-item",
    ruleset,
    spoken: spokenForms(it.name),
    display: {
      type: it.category ?? null,
      rarity: it.rarity ?? null,
      attunement: !!it.attunement,
      attunementNote: it.attunement_note ?? null,
      variants: v,
      description: it.description ?? null,
    },
  };
}
function gearEntry(g, ruleset) {
  return {
    id: `equipment:${slug(g.name)}`,
    name: g.name,
    category: "equipment",
    ruleset,
    spoken: spokenForms(g.name),
    display: {
      type: g.category ?? g.gear_category ?? null,
      cost: g.cost ?? null,
      weight: g.weight ?? null,
      description: g.description ?? null,
    },
  };
}
function conditionEntry(c, ruleset) {
  return {
    id: `condition:${slug(c.name)}`,
    name: c.name,
    category: "condition",
    ruleset,
    spoken: spokenForms(c.name),
    display: { description: c.description ?? null },
  };
}

// Item variant tables live in rules-data.json (ITEM_VARIANTS), keyed by item name. We attach only
// the label + option names (mechanics-only) so a card can show, e.g., the Belt of Giant Strength
// lineages without duplicating the derivation payload.
function loadVariants() {
  const rd = readMaybe(path.join(SRD_DIR, "rules-data.json"));
  const map = new Map();
  const iv = rd && rd.ITEM_VARIANTS;
  if (iv && typeof iv === "object") {
    for (const [name, val] of Object.entries(iv)) {
      const opts = Array.isArray(val?.options) ? val.options.map((o) => o?.name).filter(Boolean) : [];
      map.set(norm(name), { label: val?.label ?? null, options: opts });
    }
  }
  return map;
}

// ---- edition assembly ----------------------------------------------------------------------------
function buildEdition(ed, variantsByName) {
  const spells = readMaybe(path.join(SRD_DIR, `spells-${ed}.json`)) || [];
  const items = readMaybe(path.join(SRD_DIR, `magic-items-${ed}.json`)) || [];
  const gear = readMaybe(path.join(SRD_DIR, `equipment-${ed}.json`)) || [];
  // Conditions are authored only for 2014 so far; reuse them for 2024 until a 2024 file exists.
  const conditions = readMaybe(path.join(SRD_DIR, `conditions-${ed}.json`)) || readMaybe(path.join(SRD_DIR, "conditions-2014.json")) || [];
  return [
    ...spells.map((s) => spellEntry(s, ed)),
    ...items.map((it) => itemEntry(it, ed, variantsByName)),
    ...gear.map((g) => gearEntry(g, ed)),
    ...conditions.map((c) => conditionEntry(c, ed)),
  ];
}

// Union 2024 + 2014, suffixing " (legacy)" on any 2014 entry whose name collides with a 2024 one,
// matching lib/srd/srd.ts's rule so the two agree.
function mergeBoth(primary, older) {
  const taken = new Set(primary.map((e) => norm(e.name)));
  const out = [...primary];
  for (const e of older) {
    if (taken.has(norm(e.name))) {
      const name = `${e.name} (legacy)`;
      out.push({ ...e, name, id: `${e.category}:${slug(name)}`, spoken: spokenForms(e.name), ruleset: "2014" });
    } else out.push(e);
  }
  return out;
}

function main() {
  const mode = (process.argv[2] || "2014").trim();
  const variantsByName = loadVariants();

  let entries;
  if (mode === "both") entries = mergeBoth(buildEdition("2024", variantsByName), buildEdition("2014", variantsByName));
  else entries = buildEdition(mode, variantsByName);

  // Grammar: every unique spoken phrase, plus the Vosk unknown token.
  const grammar = new Set();
  for (const e of entries) for (const p of e.spoken) if (p) grammar.add(p);
  const grammarArr = [...grammar].sort();
  grammarArr.push("[unk]");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const indexPath = path.join(OUT_DIR, `index-${mode}.json`);
  const grammarPath = path.join(OUT_DIR, `grammar-${mode}.json`);
  fs.writeFileSync(indexPath, JSON.stringify(entries));
  fs.writeFileSync(grammarPath, JSON.stringify(grammarArr));

  const byCat = entries.reduce((m, e) => ((m[e.category] = (m[e.category] || 0) + 1), m), {});
  console.log(`[compendium] mode=${mode}`);
  console.log(`  entries: ${entries.length}`, byCat);
  console.log(`  grammar phrases: ${grammarArr.length - 1} (+[unk])`);
  console.log(`  wrote ${path.relative(ROOT, indexPath)} (${(fs.statSync(indexPath).size / 1024).toFixed(0)} KB)`);
  console.log(`  wrote ${path.relative(ROOT, grammarPath)} (${(fs.statSync(grammarPath).size / 1024).toFixed(0)} KB)`);
}

main();
