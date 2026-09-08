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
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRD_DIR = process.env.SRD_DIR || path.join(ROOT, "lib", "srd");
const OUT_DIR = process.env.OUT_DIR || path.join(ROOT, "public", "compendium");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const readMaybe = (p) => (fs.existsSync(p) ? readJson(p) : null);

// ---- text helpers --------------------------------------------------------------------------------
const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/\s*\(legacy\)\s*/g, " ").replace(/\s+/g, " ").trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// ---- voice/typed aliases -------------------------------------------------------------------------
// Shorthand a DM says or types that the entry name alone won't match ("temp hp" -> Temporary Hit
// Points, "oa" -> Opportunity Attacks, "gwm" -> Great Weapon Master). Keyed by the entry's normalized
// name; the phrases are merged into that entry's `spoken` list, so both the fuzzy matcher and the Vosk
// grammar pick them up with no other change. Kept deliberately specific to avoid bad collisions.
const ALIASES = {
  "opportunity attacks": ["opportunity attack", "attack of opportunity", "oa", "aoo"],
  "temporary hit points": ["temp hit points", "temporary hp", "temp hp", "thp"],
  "critical hit": ["crit", "crit hit"],
  "death saving throw": ["death save", "death saves", "dying"],
  "death saving throws": ["death save", "death saves", "dying"],
  "difficult terrain": ["rough terrain"],
  "unarmed strike": ["unarmed attack"],
  "two-weapon fighting": ["dual wield", "dual wielding", "off hand attack"],
  "grappling": ["grapple", "grab"],
  "shoving a creature": ["shove"],
  "spell components": ["components", "verbal somatic material"],
  "passive perception": ["passive check", "passive"],
  "sneak attack": ["sneak"],
  "wild shape": ["wildshape"],
  "channel divinity": ["channel"],
  "great weapon master": ["gwm"],
  "polearm master": ["pam", "pole arm master"],
  "war caster": ["warcaster"],
  "sharpshooter": ["sharp shooter"],
  "mounted combat": ["mount", "mounted"],
  "underwater combat": ["underwater", "swimming combat"],
};
const cleanPhrase = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// Populate each entry's `aliases` from two sources - the ALIASES table (keyed by entry name) and any
// aliases the entry already carries from its source data (the hook homebrew/authored entries use) -
// dedupe + clean them, store them on `e.aliases` (omitted when empty), and merge them INTO `spoken` so
// the fuzzy matcher and the Vosk grammar pick them up with no other change. Idempotent: re-running only
// re-derives the same set (mergeBoth regenerates `spoken` for legacy entries, so main re-applies).
function applyAliases(entries) {
  for (const e of entries) {
    const fromTable = ALIASES[norm(e.name)] || [];
    const fromEntry = Array.isArray(e.aliases) ? e.aliases : [];
    const set = new Set();
    for (const a of [...fromEntry, ...fromTable]) { const p = cleanPhrase(a); if (p) set.add(p); }
    const merged = [...set];
    if (merged.length) {
      e.aliases = merged;
      const spoken = new Set(e.spoken);
      for (const p of merged) spoken.add(p);
      e.spoken = [...spoken];
    } else if ("aliases" in e) {
      delete e.aliases; // keep the index lean: no empty arrays on the ~1700 alias-less entries
    }
  }
  return entries;
}

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

// Strip markdown to plain card text. The class-structured data (feature descriptions) and, defensively,
// monster text carry **bold**, *italic*, _underscores_, links, and em dashes; the cards render plain
// text, so flatten those. House style: no em-dashes, so em/en dashes become a spaced hyphen. Idempotent
// on already-clean prose (spells, items, conditions), so it is only applied to the sources that need it.
function cleanText(s) {
  if (s == null) return null;
  let t = String(s);
  t = t.replace(/<[^>]+>/g, "");                    // stray HTML tags
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");     // [text](url) -> text
  t = t.replace(/\*\*/g, "").replace(/\*/g, "");     // bold / italic asterisks
  t = t.replace(/__/g, "").replace(/_/g, "");        // underscore emphasis
  t = t.replace(/[—–]/g, " - ");                     // em/en dash -> spaced hyphen
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.trim();
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
    source: "srd",
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
    source: "srd",
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
    source: "srd",
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
    source: "srd",
    spoken: spokenForms(c.name),
    display: { description: c.description ?? null },
  };
}

