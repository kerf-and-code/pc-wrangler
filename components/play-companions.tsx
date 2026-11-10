"use client";

// components/play-companions.tsx (2026-11-07)
//
// Phase 5g: the character sheet's Extras tab, for the creatures that travel with a character and the
// forms a character takes: a familiar, a mount, an animal companion, a summon, or a Wild Shape form.
//
//   * Add one from the monster compendium (its AC, HP, speed, abilities, traits and actions come
//     with it) or type your own. Each has its own HP tracker (damage takes temporary HP first),
//     notes, and a name you can change.
//   * An attack in its actions with a to-hit bonus and damage dice ("Melee Attack Roll: +4 ...
//     5 (1d6 + 2) Piercing damage") gets roll buttons, which roll on the server like every other
//     roll from the sheet and are logged under this character.
//   * A Wild Shape form can be taken (one at a time) and left; the tab says which form you are in.
//
// Stored in the build as `companions`, saved by the Forge's autosave like the rest of the sheet.

import React, { useMemo, useState } from "react";
import { C, STONE, FORGE_FONTS, stonePanel, stoneButton } from "@/lib/forge-theme";

export type CompanionKind = "companion" | "familiar" | "mount" | "summon" | "form";
export type Companion = {
  id: string; name: string; kind: CompanionKind;
  from?: string;                 // the monster it came from, when it came from the compendium
  ac: number; hpMax: number; hp: number; temp?: number; speed: string;
  notes?: string; active?: boolean;
};
type Entry = { name: string; desc?: string };
export type MonsterRec = {
  name: string; size?: string; type?: string; ac?: string | number; hp?: string | number; hit_dice?: string; speed?: string; cr?: string | number;
  str?: string | number; dex?: string | number; con?: string | number; int?: string | number; wis?: string | number; cha?: string | number;
  senses?: string; special_abilities?: Entry[] | null; actions?: Entry[] | null; bonus_actions?: Entry[] | null; reactions?: Entry[] | null;
};

const KINDS: [CompanionKind, string][] = [["companion", "Companion"], ["familiar", "Familiar"], ["mount", "Mount"], ["summon", "Summon"], ["form", "Wild Shape form"]];
const KIND_NAME = Object.fromEntries(KINDS) as Record<CompanionKind, string>;
const ABILS = ["str", "dex", "con", "int", "wis", "cha"] as const;
const num = (v: unknown, d = 0) => { const n = parseInt(String(v ?? ""), 10); return Number.isFinite(n) ? n : d; };
const sign = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
const newId = () => `k${Math.random().toString(36).slice(2, 9)}`;
const list = (v: unknown): Entry[] => (Array.isArray(v) ? (v as Entry[]).filter((e) => e && typeof e.name === "string") : []);

// "Melee Attack Roll: +4" (2024), "Melee Weapon Attack: +4 to hit" (2014); the first dice in brackets is the damage
export function attackOf(desc: string | undefined): { hit: number; damage: string | null } | null {
  const t = (desc ?? "").replace(/\s+/g, " ");
  const m = /(?:attack roll|weapon attack|spell attack)\s*:\s*([+-]\s*\d+)/i.exec(t) ?? /([+-]\s*\d+)\s+to hit/i.exec(t);
  if (!m) return null;
  const d = /\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)/i.exec(t);
  return { hit: parseInt(m[1].replace(/\s+/g, ""), 10), damage: d ? d[1].replace(/\s+/g, "") : null };
}

