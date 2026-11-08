"use client";

// components/play-inventory.tsx (2026-11-07)
//
// Phase 5c: the inventory half of the play sheet.
//
// ITEMS. Search the compendium (mundane gear and magic items of the edition in force), read an item's
// description before adding it, or type in an item of your own. Each item shows what it changes on
// the sheet. Weapons, armor, shields and wearable or held magic items can be equipped; items that
// need attunement can be attuned, up to the character's limit (3, more for a high-level Artificer).
// Only equipped items, and attuned ones where the item needs it, change the numbers: the sheet's
// derivation reads the same `eq` and `att` flags (lib/srd/derive-sheet.ts), so armor in the pack
// does not count towards AC and a Ring of Protection does nothing until it is worn and attuned.
// Equipping body armor takes off any other body armor; the same for a shield.
//
// An item stored before this phase has no flags and counts as worn and attuned, which is how the
// sheet always treated it. The first change made here writes the flags out explicitly, so what the
// list shows and what the sheet applies can never drift apart.
//
// WEIGHT against carrying capacity (STR x 15 lb), coins included at 50 to the pound. COINS in the
// five denominations. NOTES: personality, ideals, bonds, flaws, backstory, allies and organizations.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, STONE, FORGE_FONTS, stonePanel, stoneButton } from "@/lib/forge-theme";
import { describeItem, type ItemRecord } from "@/lib/descriptions";
import {
  gearAttuned, gearEquipped, needsAttunement, itemEffectSummary,
  type Build, type GearEntry, type RulesContext,
} from "@/lib/srd/derive-sheet";
import { useNarrow } from "@/lib/use-narrow";

export type Coins = { pp?: number; gp?: number; ep?: number; sp?: number; cp?: number };
export type CharNotes = { personality?: string; ideals?: string; bonds?: string; flaws?: string; backstory?: string; allies?: string; organizations?: string };
export type CatalogEntry = { name: string; type: string; magic: boolean; rarity?: string };

type Filter = "all" | "equipped" | "attuned" | "magic" | "gear";
const COIN_KEYS: (keyof Coins)[] = ["pp", "gp", "ep", "sp", "cp"];
const COIN_NAME: Record<keyof Coins, string> = { pp: "Platinum", gp: "Gold", ep: "Electrum", sp: "Silver", cp: "Copper" };
const COIN_IN_GP: Record<keyof Coins, number> = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 };
const NOTE_FIELDS: [keyof CharNotes, string, number][] = [
  ["personality", "Personality traits", 2], ["ideals", "Ideals", 2], ["bonds", "Bonds", 2], ["flaws", "Flaws", 2],
  ["backstory", "Backstory", 5], ["allies", "Allies", 3], ["organizations", "Organizations", 3],
];