// ---- rules glossary ------------------------------------------------------------------------------
// The disputed-mechanics cards (grapple, cover, hiding, death saves, ...). Text is verbatim SRD 5.1
// (CC-BY), authored into rules-<ed>.json. Only rules-2014.json exists for now, so this category shows
// under the 2014 and "both" toggles; there is deliberately NO 2014 fallback for 2024, because several
// 2024 rules (grapple, shove, exhaustion, fighting styles) changed and 2014 text would be wrong there.
function ruleEntry(r, ruleset) {
  return {
    id: `rule:${slug(r.name)}`,
    name: r.name,
    category: "rule",
    ruleset,
    source: "srd",
    spoken: spokenForms(r.name),
    display: { topic: r.topic ?? null, description: r.description ?? null },
  };
}

// ---- feats ---------------------------------------------------------------------------------------
// The SRD-open feat set is small: SRD 5.1 (2014) has only Grappler, and SRD 5.2 (2024) ships the
// short list below. Everything else in feats-<ed>.json is original content authored by Kerf and Code
// (Terry), so it is credited "kc". Edit these sets if the SRD feat list changes; the footer names
// both sources regardless, so a miss here only mis-tags one card, it never mislabels the tool.
const SRD_FEATS = {
  "2014": new Set(["grappler"]),
  "2024": new Set([
    "alert", "magic initiate", "savage attacker", "skilled",
    "ability score improvement", "grappler",
    "archery", "defense", "great weapon fighting", "two-weapon fighting",
    "boon of combat prowess", "boon of dimensional travel", "boon of fate",
    "boon of irresistible offense", "boon of spell recall", "boon of the night spirit",
    "boon of truesight",
  ]),
};
function featSource(name, ruleset) {
  const set = SRD_FEATS[ruleset] || SRD_FEATS["2014"];
  return set.has(norm(name)) ? "srd" : "kc";
}
function featEntry(f, ruleset) {
  return {
    id: `feat:${slug(f.name)}`,
    name: f.name,
    category: "feat",
    ruleset,
    source: featSource(f.name, ruleset),
    spoken: spokenForms(f.name),
    display: {
      featType: f.category ?? null,
      prerequisite: f.prerequisite ?? null,
      description: f.description ?? null,
    },
  };
}

// ---- class options (metamagic, eldritch invocations, fighting styles) ----------------------------
// These live inside the structured class data (classes-<ed>-structured.json) as level features whose
// name carries a prefix, e.g. "Metamagic: Quickened Spell", "Eldritch Invocation: Agonizing Blast",
// "Fighting Style: Great Weapon Fighting". We lift each option out as its own lookup entry (the option
// name becomes the card title), plus the three umbrella entries ("Metamagic", "Eldritch Invocations",
// "Fighting Style") that explain the mechanic itself. All SRD content, so source "srd". Deduped by
// kind+name because fighting styles repeat across Fighter/Paladin/Ranger and the umbrellas repeat by
// level.
const OPTION_PREFIXES = [
  { re: /^metamagic:\s*(.+)$/i, kind: "metamagic" },
  { re: /^eldritch invocation:\s*(.+)$/i, kind: "invocation" },
  { re: /^fighting style:\s*(.+)$/i, kind: "fighting-style" },
];
const UMBRELLAS = new Map([
  ["metamagic", "metamagic"],
  ["eldritch invocations", "feature"],
  ["fighting style", "feature"],
]);
function featureEntry(kind, name, desc, className, level, ruleset, subclass = null) {
  return {
    id: `feature:${kind}:${slug(name)}`,
    name,
    category: "feature",
    ruleset,
    source: "srd",
    spoken: spokenForms(name),
    display: { kind, className: className ?? null, subclass: subclass ?? null, level: level ?? null, description: cleanText(desc) },
  };
}
function extractClassOptions(ed) {
  const classes = readMaybe(path.join(SRD_DIR, `classes-${ed}-structured.json`));
  if (!Array.isArray(classes)) return [];
  const seen = new Set(); // kind + normalized name
  const out = [];
  for (const cls of classes) {
    const className = cls?.name ?? null;
    const rows = Array.isArray(cls?.features_by_level) ? cls.features_by_level : [];
    for (const row of rows) {
      const level = row?.level ?? null;
      for (const f of (Array.isArray(row?.features) ? row.features : [])) {
        const fname = String(f?.name ?? "");
        const desc = f?.desc ?? f?.description ?? null;
        // Option entries: "Metamagic: X" / "Eldritch Invocation: X" / "Fighting Style: X".
        let matched = false;
        for (const { re, kind } of OPTION_PREFIXES) {
          const m = fname.match(re);
          if (m) {
            matched = true;
            const optName = m[1].trim();
            const key = `${kind}|${norm(optName)}`;
            if (!seen.has(key)) { seen.add(key); out.push(featureEntry(kind, optName, desc, className, level, ed)); }
            break;
          }
        }
        if (matched) continue;
        // Umbrella entries: the mechanic's own explainer, deduped (they repeat across levels).
        const umb = UMBRELLAS.get(norm(fname));
        if (umb) {
          const key = `${umb}|${norm(fname)}`;
          if (!seen.has(key)) { seen.add(key); out.push(featureEntry(umb, fname, desc, className, level, ed)); }
        }
      }
    }
  }
  return out;
}

