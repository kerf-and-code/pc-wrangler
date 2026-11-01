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
// SPLIT OUTPUT (so the page loads fast). index-<mode>.json is the SEARCH LIST only: id, name,
// category, ruleset, source, book, spoken/aliases, plus three precomputed facets the UI needs without
// the card text (tag = the type chip, sub = the browse subgroup, stat = one key fact for the
// disambiguation chips) and `s` = the shard number. The card text (`display`) lives in
// cards/<mode>/<s>.json as { [id]: display }, fetched the first time a card from that shard opens.
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
// Alternate published names (lib/srd/name-aliases.json, shared with lib/name-aliases.ts): the
// possessive Player's Handbook spell names the SRD prints without the wizard ("Tasha's Hideous
// Laughter" -> Hideous Laughter). Folded into ALIASES so a DM can say either name.
{
  const NAME_ALIASES = readMaybe(path.join(SRD_DIR, "name-aliases.json")) || {};
  for (const [alias, canonical] of Object.entries(NAME_ALIASES.spells || {})) {
    const k = norm(canonical);
    ALIASES[k] = [...(ALIASES[k] || []), alias];
  }
}
// Apostrophes are dropped, not spaced: "Bigby's Hand" -> "bigbys hand", the way it is typed or heard.
const cleanPhrase = (s) => String(s || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
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
// Fold accented Latin letters to their ASCII base so a name like "Adûn" spokens as "adun" (not "ad n"):
// Vosk's lexicon and a DM typing at speed both use plain letters, so the spoken/grammar forms must too.
// NFD splits a letter from its combining accent, then the accents are dropped; a few letters that do not
// decompose (ø, æ, ß, ...) are mapped by hand. Ids/slugs are deliberately NOT folded, so existing entry
// ids (and any homebrew override that points at one) are unchanged.
const LIGATURES = { "ø": "o", "æ": "ae", "œ": "oe", "ð": "d", "þ": "th", "ß": "ss", "ł": "l" };
const fold = (s) =>
  String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[øæœðþßł]/g, (m) => LIGATURES[m] || m);

