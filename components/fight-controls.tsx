"use client";

// components/fight-controls.tsx (2026-11-07)
//
// What a player can do to the running fight, shared by the character sheet (components/fight-card.tsx)
// and the tabletop's Turns tab. Every change goes through combat_act (p110), which changes one
// combatant in one locked statement and holds the rules:
//   * your own character: damage, healing, temporary HP, conditions and effects;
//   * anyone else you can see: conditions and effects only (your Bless on an ally, your Hex on the
//     ogre), and only while your character holds the turn. Monster HP stays with the GM.
// AttackForm attacks a chosen combatant through /api/tabletop/roll: the server rolls, compares with the
// target's AC in the database (the player never sees it), and lands the damage on a hit.

import React, { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C } from "@/lib/forge-theme";
import { CONDITIONS } from "@/lib/combat";
import { BUFFS, DEBUFFS, MARKER_COLORS, markerKind } from "@/lib/combat-effects";
import { applyAdvantage } from "@/lib/dice";

export type FightEntry = {
  id: string; name: string; kind: "pc" | "monster"; initiative: number | null; defeated: boolean; is_turn: boolean;
  tokenId?: string | null; characterId?: string | null; conditions?: string[]; mine?: boolean;
  hp?: number | null; maxHp?: number | null; tempHp?: number | null; ac?: number | null;
};
export type FightView = { id: string; name: string; round: number; order: FightEntry[] };

export type CombatAction = "damage" | "heal" | "temp" | "add_condition" | "remove_condition" | "sync_sheet";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> };

export async function combatAct(
  supabase: Rpc, combatId: string, target: string, action: CombatAction,
  opts: { value?: number | null; condition?: string | null; ac?: number | null } = {},
): Promise<string | null> {
  const { error } = await supabase.rpc("combat_act", {
    p_combat: combatId, p_target: target, p_action: action,
    p_value: opts.value ?? null, p_condition: opts.condition ?? null, p_ac: opts.ac ?? null,
  });
  if (!error) return null;
  const m = error.message;
  if (/only the GM/.test(m)) return "Only the GM can change that.";
  if (/not your turn/.test(m)) return "Wait for your turn to affect anyone else.";
  if (/fight is over/.test(m)) return "That fight has ended.";
  if (/no such combatant/.test(m)) return "They are no longer in the fight.";
  if (/not at this table/.test(m)) return "You are not at this table.";
  return `Could not change the fight: ${m}`;
}

const chip = (on: boolean, kind: "condition" | "buff" | "debuff"): React.CSSProperties => ({
  fontSize: 11.5, padding: "3px 8px", borderRadius: 999, cursor: "pointer",
  border: `1px solid ${on ? MARKER_COLORS[kind].line : C.line}`,
  background: on ? MARKER_COLORS[kind].fill : "transparent",
  color: on ? "#fff" : C.muted,
});

// The marker chips, grouped. Clicking one adds or removes it on the target.
export function MarkerPicker({ current, onToggle, busy }: { current: string[]; onToggle: (m: string, on: boolean) => void; busy?: boolean }) {
  const group = (title: string, list: readonly string[]) => (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: 4 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {list.map((m) => {
          const on = current.includes(m);
          return (
            <button key={m} type="button" disabled={busy} aria-pressed={on} onClick={() => onToggle(m, !on)} style={chip(on, markerKind(m))}>{m}</button>
          );
        })}
      </div>
    </div>
  );
  return (
    <div>
      {group("Buffs", BUFFS)}
      {group("Debuffs", DEBUFFS)}
      {group("Conditions", CONDITIONS)}
    </div>
  );
}

// Markers on a combatant, read-only, coloured by kind.
export function MarkerChips({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {list.map((m) => {
        const k = markerKind(m);
        return <span key={m} style={{ fontSize: 11, padding: "0 7px", borderRadius: 999, border: `1px solid ${MARKER_COLORS[k].line}`, color: MARKER_COLORS[k].line }}>{m}</span>;
      })}
    </div>
  );
}

