"use client";

// components/pf2e-picks.tsx (2026-11-10, push 22, audit G4)
//
// Feats, spells and gear for the PF2e Forge. The names come from public/pf2e/picks.json (written by
// scripts/build-pf2e-picks.mjs from the OGL and ORC records the compendium already ships), fetched the
// first time one of these panels opens, so the 16 MB of rules text never reaches the builder. Every
// field also takes a name typed by hand, for anything the list does not have.

import React, { useEffect, useId, useMemo, useState } from "react";
import {
  pf2eFeatSlots, pf2eMaxSpellRank, type Pf2eBuild, type Pf2eFeatSlot,
} from "@/lib/pf2e/character";
import { STONE, FORGE_FONTS, stonePanel, stoneField, forgeLabel, stoneButton } from "@/lib/forge-theme";

type Picks = {
  feats: [string, string, number, string][];
  spells: [string, number, string][];
  gear: [string, string, number, string, string][];
};

let picksPromise: Promise<Picks> | null = null;
function loadPicks(): Promise<Picks> {
  if (!picksPromise) {
    picksPromise = fetch("/pf2e/picks.json").then((r) => {
      if (!r.ok) throw new Error(`picks ${r.status}`);
      return r.json() as Promise<Picks>;
    }).catch((e) => { picksPromise = null; throw e; });
  }
  return picksPromise;
}

