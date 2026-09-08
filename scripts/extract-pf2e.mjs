// Extract Pathfinder Second Edition mechanics from the Foundry VTT `pf2e` system's pack sources into a
// compact, cleaned data file the compendium build reads (lib/pf2e/compendium-data.json).
//
// WHY A SEPARATE EXTRACTOR. The Foundry pf2e packs are ~140 MB of per-document JSON that does NOT ship in
// this repo (it is the Foundry system's own packaging). This script is the one-time (re-run on a pf2e
// update) bridge: point it at an unpacked `packs/pf2e` directory and it writes the small, plain-prose
// data file that scripts/build-compendium-index.mjs turns into index-pf2e.json. That keeps the build
// reproducible from committed data without vendoring the whole Foundry system.
//
// LICENSING. Pathfinder 2e rules mechanics are Open Game Content: pre-Remaster entries are OGL 1.0a,
// Remaster entries are ORC. Both are reusable. Every source doc carries system.publication.license
// ("OGL" | "ORC") and .title (the book) - we keep both and record them per entry so the compendium can
// attribute honestly. We ship MECHANICS and rules text (which PF2e opens), not Paizo Product Identity
// framing beyond what the open rules themselves contain. AP-specific bestiaries (Community-Use, not
// redistributable) are deliberately excluded; only Monster Core, Monster Core 2, and NPC Core ship.
//
// Usage:  PF2E_PACKS=/path/to/packs/pf2e node scripts/extract-pf2e.mjs
// Output: lib/pf2e/compendium-data.json  (an array of {tag,name,metaLines[],body,book,license})

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PACKS = process.env.PF2E_PACKS || path.join(ROOT, "..", "pf2e-src", "pf2e-14-dev", "packs", "pf2e");
const OUT = process.env.PF2E_OUT || path.join(ROOT, "lib", "pf2e", "compendium-data.json");

const PACK_SET = {
  spells: ["spells"],
  feats: ["feats"],
  actions: ["actions"],
  conditions: ["conditions"],
  equipment: ["equipment"],
  ancestries: ["ancestries"],
  heritages: ["heritages"],
  "ancestry-features": ["ancestry-features"],
  classes: ["classes"],
  "class-features": ["class-features"],
  backgrounds: ["backgrounds"],
  deities: ["deities"],
  bestiary: ["pathfinder-monster-core", "pathfinder-monster-core-2", "pathfinder-npc-core"],
};

// ---- text cleaning -------------------------------------------------------------------------------
const ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  "&apos;": "'", "&times;": "x", "&mdash;": " - ", "&ndash;": " - ", "&hellip;": "...", "&rsquo;": "'",
  "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"', "&plusmn;": "+/-", "&deg;": " degrees",
};
const titleCase = (s) => String(s).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
  .replace(/\b\w/g, (c) => c.toUpperCase());

const SAVES = new Set(["fortitude", "reflex", "will"]);
// Turn one Foundry @Check[...] / @Damage[...] / @Template[...] enricher into readable words.
function enricher(kind, inner) {
  const parts = String(inner).split("|");
  if (kind === "Check") {
    const type = (parts[0] || "").toLowerCase();
    const dc = (parts.find((p) => p.startsWith("dc:")) || "").slice(3);
    const basic = parts.some((p) => p === "basic" || p === "basic:true");
    const noun = SAVES.has(type) ? "save" : type === "flat" ? "check" : "check"; // skills/perception -> check
    const name = type === "flat" ? "flat" : cap(type);
    const label = `${basic ? "basic " : ""}${name} ${noun}`;
    return dc ? `DC ${dc} ${label}` : label;
  }
  if (kind === "Template") {
    const type = parts[0] || "";
    const dist = (parts.find((p) => p.startsWith("distance:")) || "").slice(9);
    return dist ? `${dist}-foot ${type}` : type;
  }
  if (kind === "Damage") {
    // e.g. "(2d6)[fire]" or "3d6[piercing]" or "(ceil(@actor.level/2))d4[poison]"
    const tm = String(inner).match(/\[([a-z, ]+)\]\s*$/i);
    const type = tm ? tm[1] : "";
    let formula = String(inner).replace(/\[[^\]]*\]/g, "").trim();
    formula = formula.replace(/^\((.*)\)$/, "$1"); // drop one outer paren pair
    formula = formula.replace(/@actor\.level/gi, "level").replace(/ceil|floor/gi, "").replace(/[()]/g, "");
    return `${formula} ${type} damage`.replace(/\s+/g, " ").trim();
  }
  return inner;
}

