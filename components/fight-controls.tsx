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
//
// Action economy (phase 4c, p112): EconomyBar shows what is left of your turn (action, bonus action,
// reaction, movement, attacks left from an Attack action) and spends it; AttackForm says what each
// attack or save effect uses. The database keeps count and refuses what the turn no longer allows; a
// reaction works on anyone's turn, once per round.

import React, { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C } from "@/lib/forge-theme";
import { CONDITIONS, type Econ } from "@/lib/combat";
import { BUFFS, COST_LABEL, DEBUFFS, MARKER_COLORS, STANDARD_ACTIONS, econOf, markerKind, movementLeft } from "@/lib/combat-effects";
import { applyAdvantage } from "@/lib/dice";
import { MarkerBadge, MarkerGlyph, useMarkerStyle } from "@/components/marker-icon";

export type PendingSave = { id: string; by: string; byId?: string; label: string; ability: string; dc: number; damage: number; type?: string; half: boolean; conditions?: string[]; at?: number };
export type LastSave = { label: string; by: string; total: number; dc: number; saved: boolean; damage: number; at: number };
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export const ABILITY_NAME: Record<string, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

export type FightEntry = {
  id: string; name: string; kind: "pc" | "monster"; initiative: number | null; defeated: boolean; is_turn: boolean;
  tokenId?: string | null; characterId?: string | null; conditions?: string[]; mine?: boolean;
  hp?: number | null; maxHp?: number | null; tempHp?: number | null; ac?: number | null;
  pendingSaves?: PendingSave[]; lastSave?: LastSave | null; awaitingSave?: boolean;
  // phase 4c, your own entry: what is left of the turn
  econ?: Econ | null; speed?: number | null; speedNow?: number | null; attacksPerAction?: number; cantAct?: string | null;
  // phase 4c, whoever holds the turn (not yours): what the table can see of it
  turnUsed?: { action: boolean; bonus: boolean; moved: number } | null;
};
export type FightView = { id: string; name: string; round: number; order: FightEntry[] };

export type CombatAction = "damage" | "heal" | "temp" | "add_condition" | "remove_condition" | "sync_sheet"
  | "spend" | "undo" | "move" | "set_speed" | "set_attacks";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> };

export async function combatAct(
  supabase: Rpc, combatId: string, target: string, action: CombatAction,
  opts: { value?: number | null; condition?: string | null; ac?: number | null; note?: string | null } = {},
): Promise<string | null> {
  const { error } = await supabase.rpc("combat_act", {
    p_combat: combatId, p_target: target, p_action: action,
    p_value: opts.value ?? null, p_condition: opts.condition ?? null, p_ac: opts.ac ?? null, p_note: opts.note ?? null,
  });
  if (!error) return null;
  const m = error.message;
  if (/only the GM/.test(m)) return "Only the GM can change that.";
  if (/not your turn/.test(m)) return action === "spend" || action === "move" || action === "undo" ? "Wait for your turn. A reaction can be used on anyone's turn." : "Wait for your turn to affect anyone else.";
  if (/used your action/.test(m)) return "You have used your action this turn.";
  if (/used your bonus action/.test(m)) return "You have used your bonus action this turn.";
  if (/used your reaction/.test(m)) return "You have used your reaction this round. It comes back at the start of your turn.";
  if (/cannot act while/.test(m)) return `You ${m.replace(/^.*?(cannot act while \w+).*$/, "$1")}.`;
  if (/not enough movement|speed is 0|nothing to undo|already happened|between/.test(m)) return m.charAt(0).toUpperCase() + m.slice(1) + ".";
  if (/fight is over/.test(m)) return "That fight has ended.";
  if (/no such combatant/.test(m)) return "They are no longer in the fight.";
  if (/not at this table/.test(m)) return "You are not at this table.";
  return `Could not change the fight: ${m}`;
}

