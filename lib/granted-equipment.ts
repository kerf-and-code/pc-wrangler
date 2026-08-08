// lib/granted-equipment.ts
//
// Turn a granted-equipment string into something the Gear panel can actually add.
//
// TWO SHAPES IN THE DATA, and both appear in backgrounds-2024.json:
//
//   a choice   "Choose A or B: (A) Dagger, Disguise Kit, Costume, Traveler's Clothes, 16 GP;
//               or (B) 50 GP"                                            75 of 123 backgrounds
//   a list     "A leather-bound diary, a bottle of ink, an ink pen, a set of traveler's clothes,
//               and a pouch containing 10 gp"                             the remaining 48
//
// The class core-traits table uses the first shape too, so one parser serves backgrounds and
// starting equipment both.
//
// WHY IT MATCHES AGAINST THE CATALOG RATHER THAN TRUSTING THE STRING
//   The Gear panel stores items by NAME, and a name the catalog does not know is a line the sheet
//   cannot weigh, price or derive armour class from. So every parsed item is looked up, and the
//   ones that miss are reported rather than added - a player who sees "Burglar's Pack: not in the
//   catalog" can do something about it, where a silently dropped item just goes missing.

export type GrantedItem = {
  qty: number;
  name: string;
  raw: string;
  /**
   * True for entries like "Gaming Set (same as above)" - a CROSS-REFERENCE to the background's tool
   * proficiency row, not an item. No equipment catalog will ever contain one, so matching it is a
   * guaranteed miss that looks like a data gap. Resolved against the background's own tool field
   * where possible, and otherwise shown as the reference it is.
   */
  crossRef?: boolean;
};
export type GrantedBundle = { label: string; items: GrantedItem[]; currency: string[] };

const CURRENCY = /^\s*(\d[\d,]*)\s*(cp|sp|ep|gp|pp)\s*$/i;

/** "2 Daggers" -> { qty: 2, name: "Dagger" }. Singularisation is deliberately timid. */
function parseItem(raw: string): GrantedItem | null {
  let t = raw.trim()
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/^set of\s+/i, "")
    .replace(/\.$/, "");
  if (!t) return null;

  let qty = 1;
  const m = /^(\d[\d,]*)\s+(.*)$/.exec(t);
  if (m) {
    qty = Number(m[1].replace(/,/g, "")) || 1;
    t = m[2];
  }

  // Only de-pluralise when a count made it plural. "Thieves' Tools" and "Traveler's Clothes" are
  // singular items whose names end in s, and trimming them would break every catalog lookup.
  if (qty > 1) {
    // "Pouches" -> "Pouch", not "Pouche". Chopping a single s off an -es plural after a sibilant
    // leaves a word that is not a word, and then no spelling of it matches anything.
    if (/(ch|sh|s|x|z)es$/i.test(t)) t = t.slice(0, -2);
    else if (/[^s]s$/.test(t)) t = t.slice(0, -1);
  }

  // "(same as above)" and friends point back at the tool proficiency row rather than naming a
  // thing. Strip the marker, keep the noun, and flag it so the caller can resolve or label it.
  const crossRef = /\(\s*same as above\s*\)|\bas above\b|\bsame as\b/i.test(t);
  if (crossRef) t = t.replace(/\s*\(\s*same as above\s*\)\s*/i, "").replace(/\s*\bsame as above\b\s*/i, "").trim();

  return { qty, name: t.trim(), raw: raw.trim(), ...(crossRef ? { crossRef: true } : {}) };
}

function splitList(text: string): { items: GrantedItem[]; currency: string[] } {
  const items: GrantedItem[] = [];
  const currency: string[] = [];
  // Split on commas and "and", but NOT inside parentheses - "Parchment (10 sheets)" and
  // "Book (prayers)" are one item each and a naive split cuts them in half.
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  parts.push(buf);

  for (const chunk of parts) {
    for (const piece of chunk.split(/\band\b/i)) {
      const t = piece.trim();
      if (!t) continue;
      if (CURRENCY.test(t)) { currency.push(t.replace(/\s+/g, " ").toUpperCase()); continue; }
      // "a pouch containing 10 gp" is money wearing a container.
      const inner = /containing\s+(\d[\d,]*\s*(?:cp|sp|ep|gp|pp))/i.exec(t);
      if (inner) { currency.push(inner[1].replace(/\s+/g, " ").toUpperCase()); continue; }
      const it = parseItem(t);
      if (it && it.name.length > 1) items.push(it);
    }
  }
  return { items, currency };
}

export function parseGranted(text: string): GrantedBundle[] {
  const src = (text || "").trim();
  if (!src) return [];

  if (/choose/i.test(src)) {
    // Find the LABEL positions and slice between them, rather than matching a bundle's body with a
    // no-parentheses pattern. Bundles routinely contain their own brackets - "Book (prayers)",
    // "Parchment (10 sheets)" - and a [^()] body stops dead at the first one, which made the whole
    // Acolyte grant parse as a single unsplit string.
    const marks: { label: string; at: number; end: number }[] = [];
    const re = /\(([A-Z])\)/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      // A single capital in brackets mid-sentence is a label; "(10 sheets)" and "(prayers)" are not.
      marks.push({ label: m[1], at: m.index, end: m.index + m[0].length });
    }
    if (marks.length >= 2) {
      const out: GrantedBundle[] = [];
      for (let i = 0; i < marks.length; i++) {
        const stop = i + 1 < marks.length ? marks[i + 1].at : src.length;
        const body = src.slice(marks[i].end, stop)
          .replace(/;?\s*or\s*$/i, "").replace(/[;,]\s*$/, "").trim();
        if (!body) continue;
        const { items, currency } = splitList(body);
        out.push({ label: marks[i].label, items, currency });
      }
      if (out.length >= 2) return out;
    }
  }

  const { items, currency } = splitList(src);
  // One unlabelled bundle: nothing to choose between, everything is granted.
  return items.length || currency.length ? [{ label: "", items, currency }] : [];
}

