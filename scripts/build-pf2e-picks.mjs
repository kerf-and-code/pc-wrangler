// scripts/build-pf2e-picks.mjs (2026-11-10, push 22, audit G4)
//
// The PF2e Forge's pickers for feats, spells and gear need names, levels and traits for about 12,000
// records, not the 16 MB of rules text in lib/pf2e/compendium-data.json. This writes the small index
// public/pf2e/picks.json, which the Forge fetches the first time a picker opens. Names and numbers only;
// the text stays in the compendium (OGL 1.0a and ORC entries, attributed there).
//
// Run after scripts/extract-pf2e.mjs refreshes the data:  node scripts/build-pf2e-picks.mjs
//
// Format (arrays keep it small):
//   feats:  [name, type, level, traits]   type: ancestry | class | skill | general | bonus
//   spells: [name, rank, traits]          rank 0 is a cantrip
//   gear:   [name, kind, level, price, bulk]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "lib", "pf2e", "compendium-data.json"), "utf8"));

const traitsOf = (r) => {
  const line = (r.metaLines || []).find((l) => l.startsWith("Traits:"));
  return line ? line.slice(7).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).join(",") : "";
};
const num = (s) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : 0; };

const feats = [];
const spells = [];
const gear = [];
const seen = new Set();
const once = (k) => (seen.has(k) ? false : (seen.add(k), true));

for (const r of data) {
  const meta = r.metaLines || [];
  if (r.tag === "feat") {
    const m = /^(\w+) feat · Level (\d+)/i.exec(meta[0] || "");
    if (!m) continue;
    const type = m[1].toLowerCase();
    if (!["ancestry", "class", "skill", "general", "bonus"].includes(type)) continue;
    if (once(`f|${r.name}|${type}`)) feats.push([r.name, type, num(m[2]), traitsOf(r)]);
  } else if (r.tag === "spell" || r.tag === "cantrip") {
    const rankLine = meta.find((l) => /^(Rank|Cantrip) \d+/.test(l)) || "";
    const rank = rankLine.startsWith("Cantrip") || r.tag === "cantrip" ? 0 : num(rankLine.slice(5));
    if (once(`s|${r.name}`)) spells.push([r.name, rank, traitsOf(r)]);
  } else if (["weapon", "armor", "shield", "item", "consumable", "gear", "ammunition"].includes(r.tag)) {
    const line = meta.find((l) => /^Level \d+/.test(l)) || "";
    const level = num(line.slice(6));
    const price = (/Price ([^·]+)/.exec(line)?.[1] || "").trim();
    const bulk = (/Bulk ([^·]+)/.exec(line)?.[1] || "").trim();
    if (once(`g|${r.name}|${level}`)) gear.push([r.name, r.tag, level, price, bulk]);
  }
}
const sortBy = (a, b) => a[0].localeCompare(b[0]);
feats.sort(sortBy); spells.sort(sortBy); gear.sort(sortBy);

const out = path.join(ROOT, "public", "pf2e", "picks.json");
fs.writeFileSync(out, JSON.stringify({ feats, spells, gear }));
console.log(`wrote ${path.relative(ROOT, out)}: ${feats.length} feats, ${spells.length} spells, ${gear.length} gear, ${fs.statSync(out).size} bytes`);
