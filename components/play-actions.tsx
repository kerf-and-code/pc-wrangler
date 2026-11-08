"use client";

// components/play-actions.tsx (2026-11-07)
//
// Phase 5b: the actions and spells half of the play sheet.
//
// ACTIONS, filtered by All, Attack, Action, Bonus action, Reaction, Other and Limited use:
//   * attack rows from the character's weapons and an unarmed strike (lib/play/attacks.ts), and from
//     spells that attack or deal damage (cantrips included);
//   * the standard actions, the opportunity attack, reaction and bonus action spells;
//   * the limited-use pools (Rages, Channel Divinity, Focus Points...) with the features that spend
//     them, shared with the Forge's resource tracker (lib/play/tracks.ts).
// SPELLS: casting ability, spell attack and save DC; search; levels with their slots; each spell with
// casting time, range, hit or DC, effect, concentration, ritual, duration and components. Cast picks a
// slot (a higher one recomputes the dice: lib/play/spells.ts) and spends it.
//
// ROLLS. In a running fight, with a target picked, an attack rolls against the target's AC on the
// server and the damage lands on a hit; a save spell leaves a pending save on each target picked
// (phase 4a/4b), and each spends the right part of the turn (4c). Outside a fight the same rolls go
// to /api/rolls/player and are recorded for the session. A spell with several attacks (beams, rays)
// spends its action on the first; each further one is a follow-up (p115).

import React, { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, STONE, FORGE_FONTS, stonePanel, stoneButton, forgeLabel } from "@/lib/forge-theme";
import { applyAdvantage } from "@/lib/dice";
import { critDice, STANDARD_ACTIONS } from "@/lib/combat-effects";
import { combatAct, type FightEntry, type FightView } from "@/components/fight-controls";
import { remaining, type Resource } from "@/lib/resources";
import type { AttackRow } from "@/lib/play/attacks";
import { readSpell, spellCost, upcasts, ORD, type SpellRecord, type SpellCost } from "@/lib/play/spells";
import { slotsLeft, slotFor } from "@/lib/play/tracks";
import type { DerivedSheet } from "@/lib/srd/derive-sheet";

export type KnownSpell = { rec: SpellRecord; always?: string | null };
type Filter = "all" | "attack" | "action" | "bonus" | "reaction" | "other" | "limited";
type Cost = "attack" | "action" | "bonus" | "reaction" | "followup";
type RollOut = { total: number; natural: number | null; notation: string; logged: boolean; hit?: boolean | null; crit?: boolean; target?: string; defeated?: boolean; error?: string };

const ABIL_NAME: Record<string, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
const sign = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
const costLabel: Record<SpellCost, string> = { action: "Action", bonus: "Bonus action", reaction: "Reaction", other: "Other" };