function cleanPf2e(html) {
  if (html == null) return null;
  let t = String(html);
  // Foundry inline references, innermost first.
  // @UUID[...]{Label} -> Label ; @UUID[....Item.Name] -> Name
  t = t.replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "$1");
  t = t.replace(/@UUID\[[^\]]*?\.([^.\]]+)\]/g, "$1");
  // Inner may contain one level of nested [..] (e.g. @Damage[(2d6)[fire]]), so match balanced-ish.
  t = t.replace(/@(Check|Damage|Template)\[((?:[^\[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/g,
    (_, k, inner, label) => (label ? label : enricher(k, inner)));
  // Remaining @Something[..]{Label} / @Something[..]
  t = t.replace(/@[A-Za-z]+\[[^\]]*\]\{([^}]*)\}/g, "$1");
  t = t.replace(/@[A-Za-z]+\[[^\]]*\]/g, "");
  // Inline rolls & actions. Handle /act first (slug -> Title Case), then the generic [[/r ...]] form.
  // Lazy match to the first `]]`; inner single `]` (e.g. 4d8[healing]) never precedes another `]`.
  t = t.replace(/\[\[\/act\s+([a-z0-9-]+)[^\]]*\]\]/gi, (_, s) => titleCase(s));
  t = t.replace(/\[\[\/[a-z]+\b([\s\S]*?)\]\](?:\{([^}]*)\})?/g, (_, inner, label) => {
    if (label) return label;
    let x = String(inner).replace(/\s*#[^\]]*$/, "");     // drop trailing #flavor tag
    x = x.replace(/\[([^\]]*)\]/g, " $1");                 // [healing] -> healing
    x = x.replace(/\b(dc|against|traits|name|basic):\S*/gi, ""); // strip roll options
    return x.replace(/\s+/g, " ").trim();
  });
  // Structural HTML -> line breaks; keep inline emphasis text.
  t = t.replace(/<hr\s*\/?>/gi, "\n");
  t = t.replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
  t = t.replace(/<li[^>]*>/gi, "- ");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<[^>]+>/g, "");
  for (const [k, v] of Object.entries(ENTITIES)) t = t.split(k).join(v);
  t = t.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  t = t.replace(/[—–]/g, " - "); // em/en dash -> spaced hyphen (house style)
  t = t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  // Enricher noun can collide with prose that already carries it ("Reflex save save", "Athletics check check").
  t = t.replace(/\b(save|check|damage)\s+\1\b/gi, "$1").replace(/\bsave\s+check\b/gi, "save");
  t = t.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.trim() || null;
}

// ---- shared field helpers ------------------------------------------------------------------------
const cap = (s) => (s ? String(s).replace(/^./, (c) => c.toUpperCase()) : s);
const SIZES = { tiny: "Tiny", sm: "Small", med: "Medium", lg: "Large", huge: "Huge", grg: "Gargantuan" };
const rarityTraits = (tr) => {
  const out = [];
  if (tr?.rarity && tr.rarity !== "common") out.push(cap(tr.rarity));
  for (const v of tr?.value || []) out.push(v);
  return out;
};
const priceStr = (p) => {
  const v = p?.value;
  if (!v || typeof v !== "object") return null;
  const parts = [];
  for (const coin of ["pp", "gp", "sp", "cp"]) if (v[coin]) parts.push(`${v[coin]} ${coin}`);
  return parts.length ? parts.join(", ") : null;
};
const actionGlyph = (actionType, actions) => {
  const t = actionType?.value;
  if (t === "reaction") return "Reaction";
  if (t === "free") return "Free Action";
  if (t === "passive") return "Passive";
  const n = actions?.value;
  if (n === 1) return "Single Action";
  if (n === 2) return "Two Actions";
  if (n === 3) return "Three Actions";
  if (n != null) return `${n} Actions`;
  return null;
};
const spellTime = (v) => {
  const s = String(v || "").trim();
  if (s === "1") return "1 action";
  if (s === "2") return "2 actions";
  if (s === "3") return "3 actions";
  if (s === "reaction") return "reaction";
  if (s === "free") return "free action";
  return s || null;
};
const list = (a) => (Array.isArray(a) && a.length ? a : null);

