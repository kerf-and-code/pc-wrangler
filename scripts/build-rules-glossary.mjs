// scripts/build-rules-glossary.mjs
//
// Generates the 2024 compendium data from the SRD 5.2.1 markdown. It does NOT hand-transcribe: it reads
// the source files and copies each entry's definition verbatim, then strips markdown so the text
// renders as a plain card. Three outputs:
//   lib/srd/rules-2024.json         - rules-glossary cards (grapple, cover, actions, weapon properties,
//                                     weapon mastery, two-weapon fighting)
//   lib/srd/conditions-2024.json    - the 2024 conditions (cumulative Exhaustion, etc.)
//   lib/srd/class-options-2024.json - the 2024 Metamagic and Eldritch Invocation options (per-option),
//                                     which the 2024 structured class data does not break out
// Sources (CC-BY 4.0, kept in lib/srd/srd-2024-src/, from github.com/downfallx/dnd-5e-srd-markdown):
//   rules-glossary.md, playing-the-game.md, classes.md, equipment.md
//
// Run (from repo root):
//   node scripts/build-rules-glossary.mjs
// Overridable inputs: SRD_2024_GLOSSARY, SRD_2024_PLAYING, SRD_2024_CLASSES, SRD_2024_EQUIPMENT.
// Overridable outputs: RULES_2024_OUT, CONDITIONS_2024_OUT, CLASS_OPTIONS_2024_OUT.
//
// After running, regenerate the compendium indexes so the new data ships:
//   node scripts/build-compendium-index.mjs 2024
//   node scripts/build-compendium-index.mjs both

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = process.env.SRD_2024_GLOSSARY || path.join(ROOT, "lib", "srd", "srd-2024-src", "rules-glossary.md");
// A few disputed mechanics aren't glossary terms in 2024; they live in the "Playing the Game" chapter.
// We pull the ones that are cleanly available there (both use #### headings, same as the glossary).
const PLAY_SRC = process.env.SRD_2024_PLAYING || path.join(ROOT, "lib", "srd", "srd-2024-src", "playing-the-game.md");
const CLASS_SRC = process.env.SRD_2024_CLASSES || path.join(ROOT, "lib", "srd", "srd-2024-src", "classes.md");
const EQUIP_SRC = process.env.SRD_2024_EQUIPMENT || path.join(ROOT, "lib", "srd", "srd-2024-src", "equipment.md");
const OUT = process.env.RULES_2024_OUT || path.join(ROOT, "lib", "srd", "rules-2024.json");
const COND_OUT = process.env.CONDITIONS_2024_OUT || path.join(ROOT, "lib", "srd", "conditions-2024.json");
const CLASS_OPTIONS_OUT = process.env.CLASS_OPTIONS_2024_OUT || path.join(ROOT, "lib", "srd", "class-options-2024.json");

// The glossary terms to surface as cards, mapped to a card topic. Order here is the card order.
// Deliberately excludes the pure conditions (Blinded, Grappled, Prone, ...) - those belong to the
// compendium's separate "condition" category - and the meta terms (Campaign, Adventure, ...).
const WHITELIST = [
  ["Action", "Actions"],
  ["Attack [Action]", "Actions"],
  ["Dash [Action]", "Actions"],
  ["Disengage [Action]", "Actions"],
  ["Dodge [Action]", "Actions"],
  ["Help [Action]", "Actions"],
  ["Hide [Action]", "Actions"],
  ["Influence [Action]", "Actions"],
  ["Magic [Action]", "Actions"],
  ["Ready [Action]", "Actions"],
  ["Search [Action]", "Actions"],
  ["Study [Action]", "Actions"],
  ["Utilize [Action]", "Actions"],
  ["Bonus Action", "Actions"],
  ["Reaction", "Actions"],
  ["Opportunity Attacks", "Combat"],
  ["Unarmed Strike", "Combat"],
  ["Grappling", "Combat"],
  ["Cover", "Combat"],
  ["Critical Hit", "Combat"],
  ["Resistance", "Combat"],
  ["Vulnerability", "Combat"],
  ["Immunity", "Combat"],
  ["Damage Threshold", "Combat"],
  ["Knocking Out a Creature", "Combat"],
  ["Improvised Weapons", "Combat"],
  ["Initiative", "Combat"],
  ["Surprise", "Combat"],
  ["Bloodied", "Combat"],
  ["Death Saving Throw", "Combat"],
  ["Stable", "Combat"],
  ["Temporary Hit Points", "Combat"],
  ["Difficult Terrain", "Movement"],
  ["Jumping", "Movement"],
  ["Falling [Hazard]", "Environment"],
  ["Suffocation [Hazard]", "Environment"],
  ["Heavily Obscured", "Environment"],
  ["Lightly Obscured", "Environment"],
  ["Bright Light", "Environment"],
  ["Dim Light", "Environment"],
  ["Darkness", "Environment"],
  ["Darkvision", "Environment"],
  ["Blindsight", "Environment"],
  ["Truesight", "Environment"],
  ["Short Rest", "Rest"],
  ["Long Rest", "Rest"],
  ["Concentration", "Spellcasting"],
  ["Area of Effect", "Spellcasting"],
  ["Spell Attack", "Spellcasting"],
  ["Ritual", "Spellcasting"],
  ["Advantage", "Checks"],
  ["Disadvantage", "Checks"],
  ["Passive Perception", "Checks"],
  ["Heroic Inspiration", "Checks"],
];