/**
 * Which of these the catalog knows. Matching is case-insensitive and ignores the curly apostrophes
 * the source data uses inconsistently - "Thieves' Tools" and "Thieves’ Tools" are the same item and
 * only one of them is ever in the catalog.
 */
/**
 * Resolve a cross-reference against the background's own tool proficiency line. "Gaming Set (same
 * as above)" beside a tool row reading "Dragonchess Set" means the player receives a Dragonchess
 * Set - the generic noun in the equipment list is a pointer, and the specific one is upstairs.
 */
export function resolveCrossRefs(items: GrantedItem[], toolProficiency: string | undefined): GrantedItem[] {
  const tool = (toolProficiency || "").trim();
  if (!tool) return items;
  return items.map((it) => (it.crossRef ? { ...it, name: tool, raw: `${it.raw} \u2192 ${tool}` } : it));
}

/**
 * Three buckets, not two.
 *
 *   matched  the catalog has it, so it can be added to the sheet
 *   choose   the grant points at a DECISION - "Choose one kind of Artisan's Tools" - which is not
 *            a missing item and must not be counted as one. Every cross-reference in the 2024
 *            backgrounds resolves to one of these, because the tool row it points at is itself a
 *            choice. Reporting them as gaps made the catalog look worse than it is and gave the
 *            player nothing to act on.
 *   missing  a real name the catalog does not stock. THIS is the number that measures data quality.
 */
export function matchGranted(
  items: GrantedItem[], known: string[],
): { matched: GrantedItem[]; missing: GrantedItem[]; choose: GrantedItem[] } {
  const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  // Index the catalog under EVERY form an item might be asked for, not just its printed name. The
  // catalog stocks "Arrows (20)" - a name carrying its bundle size - and a grant asks for "20
  // Arrows". Stripping the parenthetical was already done on the grant side; doing it only there
  // meant the two normalised forms still never met.
  const index = new Map<string, string>();
  const add = (k: string, v: string) => { if (k && !index.has(k)) index.set(k, v); };
  for (const k of known) {
    add(norm(k), k);
    const bareK = k.replace(/\s*\([^)]*\)\s*$/, "").trim();
    add(norm(bareK), k);
    add(norm(bareK.replace(/s$/, "")), k);
    // And un-invert, so "Clothes, Traveler's" is also findable as "Traveler's Clothes" - the
    // inversion is tried from the grant side too, but indexing both ends costs nothing and catches
    // the cases where the grant's wording does not invert cleanly.
    const comma = /^([^,]+),\s*(.+)$/.exec(bareK);
    if (comma) {
      add(norm(`${comma[2]} ${comma[1]}`), k);
      add(norm(`${comma[2]} ${comma[1].replace(/s$/, "")}`), k);
    }
  }
  const matched: GrantedItem[] = [];
  const missing: GrantedItem[] = [];
  const choose: GrantedItem[] = [];
  for (const it of items) {
    if (/\bchoose\b|\bof your choice\b|\bone kind of\b/i.test(it.name)) { choose.push(it); continue; }
    // Try the name as parsed, then its plural. "20 Arrows" is de-pluralised to "Arrow" so the count
    // reads properly, but the catalog lists the item as "Arrows" - so a lookup that only tries one
    // form misses an item that is plainly there.
    // A trailing parenthetical is a QUALIFIER, not part of the name: the catalog stocks "Book",
    // and the grant asks for "Book (prayers)". Dropping it is tried last so an item whose real name
    // contains brackets still wins on the exact match.
    const bare = it.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
    // The catalog is indexed, not spoken: it stocks "Clothes, Fine" where the grant says "Fine
    // Clothes", and "Bullets, Sling" where a list would say "Sling Bullets". So the last word is
    // tried as a heading with the rest as the qualifier. This is the single biggest source of
    // misses - clothing alone accounts for nearly a hundred of them across the 123 backgrounds.
    const inverted = (n: string): string | null => {
      const w = n.trim().split(/\s+/);
      return w.length >= 2 ? `${w[w.length - 1]}, ${w.slice(0, -1).join(" ")}` : null;
    };
    const inv = inverted(bare);
    const hit = index.get(norm(it.name))
      ?? index.get(norm(`${it.name}s`))
      ?? index.get(norm(it.name.replace(/s$/, "")))
      ?? index.get(norm(bare))
      ?? index.get(norm(`${bare}s`))
      ?? (inv ? index.get(norm(inv)) : undefined)
      ?? (inv ? index.get(norm(`${inv}s`)) : undefined);
    if (hit) matched.push({ ...it, name: hit });
    else if (it.crossRef) choose.push(it);
    else missing.push(it);
  }
  return { matched, missing, choose };
}