// ---- per-category mappers ------------------------------------------------------------------------
function mapSpell(d) {
  const s = d.system;
  const traits = s.traits || {};
  const tv = traits.value || [];
  const isCantrip = tv.includes("cantrip");
  const isRitual = d.type === "ritual" || tv.includes("ritual");
  const isFocus = tv.includes("focus");
  const rank = s.level?.value;
  const kind = isRitual ? "ritual" : isFocus ? "focus spell" : isCantrip ? "cantrip" : "spell";
  const rankLabel = isCantrip ? `Cantrip ${rank}` : `Rank ${rank}`;
  const traditions = list(traits.traditions);
  const meta = [];
  meta.push([rankLabel, traditions && traditions.join(", ")].filter(Boolean).join(" · "));
  const castLine = [];
  const t = spellTime(s.time?.value);
  if (t) castLine.push(`Cast ${t}`);
  if (s.cost?.value) castLine.push(`Cost ${s.cost.value}`);
  if (castLine.length) meta.push(castLine.join(" · "));
  const line3 = [];
  if (s.range?.value) line3.push(`Range ${s.range.value}`);
  if (s.area?.value) line3.push(`Area ${s.area.value}-foot ${s.area.type || ""}`.trim());
  if (s.target?.value) line3.push(`Targets ${s.target.value}`);
  if (line3.length) meta.push(line3.join(" · "));
  const line4 = [];
  if (s.duration?.value) line4.push(`Duration ${s.duration.value}${s.duration.sustained ? " (sustained)" : ""}`);
  if (s.defense?.save?.statistic) line4.push(`Defense ${s.defense.save.basic ? "basic " : ""}${s.defense.save.statistic}`);
  if (line4.length) meta.push(line4.join(" · "));
  const trLine = rarityTraits(traits);
  if (trLine.length) meta.push(`Traits: ${trLine.join(", ")}`);
  return { tag: kind, name: d.name, metaLines: meta, body: cleanPf2e(s.description?.value) };
}

function mapFeat(d, tagOverride) {
  const s = d.system;
  const meta = [];
  const head = [cap(s.category) && `${cap(s.category)} feat`, s.level?.value != null && `Level ${s.level.value}`]
    .filter(Boolean).join(" · ");
  if (head) meta.push(head);
  const glyph = actionGlyph(s.actionType, s.actions);
  if (glyph && glyph !== "Passive") meta.push(glyph);
  const prereq = (s.prerequisites?.value || []).map((p) => p.value).filter(Boolean);
  if (prereq.length) meta.push(`Prerequisites: ${prereq.join("; ")}`);
  const trLine = rarityTraits(s.traits);
  if (trLine.length) meta.push(`Traits: ${trLine.join(", ")}`);
  return { tag: tagOverride || "feat", name: d.name, metaLines: meta, body: cleanPf2e(s.description?.value) };
}

function mapAction(d) {
  const s = d.system;
  const meta = [];
  const glyph = actionGlyph(s.actionType, s.actions);
  const head = [glyph, cap(s.category)].filter(Boolean).join(" · ");
  if (head) meta.push(head);
  const trLine = rarityTraits(s.traits);
  if (trLine.length) meta.push(`Traits: ${trLine.join(", ")}`);
  return { tag: "action", name: d.name, metaLines: meta, body: cleanPf2e(s.description?.value) };
}