export default function PlayCompanions({ companions, onChange, monsters, characterId, ruleset }: {
  companions: Companion[]; onChange: (next: Companion[]) => void;
  monsters: MonsterRec[]; characterId: string | null; ruleset: "2014" | "2024";
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<CompanionKind>("companion");
  const [custom, setCustom] = useState<{ name: string; ac: string; hp: string; speed: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [amt, setAmt] = useState<Record<string, string>>({});
  const [out, setOut] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const box: React.CSSProperties = { ...stonePanel(), marginBottom: 0, padding: "12px 14px" };
  const btn = (on = false): React.CSSProperties => ({ ...stoneButton(on ? "primary" : "stone"), fontSize: 12.5, padding: "5px 10px", minHeight: "var(--sax-tap, 0px)" });
  const mono: React.CSSProperties = { fontFamily: FORGE_FONTS.mono };
  const tiny: React.CSSProperties = { ...mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: STONE.inkFaint };
  const field: React.CSSProperties = { padding: "6px 8px", borderRadius: 4, border: `1px solid ${STONE.hi}`, background: "rgba(0,0,0,0.25)", color: STONE.ink, fontSize: 13 };

  const byName = useMemo(() => {
    const m = new Map<string, MonsterRec>();
    for (const r of monsters) if (r?.name && !m.has(r.name)) m.set(r.name, r);
    return m;
  }, [monsters]);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const all = [...byName.values()];
    const starts = all.filter((r) => r.name.toLowerCase().startsWith(s));
    const has = all.filter((r) => !r.name.toLowerCase().startsWith(s) && r.name.toLowerCase().includes(s));
    return [...starts, ...has].slice(0, 12);
  }, [q, byName]);

  const set = (id: string, fn: (c: Companion) => Companion) => onChange(companions.map((c) => (c.id === id ? fn({ ...c }) : c)));
  const addFrom = (r: MonsterRec) => {
    const hp = num(r.hp, 1);
    onChange([...companions, { id: newId(), name: r.name, kind, from: r.name, ac: num(r.ac, 10), hpMax: hp, hp, speed: r.speed || "", notes: "" }]);
    setQ(""); setOut({ text: `${r.name} added as a ${KIND_NAME[kind].toLowerCase()}.`, bad: false });
  };
  const addCustom = () => {
    if (!custom?.name.trim()) return;
    const hp = Math.max(1, num(custom.hp, 1));
    onChange([...companions, { id: newId(), name: custom.name.trim().slice(0, 60), kind, ac: num(custom.ac, 10), hpMax: hp, hp, speed: custom.speed.trim().slice(0, 80), notes: "" }]);
    setOut({ text: `${custom.name.trim()} added.`, bad: false }); setCustom(null);
  };
  const damage = (c: Companion, n: number) => set(c.id, (x) => { const t = Math.min(x.temp ?? 0, n); return { ...x, temp: (x.temp ?? 0) - t, hp: Math.max(0, x.hp - (n - t)) }; });
  const heal = (c: Companion, n: number) => set(c.id, (x) => ({ ...x, hp: Math.min(x.hpMax, x.hp + n) }));
  const takeForm = (c: Companion) => onChange(companions.map((x) => (x.kind === "form" ? { ...x, active: x.id === c.id ? !c.active : false } : x)));
  const roll = async (label: string, notation: string, kindOf: string) => {
    setBusy(true); setOut(null);
    try {
      const res = await fetch("/api/rolls/player", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterId, notation, kind: kindOf, label }) });
      const j = await res.json().catch(() => ({})) as { error?: string; result?: { total: number; natural: number | null } };
      if (!res.ok || !j.result) { setOut({ text: j.error ?? "Could not roll.", bad: true }); return; }
      setOut({ text: `${label}: ${j.result.total}${j.result.natural === 20 ? " (natural 20)" : j.result.natural === 1 ? " (natural 1)" : ""}.`, bad: false });
    } finally { setBusy(false); }
  };

  const activeForm = companions.find((c) => c.kind === "form" && c.active) ?? null;

  return (
    <section aria-label="Companions and forms" style={{ display: "grid", gap: 12, marginBottom: 14 }}>
      <div style={box}>
        <div style={tiny}>Companions and forms</div>
        {activeForm && (
          <div role="status" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8, padding: "8px 10px", border: `1px solid ${C.sun}`, borderRadius: 6 }}>
            <span style={{ fontSize: 13.5, color: STONE.ink }}>In Wild Shape: <b>{activeForm.name}</b>, {activeForm.hp} / {activeForm.hpMax} HP, AC {activeForm.ac}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="forge-btn" onClick={() => takeForm(activeForm)} style={btn()}>Leave the form</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <label htmlFor="comp-search" style={{ fontSize: 12.5, color: STONE.ink }}>Add</label>
          <select aria-label="What it is" value={kind} onChange={(e) => setKind(e.target.value as CompanionKind)} style={{ ...field, width: "auto" }}>
            {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input id="comp-search" value={q} onChange={(e) => setQ(e.target.value.slice(0, 60))} placeholder="Search creatures (owl, wolf, riding horse…)" style={{ ...field, flex: "1 1 220px" }} />
          <button type="button" className="forge-btn" aria-expanded={!!custom} onClick={() => setCustom(custom ? null : { name: q.trim(), ac: "", hp: "", speed: "" })} style={btn(!!custom)}>Your own</button>
        </div>
        {results.length > 0 && (
          <ul aria-label="Creature matches" style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
            {results.map((r) => (
              <li key={r.name} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: `1px solid ${STONE.hi}` }}>
                <span style={{ flex: 1, fontSize: 13.5, color: STONE.ink }}>{r.name}
                  <span style={{ fontSize: 11.5, color: STONE.inkFaint }}> · {[r.size, r.type].filter(Boolean).join(" ")}{r.cr != null ? ` · CR ${r.cr}` : ""} · AC {String(r.ac ?? "?")} · {String(r.hp ?? "?")} HP</span>
                </span>
                <button type="button" className="forge-btn" onClick={() => addFrom(r)} aria-label={`Add ${r.name}`} style={btn()}>Add</button>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && results.length === 0 && <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: "8px 0 0" }}>No creature by that name. Add it as your own.</p>}
        {custom && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <input aria-label="Name" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value.slice(0, 60) })} placeholder="Name" style={{ ...field, flex: "1 1 140px" }} />
            <input aria-label="Armor class" value={custom.ac} inputMode="numeric" onChange={(e) => setCustom({ ...custom, ac: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="AC" style={{ ...field, width: 54 }} />
            <input aria-label="Hit points" value={custom.hp} inputMode="numeric" onChange={(e) => setCustom({ ...custom, hp: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="HP" style={{ ...field, width: 60 }} />
            <input aria-label="Speed" value={custom.speed} onChange={(e) => setCustom({ ...custom, speed: e.target.value.slice(0, 80) })} placeholder="Speed (30 ft., fly 60 ft.)" style={{ ...field, flex: "1 1 160px" }} />
            <button type="button" className="forge-btn" disabled={!custom.name.trim()} title={custom.name.trim() ? undefined : "Give it a name first"} onClick={addCustom} style={btn(true)}>Add it</button>
          </div>
        )}
        {out && <p role={out.bad ? "alert" : "status"} style={{ fontSize: 12.5, color: out.bad ? C.warn : C.plum, margin: "8px 0 0" }}>{out.text}</p>}
        {companions.length === 0 && <p style={{ fontSize: 13, color: STONE.inkFaint, margin: "10px 0 0" }}>No companions or forms yet. A familiar, a mount, an animal companion or a Wild Shape form goes here.</p>}
      </div>

      {companions.map((c) => {
        const rec = c.from ? byName.get(c.from) : undefined;
        const n = parseInt(amt[c.id] ?? "", 10);
        const isOpen = open === c.id;
        const frac = c.hpMax ? Math.max(0, Math.min(1, c.hp / c.hpMax)) : 0;
        const attacks = list(rec?.actions).map((a) => ({ a, at: attackOf(a.desc) })).filter((x) => x.at);
        return (
          <div key={c.id} style={{ ...box, outline: c.active ? `1px solid ${C.sun}` : "none" }} role="group" aria-label={c.name}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: STONE.ink, fontFamily: FORGE_FONTS.display, fontSize: 18 }}>{c.name}</button>
              <span style={{ fontSize: 11.5, color: STONE.inkFaint }}>{KIND_NAME[c.kind]}{c.from && c.from !== c.name ? ` · ${c.from}` : ""}{c.active ? " · your current form" : ""}</span>
              <span style={{ flex: 1 }} />
              <span style={{ ...mono, fontSize: 13, color: STONE.ink }}>AC {c.ac}</span>
              <span style={{ fontSize: 12.5, color: STONE.inkFaint }}>{c.speed}</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <span style={{ ...mono, fontSize: 20, fontWeight: 700, color: c.hp === 0 ? C.warn : STONE.ink }}>{c.hp}<span style={{ fontSize: 13, color: STONE.inkFaint }}> / {c.hpMax}</span>{c.temp ? <span style={{ fontSize: 13, color: "#6fa3d8" }}> +{c.temp} temp</span> : null}</span>
              <div style={{ flex: "1 1 80px", height: 6, background: "rgba(0,0,0,0.35)", borderRadius: 3 }}>
                <div style={{ width: `${frac * 100}%`, height: 6, borderRadius: 3, background: frac > 0.5 ? "#5fae5a" : frac > 0.25 ? "#d9a43a" : "#d0463c" }} />
              </div>
              <input aria-label={`Amount for ${c.name}`} value={amt[c.id] ?? ""} inputMode="numeric" placeholder="amount"
                onChange={(e) => setAmt({ ...amt, [c.id]: e.target.value.replace(/\D/g, "").slice(0, 4) })} style={{ ...field, width: 70 }} />
              <button type="button" className="forge-btn" disabled={!(n > 0) || c.hp >= c.hpMax} onClick={() => { heal(c, n); setAmt({ ...amt, [c.id]: "" }); }} aria-label={`Heal ${c.name}`} style={{ ...btn(), color: C.good }}>Heal</button>
              <button type="button" className="forge-btn" disabled={!(n > 0)} onClick={() => { damage(c, n); setAmt({ ...amt, [c.id]: "" }); }} aria-label={`Damage ${c.name}`} style={{ ...btn(), color: C.warn }}>Damage</button>
              <button type="button" className="forge-btn" disabled={!(n >= 0) || amt[c.id] === undefined || amt[c.id] === ""} onClick={() => { set(c.id, (x) => ({ ...x, temp: n })); setAmt({ ...amt, [c.id]: "" }); }} aria-label={`Set temporary HP for ${c.name}`} style={{ ...btn(), color: "#6fa3d8" }}>Set temp</button>
              {c.kind === "form" && <button type="button" className="forge-btn" aria-pressed={!!c.active} onClick={() => takeForm(c)} style={btn(!!c.active)}>{c.active ? "Leave the form" : "Take this form"}</button>}
            </div>
            {c.kind === "form" && ruleset === "2024" && <p style={{ fontSize: 11.5, color: STONE.inkFaint, margin: "6px 0 0" }}>2024 rules: in Wild Shape you keep your own HP and gain temporary HP equal to your Druid level; this tracker is for the form&apos;s own numbers if your table uses them.</p>}
            {attacks.length > 0 && (
              <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                {attacks.map(({ a, at }) => (
                  <div key={a.name} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: STONE.ink, minWidth: 90 }}>{a.name}</span>
                    <button type="button" className="forge-btn" disabled={busy} onClick={() => void roll(`${c.name}: ${a.name}`, `1d20${sign(at!.hit)}`, "attack")} aria-label={`Roll ${c.name} ${a.name} to hit`} style={btn()}>{sign(at!.hit)} to hit</button>
                    {at!.damage && <button type="button" className="forge-btn" disabled={busy} onClick={() => void roll(`${c.name}: ${a.name} damage`, at!.damage!, "damage")} aria-label={`Roll ${c.name} ${a.name} damage`} style={btn()}>{at!.damage} damage</button>}
                  </div>
                ))}
              </div>
            )}
            {isOpen && (
              <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(0,0,0,0.22)", borderRadius: 4, display: "grid", gap: 8 }}>
                {rec && (
                  <>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {ABILS.map((k) => { const v = num(rec[k], 10); return <span key={k} style={{ ...mono, fontSize: 12, color: STONE.ink }}>{k.toUpperCase()} {v} ({sign(Math.floor((v - 10) / 2))})</span>; })}
                    </div>
                    {rec.senses && <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: 0 }}>Senses: {rec.senses}</p>}
                    {[["Traits", rec.special_abilities], ["Actions", rec.actions], ["Bonus actions", rec.bonus_actions], ["Reactions", rec.reactions]].map(([label, v]) => list(v).length > 0 && (
                      <div key={String(label)}>
                        <div style={tiny}>{String(label)}</div>
                        {list(v).map((e) => <p key={e.name} style={{ fontSize: 13, color: STONE.ink, margin: "2px 0 4px", lineHeight: 1.5 }}><b>{e.name}.</b> {e.desc}</p>)}
                      </div>
                    ))}
                  </>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <label style={{ fontSize: 12.5, color: STONE.ink, display: "flex", gap: 6, alignItems: "center" }}>Name
                    <input key={`nm-${c.id}-${c.name}`} defaultValue={c.name} onBlur={(e) => { const v = e.target.value.trim().slice(0, 60); if (v && v !== c.name) set(c.id, (x) => ({ ...x, name: v })); }} style={{ ...field, width: 150 }} />
                  </label>
                  <label style={{ fontSize: 12.5, color: STONE.ink, display: "flex", gap: 6, alignItems: "center" }}>AC
                    <input key={`ac-${c.id}-${c.ac}`} defaultValue={c.ac} inputMode="numeric" onBlur={(e) => { const v = num(e.target.value, c.ac); set(c.id, (x) => ({ ...x, ac: Math.max(0, Math.min(40, v)) })); }} style={{ ...field, width: 50 }} />
                  </label>
                  <label style={{ fontSize: 12.5, color: STONE.ink, display: "flex", gap: 6, alignItems: "center" }}>Max HP
                    <input key={`hm-${c.id}-${c.hpMax}`} defaultValue={c.hpMax} inputMode="numeric" onBlur={(e) => { const v = Math.max(1, num(e.target.value, c.hpMax)); set(c.id, (x) => ({ ...x, hpMax: v, hp: Math.min(x.hp, v) })); }} style={{ ...field, width: 60 }} />
                  </label>
                  <button type="button" className="forge-btn" onClick={() => onChange(companions.filter((x) => x.id !== c.id))} aria-label={`Remove ${c.name}`} style={btn()}>Remove</button>
                </div>
                <label style={{ display: "grid", gap: 3, fontSize: 11.5, color: STONE.inkFaint }}>Notes
                  <textarea key={`no-${c.id}`} rows={2} defaultValue={c.notes ?? ""} onBlur={(e) => { const v = e.target.value.slice(0, 2000); if (v !== (c.notes ?? "")) set(c.id, (x) => ({ ...x, notes: v })); }} style={{ ...field, resize: "vertical", fontFamily: FORGE_FONTS.body }} />
                </label>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