export default function PlayActions({ sheet, charLevel, characterId, campaignId, fight, attacks, spells, pools, slots, pactLevel, spent, onSpend, costed, onHealSelf, onFightChanged }: {
  sheet: DerivedSheet; charLevel: number; characterId: string | null; campaignId: string | null;
  fight: { view: FightView; me: FightEntry } | null;
  attacks: AttackRow[]; spells: KnownSpell[]; pools: Resource[]; slots: Resource[]; pactLevel: number | null;
  spent: Record<string, number>; onSpend: (key: string, n: number) => void;
  costed: { name: string; summary: string; resource: string; amount: number }[];
  onHealSelf: (n: number) => void; onFightChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [filter, setFilter] = useState<Filter>("all");
  const [adv, setAdv] = useState<"flat" | "adv" | "dis">("flat");
  const [target, setTarget] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ text: string; bad: boolean; heal?: number } | null>(null);
  const [q, setQ] = useState("");
  const [lvl, setLvl] = useState<number | "all">("all");
  const [casting, setCasting] = useState<{ name: string; slot: string; left: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const inFight = !!fight && !!campaignId && !!characterId;
  const targets = inFight ? fight!.view.order.filter((e) => e.id !== fight!.me.id && !e.defeated) : [];
  const tgt = targets.find((e) => e.id === target) ?? null;
  const castMod = sheet.castAbil ? sheet.mods[sheet.castAbil] : 0;
  const sl = slotsLeft(slots, spent);
  const pact = pools.find((p) => p.key === "Spell Slots") ?? null;

  // ---- rolling ----
  const tabletop = async (body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; message?: { roll?: { total?: number; natural?: number | null; notation?: string } }; against?: { target: string; hit: boolean | null; crit: boolean; defeated?: boolean; attacksLeft?: number } | null; saveNote?: { targets: string[] } }> => {
    const res = await fetch("/api/tabletop/roll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, characterId, ...body }) });
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok, ...j };
  };
  const plain = async (label: string, notation: string, kind: string): Promise<RollOut | null> => {
    const res = await fetch("/api/rolls/player", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterId, notation, kind, label }) });
    const j = await res.json().catch(() => ({})) as { error?: string; logged?: boolean; result?: { total: number; natural: number | null; notation: string } };
    if (!res.ok || !j.result) { setOut({ text: j.error ?? "Could not roll.", bad: true }); return null; }
    return { ...j.result, logged: !!j.logged };
  };

  // an attack roll and, on a hit, its damage
  const attack = async (label: string, toHit: number, damage: string | null, cost: Cost, dmgType: string) => {
    setBusy(true); setOut(null);
    try {
      const d20 = applyAdvantage(`1d20${toHit >= 0 ? "+" : ""}${toHit}`, adv);
      if (inFight && tgt) {
        const a = await tabletop({ notation: d20, label, target: tgt.id, rollFor: "attack", cost });
        if (!a.ok) { setOut({ text: a.error ?? "Could not roll.", bad: true }); return; }
        const total = a.message?.roll?.total, ag = a.against;
        const left = cost === "attack" && ag?.attacksLeft ? ` ${ag.attacksLeft} attack${ag.attacksLeft === 1 ? "" : "s"} left this action.` : "";
        if (!ag || ag.hit === null) { setOut({ text: `${label}: ${total ?? "?"} against ${tgt.name}. The GM decides (no AC set).${left}`, bad: false }); return; }
        if (!ag.hit) { setOut({ text: `${label}: ${total ?? "?"}, a miss against ${ag.target}.${left}`, bad: false }); return; }
        if (!damage) { setOut({ text: `${label}: ${total ?? "?"}, ${ag.crit ? "a critical hit" : "a hit"} on ${ag.target}.${left}`, bad: false }); return; }
        const d = await tabletop({ notation: damage, label: `${label} damage`, target: tgt.id, rollFor: "damage" });
        if (!d.ok) { setOut({ text: `${label}: a hit, but the damage did not land: ${d.error ?? "unknown error"}`, bad: true }); return; }
        setOut({ text: `${label}: ${total ?? "?"}, ${ag.crit ? "a critical hit" : "a hit"} on ${ag.target} for ${d.message?.roll?.total ?? "?"} ${dmgType.toLowerCase()} damage${ag.crit ? " (dice doubled)" : ""}${d.against?.defeated ? `. ${ag.target} goes down.` : "."}${left}`, bad: false });
        onFightChanged();
        return;
      }
      const a = await plain(label, d20, "attack");
      if (!a) return;
      if (!damage) { setOut({ text: `${label}: ${a.total}${a.natural === 20 ? " (natural 20)" : a.natural === 1 ? " (natural 1)" : ""}.`, bad: false }); return; }
      const d = await plain(`${label} damage`, a.natural === 20 ? critDice(damage) : damage, "damage");
      setOut({ text: `${label}: ${a.total} to hit${a.natural === 20 ? ", a critical (dice doubled)" : a.natural === 1 ? ", a natural 1" : ""}; ${d ? d.total : "?"} ${dmgType.toLowerCase()} damage if it hits.${inFight ? " Pick a target to roll against it." : ""}`, bad: false });
    } finally { setBusy(false); }
  };

  // spend part of the turn for something with no roll (a standard action, a feature)
  const spendTurn = async (cost: "action" | "bonus" | "reaction", what: string) => {
    if (!inFight) { setOut({ text: `${what}: noted.`, bad: false }); return; }
    const e = await combatAct(supabase as never, fight!.view.id, fight!.me.id, "spend", { condition: cost, note: what });
    setOut(e ? { text: e, bad: true } : { text: `${what}: your ${cost === "bonus" ? "bonus action" : cost} is spent.`, bad: false });
    if (!e) onFightChanged();
  };

  // ---- spells ----
  const known = useMemo(() => [...spells].sort((a, b) => a.rec.level - b.rec.level || a.rec.name.localeCompare(b.rec.name)), [spells]);
  const levels = [...new Set(known.map((s) => s.rec.level))].sort((a, b) => a - b);
  const shown = known.filter((s) => (lvl === "all" || s.rec.level === lvl) && (!q.trim() || s.rec.name.toLowerCase().includes(q.trim().toLowerCase())));
  // the slots a spell can use: every level from its own up with a slot left, and a pact slot
  const slotChoices = (sp: SpellRecord) => {
    const c = sl.filter((s) => s.level >= sp.level && s.left > 0).map((s) => ({ key: s.key, level: s.level, label: `${ORD[s.level]} level (${s.left} left)` }));
    if (pact && pactLevel && pactLevel >= sp.level && remaining(pact, spent) > 0) c.push({ key: pact.key, level: pactLevel, label: `Pact slot, ${ORD[pactLevel]} (${remaining(pact, spent)} left)` });
    return c;
  };
  const cast = async (sp: SpellRecord, slotKey: string | null, slotLevel: number) => {
    const r = readSpell(sp, { slot: slotLevel, charLevel, castMod });
    const cost0 = spellCost(sp.casting_time);
    const cost: Cost = cost0 === "other" ? "action" : cost0;
    const label = sp.level > 0 && slotLevel > sp.level ? `${sp.name} (${ORD[slotLevel]} level)` : sp.name;
    setBusy(true); setOut(null);
    try {
      // a save spell in a fight: one damage roll, waiting on every target picked
      if (r.save && !r.attack && inFight) {
        if (!picked.length) { setOut({ text: "Pick the targets first.", bad: true }); return; }
        if (!r.damage) { setOut({ text: `${label}: each target makes a ${ABIL_NAME[r.save]} save against DC ${sheet.spellDC}. No damage to roll; mark the effect on them from the fight card.`, bad: false }); }
        else {
          const res = await tabletop({ notation: r.damage, label, saveAgainst: { targets: picked, ability: r.save, dc: sheet.spellDC, half: r.half, type: r.damageType ?? "" }, cost });
          if (!res.ok) { setOut({ text: res.error ?? "Could not cast.", bad: true }); return; }
          setOut({ text: `${label}: ${res.message?.roll?.total ?? "?"} ${(r.damageType ?? "").toLowerCase()} damage waits on ${res.saveNote?.targets.join(", ") || "the targets"}; each makes a ${ABIL_NAME[r.save]} save, DC ${sheet.spellDC}${r.half ? ", half on a success" : ""}.`, bad: false });
          onFightChanged();
        }
      } else if (r.attack) {
        await attack(r.count > 1 ? `${sp.name} (${r.unit} 1 of ${r.count})` : label, sheet.spellAttack, r.damage, cost, r.damageType ?? "");
        if (r.count > 1) setCasting({ name: sp.name, slot: String(slotLevel), left: r.count - 1 });
      } else if (r.healing) {
        const h = await plain(`${label} healing`, r.healing, "healing");
        if (h) setOut({ text: `${label}: ${h.total} HP of healing.`, bad: false, heal: h.total });
        if (inFight && cost !== "action") await spendTurn(cost, sp.name);
        else if (inFight) await spendTurn("action", sp.name);
      } else if (r.damage) {
        const d = await plain(`${label} damage`, r.damage, "damage");
        if (d) setOut({ text: `${label}: ${d.total} ${(r.damageType ?? "").toLowerCase()} damage${r.count > 1 ? ` (${r.count} ${r.unit}s, ${r.damage} each: roll the rest separately)` : ""}${r.save ? `; ${ABIL_NAME[r.save]} save DC ${sheet.spellDC}${r.half ? ", half on a success" : ""}` : ""}.`, bad: false });
        if (inFight) await spendTurn(cost, sp.name);
      } else {
        setOut({ text: `${label} cast${r.save ? `: ${ABIL_NAME[r.save]} save DC ${sheet.spellDC}` : ""}.`, bad: false });
        if (inFight) await spendTurn(cost, sp.name);
      }
      // the slot, and concentration in the fight
      if (slotKey) onSpend(slotKey, (spent[slotKey] || 0) + 1);
      if (sp.concentration && inFight && !(fight!.me.conditions ?? []).includes("Concentrating")) {
        await combatAct(supabase as never, fight!.view.id, fight!.me.id, "add_condition", { condition: "Concentrating" });
        onFightChanged();
      }
      if (r.count <= 1) setCasting(null);
    } finally { setBusy(false); }
  };

  // ---- rows for the Actions list ----
  type Row = { key: string; kind: Filter; name: string; range: string; hit: string; effect: string; note?: string; run?: () => void; runLabel?: string };
  const rows: Row[] = [];
  for (const a of attacks) {
    rows.push({ key: a.key, kind: "attack", name: a.name, range: a.range, hit: sign(a.toHit), effect: `${a.damage} ${a.damageType.toLowerCase()}${a.versatile ? `, ${a.versatile} two-handed` : ""}`,
      note: [a.properties.join(", "), a.mastery ? `mastery: ${a.mastery}` : "", a.proficient ? "" : "not proficient", a.assumed ? "proficiency assumed" : ""].filter(Boolean).join(" · "),
      run: () => void attack(a.name, a.toHit, a.damage, "attack", a.damageType), runLabel: "Attack" });
  }
  for (const s of known) {
    const r = readSpell(s.rec, { slot: s.rec.level, charLevel, castMod });
    const c = spellCost(s.rec.casting_time);
    if (!(r.attack || (r.damage && r.save))) {
      if (c === "bonus" || c === "reaction") rows.push({ key: `sp-${s.rec.name}`, kind: c, name: s.rec.name, range: s.rec.range ?? "", hit: r.save ? `DC ${sheet.spellDC} ${ABIL_NAME[r.save]}` : "", effect: r.healing ? `${r.healing} healing` : r.damage ?? (s.rec.duration ?? ""), note: `${ORD[s.rec.level]}${s.rec.level ? " level" : ""} spell`, run: () => { setFilter("all"); setLvl(s.rec.level); setQ(s.rec.name); }, runLabel: "Find in spells" });
      continue;
    }
    rows.push({ key: `sp-${s.rec.name}`, kind: c === "bonus" || c === "reaction" ? c : "attack", name: s.rec.name, range: s.rec.range ?? "",
      hit: r.attack ? sign(sheet.spellAttack) : `DC ${sheet.spellDC} ${ABIL_NAME[r.save!]}`, effect: `${r.damage ?? ""} ${(r.damageType ?? "").toLowerCase()}${r.count > 1 ? ` x${r.count} ${r.unit}s` : ""}`.trim(),
      note: `${s.rec.level ? `${ORD[s.rec.level]} level spell` : "cantrip"} · ${costLabel[c]}`,
      run: () => { if (s.rec.level === 0) void cast(s.rec, null, 0); else { setLvl(s.rec.level); setQ(s.rec.name); setOpen(s.rec.name); } }, runLabel: s.rec.level === 0 ? "Cast" : "Cast…" });
  }
  for (const a of STANDARD_ACTIONS) rows.push({ key: `std-${a.name}`, kind: "action", name: a.name, range: "", hit: "", effect: a.tip, run: () => void spendTurn("action", a.name), runLabel: inFight ? "Use" : undefined });
  const melee = attacks.find((a) => a.melee && a.source === "weapon") ?? attacks.find((a) => a.melee);
  if (melee) rows.push({ key: "opportunity", kind: "reaction", name: `Opportunity attack (${melee.name})`, range: melee.range, hit: sign(melee.toHit), effect: `${melee.damage} ${melee.damageType.toLowerCase()}`, note: "when a creature you can see leaves your reach", run: () => void attack(`Opportunity attack, ${melee.name}`, melee.toHit, melee.damage, "reaction", melee.damageType), runLabel: "Attack" });
  const show = (k: Filter) => filter === "all" || filter === k;

  const box: React.CSSProperties = { ...stonePanel(), marginBottom: 0, padding: "12px 14px" };
  const btn = (on = false): React.CSSProperties => ({ ...stoneButton(on ? "primary" : "stone"), fontSize: 12.5, padding: "5px 10px" });
  const mono: React.CSSProperties = { fontFamily: FORGE_FONTS.mono };
  const tiny: React.CSSProperties = { ...mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: STONE.inkFaint };
  const field: React.CSSProperties = { padding: "6px 8px", borderRadius: 4, border: `1px solid ${STONE.hi}`, background: "rgba(0,0,0,0.25)", color: STONE.ink, fontSize: 13 };
  const rowLine = (r: Row) => (
    <div key={r.key} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1.4fr) 90px 80px minmax(120px, 1.6fr) auto", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${STONE.hi}` }}>
      <div><div style={{ color: STONE.ink, fontSize: 13.5 }}>{r.name}</div>{r.note && <div style={{ fontSize: 11, color: STONE.inkFaint }}>{r.note}</div>}</div>
      <div style={{ fontSize: 12, color: STONE.inkFaint }}>{r.range}</div>
      <div style={{ ...mono, fontSize: 13, color: C.plum }}>{r.hit}</div>
      <div style={{ fontSize: 12.5, color: STONE.ink }}>{r.effect}</div>
      <div>{r.run && r.runLabel && <button type="button" className="forge-btn" disabled={busy} onClick={r.run} aria-label={`${r.runLabel.replace("…", "")} ${r.name}`} style={btn()}>{r.runLabel}</button>}</div>
    </div>
  );
  const section = (k: Filter, title: string, list: Row[]) => (show(k) && list.length > 0 ? (
    <div key={k} style={{ marginTop: 10 }}><div style={tiny}>{title}</div>{list.map(rowLine)}</div>
  ) : null);

  return (
    <section aria-label="Actions and spells" style={{ display: "grid", gap: 12, marginBottom: 14 }}>
      <div style={box}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ ...forgeLabel, margin: 0 }}>Actions</label>
          <span style={{ ...mono, fontSize: 11.5, color: STONE.inkFaint }}>{sheet.martialArts ? `martial arts d${sheet.martialArts} · ` : ""}{sheet.sneakDice ? `sneak attack ${sheet.sneakDice}d6 · ` : ""}</span>
          <span style={{ flex: 1 }} />
          <span role="group" aria-label="Roll with" style={{ display: "flex", gap: 4 }}>
            {(["dis", "flat", "adv"] as const).map((m) => <button key={m} type="button" className="forge-btn" aria-pressed={adv === m} onClick={() => setAdv(m)} style={btn(adv === m)}>{m === "adv" ? "Advantage" : m === "dis" ? "Disadvantage" : "Straight"}</button>)}
          </span>
        </div>
        {inFight ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <span style={{ fontSize: 12.5, color: STONE.ink }}>Target</span>
            <select aria-label="Who you attack" value={target} onChange={(e) => setTarget(e.target.value)} style={field}>
              <option value="">no target: just roll</option>
              {targets.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <span style={{ fontSize: 11.5, color: STONE.inkFaint }}>With a target, the AC is checked and the damage lands on a hit.</span>
          </div>
        ) : <p style={{ fontSize: 12, color: STONE.inkFaint, margin: "8px 0 0" }}>No fight running: rolls are recorded to the session, with nothing to land on.</p>}
        <div role="group" aria-label="Show" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 10 }}>
          {([["all", "All"], ["attack", "Attack"], ["action", "Action"], ["bonus", "Bonus action"], ["reaction", "Reaction"], ["other", "Other"], ["limited", "Limited use"]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} type="button" className="forge-btn" aria-pressed={filter === k} onClick={() => setFilter(k)} style={btn(filter === k)}>{l}</button>
          ))}
        </div>
        {section("attack", `Attacks${sheet.totalLevel >= 5 ? "" : ""}`, rows.filter((r) => r.kind === "attack"))}
        {section("action", "Actions anyone can take", rows.filter((r) => r.kind === "action"))}
        {section("bonus", "Bonus actions", rows.filter((r) => r.kind === "bonus"))}
        {section("reaction", "Reactions", rows.filter((r) => r.kind === "reaction"))}
        {show("other") && filter === "other" && <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: "10px 0 0" }}>Nothing else yet. Features that are not actions arrive with the features page (phase 5c).</p>}
        {show("limited") && (pools.length > 0 || costed.length > 0) && (
          <div style={{ marginTop: 10 }}>
            <div style={tiny}>Limited use</div>
            {pools.map((p) => {
              const left = remaining(p, spent);
              return (
                <div key={p.key} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${STONE.hi}`, flexWrap: "wrap" }}>
                  <span style={{ color: STONE.ink, fontSize: 13.5, minWidth: 150 }}>{p.label}</span>
                  <span style={{ ...mono, fontSize: 12.5, color: left ? C.sun : C.warn }}>{left} / {p.max}</span>
                  <span style={{ fontSize: 11.5, color: STONE.inkFaint }}>{p.shortRest === "all" ? "back on a short rest" : p.shortRest === "one" ? "one back on a short rest" : "back on a long rest"}</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="forge-btn" disabled={left === 0} onClick={() => onSpend(p.key, (spent[p.key] || 0) + 1)} style={btn()}>Use one</button>
                  <button type="button" className="forge-btn" disabled={!(spent[p.key] > 0)} onClick={() => onSpend(p.key, (spent[p.key] || 0) - 1)} style={btn()}>Give one back</button>
                </div>
              );
            })}
            {costed.filter((c) => pools.some((p) => p.key === c.resource)).map((c) => {
              const pool = pools.find((p) => p.key === c.resource)!, left = remaining(pool, spent);
              return (
                <div key={`c-${c.name}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${STONE.hi}` }}>
                  <div style={{ flex: 1 }}><div style={{ color: STONE.ink, fontSize: 13.5 }}>{c.name}</div><div style={{ fontSize: 11.5, color: STONE.inkFaint }}>{c.summary}</div></div>
                  <button type="button" className="forge-btn" disabled={left < c.amount} title={left < c.amount ? `Needs ${c.amount} ${c.resource}, you have ${left}` : undefined}
                    onClick={() => { onSpend(c.resource, (spent[c.resource] || 0) + c.amount); setOut({ text: `${c.name}: ${c.amount} ${c.resource} spent.`, bad: false }); }} style={btn()}>Use ({c.amount} {c.resource})</button>
                </div>
              );
            })}
          </div>
        )}
        {out && (
          <p role={out.bad ? "alert" : "status"} style={{ fontSize: 13, color: out.bad ? C.warn : STONE.ink, margin: "10px 0 0" }}>
            {out.text}
            {out.heal ? <> <button type="button" className="forge-btn" onClick={() => { onHealSelf(out.heal!); setOut({ text: `You regain ${out.heal} HP.`, bad: false }); }} style={{ ...btn(), marginLeft: 6 }}>Heal myself with it</button></> : null}
          </p>
        )}
      </div>

      {known.length > 0 && (
        <div style={box} role="region" aria-label="Spells">
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <label style={{ ...forgeLabel, margin: 0 }}>Spells</label>
            {sheet.isCaster && <span style={{ ...mono, fontSize: 12.5, color: STONE.inkFaint }}>{(sheet.castAbil ?? "").toUpperCase()} {sign(castMod)} · attack {sign(sheet.spellAttack)} · save DC {sheet.spellDC}</span>}
            <span style={{ flex: 1 }} />
            <input aria-label="Find a spell" value={q} onChange={(e) => setQ(e.target.value.slice(0, 40))} placeholder="Find a spell…" style={{ ...field, width: 180 }} />
          </div>
          <div role="group" aria-label="Spell level" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 10 }}>
            <button type="button" className="forge-btn" aria-pressed={lvl === "all"} onClick={() => setLvl("all")} style={btn(lvl === "all")}>All</button>
            {levels.map((l) => {
              const s = sl.find((x) => x.level === l);
              return <button key={l} type="button" className="forge-btn" aria-pressed={lvl === l} onClick={() => setLvl(l)} style={btn(lvl === l)}>{ORD[l]}{s ? ` · ${s.left}/${s.max}` : ""}</button>;
            })}
          </div>
          {sl.length > 0 && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }} aria-label="Spell slots">
              {sl.map((s) => (
                <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: STONE.inkFaint }}>
                  {ORD[s.level]}
                  {Array.from({ length: s.max }, (_, i) => {
                    const full = i < s.left;
                    return <button key={i} type="button" aria-label={`${ORD[s.level]} level slot ${i + 1}: ${full ? "spend it" : "give it back"}`}
                      onClick={() => onSpend(s.key, full ? (spent[s.key] || 0) + 1 : Math.max(0, (spent[s.key] || 0) - 1))}
                      style={{ width: 14, height: 14, borderRadius: 7, padding: 0, cursor: "pointer", background: full ? C.sun : "transparent", border: `1px solid ${full ? C.sun : STONE.hi}` }} />;
                  })}
                </span>
              ))}
              {pact && <span style={{ fontSize: 12, color: STONE.inkFaint }}>Pact slots ({pactLevel ? ORD[pactLevel] : "?"}): {remaining(pact, spent)} / {pact.max}</span>}
            </div>
          )}
          {inFight && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 10 }} role="group" aria-label="Save spell targets">
              <span style={{ fontSize: 12, color: STONE.inkFaint }}>Save spells hit:</span>
              {targets.map((e) => {
                const on = picked.includes(e.id);
                return <button key={e.id} type="button" className="forge-btn" aria-pressed={on} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== e.id) : [...p, e.id]))} style={btn(on)}>{e.name}</button>;
              })}
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            {shown.map((s) => {
              const sp = s.rec, r = readSpell(sp, { slot: sp.level, charLevel, castMod }), c = spellCost(sp.casting_time), isOpen = open === sp.name;
              const choices = sp.level ? slotChoices(sp) : [];
              return (
                <div key={sp.name} style={{ borderBottom: `1px solid ${STONE.hi}`, padding: "7px 0" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1.4fr) 90px 90px 90px minmax(110px, 1.2fr) auto", gap: 8, alignItems: "center" }}>
                    <div>
                      <button type="button" onClick={() => setOpen(isOpen ? null : sp.name)} aria-expanded={isOpen} style={{ background: "none", border: "none", padding: 0, color: STONE.ink, fontSize: 13.5, cursor: "pointer", textAlign: "left" }}>{sp.name}</button>
                      <div style={{ fontSize: 11, color: STONE.inkFaint }}>{sp.level ? `${ORD[sp.level]} level` : "Cantrip"} {sp.school ?? ""}{sp.concentration ? " · concentration" : ""}{sp.ritual ? " · ritual" : ""}{s.always ? ` · always prepared (${s.always})` : ""}</div>
                    </div>
                    <div style={{ fontSize: 12, color: STONE.inkFaint }}>{sp.casting_time}</div>
                    <div style={{ fontSize: 12, color: STONE.inkFaint }}>{sp.range}</div>
                    <div style={{ ...mono, fontSize: 12.5, color: C.plum }}>{r.attack ? sign(sheet.spellAttack) : r.save ? `DC ${sheet.spellDC} ${ABIL_NAME[r.save]}` : ""}</div>
                    <div style={{ fontSize: 12.5, color: STONE.ink }}>{r.healing ? `${r.healing} healing` : r.damage ? `${r.damage} ${(r.damageType ?? "").toLowerCase()}${r.count > 1 ? ` x${r.count}` : ""}` : sp.duration}</div>
                    <div>
                      {sp.level === 0
                        ? <button type="button" className="forge-btn" disabled={busy} onClick={() => void cast(sp, null, 0)} aria-label={`Cast ${sp.name}`} style={btn()}>Cast</button>
                        : <button type="button" className="forge-btn" disabled={busy || choices.length === 0} title={choices.length ? undefined : "No slot left of this level or higher"} onClick={() => setOpen(isOpen ? null : sp.name)} aria-label={choices.length ? `Cast ${sp.name}: pick a slot` : `${sp.name}: no slots left`} aria-expanded={isOpen} style={btn(isOpen)}>{choices.length ? "Cast…" : "No slots"}</button>}
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(0,0,0,0.22)", borderRadius: 4 }}>
                      <p style={{ fontSize: 12, color: STONE.inkFaint, margin: "0 0 6px" }}>{costLabel[c]} · {sp.range} · {sp.components} · {sp.duration}</p>
                      <p style={{ fontSize: 13, color: STONE.ink, margin: "0 0 8px", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{sp.description}</p>
                      {sp.level > 0 && choices.length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 12.5, color: STONE.ink }}>Cast with</span>
                          {choices.map((ch) => {
                            const rr = readSpell(sp, { slot: ch.level, charLevel, castMod });
                            const fx = rr.healing ?? rr.damage;
                            return <button key={ch.key} type="button" className="forge-btn" disabled={busy} onClick={() => void cast(sp, ch.key, ch.level)} style={btn()}>
                              {ch.label}{fx && upcasts(sp) ? ` · ${fx}${rr.count > 1 ? ` x${rr.count}` : ""}` : ""}
                            </button>;
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  {casting && casting.name === sp.name && casting.left > 0 && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 12.5, color: STONE.ink }}>{casting.left} more {r.unit ?? "attack"}{casting.left === 1 ? "" : "s"} from this casting.</span>
                      <button type="button" className="forge-btn" disabled={busy} onClick={() => {
                        const rr = readSpell(sp, { slot: Number(casting.slot), charLevel, castMod });
                        setCasting({ ...casting, left: casting.left - 1 });
                        // the casting already spent its action; each further beam or ray is a follow-up (p115)
                        void attack(`${sp.name} (${rr.unit} ${rr.count - casting.left + 1} of ${rr.count})`, sheet.spellAttack, rr.damage, "followup", rr.damageType ?? "");
                      }} style={btn()}>Roll the next one</button>
                    </div>
                  )}
                </div>
              );
            })}
            {!shown.length && <p style={{ fontSize: 12.5, color: STONE.inkFaint }}>No spells match.</p>}
          </div>
          <p style={{ fontSize: 11.5, color: STONE.inkFaint, margin: "8px 0 0" }}>A spell&apos;s attack, save, damage and healing are read from its text; when a spell does something the text does not spell out plainly, it casts with no roll and shows the description.</p>
        </div>
      )}
      {slotFor(slots, 1) === null && !pact && known.some((s) => s.rec.level > 0) && <p style={{ fontSize: 12, color: STONE.inkFaint, margin: 0 }}>No spell slots on this character&apos;s class table.</p>}
    </section>
  );
}