function mapCondition(d) {
  return { tag: "condition", name: d.name, metaLines: [], body: cleanPf2e(d.system.description?.value) };
}

function mapEquipment(d) {
  const s = d.system;
  const type = d.type;
  const meta = [];
  const common = [];
  if (s.level?.value) common.push(`Level ${s.level.value}`);
  const pr = priceStr(s.price);
  if (pr) common.push(`Price ${pr}`);
  if (s.bulk?.value != null && s.bulk.value !== 0) common.push(`Bulk ${s.bulk.value}`);
  else if (s.bulk?.value === 0) common.push("Bulk -");

  if (type === "weapon") {
    const dmg = s.damage ? `${s.damage.dice || ""}${s.damage.die || ""} ${s.damage.damageType || ""}`.trim() : null;
    meta.push([cap(s.category), s.group && titleCase(s.group)].filter(Boolean).join(" "));
    if (dmg) meta.push(`Damage ${dmg}`);
    const wl = [];
    if (s.range) wl.push(`Range ${s.range}${typeof s.range === "number" ? " ft" : ""}`);
    if (s.reload?.value) wl.push(`Reload ${s.reload.value}`);
    if (s.hands?.value) wl.push(`Hands ${s.hands.value}`);
    if (wl.length) meta.push(wl.join(" · "));
  } else if (type === "armor") {
    const al = [];
    if (s.acBonus != null) al.push(`AC +${s.acBonus}`);
    if (s.dexCap != null) al.push(`Dex cap +${s.dexCap}`);
    if (s.checkPenalty) al.push(`Check ${s.checkPenalty}`);
    if (s.speedPenalty) al.push(`Speed ${s.speedPenalty}`);
    if (s.strength != null) al.push(`Str ${s.strength}`);
    if (al.length) meta.push(al.join(" · "));
    if (s.group || s.category) meta.push([cap(s.category), s.group && titleCase(s.group)].filter(Boolean).join(" "));
  } else if (type === "shield") {
    const sl = [];
    if (s.acBonus != null) al_push(sl, `AC +${s.acBonus}`);
    if (s.hardness != null) sl.push(`Hardness ${s.hardness}`);
    if (s.hp?.max != null) sl.push(`HP ${s.hp.max}`);
    if (sl.length) meta.push(sl.join(" · "));
  } else if (type === "consumable") {
    if (s.category) meta.push(cap(String(s.category).replace(/([A-Z])/g, " $1")));
  }
  if (common.length) meta.push(common.join(" · "));
  const trLine = rarityTraits(s.traits);
  if (trLine.length) meta.push(`Traits: ${trLine.join(", ")}`);
  const TAG = { weapon: "weapon", armor: "armor", shield: "shield", consumable: "consumable",
    treasure: "treasure", ammo: "ammunition", backpack: "gear", kit: "kit", equipment: "item" };
  return { tag: TAG[type] || "item", name: d.name, metaLines: meta, body: cleanPf2e(s.description?.value) };
}
function al_push(arr, v) { arr.push(v); }

function boostStr(boosts) {
  if (!boosts || typeof boosts !== "object") return null;
  const out = [];
  for (const k of Object.keys(boosts)) {
    const vals = boosts[k]?.value || [];
    if (vals.length === 6) out.push("free");
    else if (vals.length) out.push(vals.map((x) => x.toUpperCase()).join("/"));
  }
  return out.length ? out.join(", ") : null;
}

function mapAncestry(d) {
  const s = d.system;
  const meta = [];
  meta.push([`HP ${s.hp}`, `Size ${SIZES[s.size] || s.size}`, `Speed ${s.speed} ft`].join(" · "));
  const b = boostStr(s.boosts);
  const flaw = boostStr(s.flaws);
  const bf = [b && `Boosts ${b}`, flaw && `Flaw ${flaw}`].filter(Boolean).join(" · ");
  if (bf) meta.push(bf);
  if (s.vision) meta.push(`Vision ${s.vision}`);
  const langs = list(s.languages?.value);
  if (langs) meta.push(`Languages: ${langs.join(", ")}`);
  const trLine = rarityTraits(s.traits);
  if (trLine.length) meta.push(`Traits: ${trLine.join(", ")}`);
  return { tag: "ancestry", name: d.name, metaLines: meta, body: cleanPf2e(s.description?.value) };
}