// From "Playing the Game" (not glossary terms). Third element is an optional card-name override.
const PLAY_WHITELIST = [
  ["Ranged Attacks in Close Combat", "Combat"],
  ["Range", "Combat", "Ranged Attack Range"],
];

// The 2024 conditions, emitted to conditions-2024.json (shape [{name, description}], matching
// conditions-2014.json) so the compendium's condition category serves correct 2024 text under the 2024
// toggle instead of falling back to 2014. Same 15 names as 2014; the text is the revised 2024 wording.
const CONDITION_HEADINGS = [
  "Blinded [Condition]", "Charmed [Condition]", "Deafened [Condition]", "Exhaustion [Condition]",
  "Frightened [Condition]", "Grappled [Condition]", "Incapacitated [Condition]", "Invisible [Condition]",
  "Paralyzed [Condition]", "Petrified [Condition]", "Poisoned [Condition]", "Prone [Condition]",
  "Restrained [Condition]", "Stunned [Condition]", "Unconscious [Condition]",
];

// Parse the glossary into { heading: body } using the "#### " term headings.
function parseGlossary(text) {
  const blocks = {};
  const parts = text.split(/^####\s+/m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n");
    const head = (nl === -1 ? part : part.slice(0, nl)).trim();
    let body = nl === -1 ? "" : part.slice(nl + 1);
    // Stop at the next heading of any shallower level (#, ##, ###) that bleeds into this block.
    // (We already split on "#### "; deeper #####+ subheadings are kept as part of the body.)
    body = body.split(/^#{1,3}\s+/m)[0];
    blocks[head] = body.trim();
  }
  return blocks;
}

// Strip the term of its bracketed kind, e.g. "Dodge [Action]" -> "Dodge", for the card title.
const cleanName = (h) => h.replace(/\s*\[[^\]]+\]\s*$/, "").trim();

// Markdown -> plain card text, faithful to the words.
function cleanBody(md) {
  let s = md;
  s = s.replace(/<table[\s\S]*?<\/table>/gi, ""); // drop embedded HTML tables (supplementary)
  s = s.replace(/<[^>]+>/g, "");                   // strip any other stray HTML tags
  s = s.replace(/_See also_[^\n]*/g, "");        // drop book cross-references
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");  // links -> link text
  s = s.replace(/\*\*/g, "").replace(/__/g, "");  // bold markers
  s = s.replace(/_/g, "");                         // italic markers (run-in labels)
  s = s.replace(/[—–]/g, " - ");        // em/en dashes -> spaced hyphen (house style: no em-dashes)
  s = s.replace(/[ \t]+\n/g, "\n");               // trailing spaces
  s = s.replace(/\n{3,}/g, "\n\n");               // collapse blank runs
  return s.trim();
}