// ---- general class + subclass features (Rage, Sneak Attack, Channel Divinity, ...) ---------------
// Everything in features_by_level that ISN'T a metamagic/invocation/fighting-style option (those are
// handled above) or pure filler. All SRD content (the structured files carry only the SRD sample
// subclasses), so source "srd". Deduped by name so shared features (Extra Attack, Spellcasting) card
// once.
const FEATURE_SKIP_EXACT = new Set([
  "ability score improvement", "epic boon",
  "metamagic", "eldritch invocations", "fighting style", // umbrellas, carded by extractClassOptions
]);
function isFillerFeature(name) {
  const n = norm(name);
  if (/^(metamagic|eldritch invocation|fighting style):/.test(n)) return true; // options, carded above
  if (FEATURE_SKIP_EXACT.has(n)) return true;
  if (/\bsubclass(es)?$/.test(n)) return true;   // "Barbarian Subclass", "Cleric Subclasses"
  if (/ features?$/.test(n)) return true;         // "Path feature", "Divine Domain feature" placeholders
  return false;
}
function extractClassFeatures(ed) {
  const seen = new Set();
  const out = [];
  const take = (data, hasSubclass) => {
    if (!Array.isArray(data)) return;
    for (const entry of data) {
      const className = hasSubclass ? (entry?.class ?? null) : (entry?.name ?? null);
      const subclass = hasSubclass ? (entry?.name ?? null) : null;
      for (const row of (Array.isArray(entry?.features_by_level) ? entry.features_by_level : [])) {
        const level = row?.level ?? null;
        for (const f of (Array.isArray(row?.features) ? row.features : [])) {
          const fname = String(f?.name ?? "");
          if (!fname || isFillerFeature(fname)) continue;
          const key = norm(fname);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(featureEntry("feature", fname, f?.desc ?? f?.description ?? null, className, level, ed, subclass));
        }
      }
    }
  };
  take(readMaybe(path.join(SRD_DIR, `classes-${ed}-structured.json`)), false);
  take(readMaybe(path.join(SRD_DIR, `subclasses-${ed}-structured.json`)), true);
  return out;
}

// ---- monsters ------------------------------------------------------------------------------------
// SRD monsters only: the source files mix in non-SRD bestiaries (Tome of Beasts, A5e, ...), tagged by
// source_key. We keep only source_key starting "srd" (srd-2024 = 331, srd-2014 = 325). Compact stat
// block; the action-ish sections become name/description lists.
function monsterEntry(m, ruleset) {
  const list = (arr) => (Array.isArray(arr) ? arr : [])
    .map((a) => ({ name: a?.name ?? null, description: cleanText(a?.desc ?? a?.description ?? null) }))
    .filter((x) => x.name || x.description);
  const asStr = (v) => (Array.isArray(v) ? v.filter(Boolean).join(", ") : (v ?? null)) || null;
  return {
    id: `monster:${slug(m.name)}`,
    name: m.name,
    category: "monster",
    ruleset,
    source: "srd",
    spoken: spokenForms(m.name),
    display: {
      size: m.size ?? null,
      type: m.type ?? null,
      alignment: m.alignment ?? null,
      ac: m.ac ?? null,
      hp: m.hp ?? null,
      hitDice: m.hit_dice ?? null,
      speed: m.speed ?? null,
      senses: m.senses ?? null,
      languages: m.languages ?? null,
      cr: m.cr != null ? String(m.cr) : null,
      xp: m.xp ?? null,
      abilities: { str: m.str ?? null, dex: m.dex ?? null, con: m.con ?? null, int: m.int ?? null, wis: m.wis ?? null, cha: m.cha ?? null },
      damageVulnerabilities: asStr(m.damage_vulnerabilities),
      damageResistances: asStr(m.damage_resistances),
      damageImmunities: asStr(m.damage_immunities),
      conditionImmunities: asStr(m.condition_immunities),
      traits: list(m.special_abilities),
      actions: list(m.actions),
      bonusActions: list(m.bonus_actions),
      reactions: list(m.reactions),
      legendaryActions: list(m.legendary_actions),
    },
  };
}
function loadMonsters(ed) {
  const all = readMaybe(path.join(SRD_DIR, `monsters-${ed}.json`)) || [];
  return (Array.isArray(all) ? all : []).filter((m) => String(m?.source_key ?? "").startsWith("srd"));
}