function mapHeritage(d) {
  const s = d.system;
  const meta = [];
  if (s.ancestry?.name) meta.push(`${s.ancestry.name} heritage`);
  const trLine = rarityTraits(s.traits);
  if (trLine.length) meta.push(`Traits: ${trLine.join(", ")}`);
  return { tag: "heritage", name: d.name, metaLines: meta, body: cleanPf2e(s.description?.value) };
}

function mapClass(d) {
  const s = d.system;
  const meta = [];
  const key = list(s.keyAbility?.value);
  if (key) meta.push(`Key ${key.map((x) => x.toUpperCase()).join(" or ")} · HP ${s.hp}/level`);
  const profs = [];
  if (s.perception != null) profs.push(`Perception ${rankName(s.perception)}`);
  const sv = s.savingThrows || {};
  const svStr = ["fortitude", "reflex", "will"].filter((k) => sv[k] != null)
    .map((k) => `${cap(k).slice(0, 4)} ${rankName(sv[k])}`).join(", ");
  if (svStr) profs.push(svStr);
  if (profs.length) meta.push(profs.join(" · "));
  const atk = s.attacks || {};
  const atkStr = ["unarmed", "simple", "martial", "advanced"].filter((k) => atk[k])
    .map((k) => `${cap(k)} ${rankName(atk[k])}`).join(", ");
  if (atkStr) meta.push(`Attacks: ${atkStr}`);
  if (s.trainedSkills?.additional != null) meta.push(`Trained skills: ${s.trainedSkills.additional} + background`);
  return { tag: "class", name: d.name, metaLines: meta, body: cleanPf2e(s.description?.value) };
}
const rankName = (n) => ({ 0: "U", 1: "T", 2: "E", 3: "M", 4: "L" })[n] || String(n);

function mapBackground(d) {
  const s = d.system;
  const meta = [];
  const b = boostStr(s.boosts);
  if (b) meta.push(`Boosts ${b}`);
  const sk = list(s.trainedSkills?.value);
  const lore = list(s.trainedSkills?.lore);
  const skStr = [sk && sk.map(cap).join(", "), lore && lore.join(", ")].filter(Boolean).join(", ");
  if (skStr) meta.push(`Trained: ${skStr}`);
  const feat = s.items && Object.values(s.items)[0]?.name;
  if (feat) meta.push(`Skill feat: ${feat}`);
  const trLine = rarityTraits(s.traits);
  if (trLine.length) meta.push(`Traits: ${trLine.join(", ")}`);
  return { tag: "background", name: d.name, metaLines: meta, body: cleanPf2e(s.description?.value) };
}

function mapDeity(d) {
  const s = d.system;
  const meta = [];
  if (s.category) meta.push(cap(s.category));
  const dom = list(s.domains?.primary);
  if (dom) meta.push(`Domains: ${dom.join(", ")}`);
  const alt = list(s.domains?.alternate);
  if (alt) meta.push(`Alternate domains: ${alt.join(", ")}`);
  if (list(s.font)) meta.push(`Divine font: ${s.font.join(", ")}`);
  if (list(s.weapons)) meta.push(`Favored weapon: ${s.weapons.join(", ")}`);
  if (list(s.skill)) meta.push(`Divine skill: ${s.skill.join(", ")}`);
  const spells = s.spells && typeof s.spells === "object" ? Object.entries(s.spells) : [];
  if (spells.length) {
    const ss = spells.map(([lvl, uuid]) => `${lvl}: ${String(uuid).split(".").pop()}`).join(", ");
    meta.push(`Cleric spells: ${ss}`);
  }
  if (list(s.sanctification?.what)) meta.push(`Sanctification: ${s.sanctification.modal} ${s.sanctification.what.join("/")}`);
  return { tag: "deity", name: d.name, metaLines: meta, body: cleanPf2e(s.description?.value) };
}