// Body of a "### <head>" section, up to the next "### " heading.
function sectionBody(text, head) {
  const re = new RegExp("^###\\s+" + head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "m");
  const m = text.match(re);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const nxt = rest.match(/^###\s+/m);
  return nxt ? rest.slice(0, nxt.index) : rest;
}

// Ordered [{name, body}] for the "#### <name>" blocks inside a section (e.g. the Metamagic options).
function parseHashFour(sectionText) {
  const out = [];
  for (const part of sectionText.split(/^####\s+/m).slice(1)) {
    const nl = part.indexOf("\n");
    const name = (nl === -1 ? part : part.slice(0, nl)).trim();
    let body = nl === -1 ? "" : part.slice(nl + 1);
    body = body.split(/^#{1,3}\s+/m)[0];
    out.push({ name, body: body.trim() });
  }
  return out;
}

// Ordered [{name, body}] for "**Name.** text" run-in entries (weapon properties, mastery properties).
function parseBoldRunIn(sectionText) {
  const re = /\*\*([A-Za-z][A-Za-z \-]*?)\.\*\*/g;
  const hits = [...sectionText.matchAll(re)];
  const out = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index + hits[i][0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index : sectionText.length;
    out.push({ name: hits[i][1].trim(), body: sectionText.slice(start, end) });
  }
  return out;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[rules-2024] source not found: ${path.relative(ROOT, SRC)}`);
    console.error(`  download it first:`);
    console.error(`  curl.exe -L -o lib\\srd\\srd-2024-src\\rules-glossary.md https://raw.githubusercontent.com/downfallx/dnd-5e-srd-markdown/master/rules-glossary.md`);
    process.exit(1);
  }
  const blocks = parseGlossary(fs.readFileSync(SRC, "utf8"));
  const out = [];
  const missing = [];
  for (const [head, topic] of WHITELIST) {
    const body = blocks[head];
    if (!body) { missing.push(head); continue; }
    out.push({ name: cleanName(head), topic, description: cleanBody(body) });
  }
  // Supplemental cards from "Playing the Game" (same #### block structure).
  if (fs.existsSync(PLAY_SRC)) {
    const playBlocks = parseGlossary(fs.readFileSync(PLAY_SRC, "utf8"));
    for (const [head, topic, nameOverride] of PLAY_WHITELIST) {
      const body = playBlocks[head];
      if (!body) { missing.push(`${head} (playing-the-game)`); continue; }
      out.push({ name: nameOverride || cleanName(head), topic, description: cleanBody(body) });
    }
  } else {
    missing.push(...PLAY_WHITELIST.map(([h]) => `${h} (playing-the-game.md not found)`));
  }
  // Weapon properties and mastery properties (equipment.md), as "Weapon Property" / "Weapon Mastery"
  // rule cards. Names are bare (e.g. "Finesse", "Nick") so a spoken lookup hits exactly; the topic tag
  // carries the classification. 2024 two-weapon fighting is covered by the "Light" property card here
  // plus the existing Two-Weapon Fighting feat, so no separate card is authored for it.
  if (fs.existsSync(EQUIP_SRC)) {
    const eq = fs.readFileSync(EQUIP_SRC, "utf8");
    const propsBody = sectionBody(eq, "Properties");
    const masteryBody = sectionBody(eq, "Mastery Properties");
    if (propsBody) {
      for (const { name, body } of parseBoldRunIn(propsBody)) {
        out.push({ name, topic: "Weapon Property", description: cleanBody(body) });
      }
    } else { missing.push("Properties (equipment.md)"); }
    // Mastery section runs into the Weapons table; cut it there before parsing run-ins.
    if (masteryBody) {
      const masteryTrim = masteryBody.split(/^\*\*Weapons\*\*/m)[0].split(/<table/)[0];
      for (const { name, body } of parseBoldRunIn(masteryTrim)) {
        out.push({ name, topic: "Weapon Mastery", description: cleanBody(body) });
      }
    } else { missing.push("Mastery Properties (equipment.md)"); }
  } else { missing.push("equipment.md not found"); }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`[rules-2024] wrote ${path.relative(ROOT, OUT)}: ${out.length} cards`);

  // Conditions -> conditions-2024.json (name + description only).
  const conditions = [];
  const condMissing = [];
  for (const head of CONDITION_HEADINGS) {
    const body = blocks[head];
    if (!body) { condMissing.push(head); continue; }
    conditions.push({ name: cleanName(head), description: cleanBody(body) });
  }
  fs.writeFileSync(COND_OUT, JSON.stringify(conditions, null, 2) + "\n");
  console.log(`[conditions-2024] wrote ${path.relative(ROOT, COND_OUT)}: ${conditions.length} conditions`);

  // Class options -> class-options-2024.json: the 2024 Metamagic and Eldritch Invocation options,
  // per-option (the 2024 structured class data only carries the umbrella entries). Shape
  // [{kind, name, className, description}]; build-compendium-index.mjs turns these into feature cards.
  const classOptions = [];
  if (fs.existsSync(CLASS_SRC)) {
    const cls = fs.readFileSync(CLASS_SRC, "utf8");
    const grab = (head, kind, className) => {
      const sec = sectionBody(cls, head);
      if (!sec) { missing.push(`${head} (classes.md)`); return; }
      for (const { name, body } of parseHashFour(sec)) {
        classOptions.push({ kind, name, className, description: cleanBody(body) });
      }
    };
    grab("Metamagic Options", "metamagic", "Sorcerer");
    grab("Eldritch Invocation Options", "invocation", "Warlock");
  } else { missing.push("classes.md not found"); }
  fs.writeFileSync(CLASS_OPTIONS_OUT, JSON.stringify(classOptions, null, 2) + "\n");
  console.log(`[class-options-2024] wrote ${path.relative(ROOT, CLASS_OPTIONS_OUT)}: ${classOptions.length} options`);

  if (missing.length) console.warn(`[rules-2024] WARNING, ${missing.length} whitelisted headings not found: ${missing.join(", ")}`);
  if (condMissing.length) console.warn(`[conditions-2024] WARNING, ${condMissing.length} conditions not found: ${condMissing.join(", ")}`);
}

main();