const chip = (on: boolean, kind: "condition" | "buff" | "debuff"): React.CSSProperties => ({
  fontSize: 11.5, padding: "3px 8px 3px 4px", borderRadius: 999, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 5,
  border: `1px solid ${on ? MARKER_COLORS[kind].line : C.line}`,
  background: on ? MARKER_COLORS[kind].fill : "transparent",
  color: on ? "#fff" : C.muted,
});

// The marker chips, grouped, each with its token icon. Clicking one adds or removes it on the target.
export function MarkerPicker({ current, onToggle, busy }: { current: string[]; onToggle: (m: string, on: boolean) => void; busy?: boolean }) {
  const [style] = useMarkerStyle();
  const group = (title: string, list: readonly string[]) => (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: 4 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {list.map((m) => {
          const on = current.includes(m);
          return (
            <button key={m} type="button" disabled={busy} aria-pressed={on} onClick={() => onToggle(m, !on)} style={chip(on, markerKind(m))}>
              <MarkerBadge name={m} size={18} style={style} />{m}
            </button>
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

// Markers on a combatant, read-only, coloured by kind, each with the icon its token shows.
export function MarkerChips({ list }: { list: string[] }) {
  const [style] = useMarkerStyle();
  if (!list.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {list.map((m) => {
        const k = markerKind(m), col = style === "plain" ? C.text : MARKER_COLORS[k].line;
        return (
          <span key={m} style={{ fontSize: 11, padding: "1px 7px 1px 4px", borderRadius: 999, border: `1px solid ${col}`, color: col, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <MarkerGlyph name={m} size={13} />{m}
          </span>
        );
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
          <button title={!(n > 0) ? "Type an amount first" : undefined} type="button" disabled={busy || !(n > 0)} onClick={() => void run("heal", { value: n })} style={{ ...small, color: C.good }}>Heal</button>
          <button title={!(n > 0) ? "Type an amount first" : undefined} type="button" disabled={busy || !(n > 0)} onClick={() => void run("damage", { value: n })} style={{ ...small, color: C.warn }}>Take damage</button>
          <button type="button" disabled={busy || !(n >= 0) || amt === ""} onClick={() => void run("temp", { value: n })} style={{ ...small, color: "#6fa3d8" }} title="Temporary HP do not stack: this replaces what you have">Set temp HP</button>
        </div>
      )}
      {!entry.mine && <p style={{ fontSize: 12, color: C.muted, margin: "0 0 2px" }}>{myTurn ? `Mark your own effects on ${entry.name}. Their HP stays with the GM.` : `Wait for your turn to affect ${entry.name}.`}</p>}
      <MarkerPicker current={entry.conditions ?? []} busy={busy || (!entry.mine && !myTurn)}
        onToggle={(m, on) => void run(on ? "add_condition" : "remove_condition", { condition: m })} />
      {err && <p role="alert" style={{ color: C.warn, fontSize: 12, margin: "6px 0 0" }}>{err}</p>}
    </div>
  );
}

// Is it this character's turn in the fight?
export function isMyTurn(fight: FightView | null | undefined, characterId: string | null | undefined): boolean {
  const cur = fight?.order.find((e) => e.is_turn);
  return !!cur && !!cur.mine && !!characterId && cur.characterId === characterId;
}

type Against = { target: string; hit: boolean | null; crit: boolean; applied?: boolean; defeated?: boolean; attacksLeft?: number };

// Attack someone in the fight: pick the target, the attack's bonus and its damage, then one press rolls
// the attack and, on a hit, the damage, which lands on the target at once.
export function AttackForm({ campaignId, characterId, fight, onDone, defaultBonus, presetTarget, presetTargets, defaultDc }: {
  campaignId: string; characterId: string; fight: FightView; onDone: () => void; defaultBonus?: number | null;
  presetTarget?: string;   // a combatant id to start on (the tabletop passes the selected token's)
  // push 28 (V1): everyone inside an area template; opens as a saving throw effect with them all picked
  presetTargets?: string[];
  defaultDc?: number | null;   // the sheet's spell save DC, for save effects
}) {
  const areaPicks = (presetTargets ?? []).filter((id) => fight.order.some((e) => e.id === id && e.characterId !== characterId && !e.defeated));
  const [mode, setMode] = useState<"attack" | "save">(areaPicks.length ? "save" : "attack");
  const [picked, setPicked] = useState<string[]>(areaPicks.length ? areaPicks : presetTarget ? [presetTarget] : []);
  const [ability, setAbility] = useState("dex");
  const [dc, setDc] = useState(defaultDc != null ? String(defaultDc) : "");
  const [half, setHalf] = useState(true);
  const targets = fight.order.filter((e) => e.characterId !== characterId && !e.defeated);
  const [target, setTarget] = useState(presetTarget ?? "");
  const [label, setLabel] = useState("Attack");
  const [bonus, setBonus] = useState(defaultBonus != null ? String(defaultBonus) : "");
  const [damage, setDamage] = useState("");
  const [adv, setAdv] = useState<"flat" | "adv" | "dis">("flat");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const [cost, setCost] = useState<"attack" | "action" | "bonus" | "reaction">("attack");
  const myTurn = isMyTurn(fight, characterId);
  const tgt = targets.find((e) => e.id === target) ?? null;
  // what this character's turn still allows (phase 4c); the database has the final say
  const meEntry = fight.order.find((e) => e.characterId === characterId && e.mine) ?? null;
  const ec = meEntry?.econ ? econOf(meEntry) : null;
  const useCost = mode === "save" && cost === "attack" ? "action" : cost;
  const canNow = useCost === "reaction" || myTurn;
  const blocked: string | null = !ec ? null
    : meEntry?.cantAct ? `You cannot act while ${meEntry.cantAct}.`
    : useCost === "reaction" ? (ec.reaction ? "Your reaction is used until your next turn." : null)
    : !myTurn ? null
    : useCost === "bonus" ? (ec.bonus ? "You have used your bonus action this turn." : null)
    : useCost === "attack" ? (ec.attacks > 0 || !ec.action ? null : "You have used your action this turn.")
    : ec.action ? "You have used your action this turn." : null;
  const attackNote = ec && useCost === "attack" && myTurn && !blocked
    ? (ec.attacks > 0 ? `${ec.attacks} attack${ec.attacks === 1 ? "" : "s"} left from this Attack action.` : (meEntry?.attacksPerAction ?? 1) > 1 ? `This Attack action makes ${meEntry?.attacksPerAction} attacks.` : null)
    : null;
  const costPick = (
    <select aria-label="What this uses" value={useCost} onChange={(e) => setCost(e.target.value as typeof cost)}
      style={{ padding: "5px 7px", borderRadius: 7, border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 13 }}>
      {mode === "attack" && <option value="attack">Attack action</option>}
      <option value="action">{mode === "attack" ? "Whole action (spell attack)" : "Action"}</option>
      <option value="bonus">Bonus action</option>
      <option value="reaction">Reaction</option>
    </select>
  );

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/tabletop/roll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, characterId, ...body }) });
    const j = await res.json().catch(() => ({})) as { error?: string; message?: { roll?: { total?: number } }; against?: Against | null };
    return { ok: res.ok, ...j };
  };

  const saveEffect = async () => {
    const d = parseInt(dc, 10);
    if (!picked.length) { setOut("Pick at least one target."); return; }
    if (!(d > 0)) { setOut("Enter the save DC."); return; }
    if (!damage.trim()) { setOut("Add the damage dice. For an effect with no damage, mark its condition on the target instead."); return; }
    setBusy(true); setOut(null);
    try {
      const r = await post({ notation: damage.trim(), label: label.trim() || "Save effect", saveAgainst: { targets: picked, ability, dc: d, half }, cost: useCost });
      if (!r.ok) { setOut(r.error ?? "Could not roll."); return; }
      const sn = (r as { saveNote?: { targets: string[] } }).saveNote;
      setOut(`${r.message?.roll?.total ?? "?"} damage now waits on ${sn?.targets.join(", ") || "the targets"}: each makes a ${ability.toUpperCase()} save, DC ${d}${half ? ", half on a success" : ", none on a success"}.`);
    } finally { setBusy(false); onDone(); }
  };

  const attack = async () => {
    if (!tgt) return;
    const b = parseInt(bonus, 10) || 0;
    setBusy(true); setOut(null);
    try {
      const a = await post({ notation: applyAdvantage(`1d20${b >= 0 ? "+" : ""}${b}`, adv), label: label.trim() || "Attack", target: tgt.id, rollFor: "attack", cost: useCost });
      if (!a.ok) { setOut(a.error ?? "Could not roll."); return; }
      const total = a.message?.roll?.total;
      const ag = a.against;
      if (!ag) { setOut(`Rolled ${total ?? "?"}.`); return; }
      const left = useCost === "attack" && ag.attacksLeft ? ` ${ag.attacksLeft} attack${ag.attacksLeft === 1 ? "" : "s"} left this action.` : "";
      if (ag.hit === false) { setOut(`${total ?? "?"}: miss against ${ag.target}.${left}`); return; }
      if (ag.hit === null) { setOut(`${total ?? "?"} against ${ag.target}: the GM has not set its AC, so the GM decides.${left}`); return; }
      const hitText = `${total ?? "?"}: ${ag.crit ? "critical hit" : "hit"} on ${ag.target}`;
      if (!damage.trim()) { setOut(`${hitText}. Roll damage to land it.${left}`); return; }
      const d = await post({ notation: damage.trim(), label: `${label.trim() || "Attack"} damage`, target: tgt.id, rollFor: "damage" });
      if (!d.ok) { setOut(`${hitText}, but the damage did not land: ${d.error ?? "unknown error"}`); return; }
      setOut(`${hitText}: ${d.message?.roll?.total ?? "?"} damage${ag.crit ? " (dice doubled)" : ""}${d.against?.defeated ? `. ${ag.target} goes down.` : "."}${left}`);
    } finally { setBusy(false); onDone(); }
  };

  const field: React.CSSProperties = { padding: "5px 7px", borderRadius: 7, border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 13 };
  const seg = (on: boolean): React.CSSProperties => ({ padding: "4px 9px", borderRadius: 7, fontSize: 12, cursor: "pointer", border: `1px solid ${on ? C.sun : C.line}`, background: on ? "rgba(217,164,58,0.12)" : "transparent", color: on ? C.sun : C.muted });
  const pill = (on: boolean): React.CSSProperties => ({ ...seg(on), padding: "3px 10px" });
  if (mode === "save") {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => setMode("attack")} style={pill(false)}>Attack roll</button>
          <button type="button" onClick={() => setMode("save")} style={pill(true)}>Saving throw effect</button>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }} role="group" aria-label="Targets">
          {targets.map((e) => {
            const on = picked.includes(e.id);
            return <button key={e.id} type="button" aria-pressed={on} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== e.id) : [...p, e.id]))} style={pill(on)}>{e.name}</button>;
          })}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input aria-label="Effect name" value={label === "Attack" ? "" : label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} placeholder="Fireball" style={{ ...field, width: 120 }} />
          <select aria-label="Saving throw ability" value={ability} onChange={(e) => setAbility(e.target.value)} style={field}>
            {ABILITIES.map((a) => <option key={a} value={a}>{a.toUpperCase()} save</option>)}
          </select>
          <input aria-label="Save DC" value={dc} onChange={(e) => setDc(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} placeholder="DC" style={{ ...field, width: 52 }} />
          <input aria-label="Damage dice" value={damage} onChange={(e) => setDamage(e.target.value.replace(/[^0-9dD+\- ]/g, "").slice(0, 24))} placeholder="damage, e.g. 8d6" style={{ ...field, width: 120 }} />
          <label style={{ fontSize: 12, color: C.muted, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} />half on a success</label>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {costPick}
          <span style={{ flex: 1, fontSize: 12, color: C.muted, minWidth: 160 }}>The damage is rolled once and waits on each target until they roll their save.</span>
          <button title={!picked.length ? "Choose at least one target" : !canNow ? "Wait for your turn" : blocked ? String(blocked) : undefined} type="button" disabled={busy || !picked.length || !canNow || !!blocked} onClick={() => void saveEffect()}
            style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: canNow && !blocked && picked.length ? C.sun : C.line, color: "#1b1712", fontWeight: 700, fontSize: 13, cursor: canNow && !blocked && picked.length ? "pointer" : "default" }}>
            {busy ? "Rolling…" : `Cast on ${picked.length || "…"}`}
          </button>
        </div>
        {(blocked || !canNow) && <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{blocked ?? "You can use it on your turn, or as a reaction."}</p>}
        {out && <p role="status" style={{ color: C.text, fontSize: 13, margin: 0 }}>{out}</p>}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => setMode("attack")} style={pill(true)}>Attack roll</button>
        <button type="button" onClick={() => setMode("save")} style={pill(false)}>Saving throw effect</button>
      </div>
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
        {costPick}
        <span style={{ flex: 1 }} />
        <button title={!tgt ? "Choose a target first" : !canNow ? "Wait for your turn" : blocked ? String(blocked) : undefined} type="button" disabled={busy || !tgt || !canNow || !!blocked} onClick={() => void attack()}
          style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: canNow && !blocked && tgt ? C.sun : C.line, color: "#1b1712", fontWeight: 700, fontSize: 13, cursor: canNow && !blocked && tgt ? "pointer" : "default" }}>
          {busy ? "Rolling…" : tgt ? `Attack ${tgt.name}` : "Attack"}
        </button>
      </div>
      {(blocked || !canNow) && <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{blocked ?? "You can attack on your turn, or with your reaction (an opportunity attack)."}</p>}
      {attackNote && <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{attackNote}</p>}
      {out && <p role="status" style={{ color: C.text, fontSize: 13, margin: 0 }}>{out}</p>}
    </div>
  );
}

