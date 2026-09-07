// scripts/build-rules-glossary.mjs
//
// Generates lib/srd/rules-2024.json (the 2024 rules-glossary cards for the voice compendium) from the
// SRD 5.2.1 Rules Glossary markdown. It does NOT hand-transcribe: it reads the source file and copies
// each whitelisted term's definition verbatim, then strips markdown so the text renders as a plain
// card. Source: the SRD 5.2.1 "Rules Glossary" chapter (CC-BY 4.0), kept at
// lib/srd/srd-2024-src/rules-glossary.md (from github.com/downfallx/dnd-5e-srd-markdown).
//
// Run (from repo root):
//   node scripts/build-rules-glossary.mjs
// Overridable: SRD_2024_GLOSSARY (input path), RULES_2024_OUT (output path).
//
// After running, regenerate the compendium indexes so the new rules ship:
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
const OUT = process.env.RULES_2024_OUT || path.join(ROOT, "lib", "srd", "rules-2024.json");

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
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`[rules-2024] wrote ${path.relative(ROOT, OUT)}: ${out.length} cards`);
  if (missing.length) console.warn(`[rules-2024] WARNING, ${missing.length} whitelisted headings not found: ${missing.join(", ")}`);
}

main();