function mapMonster(d) {
  const s = d.system;
  const det = s.details || {};
  const attr = s.attributes || {};
  const tr = s.traits || {};
  const meta = [];
  const trBits = [];
  if (tr.rarity && tr.rarity !== "common") trBits.push(cap(tr.rarity));
  if (tr.size?.value) trBits.push(SIZES[tr.size.value] || tr.size.value);
  for (const v of tr.value || []) trBits.push(v);
  meta.push([`Creature ${det.level?.value}`, trBits.join(", ")].filter(Boolean).join(" · "));

  const body = [];
  const perc = s.perception?.mod;
  const senses = (s.perception?.senses || []).map((x) => x.type).filter(Boolean);
  if (perc != null) body.push(`Perception +${perc}${senses.length ? "; " + senses.join(", ") : ""}`);
  const langs = list(det.languages?.value);
  if (langs) body.push(`Languages ${langs.join(", ")}`);
  const ab = s.abilities || {};
  const abStr = ["str", "dex", "con", "int", "wis", "cha"].filter((k) => ab[k])
    .map((k) => `${cap(k)} ${ab[k].mod >= 0 ? "+" : ""}${ab[k].mod}`).join(", ");
  if (abStr) body.push(abStr);
  // AC, saves, HP
  const acLine = [];
  if (attr.ac?.value != null) acLine.push(`AC ${attr.ac.value}`);
  const sv = s.saves || {};
  const svStr = ["fortitude", "reflex", "will"].filter((k) => sv[k]?.value != null)
    .map((k) => `${cap(k).slice(0, 4)} +${sv[k].value}`).join(", ");
  if (svStr) acLine.push(svStr);
  if (acLine.length) body.push(acLine.join("; "));
  const hpLine = [];
  if (attr.hp?.max != null) hpLine.push(`HP ${attr.hp.max}`);
  const imm = (attr.immunities || []).map((x) => x.type).filter(Boolean);
  const wk = (attr.weaknesses || []).map((x) => `${x.type} ${x.value}`).filter(Boolean);
  const res = (attr.resistances || []).map((x) => `${x.type} ${x.value}`).filter(Boolean);
  if (imm.length) hpLine.push(`Immunities ${imm.join(", ")}`);
  if (wk.length) hpLine.push(`Weaknesses ${wk.join(", ")}`);
  if (res.length) hpLine.push(`Resistances ${res.join(", ")}`);
  if (hpLine.length) body.push(hpLine.join("; "));
  // speed
  const spd = [];
  if (attr.speed?.value != null) spd.push(`${attr.speed.value} ft`);
  for (const o of attr.speed?.otherSpeeds || []) spd.push(`${o.type} ${o.value} ft`);
  if (spd.length) body.push(`Speed ${spd.join(", ")}`);
  // items: strikes, actions, spells
  const items = d.items || [];
  const strikes = [];
  const specials = [];
  const lores = [];
  for (const it of items) {
    if (it.type === "melee") {
      const is = it.system || {};
      const dmgs = Object.values(is.damageRolls || {}).map((r) => `${r.damage} ${r.damageType}`).join(" plus ");
      const kind = is.weaponType?.value === "ranged" ? "Ranged" : "Melee";
      strikes.push(`${kind}: ${it.name} +${is.bonus?.value} (${(is.traits?.value || []).join(", ")}), Damage ${dmgs}`);
    } else if (it.type === "action") {
      const is = it.system || {};
      const g = actionGlyph(is.actionType, is.actions);
      specials.push(`${it.name}${g ? ` [${g}]` : ""}: ${cleanPf2e(is.description?.value) || ""}`.trim());
    } else if (it.type === "lore") {
      lores.push(`${it.name} +${it.system?.mod?.value ?? it.system?.mod ?? "?"}`);
    }
  }
  if (lores.length) body.push(`Skills ${lores.join(", ")}`);
  if (strikes.length) body.push(strikes.join("\n"));
  if (specials.length) body.push(specials.join("\n"));
  // short flavor (first paragraph only, capped)
  const flavor = cleanPf2e(det.publicNotes);
  if (flavor) {
    const firstPara = flavor.split("\n").find((l) => l.trim()) || "";
    if (firstPara) body.push(firstPara.length > 400 ? firstPara.slice(0, 400).trim() + "..." : firstPara);
  }
  return { tag: "creature", name: d.name, metaLines: meta, body: body.filter(Boolean).join("\n") || null };
}