// Rolls go through the tabletop roll route, so they land in table chat and Mechanics like any other.
async function postRoll(campaignId: string, characterId: string, body: Record<string, unknown>) {
  const res = await fetch("/api/tabletop/roll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, characterId, ...body }) });
  const j = await res.json().catch(() => ({})) as { error?: string; message?: { roll?: { total?: number } }; saved?: { saved: boolean; damage: number; dc: number } | null };
  return { ok: res.ok, ...j };
}

// The saves waiting on your character: nothing lands until you roll. The bonus comes from the sheet
// when there is one; it can be changed before rolling.
export function SaveBanner({ campaignId, characterId, entry, saves, onDone }: {
  campaignId: string; characterId: string; entry: FightEntry; saves?: Record<string, number> | null; onDone: () => void;
}) {
  const pending = entry.pendingSaves ?? [];
  const [bonus, setBonus] = useState<Record<string, string>>({});
  const [adv, setAdv] = useState<"flat" | "adv" | "dis">("flat");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  if (!pending.length && !out) return null;
  const rollSave = async (ps: PendingSave) => {
    const b = parseInt(bonus[ps.id] ?? String(saves?.[ps.ability] ?? 0), 10) || 0;
    setBusy(true); setOut(null);
    try {
      const r = await postRoll(campaignId, characterId, { notation: applyAdvantage(`1d20${b >= 0 ? "+" : ""}${b}`, adv), label: `${ps.ability.toUpperCase()} save vs ${ps.label}`, saveFor: ps.id });
      if (!r.ok) { setOut(r.error ?? "Could not roll."); return; }
      const sv = r.saved;
      setOut(sv ? `${r.message?.roll?.total ?? "?"} against DC ${sv.dc}: ${sv.saved ? "saved" : "failed"}. ${sv.damage ? `${sv.damage} damage.` : "No damage."}` : `Rolled ${r.message?.roll?.total ?? "?"}.`);
    } finally { setBusy(false); onDone(); }
  };
  const field: React.CSSProperties = { padding: "4px 6px", borderRadius: 7, border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 13, width: 52 };
  return (
    <div role="alert" style={{ border: `1px solid ${C.warn}`, borderRadius: 8, padding: "8px 10px", background: "rgba(224,122,112,0.08)", display: "grid", gap: 8 }}>
      {pending.map((ps) => (
        <div key={ps.id} style={{ display: "grid", gap: 4 }}>
          <div style={{ fontSize: 13, color: C.text }}>
            <strong>{ps.by}&apos;s {ps.label}</strong>: make a {ABILITY_NAME[ps.ability] ?? ps.ability.toUpperCase()} save, DC {ps.dc}.
            {ps.damage ? ` ${ps.damage}${ps.type ? ` ${ps.type}` : ""} damage on a failure${ps.half ? ", half on a success" : ""}.` : ""}
            {(ps.conditions ?? []).length ? ` ${(ps.conditions ?? []).join(", ")} on a failure.` : ""}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: C.muted }}>Bonus <input aria-label={`${ps.ability} save bonus`} style={field}
              value={bonus[ps.id] ?? String(saves?.[ps.ability] ?? "")} onChange={(e) => setBonus((m) => ({ ...m, [ps.id]: e.target.value.replace(/[^0-9+-]/g, "").slice(0, 3) }))} /></label>
            {(["dis", "flat", "adv"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setAdv(m)} style={{ padding: "3px 8px", borderRadius: 7, fontSize: 12, cursor: "pointer", border: `1px solid ${adv === m ? C.sun : C.line}`, background: "transparent", color: adv === m ? C.sun : C.muted }}>
                {m === "adv" ? "Advantage" : m === "dis" ? "Disadvantage" : "Straight"}
              </button>
            ))}
            <button type="button" disabled={busy} onClick={() => void rollSave(ps)} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: C.warn, color: "#1b1712", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Roll {ps.ability.toUpperCase()} save
            </button>
          </div>
        </div>
      ))}
      {out && <p role="status" style={{ color: C.text, fontSize: 13, margin: 0 }}>{out}</p>}
    </div>
  );
}

