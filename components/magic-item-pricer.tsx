"use client";

import { useMemo, useState } from "react";
import {
  POWERS, POWER_LABEL, Power,
  RARITIES, RARITY_LABEL, Rarity,
  priceMagicItem, fmtGp,
} from "@/lib/tools/magic-item-price";

// components/magic-item-pricer.tsx
//
// The free, no-login magic item price calculator. Pick a rarity, say whether it is a consumable or
// permanent, and how strong it is for its rarity, and get a price with the reasoning shown. Pure
// client-side; the pricing is our own (lib/tools/magic-item-price.ts), derived from the 2024 DMG rarity
// bands plus a transparent heuristic, not a copy of any third-party price list.

export default function MagicItemPricer() {
  const [rarity, setRarity] = useState<Rarity>("rare");
  const [consumable, setConsumable] = useState(false);
  const [power, setPower] = useState<Power>("typical");

  const result = useMemo(() => priceMagicItem({ rarity, consumable, power }), [rarity, consumable, power]);

  return (
    <div>
      <div style={panel}>
        <div style={panelHead}>The item</div>

        <Field label="Rarity">
          <select value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)} style={inp}>
            {RARITIES.map((r) => <option key={r} value={r}>{RARITY_LABEL[r]}</option>)}
          </select>
        </Field>

        <div style={{ marginTop: 14 }}>
          <div style={smallLabel}>Type</div>
          <div style={chips}>
            <button type="button" onClick={() => setConsumable(false)} style={{ ...chip, ...(consumable ? null : chipOn) }}>
              Permanent
            </button>
            <button type="button" onClick={() => setConsumable(true)} style={{ ...chip, ...(consumable ? chipOn : null) }}>
              Consumable (potion, scroll, ammo)
            </button>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={smallLabel}>How strong is it for its rarity?</div>
          <div style={chips}>
            {POWERS.map((p) => (
              <button key={p} type="button" onClick={() => setPower(p)} style={{ ...chip, flex: 1, ...(power === p ? chipOn : null) }}>
                {POWER_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={resultPanel}>
        <div style={panelHead}>Estimated price</div>
        {result.priceable ? (
          <>
            <div style={priceBig}>{fmtGp(result.price ?? 0)}</div>
            <div style={rangeLine}>
              Reasonable range for this setup: {fmtGp(result.low ?? 0)} to {fmtGp(result.high ?? 0)}
            </div>
          </>
        ) : (
          <div style={{ ...priceBig, fontSize: 28 }}>Not for sale</div>
        )}
        <ul style={rationale}>
          {result.rationale.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
        </ul>
      </div>

      <details style={explain}>
        <summary style={explainSummary}>How this is calculated</summary>
        <div style={{ marginTop: 10 }}>
          <p style={p}>
            The 2024 Dungeon Master&apos;s Guide gives a price range for each rarity. We start from that band,
            place the item inside it by how strong it is for its rarity, and halve it if it is a consumable,
            since a one-use item is worth far less than a permanent one of the same rarity. The numbers are
            ours, derived from the official rarity bands, not lifted from any third-party price list.
          </p>
          <p style={p}>
            Treat it as a planning estimate. A shop selling to adventurers marks up; buying from them, expect
            roughly half. Items that require attunement are worth a little less to a buyer who has to spend a
            slot on them. And a table that wants magic to feel rare can price everything higher on purpose.
          </p>
          <p style={pMuted}>
            Mundane gear (weapons, armor, tools) has fixed book prices and is not what this tool is for.
          </p>
        </div>
      </details>

      <div style={upsell}>
        <div style={upsellHead}>In the full app</div>
        <p style={{ ...p, margin: 0 }}>
          Six Axes values the loot you actually hand out as it happens, tracked per character and campaign,
          so a party&apos;s haul adds up on its own instead of being priced one item at a time.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={smallLabel}>{label}</span>
      {children}
    </label>
  );
}

// ---- styles (cream document register) ----

const panel: React.CSSProperties = { border: "1px solid #ddd4c2", background: "#fffdf8", borderRadius: 6, padding: "16px 18px", marginBottom: 16 };
const resultPanel: React.CSSProperties = { ...panel, background: "#f3ecdd", borderColor: "#d8cdb4" };
const panelHead: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, letterSpacing: "0.14em",
  textTransform: "uppercase", color: "#8a7a55", marginBottom: 12,
};
const smallLabel: React.CSSProperties = {
  display: "block", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 10.5,
  letterSpacing: "0.12em", textTransform: "uppercase", color: "#8a7a55", marginBottom: 8,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 10px", borderRadius: 4, border: "1px solid #c9bfa8", background: "#fff",
  color: "#2a2620", fontSize: 15.5, fontFamily: "inherit", boxSizing: "border-box",
};
const chips: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
const chip: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, color: "#7a7060",
  border: "1px solid #d8cdb4", borderRadius: 3, padding: "7px 11px", background: "#fff", cursor: "pointer",
};
const chipOn: React.CSSProperties = { background: "#3a352c", color: "#f6f2e9", borderColor: "#3a352c" };
const priceBig: React.CSSProperties = { fontSize: 40, fontWeight: 700, color: "#2a2620", lineHeight: 1.1 };
const rangeLine: React.CSSProperties = { fontSize: 14.5, color: "#7a7060", margin: "8px 0 0" };
const rationale: React.CSSProperties = { margin: "14px 0 0", paddingLeft: 18, fontSize: 14, lineHeight: 1.55, color: "#4a443a" };
const explain: React.CSSProperties = { border: "1px solid #e6ddca", borderRadius: 6, padding: "12px 16px", marginBottom: 16, background: "#fffdf8" };
const explainSummary: React.CSSProperties = { cursor: "pointer", fontSize: 14.5, color: "#8a6a2f", fontWeight: 600 };
const p: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.6, color: "#4a443a", margin: "0 0 10px" };
const pMuted: React.CSSProperties = { fontSize: 13, lineHeight: 1.55, color: "#8a8069", margin: 0 };
const upsell: React.CSSProperties = { border: "1px solid #d8cdb4", borderRadius: 6, padding: "16px 18px", background: "#f3ecdd" };
const upsellHead: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, letterSpacing: "0.14em",
  textTransform: "uppercase", color: "#8a7a55", marginBottom: 8,
};