// The controls for one entry. Your own character gets HP controls and markers; anyone else, markers.
export function PlayerEntryControls({ fightId, entry, onChanged, myTurn = true }: { fightId: string; entry: FightEntry; onChanged: () => void; myTurn?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = parseInt(amt, 10);
  const run = async (action: CombatAction, opts: { value?: number; condition?: string } = {}) => {
    setBusy(true); setErr(null);
    const e = await combatAct(supabase as unknown as Rpc, fightId, entry.id, action, opts);
    setBusy(false);
    if (e) setErr(e); else { setAmt(""); onChanged(); }
  };
  const small: React.CSSProperties = { padding: "5px 10px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" };
  return (
    <div>
      {entry.mine && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input aria-label={`Amount for ${entry.name}`} value={amt} inputMode="numeric" placeholder="amount"
            onChange={(ev) => setAmt(ev.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
            style={{ width: 72, padding: "5px 7px", borderRadius: 7, border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 13 }} />
          <button type="button" disabled={busy || !(n > 0)} onClick={() => void run("heal", { value: n })} style={{ ...small, color: "#8fd18a" }}>Heal</button>
          <button type="button" disabled={busy || !(n > 0)} onClick={() => void run("damage", { value: n })} style={{ ...small, color: "#e07a70" }}>Take damage</button>
          <button type="button" disabled={busy || !(n >= 0) || amt === ""} onClick={() => void run("temp", { value: n })} style={{ ...small, color: "#6fa3d8" }} title="Temporary HP do not stack: this replaces what you have">Set temp HP</button>
        </div>
      )}
      {!entry.mine && <p style={{ fontSize: 12, color: C.muted, margin: "0 0 2px" }}>{myTurn ? `Mark your own effects on ${entry.name}. Their HP stays with the GM.` : `Wait for your turn to affect ${entry.name}.`}</p>}
      <MarkerPicker current={entry.conditions ?? []} busy={busy || (!entry.mine && !myTurn)}
        onToggle={(m, on) => void run(on ? "add_condition" : "remove_condition", { condition: m })} />
      {err && <p role="alert" style={{ color: "#e07a70", fontSize: 12, margin: "6px 0 0" }}>{err}</p>}
    </div>
  );
}

// Is it this character's turn in the fight?
export function isMyTurn(fight: FightView | null | undefined, characterId: string | null | undefined): boolean {
  const cur = fight?.order.find((e) => e.is_turn);
  return !!cur && !!cur.mine && !!characterId && cur.characterId === characterId;
}

type Against = { target: string; hit: boolean | null; crit: boolean; applied?: boolean; defeated?: boolean };

// Attack someone in the fight: pick the target, the attack's bonus and its damage, then one press rolls
// the attack and, on a hit, the damage, which lands on the target at once.
export function AttackForm({ campaignId, characterId, fight, onDone, defaultBonus, presetTarget }: {
  campaignId: string; characterId: string; fight: FightView; onDone: () => void; defaultBonus?: number | null;
  presetTarget?: string;   // a combatant id to start on (the tabletop passes the selected token's)
}) {
  const targets = fight.order.filter((e) => e.characterId !== characterId && !e.defeated);
  const [target, setTarget] = useState(presetTarget ?? "");
  const [label, setLabel] = useState("Attack");
  const [bonus, setBonus] = useState(defaultBonus != null ? String(defaultBonus) : "");
  const [damage, setDamage] = useState("");
  const [adv, setAdv] = useState<"flat" | "adv" | "dis">("flat");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const myTurn = isMyTurn(fight, characterId);
  const tgt = targets.find((e) => e.id === target) ?? null;

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/tabletop/roll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, characterId, ...body }) });
    const j = await res.json().catch(() => ({})) as { error?: string; message?: { roll?: { total?: number } }; against?: Against | null };
    return { ok: res.ok, ...j };
  };

  const attack = async () => {
    if (!tgt) return;
    const b = parseInt(bonus, 10) || 0;
    setBusy(true); setOut(null);
    try {
      const a = await post({ notation: applyAdvantage(`1d20${b >= 0 ? "+" : ""}${b}`, adv), label: label.trim() || "Attack", target: tgt.id, rollFor: "attack" });
      if (!a.ok) { setOut(a.error ?? "Could not roll."); return; }
      const total = a.message?.roll?.total;
      const ag = a.against;
      if (!ag) { setOut(`Rolled ${total ?? "?"}.`); return; }
      if (ag.hit === false) { setOut(`${total ?? "?"}: miss against ${ag.target}.`); return; }
      if (ag.hit === null) { setOut(`${total ?? "?"} against ${ag.target}: the GM has not set its AC, so the GM decides.`); return; }
      const hitText = `${total ?? "?"}: ${ag.crit ? "critical hit" : "hit"} on ${ag.target}`;
      if (!damage.trim()) { setOut(`${hitText}. Roll damage to land it.`); return; }
      const d = await post({ notation: damage.trim(), label: `${label.trim() || "Attack"} damage`, target: tgt.id, rollFor: "damage" });
      if (!d.ok) { setOut(`${hitText}, but the damage did not land: ${d.error ?? "unknown error"}`); return; }
      setOut(`${hitText}: ${d.message?.roll?.total ?? "?"} damage${ag.crit ? " (dice doubled)" : ""}${d.against?.defeated ? `. ${ag.target} goes down.` : "."}`);
    } finally { setBusy(false); onDone(); }
  };

  const field: React.CSSProperties = { padding: "5px 7px", borderRadius: 7, border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 13 };
  const seg = (on: boolean): React.CSSProperties => ({ padding: "4px 9px", borderRadius: 7, fontSize: 12, cursor: "pointer", border: `1px solid ${on ? C.sun : C.line}`, background: on ? "rgba(217,164,58,0.12)" : "transparent", color: on ? C.sun : C.muted });
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <select aria-label="Who you attack" value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...field, minWidth: 150 }}>
          <option value="">Target…</option>
          {targets.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <input aria-label="Attack name" value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} style={{ ...field, width: 120 }} />
        <input aria-label="Attack bonus" value={bonus} onChange={(e) => setBonus(e.target.value.replace(/[^0-9+-]/g, "").slice(0, 3))} placeholder="+hit" style={{ ...field, width: 56 }} />
        <input aria-label="Damage dice" value={damage} onChange={(e) => setDamage(e.target.value.replace(/[^0-9dD+\- ]/g, "").slice(0, 24))} placeholder="damage, e.g. 1d8+3" style={{ ...field, width: 140 }} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={() => setAdv("dis")} style={seg(adv === "dis")}>Disadvantage</button>
        <button type="button" onClick={() => setAdv("flat")} style={seg(adv === "flat")}>Straight</button>
        <button type="button" onClick={() => setAdv("adv")} style={seg(adv === "adv")}>Advantage</button>
        <span style={{ flex: 1 }} />
        <button type="button" disabled={busy || !tgt || !myTurn} onClick={() => void attack()}
          style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: myTurn && tgt ? C.sun : C.line, color: "#1b1712", fontWeight: 700, fontSize: 13, cursor: myTurn && tgt ? "pointer" : "default" }}>
          {busy ? "Rolling…" : tgt ? `Attack ${tgt.name}` : "Attack"}
        </button>
      </div>
      {!myTurn && <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>You can attack on your turn.</p>}
      {out && <p role="status" style={{ color: C.text, fontSize: 13, margin: 0 }}>{out}</p>}
    </div>
  );
}