// The six saving throws, ready to roll into table chat (an effect without a pending save, or the GM
// asking out loud).
export function SavesRow({ campaignId, characterId, saves, profs }: {
  campaignId: string; characterId: string; saves: Record<string, number>; profs?: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const roll = async (a: string) => {
    const b = saves[a] ?? 0;
    setBusy(true);
    try {
      const r = await postRoll(campaignId, characterId, { notation: `1d20${b >= 0 ? "+" : ""}${b}`, label: `${a.toUpperCase()} save` });
      setOut(r.ok ? `${a.toUpperCase()} save: ${r.message?.roll?.total ?? "?"}` : r.error ?? "Could not roll.");
    } finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 5 }}>
        {ABILITIES.map((a) => {
          const prof = (profs ?? []).includes(a);
          return (
            <button key={a} type="button" disabled={busy} onClick={() => void roll(a)} title={prof ? "Proficient" : undefined}
              style={{ padding: "6px 4px", borderRadius: 7, cursor: "pointer", background: "transparent", color: C.text, border: `1px solid ${prof ? C.sun : C.line}`, fontSize: 12.5, display: "grid", gap: 1 }}>
              <span style={{ fontSize: 10.5, color: C.muted, letterSpacing: "0.08em" }}>{a.toUpperCase()}</span>
              <span style={{ fontWeight: 700 }}>{(saves[a] ?? 0) >= 0 ? "+" : ""}{saves[a] ?? 0}</span>
            </button>
          );
        })}
      </div>
      {out && <p role="status" style={{ color: C.text, fontSize: 12.5, margin: "6px 0 0" }}>{out}</p>}
    </div>
  );
}