function spokenForms(name) {
  const set = new Set();
  const base = norm(name);
  const speak = (s) => fold(s).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
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

// The SRD document an SRD card comes from, shown as its book chip so every card names a source.
const srdBook = (ed) => (ed === "2024" ? "SRD 5.2" : "SRD 5.1");

// ---- per-domain entry builders -------------------------------------------------------------------
function spellEntry(s, ruleset) {
  return {
    id: `spell:${slug(s.name)}`,
    name: s.name,
    category: "spell",
    ruleset,
    // SRD spells are "srd"; the non-SRD spells Terry authored (spells-authored.json) mark themselves "kc".
    source: s.source === "kc" ? "kc" : "srd",
    book: s.source === "kc" ? (s.book ?? null) : srdBook(ruleset),
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
    // Non-SRD items (Arcana Unleashed, Deadfall) carry source "kc": book facts, Kerf and Code wording.
    source: it.source === "kc" ? "kc" : "srd",
    book: it.source === "kc" ? (it.book ?? null) : srdBook(ruleset),
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
    book: srdBook(ruleset),
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
    book: srdBook(ruleset),
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
    // Most glossary cards are verbatim SRD (CC-BY) -> "srd". Authored optional/variant rules (flanking,
    // rest variants, etc.) are original Kerf-and-Code wording and mark themselves "kc" in the source JSON.
    source: r.source === "kc" ? "kc" : "srd",
    book: r.source === "kc" ? (r.book ?? null) : srdBook(ruleset),
    spoken: spokenForms(r.name),
    display: { topic: r.topic ?? null, description: r.description ?? null },
  };
}

// ---- reference cards (at-a-glance DM-screen tables) -----------------------------------------------
// Authored numeric fact tables (typical DCs, travel pace, skills by ability, light sources, the
// exhaustion track, actions in combat) from lib/srd/reference.json. Category "reference" renders as a
// small table card (blurb + column/row grid + footnote). Numeric game facts -> source "kc". Routed by an
// `edition` field ("2014" | "2024" | "both") the same way authored spells are.
function referenceEntry(r, ruleset) {
  return {
    id: `reference:${slug(r.name)}`,
    name: r.name,
    category: "reference",
    ruleset,
    source: r.source === "srd" ? "srd" : "kc",
    book: r.source === "srd" ? srdBook(ruleset) : (r.book ?? null),
    spoken: spokenForms(r.name),
    display: {
      blurb: r.blurb ?? null,
      columns: Array.isArray(r.columns) ? r.columns : [],
      rows: Array.isArray(r.rows) ? r.rows : [],
      note: r.note ?? null,
    },
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
    book: f.book ?? (featSource(f.name, ruleset) === "srd" ? srdBook(ruleset) : null),
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
function featureEntry(kind, name, desc, className, level, ruleset, subclass = null, source = "srd", book = null) {
  return {
    id: `feature:${kind}:${slug(name)}`,
    name,
    category: "feature",
    ruleset,
    source,
    book: book ?? (source === "srd" ? srdBook(ruleset) : null),
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
// once. The one exception is subclasses-authored-<ed>.json: non-SRD subclasses (Arcana Unleashed so
// far) written in Kerf and Code wording, same shape, read LAST so an SRD feature of the same name
// wins the dedupe, and carded with the entry's own `source` ("kc") so they never pass as SRD.
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
// Deduped on name AND text, not name alone: many classes and subclasses share a feature NAME
// ("Bonus Proficiencies", "Spellcasting", "Expanded Spell List") with different rules, and a name-only
// dedupe kept the first and silently dropped every other version. Only a true repeat (same name, same
// text, e.g. Extra Attack) collapses. The first card of a name keeps the plain id so existing overrides
// and DM-screen snapshots still resolve; later versions are qualified by their subclass or class.
function extractClassFeatures(ed) {
  const seen = new Set();
  const usedIds = new Set();
  const out = [];
  // Partnered classes carry their book on the simple class record.
  const classBook = new Map((readMaybe(path.join(SRD_DIR, `classes-${ed}.json`)) || []).map((c) => [c.name, c.book ?? null]));
  const take = (data, hasSubclass) => {
    if (!Array.isArray(data)) return;
    for (const entry of data) {
      const className = hasSubclass ? (entry?.class ?? null) : (entry?.name ?? null);
      const subclass = hasSubclass ? (entry?.name ?? null) : null;
      const book = entry?.book ?? (hasSubclass ? null : classBook.get(className) ?? null);
      for (const row of (Array.isArray(entry?.features_by_level) ? entry.features_by_level : [])) {
        const level = row?.level ?? null;
        for (const f of (Array.isArray(row?.features) ? row.features : [])) {
          const fname = String(f?.name ?? "");
          if (!fname || isFillerFeature(fname)) continue;
          const desc = f?.desc ?? f?.description ?? null;
          const key = `${norm(fname)}|${norm(cleanText(desc) ?? "")}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const source = entry?.source === "kc" ? "kc" : "srd";
          const e = featureEntry("feature", fname, desc, className, level, ed, subclass, source, book);
          if (usedIds.has(e.id)) e.id = `feature:feature:${slug(subclass || className || "x")}:${slug(fname)}`;
          if (usedIds.has(e.id)) e.id = `feature:feature:${slug(className || "x")}:${slug(subclass || "base")}:${slug(fname)}:${level ?? 0}`;
          usedIds.add(e.id);
          out.push(e);
        }
      }
    }
  };
  take(readMaybe(path.join(SRD_DIR, `classes-${ed}-structured.json`)), false);
  take(readMaybe(path.join(SRD_DIR, `subclasses-${ed}-structured.json`)), true);
  take(readMaybe(path.join(SRD_DIR, `subclasses-authored-${ed}.json`)), true);
  return out;
}

// ---- monsters ------------------------------------------------------------------------------------
// Every monster in monsters-<ed>.json, carded by origin (lib/monster-sources.ts is the map):
//   srd-*   SRD 5.1 / 5.2 (CC BY)                        -> source "srd"
//   kc-*    Kerf and Code wording of book statistics       -> source "kc"
//   others  third-party Open5e bestiaries (OGL 1.0a / ORC) -> source "3p", with `book` = the short
//           book label, which the card shows as a chip (the OGL Section 8 identification).
// Third-party ids carry the source key (monster:tob2:aboleth) because 651 names repeat across books.
// Their names are qualified with the book ("Aboleth (Monstrous Menagerie (A5E))") when the plain name
// is already taken in the edition or repeats among the third-party books, so cards stay tellable apart
// and an exact voice match on a shared name still lands on the SRD card (the matcher breaks score
// ties on the shorter name). The plain name stays in `spoken`, so saying it still finds them all.
// Compact stat block; the action-ish sections become name/description lists.
let MONSTER_SOURCES = {}; // filled in main() from lib/srd/monster-sources.json before any edition is built
function monsterOrigin(key) {
  const k = String(key ?? "");
  if (k.startsWith("kc-")) return "kc";
  if (k.startsWith("srd")) return "srd";
  return MONSTER_SOURCES[k]?.thirdParty ? "3p" : null;
}
function monsterEntry(m, ruleset) {
  const origin = monsterOrigin(m.source_key);
  const idBase = origin === "3p" ? `monster:${m.source_key}:${slug(m.name)}` : `monster:${slug(m.name)}`;
  const list = (arr) => (Array.isArray(arr) ? arr : [])
    .map((a) => ({ name: a?.name ?? null, description: cleanText(a?.desc ?? a?.description ?? null) }))
    .filter((x) => x.name || x.description);
  const asStr = (v) => (Array.isArray(v) ? v.filter(Boolean).join(", ") : (v ?? null)) || null;
  return {
    id: idBase,
    name: m.name,
    category: "monster",
    ruleset,
    source: origin,
    // Every monster names its book: third-party by the short label (it doubles as the OGL Section 8
    // identification and qualifies repeated names), first-party by the full title.
    book: origin === "3p"
      ? (MONSTER_SOURCES[m.source_key]?.short ?? String(m.source_key))
      : origin === "srd" ? srdBook(ruleset)
      // kc titles carry a ", Kerf and Code wording" note for the licenses page; the chip shows the book.
      : String(MONSTER_SOURCES[m.source_key]?.title ?? m.source_key).replace(/,\s*Kerf and Code wording$/i, ""),
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
  // A source_key not in lib/monster-sources.ts is skipped rather than guessed at.
  return (Array.isArray(all) ? all : []).filter((m) => monsterOrigin(m?.source_key) != null);
}

// Monster entries for one edition: SRD and kc first, third-party after, so the qualifying pass sees
// every first-party name before it. `takenNames` holds the normalized names of the edition's other
// entries (spells, items, ...), which a third-party monster must not shadow either.
function monsterEntries(monsters, ed, takenNames) {
  const first = monsters.filter((m) => monsterOrigin(m.source_key) !== "3p").map((m) => monsterEntry(m, ed));
  const third = monsters.filter((m) => monsterOrigin(m.source_key) === "3p").map((m) => monsterEntry(m, ed));
  const taken = new Set([...takenNames, ...first.map((e) => norm(e.name))]);
  const thirdCount = third.reduce((c, e) => c.set(norm(e.name), (c.get(norm(e.name)) || 0) + 1), new Map());
  const usedIds = new Set(first.map((e) => e.id));
  for (const e of third) {
    const key = norm(e.name);
    if (taken.has(key) || thirdCount.get(key) > 1) {
      const name = `${e.name} (${e.book})`;
      e.spoken = [...new Set([...e.spoken, ...spokenForms(name)])];
      e.name = name;
    }
  }
  for (const e of third) {
    const src = e.id; // set below from the source key; keep ids unique even within one book
    let id = src;
    if (usedIds.has(id)) { let n = 2; while (usedIds.has(`${src}-${n}`)) n++; id = `${src}-${n}`; }
    usedIds.add(id);
    e.id = id;
  }
  return [...first, ...third];
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
    book: srdBook(ruleset),
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
    book: b.book ?? (backgroundSource(b.name, ruleset) === "srd" ? srdBook(ruleset) : null),
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


// ---- classes -------------------------------------------------------------------------------------
// One overview card per class: hit die, saves, proficiencies, the level table (proficiency bonus,
// every resource column the book's table has, and spell slots), and the features gained at each level
// by name (each feature is its own card). Built from classes-<ed>.json (features, book) plus the
// structured file (the table). SRD classes keep SRD text; partnered classes are Kerf and Code wording.
const prettyKey = (k) => String(k).replace(/_/g, " ").replace(/\bspell slots level (\d)\b/, "slot $1").replace(/^./, (c) => c.toUpperCase());
function classTable2024(st) {
  const cols = Array.isArray(st?.class_table) ? st.class_table : [];
  if (!cols.length) return null;
  const ordered = [...cols.filter((c) => c.type === "PROFICIENCY_BONUS"), ...cols.filter((c) => c.type === "CLASS_TABLE_DATA"), ...cols.filter((c) => c.type === "SPELL_SLOTS")];
  return { columns: ordered.map((c) => (c.type === "PROFICIENCY_BONUS" ? "PB" : c.type === "SPELL_SLOTS" ? `Slot ${c.name}` : c.name)),
    cell: (lvl) => ordered.map((c) => String(c.by_level?.[String(lvl)] ?? "-")) };
}
function classTable2014(st) {
  const prog = Array.isArray(st?.progression) ? st.progression : [];
  if (!prog.length) return null;
  const csKeys = [...new Set(prog.flatMap((p) => Object.keys(p.class_specific || {})))];
  const scKeys = [...new Set(prog.flatMap((p) => Object.keys(p.spellcasting || {})))]
    .filter((k) => prog.some((p) => Number(p.spellcasting?.[k] ?? 0) !== 0));
  const byLvl = new Map(prog.map((p) => [p.level, p]));
  const fmt = (v) => (v == null ? "-" : typeof v === "object" ? Object.entries(v).map(([a, b]) => `${a} ${b}`).join(", ") : String(v));
  return { columns: ["PB", ...csKeys.map(prettyKey), ...scKeys.map(prettyKey)],
    cell: (lvl) => { const p = byLvl.get(lvl) || {}; return [p.prof_bonus != null ? `+${p.prof_bonus}` : "-", ...csKeys.map((k) => fmt(p.class_specific?.[k])),
      ...scKeys.map((k) => (/^spell_slots_level_/.test(k) && Number(p.spellcasting?.[k] ?? 0) === 0 ? "-" : fmt(p.spellcasting?.[k])))]; } };
}
function classEntries(ed) {
  const simple = readMaybe(path.join(SRD_DIR, `classes-${ed}.json`)) || [];
  const structured = readMaybe(path.join(SRD_DIR, `classes-${ed}-structured.json`)) || [];
  const subs = [...(readMaybe(path.join(SRD_DIR, `subclasses-${ed}-structured.json`)) || []), ...(readMaybe(path.join(SRD_DIR, `subclasses-authored-${ed}.json`)) || [])];
  const out = [];
  for (const c of simple) {
    const st = structured.find((x) => x.name === c.name);
    const table = ed === "2024" ? classTable2024(st) : classTable2014(st);
    const feats = new Map();
    for (const f of (Array.isArray(c.features_by_level) ? c.features_by_level : [])) {
      if (!f?.name || isFillerFeature(f.name)) continue;
      const lv = Number(f.level) || 0;
      if (!feats.has(lv)) feats.set(lv, []);
      if (!feats.get(lv).includes(f.name)) feats.get(lv).push(f.name);
    }
    const subNames = [...new Set([...(Array.isArray(c.subclasses) ? c.subclasses.map((x) => (typeof x === "string" ? x : x?.name)) : []),
      ...subs.filter((x) => x.class === c.name).map((x) => x.name)].filter(Boolean))].sort();
    const listOrStr = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : x?.name ?? "")).filter(Boolean).join(", ") : (v ?? null));
    const rows = [];
    for (let lvl = 1; lvl <= 20; lvl++) rows.push([String(lvl), ...(table ? table.cell(lvl) : []), (feats.get(lvl) || []).join(", ") || "-"]);
    const partnered = c.source === "kc" || c.partnered;
    out.push({
      id: `class:${slug(c.name)}`,
      name: c.name,
      category: "class",
      ruleset: ed,
      source: partnered ? "kc" : "srd",
      book: partnered ? (c.book ?? null) : srdBook(ed),
      spoken: spokenForms(c.name),
      display: {
        hitDie: c.hit_die != null ? `d${c.hit_die}` : null,
        primaryAbility: c.primary_ability ?? null,
        savingThrows: listOrStr(c.saving_throws),
        proficiencies: listOrStr(c.proficiencies),
        spellcastingAbility: c.spellcasting_ability ?? null,
        columns: ["Level", ...(table ? table.columns : []), "Features"],
        rows,
        subclasses: subNames,
      },
    });
  }
  return out;
}

// ---- subclasses ----------------------------------------------------------------------------------
// One overview card per subclass with every feature by level, so saying "Path of the Glacier" brings up
// the whole subclass. The features also stay individual cards for a direct lookup of one feature.
function subclassEntries(ed) {
  const out = [];
  const seen = new Set();
  const take = (list) => {
    for (const sc of (Array.isArray(list) ? list : [])) {
      if (!sc?.name || !sc?.class) continue;
      const key = `${norm(sc.class)}|${norm(sc.name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const levels = (Array.isArray(sc.features_by_level) ? sc.features_by_level : [])
        .map((row) => ({ level: row?.level ?? null,
          features: (Array.isArray(row?.features) ? row.features : []).filter((f) => f?.name && !isFillerFeature(f.name))
            .map((f) => ({ name: f.name, description: cleanText(f.desc ?? f.description ?? null) })) }))
        .filter((r) => r.features.length);
      if (!levels.length) continue;
      const kc = sc.source === "kc";
      out.push({
        id: `subclass:${slug(sc.class)}:${slug(sc.name)}`,
        name: sc.name,
        category: "subclass",
        ruleset: ed,
        source: kc ? "kc" : "srd",
        book: kc ? (sc.book ?? null) : srdBook(ed),
        spoken: spokenForms(sc.name),
        display: { className: sc.class, levels },
      });
    }
  };
  take(readMaybe(path.join(SRD_DIR, `subclasses-${ed}-structured.json`)));
  take(readMaybe(path.join(SRD_DIR, `subclasses-authored-${ed}.json`)));
  return out;
}

// ---- species from the builder's mechanics (rules-data.json SPECIES) -------------------------------
// Every species the Forge can build, not just the 9 SRD ones: Kerf and Code wording throughout. The SRD
// species keep their SRD card (same name is skipped here). One card covers both editions (the 2014
// ability score rule is a line on it), so it is tagged `edAgnostic` and "both" mode keeps one copy.
const ABIL = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };
const titleWords = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
function speciesSpells(list) {
  return (Array.isArray(list) ? list : []).map((sp) => {
    const bits = [sp.level > 1 ? `level ${sp.level}` : null,
      sp.free === "1/LR" ? "once per Long Rest" : sp.free === "PB/LR" ? "Proficiency Bonus times per Long Rest" : null].filter(Boolean);
    return `${sp.spell}${bits.length ? ` (${bits.join(", ")})` : ""}`;
  }).join(", ");
}
function speciesFacts(v) {
  const facts = [];
  if (v.darkvision) facts.push(`Darkvision ${v.darkvision} ft.`);
  if (v.senses) for (const [k, n] of Object.entries(v.senses)) facts.push(`${titleWords(k)} ${n} ft.`);
  if (Array.isArray(v.resist) && v.resist.length) facts.push(`Resistance: ${v.resist.join(", ")}`);
  if (Array.isArray(v.immune) && v.immune.length) facts.push(`Immunity: ${v.immune.join(", ")}`);
  if (Array.isArray(v.advAgainst) && v.advAgainst.length) facts.push(`Advantage on saves against: ${v.advAgainst.join(", ")}`);
  if (Array.isArray(v.skillProf) && v.skillProf.length) facts.push(`Skills: ${v.skillProf.map(titleWords).join(", ")}`);
  if (v.skillPick) {
    const from = Array.isArray(v.skillPick.from) ? v.skillPick.from.map(titleWords).join(", ") : "any skill";
    facts.push(`Skill choice: ${v.skillPick.n ?? 1} of ${from}`);
  }
  if (Array.isArray(v.weaponProf) && v.weaponProf.length) facts.push(`Weapons: ${v.weaponProf.join(", ")}`);
  if (Array.isArray(v.toolProf) && v.toolProf.length) facts.push(`Tools: ${v.toolProf.join(", ")}`);
  if (Array.isArray(v.languages) && v.languages.length) facts.push(`Languages: ${v.languages.join(", ")}`);
  if (Array.isArray(v.spells) && v.spells.length) facts.push(`Spells: ${speciesSpells(v.spells)}${v.spellAbility && v.spellAbility !== "choose" ? ` (${ABIL[v.spellAbility] ?? v.spellAbility})` : v.spellAbility === "choose" ? " (Int, Wis or Cha, your choice)" : ""}`);
  const e14 = v.editions?.["2014"] || {};
  const mods = e14.mods || v.mods;
  const parts = [];
  if (mods) parts.push(Object.entries(mods).map(([a, n]) => `${n >= 0 ? "+" : ""}${n} ${ABIL[a] ?? a}`).join(", "));
  if (e14.asiPick) parts.push(e14.asiPick.kind === "flexible" ? "+2 and +1, or three +1s, to abilities of your choice"
    : `${e14.asiPick.amounts.map((n) => `+${n}`).join(" and ")} to different abilities of your choice${e14.asiPick.exclude ? ` (not ${e14.asiPick.exclude.map((a) => ABIL[a] ?? a).join(", ")})` : ""}`);
  if (parts.length) facts.push(`Ability scores (2014 rules): ${parts.join("; ")}. 2024 rules: from your background.`);
  return facts;
}
function speciesFromRules(ed, srdNames) {
  const rd = readMaybe(path.join(SRD_DIR, "rules-data.json"));
  const out = [];
  for (const [name, v] of Object.entries(rd?.SPECIES || {})) {
    if (srdNames.has(norm(name))) continue;
    const speeds = Object.entries(v.speeds || {}).map(([k, n]) => `${k} ${n === "speed" ? "equal to Speed" : `${n} ft.`}`);
    const traits = (Array.isArray(v.traits) ? v.traits : []).map((t) => (Array.isArray(t) ? { name: t[0] ?? null, description: t[1] ?? null } : { name: t?.name ?? null, description: t?.desc ?? null }));
    if (v.choice?.options) {
      for (const [opt, o] of Object.entries(v.choice.options)) {
        const bits = [o.summary, o.darkvision && `Darkvision ${o.darkvision} ft.`, o.speed && `Speed ${o.speed} ft.`,
          Array.isArray(o.resist) && o.resist.length && `Resistance: ${o.resist.join(", ")}`,
          Array.isArray(o.spells) && o.spells.length && `Spells: ${speciesSpells(o.spells)}`].filter(Boolean);
        traits.push({ name: `${v.choice.label ?? "Option"}: ${opt}`, description: bits.join(" ") || null });
      }
    }
    out.push({
      id: `species:${slug(name)}`,
      name,
      category: "species",
      ruleset: ed,
      source: "kc",
      book: v.src ?? null,
      edAgnostic: true,
      spoken: spokenForms(name),
      display: {
        size: v.size ?? null,
        speed: `${v.speed ?? 30} ft.${speeds.length ? `, ${speeds.join(", ")}` : ""}`,
        creatureType: v.creatureType ?? null,
        traits,
        facts: speciesFacts(v),
      },
    });
  }
  return out;
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
  // Non-SRD spells Terry authored (spells-authored.json), routed by their `edition` field: a spell tagged
  // for this edition, or "both", is included. They carry source "kc" and render through the same spell
  // card as the SRD spells. In "both" mode a "both"-tagged spell lands in both editions and mergeBoth
  // legacy-suffixes the 2014 copy, exactly like a cross-edition SRD spell.
  const authoredSpells = (readMaybe(path.join(SRD_DIR, "spells-authored.json")) || [])
    .filter((s) => s.edition === ed || s.edition === "both");
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
  // At-a-glance reference tables, edition-routed like the authored spells.
  const references = (readMaybe(path.join(SRD_DIR, "reference.json")) || [])
    .filter((r) => r.edition === ed || r.edition === "both");
  const before = [
    ...spells.map((s) => spellEntry(s, ed)),
    ...authoredSpells.map((s) => spellEntry(s, ed)),
    ...items.map((it) => itemEntry(it, ed, variantsByName)),
    ...gear.map((g) => gearEntry(g, ed)),
    ...conditions.map((c) => conditionEntry(c, ed)),
    ...feats.map((f) => featEntry(f, ed)),
    ...classOptions,
    ...classOptionExtra,
    ...classFeatures,
  ];
  const srdSpecies = species.map((s) => speciesEntry(s, ed));
  const after = [
    ...classEntries(ed),
    ...subclassEntries(ed),
    ...srdSpecies,
    ...speciesFromRules(ed, new Set(species.map((s) => norm(s.name)))),
    ...backgrounds.map((b) => backgroundEntry(b, ed)),
    ...rules.map((r) => ruleEntry(r, ed)),
    ...references.map((r) => referenceEntry(r, ed)),
  ];
  const monsterList = monsterEntries(monsters, ed, [...before, ...after].map((e) => norm(e.name)));
  return applyAliases([...before, ...monsterList, ...after]);
}

// Union 2024 + 2014, suffixing " (legacy)" on any 2014 entry whose name collides with a 2024 one,
// matching lib/srd/srd.ts's rule so the two agree.
// A 2014 card is a legacy copy only of a 2024 card of the SAME category: a 2014 Witch class is not an
// older printing of a 2024 Witch subclass. (The third-party book qualifier below still looks across
// categories, since a monster must not shadow any other card's name.)
function mergeBoth(primary, older) {
  const taken = new Set(primary.map((e) => norm(e.name)));
  const takenCat = new Set(primary.map((e) => `${e.category}|${norm(e.name)}`));
  // Features: "legacy" only when the 2024 data has the same feature of the same class and subclass. A
  // 2014-only subclass's "Bonus Proficiencies" is not an old printing of another subclass's feature; it
  // keeps its name (the chip shows subclass and edition) and only its id is told apart.
  const featKey = (e) => `${norm(e.display?.className ?? "")}|${norm(e.display?.subclass ?? "")}|${norm(e.name)}`;
  const takenFeat = new Set(primary.filter((e) => e.category === "feature").map(featKey));
  const usedIds = new Set(primary.map((e) => e.id));
  // "(legacy)" claims the 2014 card is an older printing of the 2024 one. That holds for the SRD 5.1/5.2
  // pair and for a book reprinted under the same title; two different books that happen to share a
  // name (Obojima's Witch and Northlands' Witch) are told apart by book instead.
  const primaryBook = new Map(primary.map((e) => [`${e.category}|${norm(e.name)}`, e.book ?? null]));
  const isSrdBook = (b) => /^SRD /.test(String(b ?? ""));
  const allNames = new Set([...primary, ...older].map((e) => `${e.category}|${norm(e.name)}`));
  const out = [...primary];
  const agnostic = new Set(primary.filter((e) => e.edAgnostic).map((e) => e.id));
  for (const e of older) {
    // One card already covers both editions (rules-data species): keep the single copy.
    if (e.edAgnostic && agnostic.has(e.id)) continue;
    // A third-party monster that collides with a 2024 name is told apart by its book, not "(legacy)":
    // it is not an older printing of the 2024 creature.
    if (taken.has(norm(e.name)) && e.source === "3p" && !e.name.endsWith(`(${e.book})`)) {
      const name = `${e.name} (${e.book})`;
      out.push({ ...e, name, spoken: [...new Set([...e.spoken, ...spokenForms(name)])] });
      continue;
    }
    if (e.category === "feature" && takenCat.has(`feature|${norm(e.name)}`) && !takenFeat.has(featKey(e))) {
      out.push(usedIds.has(e.id) ? { ...e, id: `${e.id}-2014` } : e);
      continue;
    }
    const pb = primaryBook.get(`${e.category}|${norm(e.name)}`);
    if (takenCat.has(`${e.category}|${norm(e.name)}`) && e.book && pb && e.book !== pb && !(isSrdBook(e.book) && isSrdBook(pb))
      && !allNames.has(`${e.category}|${norm(`${e.name} (${e.book})`)}`)) {
      const name = `${e.name} (${e.book})`;
      out.push({ ...e, name, id: usedIds.has(e.id) ? `${e.id}-2014` : e.id, spoken: [...new Set([...e.spoken, ...spokenForms(name)])], ruleset: "2014" });
      continue;
    }
    if (takenCat.has(`${e.category}|${norm(e.name)}`)) {
      const name = `${e.name} (legacy)`;
      // The id is the 2014 entry's own id plus "-legacy", NOT slug(name): norm() strips "(legacy)", so
      // slug(name) reproduced the 2024 twin's id, and the 1,154 duplicate ids made the matcher (which
      // keeps one result per id) and the override layer treat the two cards as one.
      out.push({ ...e, name, id: `${e.id}-legacy`, spoken: spokenForms(e.name), ruleset: "2014" });
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

// ---- Pathfinder Second Edition (fifth real system) -----------------------------------------------
// Unlike the other extra systems, PF2e content is far too large to hand-author as a .ts module, so it is
// pre-extracted from the Foundry `pf2e` system packs by scripts/extract-pf2e.mjs into the committed data
// file lib/pf2e/compendium-data.json (records already cleaned to plain prose, house style applied). Here
// we only wrap each record into the generic "custom" card. PF2e rules mechanics are Open Game Content
// (OGL 1.0a for legacy entries, ORC for Remaster entries) - both reusable - so unlike MCDM/Critical Role/
// Massif we DO ship the rules text PF2e opens, per-entry sourced to its book. AP-specific bestiaries are
// excluded by the extractor; only Monster Core, Monster Core 2, and NPC Core creatures ship. Ids are
// "pf-<tag>:" and source "srd" (keeps the homebrew chip off; the footer carries the OGL/ORC line).
function buildPathfinder() {
  const dataPath = path.join(ROOT, "lib", "pf2e", "compendium-data.json");
  if (!fs.existsSync(dataPath)) {
    throw new Error(`missing ${path.relative(ROOT, dataPath)} - run: PF2E_PACKS=<packs/pf2e> node scripts/extract-pf2e.mjs`);
  }
  const data = readJson(dataPath);
  const usedIds = new Set();
  const out = data.map((r) => {
    const meta = [...(r.metaLines || [])];
    if (r.book) meta.push(`Source: ${r.book}`);
    let id = `pf-${String(r.tag).replace(/\s+/g, "-")}:${slug(r.name)}`;
    if (usedIds.has(id)) { let n = 2; while (usedIds.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
    usedIds.add(id);
    return {
      id,
      name: r.name,
      category: "custom",
      ruleset: "pf2e",
      source: "srd",
      spoken: spokenForms(r.name),
      display: { tag: r.tag, metaLines: meta.filter(Boolean), body: r.body ?? null },
    };
  });
  return applyAliases(out);
}


// ---- search-list facets + card shards ------------------------------------------------------------
// tag/sub mirror entryTag() and idxSubOf() in components/compendium-tool.tsx (sub is title-cased on the
// client), stat is the one fact a disambiguation chip shows. Computed here so the page can search,
// browse and tell look-alikes apart from the search list alone, without downloading card text.
function facetTag(e) {
  const d = e.display || {};
  switch (e.category) {
    case "feature": return d.kind === "fighting-style" ? "fighting style" : d.kind === "feature" ? "class feature" : d.kind;
    case "rule": return d.topic ? String(d.topic).toLowerCase() : "rule";
    case "reference": return "quick reference";
    case "custom": return d.tag || "custom";
    case "magic-item": return "item";
    default: return e.category;
  }
}
function facetSub(e) {
  const d = e.display || {};
  const head = (t) => (t ? String(t).split("(")[0].trim() : "Other");
  switch (e.category) {
    case "spell": return d.school || "Other";
    case "monster": {
      const t = String(d.type || "").toLowerCase();
      const hit = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"].find((k) => t.includes(k));
      return hit || "Other";
    }
    case "magic-item": return head(d.type);
    case "equipment": return head(d.type);
    case "feat": return d.featType || "Other";
    case "feature": return d.className || d.kind || "Other";
    case "rule": return d.topic || "Other";
    case "subclass": return d.className || "Other";
    default: return null;
  }
}
function facetStat(e) {
  const d = e.display || {};
  switch (e.category) {
    case "spell": return d.level === 0 ? "cantrip" : d.level != null ? `level ${d.level}` : null;
    case "monster": return d.cr != null ? `CR ${d.cr}` : null;
    case "magic-item": return d.rarity || null;
    case "feature": return [d.subclass || d.className, d.level != null ? `lvl ${d.level}` : null].filter(Boolean).join(" ") || null;
    case "subclass": return d.className || null;
    case "class": return d.hitDie || null;
    case "species": return d.size || null;
    case "feat": return d.featType || null;
    case "equipment": return d.cost || null;
    case "background": return d.feat || null;
    default: return null;
  }
}
const SHARD_BYTES = 1200 * 1024;
// The client matcher (lib/compendium/match.ts) always indexes norm(name) itself, so a spoken phrase equal
// to it is redundant in the search list (it stays in the grammar, which is built before the split). This
// replicates that norm exactly; anything it does not reproduce byte for byte is kept.
const clientNorm = (s) => fold(String(s || "").toLowerCase()).replace(/[’']/g, "'").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function writeSplit(entries, mode) {
  const cardDir = path.join(OUT_DIR, "cards", mode);
  fs.rmSync(cardDir, { recursive: true, force: true });
  fs.mkdirSync(cardDir, { recursive: true });
  const light = [];
  let shard = 0, size = 0, bucket = {};
  const flush = () => {
    if (!Object.keys(bucket).length) return;
    fs.writeFileSync(path.join(cardDir, `${shard}.json`), JSON.stringify(bucket));
    shard++; size = 0; bucket = {};
  };
  for (const e of entries) {
    const disp = JSON.stringify(e.display ?? null);
    if (size + disp.length > SHARD_BYTES) flush();
    bucket[e.id] = e.display ?? null;
    size += disp.length + e.id.length + 4;
    const { display, edAgnostic, ...rest } = e; // eslint-disable-line no-unused-vars
    const tag = facetTag(e), sub = facetSub(e), stat = facetStat(e);
    const own = clientNorm(rest.name);
    const spoken = (rest.spoken || []).filter((p) => p !== own);
    const row = { ...rest, tag, ...(sub ? { sub } : {}), ...(stat ? { stat } : {}), s: shard };
    if (spoken.length) row.spoken = spoken; else delete row.spoken;
    if (row.book == null) delete row.book; // keep the list lean: no null books
    light.push(row);
  }
  flush();
  return { light, shards: shard };
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
  } else if (mode === "pf2e") {
    entries = buildPathfinder();
  } else {
    // The monster source table (lib/srd/monster-sources.json), the same one lib/monster-sources.ts reads.
    MONSTER_SOURCES = readMaybe(path.join(SRD_DIR, "monster-sources.json")) || {};
    const variantsByName = loadVariants();
    if (mode === "both") entries = mergeBoth(buildEdition("2024", variantsByName), buildEdition("2014", variantsByName));
    else entries = buildEdition(mode, variantsByName);
    // Re-apply aliases on the final list: mergeBoth regenerates `spoken` for legacy-suffixed entries,
    // which would otherwise drop their aliases. Idempotent for the single-edition modes.
    applyAliases(entries);
    // Ids must be unique: the matcher keeps one result per id and overrides shadow by id. The source data
    // still has the odd exact repeat (the 2014 SRD lists Potion of Healing twice), so a repeat gets -2.
    const usedIds = new Set();
    for (const e of entries) {
      let id = e.id;
      if (usedIds.has(id)) { let n = 2; while (usedIds.has(`${e.id}-${n}`)) n++; id = `${e.id}-${n}`; }
      usedIds.add(id);
      e.id = id;
    }
  }

  // Grammar: every unique spoken phrase, plus the Vosk unknown token.
  const grammar = new Set();
  for (const e of entries) for (const p of e.spoken) if (p) grammar.add(p);
  const grammarArr = [...grammar].sort();
  grammarArr.push("[unk]");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const indexPath = path.join(OUT_DIR, `index-${mode}.json`);
  const grammarPath = path.join(OUT_DIR, `grammar-${mode}.json`);
  const { light, shards } = writeSplit(entries, mode);
  fs.writeFileSync(indexPath, JSON.stringify(light));
  fs.writeFileSync(grammarPath, JSON.stringify(grammarArr));

  const byCat = entries.reduce((m, e) => ((m[e.category] = (m[e.category] || 0) + 1), m), {});
  console.log(`[compendium] mode=${mode}`);
  console.log(`  entries: ${entries.length}`, byCat);
  console.log(`  grammar phrases: ${grammarArr.length - 1} (+[unk])`);
  console.log(`  wrote ${path.relative(ROOT, indexPath)} (${(fs.statSync(indexPath).size / 1024).toFixed(0)} KB)`);
  console.log(`  wrote ${path.relative(ROOT, grammarPath)} (${(fs.statSync(grammarPath).size / 1024).toFixed(0)} KB)`);
  console.log(`  wrote ${shards} card shard(s) to ${path.relative(ROOT, path.join(OUT_DIR, "cards", mode))}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