// "3", 3, "1/4", "1½", 0.5 -> pounds
export function parseWeight(w: unknown): number | null {
  if (typeof w === "number") return Number.isFinite(w) ? w : null;
  if (typeof w !== "string" || !w.trim() || w === "None") return null;
  const s = w.replace("½", ".5").replace("¼", ".25").trim();
  const f = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (f) return Number(f[1]) / Number(f[2]);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// The Artificer's Magic Item Adept, Savant and Master raise the attunement limit; everyone else has 3.
export function attunementLimit(classes: { className: string; level: number }[]): number {
  const art = classes.find((c) => /^artificer$/i.test(c.className));
  const l = art?.level ?? 0;
  return l >= 18 ? 6 : l >= 14 ? 5 : l >= 10 ? 4 : 3;
}

type Ctx = Pick<RulesContext, "items" | "itemEffects" | "itemVariants">;

// Can this be worn or held so that it matters? Armor, shields and weapons; magic items worn or held
// (rings, rods, staffs, wands, wondrous items); not potions, scrolls, ammunition, books or bags.
export function canEquip(e: GearEntry, ctx: Ctx, rec: ItemRecord | undefined): boolean {
  if (e.custom) return false;
  const def = ctx.items[e.n];
  if (def && (def.kind === "Armor" || def.kind === "Weapon")) return true;
  if (needsAttunement(e.n, ctx)) return true;
  const cat = (rec?.category ?? "").toLowerCase();
  if (!/^(ring|rod|staff|wand|wondrous)\b/.test(cat)) return false;
  return !/^(potion|oil|dust|elixir|philter|scroll|manual|tome|bead|feather token|keoghtom|sovereign glue|universal solvent|bag|portable hole|ammunition|arrow|bolt|deck of|candle|incense|ink|marvelous pigments|nolzur)/i.test(e.n);
}
const bodyArmor = (e: GearEntry, ctx: Ctx) => ctx.items[e.n]?.kind === "Armor" && ctx.items[e.n]?.sub !== "Shield";
const shield = (e: GearEntry, ctx: Ctx) => ctx.items[e.n]?.kind === "Armor" && ctx.items[e.n]?.sub === "Shield";

export default function PlayInventory({ gear, catalog, itemByName, ctx, str, attuneMax, coins, notes, onGear, onCoins, onNotes }: {
  gear: Build["gear"];
  catalog: CatalogEntry[];
  itemByName: Record<string, ItemRecord>;
  ctx: Ctx;
  str: number;
  attuneMax: number;
  coins: Coins;
  notes: CharNotes;
  onGear: (items: GearEntry[], attuned: string[]) => void;
  onCoins: (c: Coins) => void;
  onNotes: (n: CharNotes) => void;
}) {
  const narrow = useNarrow();
  const items = useMemo(() => gear?.items ?? [], [gear]);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [custom, setCustom] = useState<{ n: string; wt: string; note: string } | null>(null);

  const box: React.CSSProperties = { ...stonePanel(), marginBottom: 0, padding: "12px 14px" };
  const btn = (on = false): React.CSSProperties => ({ ...stoneButton(on ? "primary" : "stone"), fontSize: 12.5, padding: "5px 10px" });
  const mono: React.CSSProperties = { fontFamily: FORGE_FONTS.mono };
  const tiny: React.CSSProperties = { ...mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: STONE.inkFaint };
  const field: React.CSSProperties = { padding: "6px 8px", borderRadius: 4, border: `1px solid ${STONE.hi}`, background: "rgba(0,0,0,0.25)", color: STONE.ink, fontSize: 13 };

  // ---- the derived view of each entry ----
  const view = useMemo(() => items.map((e, i) => {
    const rec = itemByName[e.n];
    const equippable = canEquip(e, ctx, rec);
    const attune = !e.custom && needsAttunement(e.n, ctx);
    const equipped = equippable && gearEquipped(e);
    const attuned = attune && gearAttuned(e, gear);
    const each = e.wt ?? parseWeight((rec as { weight?: unknown } | undefined)?.weight);
    const qty = Math.max(1, e.qty ?? 1);
    return {
      e, i, rec, equippable, attune, equipped, attuned, qty, each,
      weight: each === null ? null : each * qty,
      active: (equippable ? equipped : true) && (attune ? attuned : true),
      magic: !!rec && !!(rec as { rarity?: string }).rarity,
      effect: e.custom ? null : itemEffectSummary(e, ctx),
    };
  }), [items, itemByName, ctx, gear]);
  type V = (typeof view)[number];
  const attunedCount = view.filter((v) => v.attuned).length;
  const coinCount = COIN_KEYS.reduce((n, k) => n + (Number(coins[k]) || 0), 0);
  const carried = view.reduce((n, v) => n + (v.weight ?? 0), 0) + coinCount / 50;
  const unweighed = view.filter((v) => v.weight === null).length;
  const capacity = str * 15;
  const over = carried > capacity;

  // ---- writing back ----
  // Every write sends the whole list with the flags made explicit, and the attuned list beside it
  // (the GM's sheet peek and the D&D Beyond import read gear.attuned).
  const commit = (next: GearEntry[]) => {
    const out = next.map((e) => {
      const rec = itemByName[e.n];
      const x = { ...e };
      if (canEquip(x, ctx, rec) && x.eq === undefined) x.eq = true;
      if (!x.custom && needsAttunement(x.n, ctx) && x.att === undefined) x.att = gearAttuned(x, gear);
      return x;
    });
    onGear(out, Array.from(new Set(out.filter((e) => e.att && needsAttunement(e.n, ctx)).map((e) => e.n))));
  };
  const change = (i: number, fn: (e: GearEntry) => GearEntry) => commit(items.map((e, idx) => (idx === i ? fn({ ...e }) : e)));

  const equip = (v: V) => {
    if (v.equipped) { change(v.i, (e) => ({ ...e, eq: false })); setMsg(null); return; }
    const isBody = bodyArmor(v.e, ctx), isShield = shield(v.e, ctx);
    const off: string[] = [];
    const next = items.map((e, idx) => {
      if (idx === v.i) return { ...e, eq: true };
      if ((isBody && bodyArmor(e, ctx) && gearEquipped(e)) || (isShield && shield(e, ctx) && gearEquipped(e))) { off.push(e.n); return { ...e, eq: false }; }
      return e;
    });
    commit(next);
    const needs = v.attune && !v.attuned ? ` It needs attunement before its magic works.` : "";
    setMsg({ text: `${v.e.n} equipped.${off.length ? ` ${off.join(", ")} taken off.` : ""}${needs}`, bad: false });
  };
  const attune = (v: V) => {
    if (v.attuned) { change(v.i, (e) => ({ ...e, att: false })); setMsg({ text: `Attunement to ${v.e.n} ended.`, bad: false }); return; }
    if (attunedCount >= attuneMax) { setMsg({ text: `You are attuned to ${attunedCount} items, the most you can be. End attunement to one of them first.`, bad: true }); return; }
    change(v.i, (e) => ({ ...e, att: true }));
    setMsg({ text: `Attuned to ${v.e.n}${v.equippable && !v.equipped ? ". Equip it too for its magic to work" : ""}.`, bad: false });
  };
  const remove = (v: V) => { commit(items.filter((_, idx) => idx !== v.i)); setOpen(null); setMsg({ text: `${v.e.n} removed.`, bad: false }); };
  const add = (name: string) => {
    const rec = itemByName[name];
    const proto: GearEntry = { n: name };
    const equippable = canEquip(proto, ctx, rec);
    // a stackable item already in the list gets one more instead of a second row
    const same = items.findIndex((e) => e.n === name && !e.custom && !equippable);
    if (same >= 0) { change(same, (e) => ({ ...e, qty: Math.max(1, e.qty ?? 1) + 1 })); setMsg({ text: `One more ${name}.`, bad: false }); return; }
    const entry: GearEntry = { n: name, ...(equippable ? { eq: false } : {}), ...(needsAttunement(name, ctx) ? { att: false } : {}) };
    commit([...items, entry]);
    setMsg({ text: `${name} added${equippable ? ". Equip it to use it" : ""}.`, bad: false });
  };
  const addCustom = () => {
    if (!custom || !custom.n.trim()) return;
    const wt = parseWeight(custom.wt);
    commit([...items, { n: custom.n.trim().slice(0, 80), custom: true, ...(wt !== null ? { wt } : {}), ...(custom.note.trim() ? { note: custom.note.trim().slice(0, 500) } : {}) }]);
    setMsg({ text: `${custom.n.trim()} added.`, bad: false });
    setCustom(null);
  };

  // ---- the compendium search ----
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const starts = catalog.filter((c) => c.name.toLowerCase().startsWith(s));
    const has = catalog.filter((c) => !c.name.toLowerCase().startsWith(s) && c.name.toLowerCase().includes(s));
    return [...starts, ...has].slice(0, 12);
  }, [q, catalog]);
  const pv = preview ? describeItem(itemByName[preview]) : null;

  const shown = view.filter((v) => filter === "all" || (filter === "equipped" && v.equipped) || (filter === "attuned" && v.attune)
    || (filter === "magic" && v.magic) || (filter === "gear" && !v.magic && !v.equippable));

  return (
    <section aria-label="Inventory" style={{ display: "grid", gap: 12, marginBottom: 14 }}>
      <div style={box}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div style={tiny}>Inventory</div>
          <span style={{ fontSize: 12.5, color: STONE.inkFaint }}>{items.length} item{items.length === 1 ? "" : "s"}</span>
          <span style={{ fontSize: 12.5, color: attunedCount > attuneMax ? C.warn : STONE.inkFaint }} aria-label={`Attuned to ${attunedCount} of ${attuneMax}`}>Attuned {attunedCount} of {attuneMax}</span>
          <span style={{ fontSize: 12.5, color: over ? C.warn : STONE.inkFaint }}>Carrying {Math.round(carried * 10) / 10} of {capacity} lb</span>
        </div>
        <div role="meter" aria-label="Carried weight" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={Math.round(carried)} style={{ height: 6, borderRadius: 3, background: "rgba(0,0,0,0.3)", marginTop: 8, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, capacity ? (carried / capacity) * 100 : 0)}%`, height: "100%", background: over ? C.warn : C.sun }} />
        </div>
        {over && <p style={{ fontSize: 12.5, color: C.warn, margin: "6px 0 0" }}>Over your carrying capacity (STR {str} x 15). You can push, drag or lift up to twice that, but only at a Speed of 5 feet.</p>}
        {unweighed > 0 && <p style={{ fontSize: 11.5, color: STONE.inkFaint, margin: "6px 0 0" }}>{unweighed} item{unweighed === 1 ? " has" : "s have"} no listed weight (magic items mostly). Open one to set it.</p>}
        {attunedCount > attuneMax && <p style={{ fontSize: 12.5, color: C.warn, margin: "6px 0 0" }}>Attuned to more items than you can be. End attunement to {attunedCount - attuneMax}.</p>}

        {/* add from the compendium */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
          <label htmlFor="inv-search" style={{ fontSize: 12.5, color: STONE.ink }}>Add an item</label>
          <input id="inv-search" value={q} onChange={(e) => { setQ(e.target.value.slice(0, 60)); setPreview(null); }} placeholder="Search weapons, armor, gear, magic items…" style={{ ...field, flex: "1 1 220px" }} />
          <button type="button" className="forge-btn" onClick={() => setCustom(custom ? null : { n: q.trim(), wt: "", note: "" })} aria-expanded={!!custom} style={btn(!!custom)}>Your own item</button>
        </div>
        {results.length > 0 && (
          <ul aria-label="Compendium matches" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 2 }}>
            {results.map((r) => (
              <li key={r.name} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0", borderBottom: `1px solid ${STONE.hi}` }}>
                <button type="button" onClick={() => setPreview(preview === r.name ? null : r.name)} aria-expanded={preview === r.name} style={{ background: "none", border: "none", padding: 0, color: STONE.ink, fontSize: 13.5, cursor: "pointer", textAlign: "left", flex: "1 1 180px" }}>
                  {r.name}<span style={{ fontSize: 11.5, color: STONE.inkFaint }}> · {r.type}{r.rarity ? ` · ${r.rarity}` : ""}</span>
                </button>
                <button type="button" className="forge-btn" onClick={() => add(r.name)} aria-label={`Add ${r.name}`} style={btn()}>Add</button>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && results.length === 0 && <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: "8px 0 0" }}>Nothing in the compendium by that name. Add it as your own item.</p>}
        {preview && (
          <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(0,0,0,0.22)", borderRadius: 4 }}>
            <div style={{ fontSize: 13.5, color: STONE.ink }}>{preview}</div>
            {pv?.lead && <p style={{ fontSize: 12, color: STONE.inkFaint, margin: "2px 0 6px" }}>{pv.lead}</p>}
            {(() => { const fx = itemEffectSummary({ n: preview }, ctx); return fx ? <p style={{ fontSize: 12.5, color: C.plum, margin: "0 0 6px" }}>On your sheet: {fx}</p> : null; })()}
            {pv?.body && <p style={{ fontSize: 13, color: STONE.ink, margin: 0, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{pv.body}</p>}
          </div>
        )}
        {custom && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <input aria-label="Item name" value={custom.n} onChange={(e) => setCustom({ ...custom, n: e.target.value.slice(0, 80) })} placeholder="Name" style={{ ...field, flex: "1 1 160px" }} />
            <input aria-label="Weight in pounds" value={custom.wt} onChange={(e) => setCustom({ ...custom, wt: e.target.value.slice(0, 8) })} placeholder="lb" inputMode="decimal" style={{ ...field, width: 64 }} />
            <input aria-label="What it does" value={custom.note} onChange={(e) => setCustom({ ...custom, note: e.target.value.slice(0, 500) })} placeholder="What it does (optional)" style={{ ...field, flex: "2 1 200px" }} />
            <button type="button" className="forge-btn" disabled={!custom.n.trim()} title={custom.n.trim() ? undefined : "Give it a name first"} onClick={addCustom} style={btn(true)}>Add it</button>
          </div>
        )}
        {msg && <p role="status" style={{ fontSize: 12.5, color: msg.bad ? C.warn : C.plum, margin: "8px 0 0" }}>{msg.text}</p>}

        {/* the list */}
        <div role="group" aria-label="Show" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 12 }}>
          {([["all", "All"], ["equipped", "Equipped"], ["attuned", "Attunement"], ["magic", "Magic"], ["gear", "Gear"]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} type="button" className="forge-btn" aria-pressed={filter === k} onClick={() => setFilter(k)} style={btn(filter === k)}>{l}</button>
          ))}
        </div>
        {items.length === 0 && <p style={{ fontSize: 13, color: STONE.inkFaint, margin: "10px 0 0" }}>Nothing carried yet. Search the compendium above, or add your own item.</p>}
        {items.length > 0 && shown.length === 0 && <p style={{ fontSize: 13, color: STONE.inkFaint, margin: "10px 0 0" }}>Nothing here under this filter.</p>}
        <div style={{ marginTop: 6 }}>
          {shown.map((v) => {
            const isOpen = open === v.i;
            const def = ctx.items[v.e.n];
            const variants = ctx.itemVariants[v.e.n];
            const canMod = !!def && (def.kind === "Armor" || def.kind === "Weapon");
            const d = v.rec ? describeItem(v.rec) : null;
            const meta = [v.rec?.category ?? (v.e.custom ? "Your own item" : null), (v.rec as { rarity?: string } | undefined)?.rarity, v.attune ? "needs attunement" : null,
              v.weight !== null ? `${Math.round(v.weight * 100) / 100} lb` : null].filter(Boolean).join(" · ");
            const state = v.equippable && v.equipped && v.attune && !v.attuned ? "Not working until attuned"
              : v.attune && v.attuned && v.equippable && !v.equipped ? "Attuned, not equipped" : null;
            return (
              <div key={`${v.e.n}-${v.i}`} style={{ borderBottom: `1px solid ${STONE.hi}`, padding: "7px 0" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: narrow ? "wrap" : "nowrap" }}>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <button type="button" onClick={() => setOpen(isOpen ? null : v.i)} aria-expanded={isOpen} style={{ background: "none", border: "none", padding: 0, color: STONE.ink, fontSize: 13.5, cursor: "pointer", textAlign: "left" }}>
                      {v.e.n}{v.e.mod ? ` +${v.e.mod}` : ""}{v.e.variant ? ` (${v.e.variant})` : ""}{v.qty > 1 ? ` x${v.qty}` : ""}
                    </button>
                    {v.active && (v.equipped || v.attuned) && <span style={{ ...mono, fontSize: 10, color: C.sun, marginLeft: 8, letterSpacing: "0.1em" }}>ACTIVE</span>}
                    <div style={{ fontSize: 11, color: STONE.inkFaint }}>{meta}</div>
                    {v.effect && <div style={{ fontSize: 12, color: v.active ? C.plum : STONE.inkFaint }}>{v.active ? "" : "When active: "}{v.effect}</div>}
                    {state && <div style={{ fontSize: 12, color: C.warn }}>{state}</div>}
                    {v.e.custom && v.e.note && <div style={{ fontSize: 12, color: STONE.inkFaint }}>{v.e.note}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: narrow ? "flex-start" : "flex-end" }}>
                    {v.equippable && <button type="button" className="forge-btn" aria-pressed={v.equipped} onClick={() => equip(v)} aria-label={`${v.equipped ? "Unequip" : "Equip"} ${v.e.n}`} style={btn(v.equipped)}>{v.equipped ? "Equipped" : "Equip"}</button>}
                    {v.attune && <button type="button" className="forge-btn" aria-pressed={v.attuned} onClick={() => attune(v)} aria-label={`${v.attuned ? "End attunement to" : "Attune to"} ${v.e.n}`} style={btn(v.attuned)}>{v.attuned ? "Attuned" : "Attune"}</button>}
                    {!v.equippable && (
                      <input type="number" min={1} max={9999} aria-label={`How many ${v.e.n}`} value={v.qty}
                        onChange={(ev) => { const n = Math.max(1, Math.min(9999, parseInt(ev.target.value, 10) || 1)); change(v.i, (e) => ({ ...e, qty: n })); }}
                        style={{ ...field, width: 64 }} />
                    )}
                  </div>
                </div>
                {isOpen && (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(0,0,0,0.22)", borderRadius: 4, display: "grid", gap: 8 }}>
                    {d?.lead && <p style={{ fontSize: 12, color: STONE.inkFaint, margin: 0 }}>{d.lead}</p>}
                    {d?.body && <p style={{ fontSize: 13, color: STONE.ink, margin: 0, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{d.body}</p>}
                    {!d && !v.e.custom && <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: 0 }}>No description for this item in the compendium.</p>}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {variants && (
                        <label style={{ fontSize: 12.5, color: STONE.ink, display: "flex", gap: 6, alignItems: "center" }}>Kind
                          <select value={v.e.variant ?? ""} onChange={(ev) => change(v.i, (e) => ({ ...e, variant: ev.target.value || undefined }))} style={field}>
                            <option value="">Choose</option>
                            {variants.options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                          </select>
                        </label>
                      )}
                      {canMod && (
                        <label style={{ fontSize: 12.5, color: STONE.ink, display: "flex", gap: 6, alignItems: "center" }}>Magic bonus
                          <select value={v.e.mod ?? 0} onChange={(ev) => change(v.i, (e) => ({ ...e, mod: parseInt(ev.target.value, 10) || 0 }))} style={field}>
                            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n ? `+${n}` : "none"}</option>)}
                          </select>
                        </label>
                      )}
                      <label style={{ fontSize: 12.5, color: STONE.ink, display: "flex", gap: 6, alignItems: "center" }}>Weight each (lb)
                        <input key={`wt-${v.i}-${v.each ?? ""}`} inputMode="decimal" defaultValue={v.each ?? ""} onBlur={(ev) => { const w = parseWeight(ev.target.value); change(v.i, (e) => { const x = { ...e }; if (w === null) delete x.wt; else x.wt = w; return x; }); }} style={{ ...field, width: 64 }} />
                      </label>
                      {v.equippable && (
                        <label style={{ fontSize: 12.5, color: STONE.ink, display: "flex", gap: 6, alignItems: "center" }}>How many
                          <input type="number" min={1} max={9999} value={v.qty} onChange={(ev) => { const n = Math.max(1, Math.min(9999, parseInt(ev.target.value, 10) || 1)); change(v.i, (e) => ({ ...e, qty: n })); }} style={{ ...field, width: 64 }} />
                        </label>
                      )}
                      <button type="button" className="forge-btn" onClick={() => remove(v)} aria-label={`Remove ${v.e.n}`} style={btn()}>Remove</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <CoinsBox coins={coins} onCoins={onCoins} box={box} tiny={tiny} field={field} />
      <NotesBox notes={notes} onNotes={onNotes} box={box} tiny={tiny} field={field} />
    </section>
  );
}

function CoinsBox({ coins, onCoins, box, tiny, field }: { coins: Coins; onCoins: (c: Coins) => void; box: React.CSSProperties; tiny: React.CSSProperties; field: React.CSSProperties }) {
  const total = COIN_KEYS.reduce((n, k) => n + (Number(coins[k]) || 0) * COIN_IN_GP[k], 0);
  return (
    <div style={box}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={tiny}>Coins</div>
        <span style={{ fontSize: 12.5, color: STONE.inkFaint }}>Worth {Math.round(total * 100) / 100} gp in all</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, marginTop: 8 }}>
        {COIN_KEYS.map((k) => (
          <label key={k} style={{ display: "grid", gap: 3, fontSize: 11.5, color: STONE.inkFaint }}>
            {COIN_NAME[k]} ({k})
            <input type="number" min={0} max={9999999} value={coins[k] ?? 0}
              onChange={(e) => onCoins({ ...coins, [k]: Math.max(0, Math.min(9999999, parseInt(e.target.value, 10) || 0)) })}
              style={{ ...field, fontFamily: FORGE_FONTS.mono }} />
          </label>
        ))}
      </div>
    </div>
  );
}

// Notes are typed into local state and written back a moment after the typing stops (and when the
// panel goes away), so a long backstory does not re-derive the sheet on every key.
function NotesBox({ notes, onNotes, box, tiny, field }: { notes: CharNotes; onNotes: (n: CharNotes) => void; box: React.CSSProperties; tiny: React.CSSProperties; field: React.CSSProperties }) {
  const [draft, setDraft] = useState<CharNotes>(notes);
  const pending = useRef<CharNotes | null>(null);
  const save = useRef(onNotes);
  useEffect(() => { save.current = onNotes; }, [onNotes]);
  useEffect(() => {
    if (!pending.current) return;
    const t = setTimeout(() => { if (pending.current) { save.current(pending.current); pending.current = null; } }, 600);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => () => { if (pending.current) save.current(pending.current); }, []);
  const set = (k: keyof CharNotes, v: string) => { const next = { ...draft, [k]: v.slice(0, 4000) }; pending.current = next; setDraft(next); };
  return (
    <div style={box}>
      <div style={tiny}>Character notes</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginTop: 8 }}>
        {NOTE_FIELDS.map(([k, label, rows]) => (
          <label key={k} style={{ display: "grid", gap: 3, fontSize: 11.5, color: STONE.inkFaint, gridColumn: rows >= 5 ? "1 / -1" : undefined }}>
            {label}
            <textarea rows={rows} value={draft[k] ?? ""} onChange={(e) => set(k, e.target.value)} style={{ ...field, resize: "vertical", lineHeight: 1.5, fontFamily: FORGE_FONTS.body }} />
          </label>
        ))}
      </div>
    </div>
  );
}