// What is left of your turn, and the buttons that spend it. Action, bonus action and movement are for
// your own turn; a reaction works on anyone's turn and comes back at the start of yours. Moving your
// token on the tabletop counts its movement for you; "Move" here is for a fight without the tabletop.
export function EconomyBar({ fightId, entry, myTurn, onChanged }: { fightId: string; entry: FightEntry; myTurn: boolean; onChanged: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [note, setNote] = useState("");
  const [feet, setFeet] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [spd, setSpd] = useState(entry.speed != null ? String(entry.speed) : "");
  const [apa, setApa] = useState(String(entry.attacksPerAction ?? 1));
  const e = econOf(entry);
  const left = movementLeft(e, entry.speedNow ?? null);
  const run = async (action: CombatAction, opts: { value?: number; condition?: string; note?: string } = {}) => {
    setBusy(true); setErr(null);
    const m = await combatAct(supabase as unknown as Rpc, fightId, entry.id, action, opts);
    setBusy(false);
    if (m) setErr(m); else { if (action === "spend") setNote(""); if (action === "move") setFeet(""); onChanged(); }
  };
  const spend = (cost: "action" | "bonus" | "reaction", what?: string) => void run("spend", { condition: cost, note: what ?? (note.trim() || undefined) });
  const last = (e.log ?? [])[(e.log ?? []).length - 1] ?? null;
  const pip = (label: string, used: boolean, color: string): React.ReactNode => (
    <span title={used ? `${label}: used` : `${label}: ready`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: used ? C.muted : C.text, textDecoration: used ? "line-through" : "none" }}>
      <span aria-hidden style={{ width: 11, height: 11, borderRadius: 999, border: `2px solid ${color}`, background: used ? "transparent" : color }} />{label}
    </span>
  );
  const small: React.CSSProperties = { padding: "4px 9px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12, cursor: "pointer" };
  const field: React.CSSProperties = { padding: "4px 6px", borderRadius: 7, border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 12.5 };
  const turnOk = myTurn && !entry.cantAct;
  return (
    <div style={{ display: "grid", gap: 7 }} aria-label="What is left of your turn">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {pip("Action", e.action && e.attacks === 0, "#d9a43a")}
        {pip("Bonus action", e.bonus, C.good)}
        {pip("Reaction", e.reaction, "#c2a8f0")}
        <span style={{ fontSize: 12.5, color: C.text }}>
          {left == null ? "Speed not set" : `${left} of ${(entry.speedNow ?? 0) + e.dash} ft left`}
          {e.dash > 0 ? <span style={{ color: C.muted }}> (Dash)</span> : null}
        </span>
        {e.attacks > 0 && <span style={{ fontSize: 12.5, color: "#d9a43a" }}>{e.attacks} attack{e.attacks === 1 ? "" : "s"} left</span>}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setEdit((v) => !v)} aria-expanded={edit} style={{ ...small, color: C.muted }}>Speed and attacks</button>
      </div>
      {entry.cantAct && <p role="status" style={{ fontSize: 12.5, color: C.warn, margin: 0 }}>{entry.cantAct}: no actions, bonus actions or reactions until it ends.</p>}
      {!myTurn && !entry.cantAct && <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>Not your turn: only your reaction can be used now.</p>}
      {edit && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: C.muted }}>Speed <input aria-label="Walking speed in feet" value={spd} inputMode="numeric" onChange={(ev) => setSpd(ev.target.value.replace(/[^0-9]/g, "").slice(0, 3))} style={{ ...field, width: 50 }} /> ft</label>
          <button title={spd === "" ? "Type a speed first" : undefined} type="button" disabled={busy || spd === ""} onClick={() => void run("set_speed", { value: parseInt(spd, 10) })} style={small}>Set</button>
          <label style={{ fontSize: 12, color: C.muted }}>Attacks per Attack action <input aria-label="Attacks per Attack action" value={apa} inputMode="numeric" onChange={(ev) => setApa(ev.target.value.replace(/[^0-9]/g, "").slice(0, 1))} style={{ ...field, width: 34 }} /></label>
          <button title={!(parseInt(apa, 10) >= 1) ? "Type at least 1" : undefined} type="button" disabled={busy || !(parseInt(apa, 10) >= 1)} onClick={() => void run("set_attacks", { value: parseInt(apa, 10) })} style={small}>Set</button>
          <span style={{ fontSize: 11.5, color: C.muted }}>Filled in from your sheet; Hasted doubles speed and Slowed halves it.</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }} role="group" aria-label="Standard actions">
        <span style={{ fontSize: 11, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 2 }}>Action</span>
        {STANDARD_ACTIONS.map((a) => (
          <button key={a.name} type="button" title={a.tip} disabled={busy || !turnOk || e.action} onClick={() => spend("action", a.name)} style={small}>{a.name}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="What you use it for" value={note} onChange={(ev) => setNote(ev.target.value.slice(0, 60))} placeholder="what for, e.g. Cunning Action: Dash" style={{ ...field, width: 210 }} />
        <button title={!turnOk ? "Wait for your turn" : e.action ? "Your action is used this turn" : undefined} type="button" disabled={busy || !turnOk || e.action} onClick={() => spend("action")} style={small}>Use action</button>
        <button title={!turnOk ? "Wait for your turn" : e.bonus ? "Your bonus action is used this turn" : undefined} type="button" disabled={busy || !turnOk || e.bonus} onClick={() => spend("bonus")} style={{ ...small, color: C.good }}>Use bonus action</button>
        <button title={entry.cantAct ? "You cannot act right now" : e.reaction ? "Your reaction is used this round" : undefined} type="button" disabled={busy || !!entry.cantAct || e.reaction} onClick={() => spend("reaction")} style={{ ...small, color: "#c2a8f0" }}>Use reaction</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="Feet to move" value={feet} inputMode="numeric" onChange={(ev) => setFeet(ev.target.value.replace(/[^0-9]/g, "").slice(0, 3))} placeholder="ft" style={{ ...field, width: 50 }} />
        <button title={!myTurn ? "Wait for your turn" : !(parseInt(feet, 10) > 0) ? "Type how far to move" : undefined} type="button" disabled={busy || !myTurn || !(parseInt(feet, 10) > 0)} onClick={() => void run("move", { value: parseInt(feet, 10) })} style={small}>Move</button>
        <span style={{ fontSize: 11.5, color: C.muted }}>Moving your token on the tabletop counts this for you.</span>
        <span style={{ flex: 1 }} />
        {last && (
          <button type="button" disabled={busy || !!last.locked} onClick={() => void run("undo")} style={{ ...small, color: C.muted }}
            title={last.locked ? "That already happened at the table; the GM can undo it" : "Take back the last thing you spent"}>
            Undo: {COST_LABEL[last.cost] ?? last.cost}{last.what ? `, ${last.what}` : ""}
          </button>
        )}
      </div>
      {err && <p role="alert" style={{ color: C.warn, fontSize: 12, margin: 0 }}>{err}</p>}
    </div>
  );
}

// What the creature whose turn it is has used, as the table sees it (not your own character).
export function TurnUsed({ entry }: { entry: FightEntry }) {
  const u = entry.turnUsed;
  if (!u) return null;
  const bits = [u.action ? "action used" : null, u.bonus ? "bonus action used" : null, u.moved ? `moved ${u.moved} ft` : null].filter(Boolean);
  if (!bits.length) return null;
  return <span style={{ fontSize: 11.5, color: C.muted }}>{bits.join(", ")}</span>;
}