// ---- walk & emit ---------------------------------------------------------------------------------
function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "_folders.json") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith(".json")) out.push(p);
  }
  return out;
}

function pub(d) {
  const p = d.system?.publication || d.system?.details?.publication || {};
  return { book: (p.title || "").replace(/^Pathfinder\s+/, "") || null, license: p.license || null };
}

function run() {
  if (!fs.existsSync(PACKS)) {
    console.error(`[pf2e] packs dir not found: ${PACKS}\nSet PF2E_PACKS to the unpacked Foundry packs/pf2e directory.`);
    process.exit(1);
  }
  const records = [];
  const seen = new Set(); // dedupe by tag+name (some entries repeat across variant folders)
  const add = (rec, d) => {
    if (!rec || !rec.name) return;
    const key = `${rec.tag} ${rec.name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const { book, license } = pub(d);
    // Final house-style pass over everything (catches raw names/placeholders that skipped cleanPf2e):
    // strip stray angle-bracket tokens, normalize em/en dashes to a spaced hyphen.
    const tidy = (s) => (s == null ? s : String(s).replace(/<[^>]*>/g, "").replace(/[—–]/g, " - ").replace(/[ \t]{2,}/g, " ").trim());
    rec.body = tidy(rec.body) || null;
    rec.metaLines = (rec.metaLines || []).map(tidy).filter(Boolean);
    rec.book = book;
    rec.license = license;
    records.push(rec);
  };
  const from = (group) => PACK_SET[group].flatMap((pk) => walk(path.join(PACKS, pk)));

  for (const f of from("spells")) { const d = readJson(f); if (["spell", "ritual"].includes(d.type)) add(mapSpell(d), d); }
  for (const f of from("actions")) { const d = readJson(f); if (d.type === "action") add(mapAction(d), d); }
  for (const f of from("conditions")) { const d = readJson(f); if (d.type === "condition") add(mapCondition(d), d); }
  for (const f of from("feats")) { const d = readJson(f); if (d.type === "feat") add(mapFeat(d), d); }
  for (const f of from("ancestry-features")) { const d = readJson(f); if (d.type === "feat") add(mapFeat(d, "ancestry feature"), d); }
  for (const f of from("class-features")) { const d = readJson(f); if (d.type === "feat") add(mapFeat(d, "class feature"), d); }
  for (const f of from("equipment")) { const d = readJson(f); if (d.system) add(mapEquipment(d), d); }
  for (const f of from("ancestries")) { const d = readJson(f); if (d.type === "ancestry") add(mapAncestry(d), d); }
  for (const f of from("heritages")) { const d = readJson(f); if (d.type === "heritage") add(mapHeritage(d), d); }
  for (const f of from("classes")) { const d = readJson(f); if (d.type === "class") add(mapClass(d), d); }
  for (const f of from("backgrounds")) { const d = readJson(f); if (d.type === "background") add(mapBackground(d), d); }
  for (const f of from("deities")) { const d = readJson(f); if (d.type === "deity") add(mapDeity(d), d); }
  for (const f of from("bestiary")) { const d = readJson(f); if (d.type === "npc") add(mapMonster(d), d); }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(records));
  const byTag = records.reduce((m, r) => ((m[r.tag] = (m[r.tag] || 0) + 1), m), {});
  const byLic = records.reduce((m, r) => ((m[r.license || "?"] = (m[r.license || "?"] || 0) + 1), m), {});
  console.log(`[pf2e] extracted ${records.length} records -> ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
  console.log("  by tag:", byTag);
  console.log("  by license:", byLic);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
run();
