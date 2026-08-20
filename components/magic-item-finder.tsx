"use client";

import { useMemo, useState } from "react";
import { SAX, STONE, surfaces } from "@/lib/theme";
import { stoneField } from "@/lib/forge-theme";
import { MAGIC_ITEMS, MagicItemType, isConsumableType } from "@/lib/tools/magic-items";
import {
  Rarity, RARITIES, RARITY_LABEL, priceMagicItem, fmtGp,
} from "@/lib/tools/magic-item-price";

// components/magic-item-finder.tsx
//
// Browse and search the D&D 2024 magic items, each priced by OUR calculator (lib/tools/magic-item-price),
// never by any third-party price list. The catalog (lib/tools/magic-items) carries only facts: name, type,
// rarity, attunement. No item text is shown. Pure client-side; nothing saved.

const CAP = 120; // render ceiling, keeps the page snappy; the count line says when there is more

const TYPES: MagicItemType[] = ["Armor", "Potion", "Ring", "Rod", "Scroll", "Staff", "Wand", "Weapon", "Wondrous Item"];

const SORTED = [...MAGIC_ITEMS].sort((a, b) => a.name.localeCompare(b.name));

const RARITY_TINT: Record<Rarity, string> = {
  common: "#a99e86",
  uncommon: "#9aa880",
  rare: "#6fa3c9",
  "very rare": "#b493d4",
  legendary: "#e2b878",
  artifact: "#d97d6d",
};

export default function MagicItemFinder() {
  const [q, setQ] = useState("");
  const [rarity, setRarity] = useState<"all" | Rarity>("all");
  const [type, setType] = useState<"all" | MagicItemType>("all");
  const [attune, setAttune] = useState<"all" | "yes" | "no">("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SORTED.filter((it) => {
      if (needle && !it.name.toLowerCase().includes(needle)) return false;
      if (rarity !== "all" && it.rarity !== rarity) return false;
      if (type !== "all" && it.type !== type) return false;
      if (attune === "yes" && !it.attunement) return false;
      if (attune === "no" && it.attunement) return false;
      return true;
    });
  }, [q, rarity, type, attune]);

  const shown = filtered.slice(0, CAP);

  return (
    <div style={{ marginTop: 28 }}>
      <div style={header}>
        <h2 style={h2}>Find an item</h2>
        <p style={sub}>
          {MAGIC_ITEMS.length} magic items, each priced by the calculator above from its rarity. Prices are
          our own estimates, not official values.
        </p>
      </div>

      <div style={panel}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name (Flame Tongue, Cloak of...)"
          style={search}
        />
        <div style={filters}>
          <label style={filterWrap}>
            <span style={smallLabel}>Rarity</span>
            <select value={rarity} onChange={(e) => setRarity(e.target.value as "all" | Rarity)} style={sel}>
              <option value="all">All</option>
              {RARITIES.map((r) => <option key={r} value={r}>{RARITY_LABEL[r]}</option>)}
            </select>
          </label>
          <label style={filterWrap}>
            <span style={smallLabel}>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as "all" | MagicItemType)} style={sel}>
              <option value="all">All</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={filterWrap}>
            <span style={smallLabel}>Attunement</span>
            <select value={attune} onChange={(e) => setAttune(e.target.value as "all" | "yes" | "no")} style={sel}>
              <option value="all">Any</option>
              <option value="yes">Required</option>
              <option value="no">Not required</option>
            </select>
          </label>
        </div>
      </div>

      <p style={countLine}>
        {filtered.length} item{filtered.length === 1 ? "" : "s"}
        {filtered.length > CAP ? ` (showing the first ${CAP}, narrow your search to see the rest)` : ""}
      </p>

      <div style={{ display: "grid", gap: 6 }}>
        {shown.map((it, i) => {
          const res = priceMagicItem({ rarity: it.rarity, consumable: isConsumableType(it.type), power: "typical" });
          return (
            <div key={`${it.name}-${it.rarity}-${i}`} style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={itemName}>{it.name}</div>
                <div style={meta}>
                  <span style={{ ...rarityBadge, color: RARITY_TINT[it.rarity], borderColor: RARITY_TINT[it.rarity] }}>
                    {RARITY_LABEL[it.rarity]}
                  </span>
                  <span style={typeText}>{it.type}</span>
                  {it.attunement && <span style={attuneText}>attunement</span>}
                </div>
              </div>
              <div style={priceCell}>
                {res.priceable ? fmtGp(res.price ?? 0) : "Not for sale"}
              </div>
            </div>
          );
        })}
        {shown.length === 0 && <p style={{ color: "#8a8069", fontSize: 14 }}>No items match those filters.</p>}
      </div>

      <p style={disclaimer}>
        Item names, rarities, and types are factual references to published content and are used for
        compatibility only. Prices are our own estimates. Unofficial; not affiliated with or endorsed by
        Wizards of the Coast.
      </p>
    </div>
  );
}

// ---- styles (cream document register) ----

const header: React.CSSProperties = { marginBottom: 14 };
const h2: React.CSSProperties = { fontSize: 24, fontWeight: 600, color: STONE.ink, margin: "0 0 4px", fontFamily: "var(--forge-display, 'Cinzel', serif)" };
const sub: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.55, color: STONE.inkDim, margin: 0, fontFamily: SAX.serif };
const panel: React.CSSProperties = { ...surfaces.panel, padding: "14px 16px", marginBottom: 12 };
const search: React.CSSProperties = { ...stoneField(), fontSize: 15, boxSizing: "border-box" };
const filters: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 };
const filterWrap: React.CSSProperties = { flex: "1 1 140px" };
const smallLabel: React.CSSProperties = {
  display: "block", fontFamily: SAX.mono, fontSize: 10,
  letterSpacing: "0.12em", textTransform: "uppercase", color: STONE.inkDim, marginBottom: 5,
};
const sel: React.CSSProperties = { ...stoneField(), padding: "8px 10px", fontSize: 14, boxSizing: "border-box" };
const countLine: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 12, color: STONE.inkFaint, margin: "0 0 10px",
};
const row: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
  padding: "9px 12px", borderRadius: 4, background: "rgba(0,0,0,0.22)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4)",
};
const itemName: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: STONE.ink };
const meta: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", marginTop: 3, flexWrap: "wrap" };
const rarityBadge: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 10.5, letterSpacing: "0.04em",
  border: "1px solid", borderRadius: 3, padding: "1px 6px", textTransform: "uppercase",
};
const typeText: React.CSSProperties = { fontSize: 12.5, color: STONE.inkDim };
const attuneText: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 10.5, color: SAX.brass,
  textTransform: "uppercase", letterSpacing: "0.05em",
};
const priceCell: React.CSSProperties = { flex: "0 0 auto", fontSize: 15, fontWeight: 600, color: STONE.brassHi, whiteSpace: "nowrap" };
const disclaimer: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, color: STONE.inkFaint, margin: "18px 0 0", fontFamily: SAX.serif };