function usePicks(): { picks: Picks | null; failed: boolean } {
  const [picks, setPicks] = useState<Picks | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadPicks().then((p) => { if (live) setPicks(p); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  return { picks, failed };
}

const hasTrait = (traits: string, t: string) => !!t && traits.split(",").includes(t);
const MAX_SUGGEST = 150;
const btn: React.CSSProperties = { ...stoneButton("stone"), fontSize: 12.5, padding: "5px 10px", minHeight: "var(--sax-tap, 0px)" };

/** A text field with suggestions: shows the matches for what is typed, and accepts any name. */
function NameField({ label, value, onCommit, options, placeholder, live = false }: {
  label: string; value: string; onCommit: (v: string) => void;
  options: { name: string; hint: string }[]; placeholder: string;
  /** Report every keystroke (an add-row draft) instead of only on blur or Enter (a filled slot). */
  live?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const q = text.trim().toLowerCase();
  const shown = useMemo(() => (q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options).slice(0, MAX_SUGGEST), [options, q]);
  const commit = () => { const v = text.trim().slice(0, 120); if (v !== value) onCommit(v); };
  return (
    <>
      <input aria-label={label} list={id} value={text} placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); if (live) onCommit(e.target.value); }} onBlur={live ? undefined : commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        style={{ ...stoneField(), cursor: "text", flex: "1 1 220px", minWidth: 0 }} />
      <datalist id={id}>{shown.map((o) => <option key={`${o.name}|${o.hint}`} value={o.name}>{o.hint}</option>)}</datalist>
    </>
  );
}

export function Pf2eFeatsPanel({ pbuild, onChange }: { pbuild: Pf2eBuild; onChange: (b: Pf2eBuild) => void }) {
  const { picks, failed } = usePicks();
  const [anyTrait, setAnyTrait] = useState(false);
  const slots = pf2eFeatSlots(pbuild.level, pbuild.classId);
  const optionsFor = (slot: Pf2eFeatSlot) => (picks?.feats ?? [])
    .filter(([, type, lvl, traits]) => {
      if (type !== slot.type || lvl > slot.level) return false;
      if (anyTrait) return true;
      if (slot.type === "class") return hasTrait(traits, pbuild.classId) || hasTrait(traits, "archetype");
      if (slot.type === "ancestry") return hasTrait(traits, pbuild.ancestryId);
      return true;
    })
    .map(([name, , lvl, traits]) => ({ name, hint: `Level ${lvl}${traits.includes("archetype") ? " · archetype" : ""}` }));
  const setSlot = (key: string, v: string) => {
    const feats = { ...pbuild.feats };
    if (v) feats[key] = [v]; else delete feats[key];
    onChange({ ...pbuild, feats });
  };
  const known = useMemo(() => new Set((picks?.feats ?? []).map((f) => f[0])), [picks]);
  return (
    <div style={stonePanel()}>
      <div style={forgeLabel}>Feats</div>
      <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>
        One per slot, as your level grants them. Class slots list your class&apos;s feats and archetype feats;
        ancestry slots list your ancestry&apos;s. Recorded on the sheet; their effects are not applied for you.
      </p>
      {failed && <p role="alert" style={{ color: STONE.bloodLit, fontSize: 12.5 }}>The feat list did not load. You can still type feat names.</p>}
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: STONE.ink, marginBottom: 10 }}>
        <input type="checkbox" checked={anyTrait} onChange={(e) => setAnyTrait(e.target.checked)} />
        List every feat of the slot&apos;s type (other classes and ancestries too)
      </label>
      <div style={{ display: "grid", gap: 8 }}>
        {slots.map((slot) => {
          const v = pbuild.feats[slot.key]?.[0] ?? "";
          return (
            <div key={slot.key} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ ...forgeLabel, minWidth: 170, marginBottom: 0 }}>{slot.label}</span>
              <NameField label={slot.label} value={v} onCommit={(x) => setSlot(slot.key, x)} options={optionsFor(slot)} placeholder="Type to search" />
              {v && picks && !known.has(v) && <span style={{ fontSize: 11, color: STONE.inkDim }}>not in the list</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Pf2eSpellsPanel({ pbuild, onChange }: { pbuild: Pf2eBuild; onChange: (b: Pf2eBuild) => void }) {
  const { picks, failed } = usePicks();
  const maxRank = pf2eMaxSpellRank(pbuild.level);
  const list = pbuild.spells ?? [];
  const byName = useMemo(() => new Map((picks?.spells ?? []).map((s) => [s[0], s[1]])), [picks]);
  const options = useMemo(() => (picks?.spells ?? []).filter(([, r]) => r <= maxRank)
    .map(([name, r]) => ({ name, hint: r === 0 ? "Cantrip" : `Rank ${r}` })), [picks, maxRank]);
  const add = (name: string) => {
    if (!name || list.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
    const next = [...list, { name, rank: byName.get(name) ?? 1 }].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    onChange({ ...pbuild, spells: next });
  };
  const remove = (name: string) => onChange({ ...pbuild, spells: list.filter((s) => s.name !== name) });
  const setRank = (name: string, rank: number) => onChange({ ...pbuild, spells: list.map((s) => (s.name === name ? { ...s, rank } : s)) });
  const [draft, setDraft] = useState("");
  return (
    <div style={stonePanel()}>
      <div style={forgeLabel}>Spells</div>
      <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>
        Your repertoire or the spells you prepare, up to rank {maxRank} at level {pbuild.level}. Check your tradition&apos;s list in the compendium.
      </p>
      {failed && <p role="alert" style={{ color: STONE.bloodLit, fontSize: 12.5 }}>The spell list did not load. You can still type spell names.</p>}
      {list.length === 0 && <p style={{ fontSize: 13, color: STONE.inkDim, margin: "0 0 8px" }}>No spells yet.</p>}
      {list.map((s) => (
        <div key={s.name} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: `1px solid ${STONE.hi}` }}>
          <span style={{ flex: 1, fontSize: 13.5, color: STONE.ink }}>{s.name}</span>
          <select aria-label={`Rank of ${s.name}`} value={s.rank} onChange={(e) => setRank(s.name, parseInt(e.target.value, 10))} style={{ ...stoneField(), width: "auto", cursor: "pointer" }}>
            {Array.from({ length: 11 }, (_, r) => <option key={r} value={r}>{r === 0 ? "Cantrip" : `Rank ${r}`}</option>)}
          </select>
          <button type="button" className="forge-btn" onClick={() => remove(s.name)} aria-label={`Remove ${s.name}`} style={btn}>Remove</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <NameField live label="Add a spell" value={draft} onCommit={(v) => setDraft(v)} options={options} placeholder="Spell name" />
        <button type="button" className="forge-btn" disabled={!draft.trim()} title={!draft.trim() ? "Type a spell name first" : undefined}
          onClick={() => { add(draft.trim()); setDraft(""); }} style={btn}>Add spell</button>
      </div>
    </div>
  );
}

export function Pf2eGearPanel({ pbuild, onChange }: { pbuild: Pf2eBuild; onChange: (b: Pf2eBuild) => void }) {
  const { picks, failed } = usePicks();
  const list = pbuild.gear ?? [];
  const info = useMemo(() => {
    const m = new Map<string, string>();
    for (const [name, kind, lvl, price, bulk] of picks?.gear ?? []) if (!m.has(name)) m.set(name, [kind, `level ${lvl}`, price, bulk ? `Bulk ${bulk}` : ""].filter(Boolean).join(" · "));
    return m;
  }, [picks]);
  const options = useMemo(() => Array.from(info, ([name, hint]) => ({ name, hint })), [info]);
  const [draft, setDraft] = useState("");
  const add = (name: string) => {
    if (!name) return;
    const at = list.findIndex((g) => g.name === name);
    const next = at >= 0 ? list.map((g, i) => (i === at ? { ...g, qty: Math.min(9999, g.qty + 1) } : g)) : [...list, { name, qty: 1 }];
    onChange({ ...pbuild, gear: next });
  };
  const setQty = (name: string, qty: number) => onChange({ ...pbuild, gear: qty < 1 ? list.filter((g) => g.name !== name) : list.map((g) => (g.name === name ? { ...g, qty } : g)) });
  return (
    <div style={stonePanel()}>
      <div style={forgeLabel}>Gear</div>
      <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>What you carry. Armor still sets your AC through the Armor panel.</p>
      {failed && <p role="alert" style={{ color: STONE.bloodLit, fontSize: 12.5 }}>The item list did not load. You can still type item names.</p>}
      {list.length === 0 && <p style={{ fontSize: 13, color: STONE.inkDim, margin: "0 0 8px" }}>Nothing yet.</p>}
      {list.map((g) => (
        <div key={g.name} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: `1px solid ${STONE.hi}`, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 160px", fontSize: 13.5, color: STONE.ink }}>
            {g.name}
            {info.get(g.name) && <span style={{ display: "block", fontSize: 11, color: STONE.inkDim }}>{info.get(g.name)}</span>}
          </span>
          <button type="button" className="forge-btn" onClick={() => setQty(g.name, g.qty - 1)} aria-label={`One fewer ${g.name}`} style={btn}>-</button>
          <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 13, minWidth: 30, textAlign: "center", color: STONE.ink }}>x{g.qty}</span>
          <button type="button" className="forge-btn" onClick={() => setQty(g.name, Math.min(9999, g.qty + 1))} aria-label={`One more ${g.name}`} style={btn}>+</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <NameField live label="Add an item" value={draft} onCommit={(v) => setDraft(v)} options={options} placeholder="Item name" />
        <button type="button" className="forge-btn" disabled={!draft.trim()} title={!draft.trim() ? "Type an item name first" : undefined}
          onClick={() => { add(draft.trim()); setDraft(""); }} style={btn}>Add item</button>
      </div>
    </div>
  );
}