// ---- species -------------------------------------------------------------------------------------
// Playable species with their named traits. species-<ed>.json is { species: [...], variants: [...] };
// every entry carries a source ("SRD 5.1" / "SRD 5.2.1"), and we keep only the SRD ones.
function speciesEntry(sp, ruleset) {
  const traits = (Array.isArray(sp.traits) ? sp.traits : [])
    .map((t) => ({ name: t?.name ?? null, description: cleanText(t?.desc ?? t?.description ?? null) }))
    .filter((t) => t.name || t.description);
  return {
    id: `species:${slug(sp.name)}`,
    name: sp.name,
    category: "species",
    ruleset,
    source: "srd",
    spoken: spokenForms(sp.name),
    display: {
      size: cleanText(sp.size != null ? String(sp.size) : null),
      speed: cleanText(sp.speed != null ? String(sp.speed) : null),
      creatureType: sp.creature_type ?? sp.type ?? null,
      traits,
    },
  };
}
function loadSpecies(ed) {
  const data = readMaybe(path.join(SRD_DIR, `species-${ed}.json`));
  const list = Array.isArray(data) ? data : (Array.isArray(data?.species) ? data.species : []);
  return list.filter((s) => String(s?.source ?? "").toUpperCase().startsWith("SRD"));
}

// ---- backgrounds ---------------------------------------------------------------------------------
// backgrounds-<ed>.json is the structured (no-prose) background data. The two editions carry different
// fields: 2024 grants ability-score choices + an origin feat; 2014 grants languages instead and neither
// of those. The SRD-open background set is tiny - SRD 5.2 ships 4 sample backgrounds (Acolyte, Criminal,
// Sage, Soldier) and SRD 5.1 ships only Acolyte - so those are tagged "srd" and everything else is
// Terry's original content, tagged "kc" (repo-wide provenance: anything not from the SRD is self-authored).
const SRD_BACKGROUNDS = {
  "2014": new Set(["acolyte"]),
  "2024": new Set(["acolyte", "criminal", "sage", "soldier"]),
};
function backgroundSource(name, ruleset) {
  const set = SRD_BACKGROUNDS[ruleset] || SRD_BACKGROUNDS["2014"];
  return set.has(norm(name)) ? "srd" : "kc";
}
function backgroundEntry(b, ruleset) {
  return {
    id: `background:${slug(b.name)}`,
    name: b.name,
    category: "background",
    ruleset,
    source: backgroundSource(b.name, ruleset),
    spoken: spokenForms(b.name),
    display: {
      abilityScores: b.ability_scores ?? null,
      feat: b.feat ?? null,
      skillProficiencies: b.skill_proficiencies ?? null,
      toolProficiency: b.tool_proficiency ?? null,
      languages: b.languages ?? null,
      equipment: b.equipment ?? null,
    },
  };
}
function loadBackgrounds(ed) {
  const data = readMaybe(path.join(SRD_DIR, `backgrounds-${ed}.json`));
  return Array.isArray(data) ? data : (Array.isArray(data?.backgrounds) ? data.backgrounds : []);
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
  const feats = readMaybe(path.join(SRD_DIR, `feats-${ed}.json`)) || [];
  const classOptions = extractClassOptions(ed);
  // Extra per-option class features authored from SRD markdown (currently the 2024 metamagic and
  // eldritch invocation options, which the 2024 structured data does not break out). Shape:
  // [{kind, name, className, description}].
  const classOptionExtra = (readMaybe(path.join(SRD_DIR, `class-options-${ed}.json`)) || [])
    .map((o) => featureEntry(o.kind || "feature", o.name, o.description, o.className ?? null, o.level ?? null, ed));
  const classFeatures = extractClassFeatures(ed);
  const monsters = loadMonsters(ed);
  const species = loadSpecies(ed);
  const backgrounds = loadBackgrounds(ed);
  // No 2014 fallback here (unlike conditions): rules-<ed>.json is edition-specific SRD text.
  const rules = readMaybe(path.join(SRD_DIR, `rules-${ed}.json`)) || [];
  return applyAliases([
    ...spells.map((s) => spellEntry(s, ed)),
    ...items.map((it) => itemEntry(it, ed, variantsByName)),
    ...gear.map((g) => gearEntry(g, ed)),
    ...conditions.map((c) => conditionEntry(c, ed)),
    ...feats.map((f) => featEntry(f, ed)),
    ...classOptions,
    ...classOptionExtra,
    ...classFeatures,
    ...monsters.map((m) => monsterEntry(m, ed)),
    ...species.map((s) => speciesEntry(s, ed)),
    ...backgrounds.map((b) => backgroundEntry(b, ed)),
    ...rules.map((r) => ruleEntry(r, ed)),
  ]);
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

// Import a .ts module that a plain `node` run can't load directly because it uses EXTENSIONLESS
// relative value imports (e.g. lib/drawsteel/rules-data.ts does `import {DS_CAREERS} from "./careers"`,
// lib/lancer/rules-data.ts does `import {FRAME_EXTRAS} from "./frame-traits"`). Node's ESM/TS loader
// won't add the .ts extension; esbuild's bundler does. We bundle the module (esbuild is present via the
// project's deps) to a temp ESM file, import it, then clean up. Used only for the rules-data modules;
// the extension-clean data modules load with a direct import().
async function bundleImport(absPath) {
  const esbuild = await import("esbuild");
  const tmp = path.join(os.tmpdir(), `cmp-${path.basename(absPath, ".ts")}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await esbuild.build({ entryPoints: [absPath], bundle: true, format: "esm", platform: "node", outfile: tmp, logLevel: "silent" });
  try { return await import(pathToFileURL(tmp).href); }
  finally { fs.rmSync(tmp, { force: true }); }
}

// ---- Draw Steel (a second real system behind the TTRPG dropdown) ---------------------------------
// Draw Steel content lives in lib/drawsteel/*.ts (not lib/srd JSON), and it is MECHANICS METADATA ONLY
// under the DRAW STEEL Creator License - names + derived stat tags + a generated one-line ability
// explainer, never MCDM's authored effect prose (the same stance the Forge takes; see the data files'
// headers and lib/systems/attribution.ts). Every content type folds into the generic "custom" card
// (tag + meta lines + body), so no new category or renderer is needed. Ids are prefixed "ds-<type>:"
// (NOT "custom:") so the tool treats them as shipped cards, not the GM's homebrew. source "srd" keeps
// the Kerf-and-Code chip off; the footer surfaces the Creator License line. Classes/kits (rules-data.ts)
// are deferred: that module's extensionless value imports don't load under a plain `node` run.
async function buildDrawSteel() {
  const dsDir = path.join(ROOT, "lib", "drawsteel");
  const imp = (f) => import(pathToFileURL(path.join(dsDir, f)).href);
  const [A, An, Ca, Co, De, Su, Ti] = await Promise.all([
    imp("abilities.ts"), imp("ancestries.ts"), imp("careers.ts"),
    imp("complications.ts"), imp("deities.ts"), imp("subclasses.ts"), imp("titles.ts"),
  ]);
  const R = await bundleImport(path.join(dsDir, "rules-data.ts")); // classes + kits (extensionless imports)
  const clsLabel = (id) => (id === "common" ? "Common" : String(id).replace(/_$/, "").replace(/^./, (c) => c.toUpperCase()));
  const mk = (type, id, name, metaLines, body) => ({
    id: `ds-${type}:${slug(id || name)}`,
    name,
    category: "custom",
    ruleset: "drawsteel",
    source: "srd",
    spoken: spokenForms(name),
    display: { tag: type, metaLines: (metaLines || []).filter(Boolean), body: body ?? null },
  });
  const out = [];
  for (const a of A.DS_ABILITIES) {
    const head = [clsLabel(a.classId), a.level != null ? `level ${a.level}` : null, a.subclass].filter(Boolean).join(" · ");
    out.push(mk("ability", a.id, a.name, [head], A.abilityExplainer(a)));
  }
  for (const an of An.DS_ANCESTRY_LIST) {
    const sig = (an.signatureTraits || []).map((t) => t.name).filter(Boolean).join(", ");
    const pur = (an.purchasedTraits || []).map((t) => `${t.name} (${t.cost})`).join(", ");
    const body = [sig && `Signature: ${sig}.`, pur && `Purchased: ${pur}.`].filter(Boolean).join(" ");
    out.push(mk("ancestry", an.id, an.name, [`Size ${an.size} · Speed ${an.speed} · ${an.points} points`], body || null));
  }
  for (const c of Ca.DS_CAREER_LIST) {
    const meta = [c.perkGroup && `Perk group: ${c.perkGroup}`, c.languages != null && `Languages: ${c.languages}`,
      c.quickSkills && c.quickSkills.length && `Skills: ${c.quickSkills.join(", ")}`];
    out.push(mk("career", c.id, c.name, meta, null));
  }
  for (const c of Co.DS_COMPLICATIONS) {
    out.push(mk("complication", c.id, c.name, [c.benefit && `Benefit: ${c.benefit}`, c.drawback && `Drawback: ${c.drawback}`], null));
  }
  for (const d of De.DS_DEITIES) {
    const domains = (d.domains || []).map((x) => De.domainName(x)).join(", ");
    out.push(mk(d.kind === "saint" ? "saint" : "deity", d.id, d.name, [domains && `Domains: ${domains}`], null));
  }
  for (const [classId, grp] of Object.entries(Su.DS_SUBCLASSES)) {
    for (const opt of (grp.options || [])) {
      const meta = [`${clsLabel(classId)}${grp.concept ? ` · ${grp.concept}` : ""}`, opt.grantsSkill && `Grants: ${opt.grantsSkill}`];
      out.push(mk("subclass", `${classId}-${opt.id}`, opt.name, meta, null));
    }
  }
  for (const t of Ti.DS_TITLES) {
    out.push(mk("title", t.id, t.name, [`Echelon ${t.echelon}`, t.effect && `Effect: ${t.effect}`], null));
  }
  for (const cl of R.DS_CLASS_LIST) {
    const fixed = Object.entries(cl.fixed || {}).map(([k, v]) => `${clsLabel(k)} ${v >= 0 ? "+" : ""}${v}`).join(", ");
    const meta = [
      cl.keyChar && `Key: ${clsLabel(cl.keyChar)}`,
      cl.baseStamina != null && `Stamina ${cl.baseStamina} (+${cl.staminaPerLevel}/lvl)`,
      cl.recoveries != null && `Recoveries ${cl.recoveries}`,
      cl.resource && `Heroic resource: ${cl.resource}`,
    ];
    const body = [fixed && `Fixed: ${fixed}.`, cl.subclass && cl.subclass.concept && `Subclass: ${cl.subclass.concept}.`].filter(Boolean).join(" ");
    out.push(mk("class", cl.id, cl.name, meta, body || null));
  }
  for (const k of R.DS_KIT_LIST) {
    const meta = [
      [k.armor && `Armor ${k.armor}`, k.weapon && `Weapon ${k.weapon}`].filter(Boolean).join(" · "),
      `Speed +${k.speed} · Stability +${k.stability} · Disengage +${k.disengage}`,
      k.staminaPerEchelon ? `Stamina +${k.staminaPerEchelon}/echelon` : null,
    ];
    const dmg = [
      k.meleeDamage && `Melee +${k.meleeDamage.join("/")} (distance ${k.meleeDistance})`,
      k.rangedDamage && `Ranged +${k.rangedDamage.join("/")} (distance ${k.rangedDistance})`,
    ].filter(Boolean).join("; ");
    out.push(mk("kit", k.id, k.name, meta, dmg || null));
  }
  return applyAliases(out);
}

// ---- Lancer (third real system) ------------------------------------------------------------------
// lib/lancer/*.ts, MECHANICS METADATA ONLY under the Lancer Third Party License (weapon/system/mod stat
// lines, pilot gear, and talent + skill-trigger names; no Massif Press prose). Folds into the generic
// "custom" card like Draw Steel; ids "lc-<type>:", source "srd". FRAMES are deferred: lib/lancer/
// rules-data.ts (which merges the base frame stats with FRAME_EXTRAS) uses an extensionless value import
// a plain `node` run can't resolve - unlocking it (and DS classes/kits) means esbuild-bundling that one
// module, a later pass.
async function buildLancer() {
  const dir = path.join(ROOT, "lib", "lancer");
  const imp = (f) => import(pathToFileURL(path.join(dir, f)).href);
  const [L, C, P, D] = await Promise.all([
    imp("loadout-data.ts"), imp("core-bonuses.ts"), imp("pilot-gear.ts"), imp("pilot-data.ts"),
  ]);
  const R = await bundleImport(path.join(dir, "rules-data.ts")); // frames (extensionless FRAME_EXTRAS import)
  const lic = (license, level) => (license ? `License: ${license}${level ? ` ${level}` : ""}` : null);
  const mk = (type, id, name, metaLines, body) => ({
    id: `lc-${type.replace(/\s+/g, "-")}:${slug(id || name)}`,
    name, category: "custom", ruleset: "lancer", source: "srd",
    spoken: spokenForms(name),
    display: { tag: type, metaLines: (metaLines || []).filter(Boolean), body: body ?? null },
  });
  const out = [];
  for (const w of L.LANCER_WEAPONS) {
    out.push(mk("weapon", w.id, w.name, [
      [w.size, w.type].filter(Boolean).join(" · "),
      w.damage && w.damage.length && `Damage: ${w.damage.join(", ")}`,
      w.range && w.range.length && `Range: ${w.range.join(", ")}`,
      lic(w.license, w.licenseLevel),
    ], w.tags && w.tags.length ? `Tags: ${w.tags.join(", ")}` : null));
  }
  for (const s of L.LANCER_SYSTEMS) {
    out.push(mk("system", s.id, s.name, [
      s.type, s.sp != null && `SP ${s.sp}`, lic(s.license, s.licenseLevel),
    ], s.tags && s.tags.length ? `Tags: ${s.tags.join(", ")}` : null));
  }
  for (const m of L.LANCER_MODS) {
    out.push(mk("mod", m.id, m.name, [
      m.sp != null && `SP ${m.sp}`,
      m.allowedTypes && m.allowedTypes.length && `For: ${m.allowedTypes.join(", ")}`,
      lic(m.license, m.licenseLevel),
    ], m.addedTags && m.addedTags.length ? `Adds: ${m.addedTags.map((t) => String(t).trim()).join(", ")}` : null));
  }
  for (const c of C.LANCER_CORE_BONUSES) out.push(mk("core bonus", c.id, c.name, [c.manufacturer], null));
  for (const a of P.LANCER_PILOT_ARMOR) {
    out.push(mk("pilot armor", a.id, a.name, [
      `Armor ${a.armor} · Evasion ${a.evasion} · E-Def ${a.edef} · Speed ${a.speed}`, a.bonusLabel,
    ], a.tags && a.tags.length ? `Tags: ${a.tags.join(", ")}` : null));
  }
  for (const w of P.LANCER_PILOT_WEAPONS) {
    out.push(mk("pilot weapon", w.id, w.name, [
      w.category, w.range && w.range.length && `Range: ${w.range.join(", ")}`, w.damage && `Damage: ${w.damage}`,
    ], w.tags && w.tags.length ? `Tags: ${w.tags.join(", ")}` : null));
  }
  for (const g of P.LANCER_PILOT_GEAR) {
    out.push(mk("pilot gear", g.id, g.name, [g.group, g.tags && g.tags.length && g.tags.join(", ")], g.note || null));
  }
  for (const t of D.LANCER_TALENTS) out.push(mk("talent", t.id, t.name, [], null));
  for (const st of D.LANCER_SKILL_TRIGGERS) out.push(mk("skill trigger", st.id, st.name, [], null));
  for (const f of R.LANCER_FRAME_LIST) {
    const b = f.base || {};
    const meta = [
      [f.manufacturer, f.licenseLevel != null && `License ${f.licenseLevel}`].filter(Boolean).join(" · "),
      `Size ${b.size} · HP ${b.hp} · Armor ${b.armor} · Evasion ${b.evasion} · E-Def ${b.edef}`,
      `Structure ${b.structure} · Stress ${b.stress} · Heat ${b.heatCap} · Speed ${b.speed} · SP ${b.sp}`,
      `Save ${b.save} · Sensors ${b.sensors} · Repair ${b.repCap} · Tech Attack ${b.techAttack}`,
      f.mounts && f.mounts.length && `Mounts: ${f.mounts.join(", ")}`,
    ];
    const traitLines = (f.traits || []).map((t) => `${t.name}: ${t.note}`);
    const cs = f.coreSystem;
    const csLine = cs ? `Core System - ${cs.name}${cs.activeName ? ` (${cs.activeName})` : ""}: ${cs.activeNote || ""}`.trim() : null;
    const body = [...traitLines, csLine].filter(Boolean).join("\n");
    out.push(mk("frame", f.id, f.name, meta, body || null));
  }
  return applyAliases(out);
}

// ---- Daggerheart (fourth real system) ------------------------------------------------------------
// lib/daggerheart/*.ts, MECHANICS METADATA ONLY under the Darrington Press Community Gaming License:
// domain-card names + domain/level/recall/type (their EFFECT TEXT is deliberately not stored), weapon
// and armor stat lines, class/ancestry/community index. No Critical Role / Darrington Press prose ships.
// Folds into the generic "custom" card; ids "dh-<type>:", source "srd". rules-data.ts needs the esbuild
// bundle (extensionless DH_WEAPONS import); domain-cards.ts loads directly (type-only import).
async function buildDaggerheart() {
  const dir = path.join(ROOT, "lib", "daggerheart");
  const DC = await import(pathToFileURL(path.join(dir, "domain-cards.ts")).href);
  const R = await bundleImport(path.join(dir, "rules-data.ts")); // weapons + classes + ancestries + communities + armor
  const cap = (s) => (s ? String(s).replace(/^./, (c) => c.toUpperCase()) : s);
  const DTYPE = { phy: "physical", mag: "magic" };
  const mk = (type, id, name, metaLines, body) => ({
    id: `dh-${type.replace(/\s+/g, "-")}:${slug(id || name)}`,
    name, category: "custom", ruleset: "daggerheart", source: "srd",
    spoken: spokenForms(name),
    display: { tag: type, metaLines: (metaLines || []).filter(Boolean), body: body ?? null },
  });
  const out = [];
  for (const c of DC.DH_DOMAIN_CARDS) {
    out.push(mk("domain card", c.id, c.name, [`${cap(c.domain)} · Level ${c.level} · ${c.type}`, `Recall ${c.recall}`], null));
  }
  for (const w of R.DH_WEAPON_LIST) {
    const dmg = `Damage ${w.damageDie}${w.damageBonus ? `+${w.damageBonus}` : ""} ${DTYPE[w.damageType] || w.damageType || ""}`.trim();
    out.push(mk("weapon", w.id, w.name, [
      [w.tier != null && `Tier ${w.tier}`, w.category].filter(Boolean).join(" · "),
      [cap(w.trait), w.range].filter(Boolean).join(" · "),
      dmg, w.burden,
    ], w.feature ? `Feature: ${w.feature}` : null));
  }
  for (const cl of R.DH_CLASS_LIST) {
    out.push(mk("class", cl.id, cl.name, [
      cl.domains && cl.domains.length && `Domains: ${cl.domains.map(cap).join(", ")}`,
      cl.evasion != null && `Evasion ${cl.evasion}`, cl.hp != null && `HP ${cl.hp}`,
    ], null));
  }
  for (const a of R.DH_ANCESTRY_LIST) out.push(mk("ancestry", a.id, a.name, [], null));
  for (const c of R.DH_COMMUNITY_LIST) out.push(mk("community", c.id, c.name, [], null));
  for (const ar of R.DH_ARMOR_LIST) {
    out.push(mk("armor", ar.id, ar.name, [
      ar.tier != null && `Tier ${ar.tier}`,
      (ar.baseMajor != null && ar.baseSevere != null) && `Thresholds ${ar.baseMajor}/${ar.baseSevere}`,
      ar.baseScore != null && `Base Score ${ar.baseScore}`,
      ar.evasionMod ? `Evasion ${ar.evasionMod >= 0 ? "+" : ""}${ar.evasionMod}` : null,
    ], null));
  }
  return applyAliases(out);
}

async function main() {
  const mode = (process.argv[2] || "2014").trim();

  let entries;
  if (mode === "drawsteel") {
    entries = await buildDrawSteel();
  } else if (mode === "lancer") {
    entries = await buildLancer();
  } else if (mode === "daggerheart") {
    entries = await buildDaggerheart();
  } else {
    const variantsByName = loadVariants();
    if (mode === "both") entries = mergeBoth(buildEdition("2024", variantsByName), buildEdition("2014", variantsByName));
    else entries = buildEdition(mode, variantsByName);
    // Re-apply aliases on the final list: mergeBoth regenerates `spoken` for legacy-suffixed entries,
    // which would otherwise drop their aliases. Idempotent for the single-edition modes.
    applyAliases(entries);
  }

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

main().catch((e) => { console.error(e); process.exit(1); });
