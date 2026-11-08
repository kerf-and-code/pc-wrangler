"use client";

// components/play-sheet.tsx (2026-11-07)
//
// Phase 5a: the top half of the play sheet, the page a player keeps open at the table. Everything it
// shows comes from the Forge's derived sheet (lib/srd/derive-sheet.ts), so nothing is retyped:
//   * the six abilities (modifier large, score small), proficiency bonus, speed, initiative, AC;
//   * the HP box: current, maximum and temporary HP, one amount with Heal and Damage, death saves at
//     0 HP, and hit dice;
//   * saving throws, skills (none, proficient, expertise), senses and passive scores;
//   * defenses (resistances, immunities), conditions, exhaustion and heroic inspiration;
//   * short rest (spend hit dice, and the resources that come back) and long rest.
// Every check, save, skill and initiative rolls on the server (/api/rolls/player), so it lands in the
// session's Mechanics like any other roll.
//
// The play state (current HP, temporary HP, hit dice spent, death saves, inspiration, exhaustion,
// conditions) is stored in the character's build as `play`, beside the spent resources, and saved by
// the Forge's own autosave. While the character is in a running fight, the fight's HP and conditions
// are the truth: changes here go through the fight (combat_act, p110) and the Forge copies the fight's
// numbers back into `play`, so the HP a fight ends with is the HP the sheet shows afterwards.
//
// Phase 5e: a score's pill opens its breakdown (base, species, background, feats, items, cap) with an
// override; the HP box's Max HP control adds a modifier or replaces the maximum. Both are stored in
// the build (abilityOverride, hpMaxMod, hpMaxOverride) and applied by the derivation.
//
// Phase 5f: defenses the player records by hand (resistances, immunities, vulnerabilities) join the
// derived ones, kept in the build as customDefenses.

import React, { useCallback, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, STONE, FORGE_FONTS, stonePanel, stoneButton, forgeLabel } from "@/lib/forge-theme";
import { applyAdvantage } from "@/lib/dice";
import { CONDITIONS } from "@/lib/combat";
import { combatAct, type FightEntry } from "@/components/fight-controls";
import { SKILLS, type Ability, type DerivedSheet, type ImportAdjust } from "@/lib/srd/derive-sheet";

export type SheetOverrides = { ability: Partial<Record<Ability, number>>; hpMaxMod: number; hpMaxOverride: number | null };
export type CustomDefenses = { resist?: string[]; immune?: string[]; vuln?: string[] };
const DAMAGE_TYPES = ["Acid", "Bludgeoning", "Cold", "Fire", "Force", "Lightning", "Necrotic", "Piercing", "Poison", "Psychic", "Radiant", "Slashing", "Thunder"];
const DEF_KINDS: [keyof CustomDefenses, string][] = [["resist", "Resistant"], ["immune", "Immune"], ["vuln", "Vulnerable"]];

export type PlayState = {
  hp?: number | null;                     // null or missing: at full HP
  temp?: number;
  hdSpent?: Record<string, number>;      // "d10": dice of that size spent
  death?: { s: number; f: number; stable?: boolean };
  insp?: boolean;
  exhaustion?: number;
  conds?: string[];
};
export type HitDice = { die: number; count: number }[];

const ABILS: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const ABIL_NAME: Record<Ability, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const PLAIN_CONDS = CONDITIONS.filter((c) => c !== "Exhaustion" && c !== "Concentrating");
const sign = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

// What a short rest can heal: each die size, how many there are, how many are left.
export function hitDiceLeft(dice: HitDice, spent: Record<string, number> = {}) {
  const by = new Map<number, number>();
  for (const d of dice) if (d.die > 0 && d.count > 0) by.set(d.die, (by.get(d.die) ?? 0) + d.count);
  return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([die, total]) => ({ die, total, left: Math.max(0, total - (spent[`d${die}`] ?? 0)) }));
}
// A long rest gives back every spent hit die (2024) or half the total, at least one (2014).
export function hitDiceAfterLongRest(dice: HitDice, spent: Record<string, number> = {}, ruleset: "2014" | "2024"): Record<string, number> {
  if (ruleset === "2024") return {};
  const total = dice.reduce((n, d) => n + d.count, 0);
  let back = Math.max(1, Math.floor(total / 2));
  const next: Record<string, number> = { ...spent };
  for (const k of Object.keys(next).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))) {
    const give = Math.min(back, next[k]); next[k] -= give; back -= give;
    if (!next[k]) delete next[k];
  }
  return next;
}
// Damage, temporary HP first, never below 0.
export function takeDamage(hp: number, temp: number, n: number): { hp: number; temp: number } {
  const fromTemp = Math.min(temp, n);
  return { temp: temp - fromTemp, hp: Math.max(0, hp - (n - fromTemp)) };
}

type Rolled = { label: string; total: number; notation: string; natural: number | null; logged: boolean; at: number };

export default function PlaySheet({ name, sheet, saveProf, ruleset, characterId, hitDice, play, onPlay, fight, onFightChanged, onShortRestResources, onLongRestResources, overrides, onOverrides, customDefenses, onCustomDefenses, importAdjust }: {
  name: string; sheet: DerivedSheet; saveProf: Ability[]; ruleset: "2014" | "2024"; characterId: string | null;
  hitDice: HitDice; play: PlayState; onPlay: (fn: (p: PlayState) => PlayState) => void;
  fight: { id: string; me: FightEntry } | null; onFightChanged: () => void;
  onShortRestResources: () => void; onLongRestResources: () => void;
  /** Phase 5e: the player's ability and max HP overrides; without onOverrides the controls are hidden. */
  overrides?: SheetOverrides; onOverrides?: (fn: (o: SheetOverrides) => SheetOverrides) => void;
  /** Phase 5f: hand-recorded defenses; without onCustomDefenses the editor is hidden. */
  customDefenses?: CustomDefenses; onCustomDefenses?: (d: CustomDefenses) => void;
  /** Phase 5i.2: an imported character's adjustments to match D&D Beyond (the passives are applied here). */
  importAdjust?: ImportAdjust;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [adv, setAdv] = useState<"flat" | "adv" | "dis">("flat");
  const [amt, setAmt] = useState("");
  const [log, setLog] = useState<Rolled[]>([]);
  const [note, setNoteRaw] = useState<{ text: string; bad: boolean } | null>(null);
  // problems in the warning colour, confirmations plain
  const setNote = useCallback((text: string | null, bad = true) => setNoteRaw(text ? { text, bad } : null), []);
  const [busy, setBusy] = useState(false);
  const [resting, setResting] = useState<"short" | "long" | null>(null);
  const [detail, setDetail] = useState<Ability | null>(null);
  const [maxOpen, setMaxOpen] = useState(false);
  const [defOpen, setDefOpen] = useState(false);
  const [defAdd, setDefAdd] = useState<{ kind: keyof CustomDefenses; type: string }>({ kind: "resist", type: "" });
  const ov: SheetOverrides = overrides ?? { ability: {}, hpMaxMod: 0, hpMaxOverride: null };

  const hpMax = Math.max(1, sheet.hpMax || 1);
  const inFight = !!fight && fight.me.hp != null;
  const hp = inFight ? (fight!.me.hp as number) : Math.min(hpMax, play.hp ?? hpMax);
  const temp = inFight ? (fight!.me.tempHp ?? 0) : (play.temp ?? 0);
  const conds = inFight ? (fight!.me.conditions ?? []) : (play.conds ?? []);
  const ex = Math.max(0, Math.min(6, play.exhaustion ?? 0));
  const death = play.death ?? { s: 0, f: 0 };
  // 2024: each level of exhaustion takes 2 off every d20 test and 5 ft off speed
  const exPenalty = ruleset === "2024" ? 2 * ex : 0;
  const speed = Math.max(0, sheet.speed - (ruleset === "2024" ? 5 * ex : 0));
  const dice = hitDiceLeft(hitDice, play.hdSpent);

  const roll = useCallback(async (label: string, notation: string, kind: string): Promise<Rolled | null> => {
    setBusy(true); setNote(null);
    try {
      const res = await fetch("/api/rolls/player", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterId, notation, kind, label }) });
      const out = await res.json().catch(() => ({})) as { error?: string; logged?: boolean; reason?: string; result?: { total: number; notation: string; natural: number | null } };
      if (!res.ok || !out.result) { setNote(out.error ?? "Could not roll."); return null; }
      const r: Rolled = { label, total: out.result.total, notation: out.result.notation, natural: out.result.natural, logged: !!out.logged, at: Date.now() };
      setLog((l) => [r, ...l].slice(0, 12));
      if (!out.logged && out.reason) setNote(`Rolled, not recorded: ${out.reason}.`);
      return r;
    } catch { setNote("Could not reach the server."); return null; } finally { setBusy(false); }
  }, [characterId, setNote]);
  const d20 = (label: string, mod: number, kind: string) => {
    const m = mod - exPenalty;
    void roll(label + (exPenalty ? ` (exhaustion -${exPenalty})` : ""), applyAdvantage(`1d20${m >= 0 ? "+" : "-"}${Math.abs(m)}`, adv), kind);
  };

  // ---- HP ----
  const act = async (action: "damage" | "heal" | "temp" | "add_condition" | "remove_condition", opts: { value?: number; condition?: string }) => {
    if (!fight) return true;
    const e = await combatAct(supabase as never, fight.id, fight.me.id, action, opts);
    if (e) { setNote(e); return false; }
    onFightChanged(); return true;
  };
  const damage = async (n: number) => {
    if (!(n > 0)) return;
    const next = takeDamage(hp, temp, n);
    if (!(await act("damage", { value: n }))) return;
    // damage at 0 HP is a failed death save
    onPlay((p) => ({ ...p, hp: next.hp, temp: next.temp, death: hp === 0 ? { s: death.s, f: Math.min(3, death.f + 1) } : p.death }));
    setAmt("");
  };
  const heal = async (n: number) => {
    if (!(n > 0)) return;
    if (!(await act("heal", { value: n }))) return;
    onPlay((p) => ({ ...p, hp: Math.min(hpMax, hp + n), death: { s: 0, f: 0 } }));
    setAmt("");
  };
  const setTemp = async (n: number) => {
    if (!(n >= 0)) return;
    if (!(await act("temp", { value: n }))) return;
    onPlay((p) => ({ ...p, temp: n })); setAmt("");
  };
  const toggleCond = async (c: string) => {
    const on = conds.includes(c);
    if (!(await act(on ? "remove_condition" : "add_condition", { condition: c }))) return;
    onPlay((p) => ({ ...p, conds: on ? (p.conds ?? []).filter((x) => x !== c) : [...(p.conds ?? []), c] }));
  };
  const setExhaustion = async (n: number) => {
    const v = Math.max(0, Math.min(6, n));
    if (fight && (v > 0) !== conds.includes("Exhaustion")) { if (!(await act(v > 0 ? "add_condition" : "remove_condition", { condition: "Exhaustion" }))) return; }
    onPlay((p) => ({ ...p, exhaustion: v }));
  };
  const deathSave = async () => {
    const r = await roll("Death save", "1d20", "death-save");
    if (!r) return;
    if (r.natural === 20) { await heal(1); setNote("A natural 20: you are back with 1 HP.", false); return; }
    const s = death.s + (r.total >= 10 ? 1 : 0), f = death.f + (r.natural === 1 ? 2 : r.total >= 10 ? 0 : 1);
    if (s >= 3) { onPlay((p) => ({ ...p, death: { s: 0, f: 0, stable: true } })); setNote("Three successes: you are stable at 0 HP.", false); return; }
    if (f >= 3) setNote("Three failures. Tell the GM.");
    onPlay((p) => ({ ...p, death: { s, f: Math.min(3, f) } }));
  };

  // ---- rests ----
  const spendHitDie = async (die: number) => {
    const con = sheet.mods.con ?? 0;
    const r = await roll(`Hit die (d${die})`, `1d${die}${con >= 0 ? "+" : "-"}${Math.abs(con)}`, "hit-die");
    if (!r) return;
    const gain = Math.max(ruleset === "2024" ? 1 : 0, r.total);
    onPlay((p) => ({ ...p, hdSpent: { ...(p.hdSpent ?? {}), [`d${die}`]: ((p.hdSpent ?? {})[`d${die}`] ?? 0) + 1 } }));
    if (gain > 0) await heal(Math.min(gain, hpMax - hp));
    setNote(`Hit die: ${r.total}, ${Math.min(gain, hpMax - hp)} HP back.`, false);
  };
  const finishShortRest = () => { onShortRestResources(); setResting(null); setNote("Short rest done: the resources that come back on a short rest are back.", false); };
  const longRest = async () => {
    if (fight) {
      if (hp < hpMax && !(await act("heal", { value: hpMax - hp }))) return;
      if (temp > 0 && !(await act("temp", { value: 0 }))) return;
    }
    onPlay((p) => ({ ...p, hp: null, temp: 0, death: { s: 0, f: 0 }, hdSpent: hitDiceAfterLongRest(hitDice, p.hdSpent, ruleset), exhaustion: Math.max(0, (p.exhaustion ?? 0) - 1) }));
    onLongRestResources(); setResting(null);
    setNote(`Long rest done: full HP, ${ruleset === "2024" ? "every hit die" : "half your hit dice"} back, resources and spell slots back${ex ? ", one level of exhaustion gone" : ""}.`, false);
  };

  // ---- layout ----
  const box: React.CSSProperties = { ...stonePanel(), marginBottom: 0, padding: "12px 14px" };
  const btn = (on = false): React.CSSProperties => ({ ...stoneButton(on ? "primary" : "stone"), fontSize: 12.5, padding: "6px 11px" });
  const mono: React.CSSProperties = { fontFamily: FORGE_FONTS.mono };
  const tiny: React.CSSProperties = { ...mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: STONE.inkFaint };
  const field: React.CSSProperties = { padding: "6px 8px", borderRadius: 4, border: `1px solid ${STONE.hi}`, background: "rgba(0,0,0,0.25)", color: STONE.ink, fontSize: 14, width: 74, ...mono };
  const n = parseInt(amt, 10);
  // a passive score is not a d20 test, so 2024 exhaustion does not lower it
  const passive = (k: string) => 10 + (sheet.skills[k]?.val ?? 0) + ((importAdjust?.passives as Record<string, number | undefined> | undefined)?.[k] ?? 0);
  const rollBtn = (label: string, mod: number, kind: string, rank = 0, key?: string, abil?: string) => (
    <button key={key ?? label} type="button" className="forge-btn" disabled={busy} onClick={() => d20(label, mod, kind)}
      title={rank >= 2 ? "Expertise" : rank >= 1 ? "Proficient" : "Not proficient"}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px", background: "transparent", border: "none", borderBottom: `1px solid ${STONE.hi}`, color: STONE.ink, cursor: "pointer", fontSize: 13.5, textAlign: "left" }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, border: `1px solid ${rank ? C.sun : STONE.hi}`, background: rank >= 1 ? C.sun : "transparent", boxShadow: rank >= 2 ? "0 0 0 2px rgba(200,162,75,0.3)" : undefined }} />
      <span style={{ flex: 1 }}>{label}{abil && <span style={{ ...mono, fontSize: 10.5, color: STONE.inkFaint, marginLeft: 6 }}>{abil}</span>}</span>
      <span style={{ ...mono, color: C.plum }}>{sign(mod - exPenalty)}</span>
    </button>
  );

  return (
    <section aria-label={`${name}: play sheet`} style={{ display: "grid", gap: 12, marginBottom: 14 }}>
      {/* the bar: roll mode, inspiration, rests */}
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ color: STONE.ink, fontSize: 15 }}>{name}</strong>
        <span style={{ ...mono, fontSize: 12, color: STONE.inkFaint }}>level {sheet.totalLevel} · proficiency {sign(sheet.proficiencyBonus)}</span>
        <span style={{ flex: 1 }} />
        <span role="group" aria-label="Roll with" style={{ display: "flex", gap: 4 }}>
          {(["dis", "flat", "adv"] as const).map((m) => (
            <button key={m} type="button" className="forge-btn" aria-pressed={adv === m} onClick={() => setAdv(m)} style={btn(adv === m)}>{m === "adv" ? "Advantage" : m === "dis" ? "Disadvantage" : "Straight"}</button>
          ))}
        </span>
        <button type="button" className="forge-btn" aria-pressed={!!play.insp} onClick={() => onPlay((p) => ({ ...p, insp: !p.insp }))} title="Heroic Inspiration: spend it to reroll a die" style={btn(!!play.insp)}>
          {play.insp ? "Inspired" : "Inspiration"}
        </button>
        <button type="button" className="forge-btn" aria-expanded={resting === "short"} onClick={() => setResting(resting === "short" ? null : "short")} style={btn(resting === "short")}>Short rest</button>
        <button type="button" className="forge-btn" aria-expanded={resting === "long"} onClick={() => setResting(resting === "long" ? null : "long")} style={btn(resting === "long")}>Long rest</button>
      </div>

      {resting === "short" && (
        <div style={box} role="region" aria-label="Short rest">
          <div style={tiny}>Short rest: spend hit dice</div>
          <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: "6px 0 8px" }}>Each die rolls with your Constitution modifier ({sign(sheet.mods.con ?? 0)}) and heals that much. {hp >= hpMax ? "You are at full HP." : `${hpMax - hp} HP to go.`}</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {dice.map((d) => (
              <button key={d.die} type="button" className="forge-btn" disabled={busy || d.left === 0 || hp >= hpMax} onClick={() => void spendHitDie(d.die)} style={btn()}>
                Spend a d{d.die} <span style={{ ...mono, color: STONE.inkFaint }}>({d.left} of {d.total} left)</span>
              </button>
            ))}
            {!dice.length && <span style={{ fontSize: 12.5, color: STONE.inkFaint }}>Pick a class first: hit dice come from it.</span>}
            <span style={{ flex: 1 }} />
            <button type="button" className="forge-btn" onClick={finishShortRest} style={btn(true)}>Finish the short rest</button>
          </div>
        </div>
      )}
      {resting === "long" && (
        <div style={{ ...box, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }} role="region" aria-label="Long rest">
          <span style={{ fontSize: 13, color: STONE.ink, flex: "1 1 280px" }}>
            A long rest: HP to {hpMax}, temporary HP gone, {ruleset === "2024" ? "every hit die" : "half your hit dice"} back, every resource and spell slot back{ex ? ", and one level of exhaustion off" : ""}.
          </span>
          <button type="button" className="forge-btn" onClick={() => void longRest()} style={btn(true)}>Take the long rest</button>
          <button type="button" className="forge-btn" onClick={() => setResting(null)} style={btn()}>Not yet</button>
        </div>
      )}

      {/* abilities, then the numbers a turn uses, then the HP box */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 8 }}>
        {ABILS.map((a) => (
          <div key={a} style={{ ...box, textAlign: "center", display: "grid", gap: 2, padding: "10px 6px", outline: detail === a ? `1px solid ${C.sun}` : "none" }}>
            <button type="button" className="forge-btn" disabled={busy} onClick={() => d20(`${ABIL_NAME[a]} check`, (sheet.mods[a] ?? 0) + (sheet.checkBonus ?? 0), "check")}
              title={`Roll a ${ABIL_NAME[a]} check${sheet.checkBonus ? ` (${sign(sheet.checkBonus)} from items)` : ""}`} aria-label={`${ABIL_NAME[a]} ${sheet.abilities[a]}, modifier ${sign(sheet.mods[a] ?? 0)}: roll a check`}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "grid", gap: 2 }}>
              <span style={tiny}>{ABIL_NAME[a]}</span>
              <span style={{ ...mono, fontSize: 26, fontWeight: 700, color: STONE.ink, lineHeight: 1.1 }}>{sign(sheet.mods[a] ?? 0)}</span>
            </button>
            <button type="button" onClick={() => setDetail(detail === a ? null : a)} aria-expanded={detail === a}
              aria-label={`${ABIL_NAME[a]} score ${sheet.abilities[a]}: where it comes from`} title="Where this score comes from"
              style={{ ...mono, fontSize: 12, color: typeof ov.ability[a] === "number" ? C.sun : STONE.inkFaint, background: "transparent", border: `1px solid ${typeof ov.ability[a] === "number" ? C.sun : STONE.hi}`, borderRadius: 999, padding: "0 8px", justifySelf: "center", cursor: "pointer" }}>{sheet.abilities[a]}</button>
          </div>
        ))}
      </div>
      {detail && (
        <div style={{ ...box }} role="region" aria-label={`${ABIL_NAME[detail]} breakdown`}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={tiny}>{ABIL_NAME[detail]} {sheet.abilities[detail]}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="forge-btn" onClick={() => setDetail(null)} style={btn()}>Close</button>
          </div>
          <div style={{ display: "grid", gap: 3, marginTop: 6 }}>
            {(sheet.abilityParts?.[detail] ?? [{ label: "Score", value: sheet.abilities[detail], how: "base" as const }]).map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: p.how === "override" ? C.sun : STONE.ink }}>
                <span style={{ flex: 1 }}>{p.label}</span>
                <span style={{ ...mono }}>{p.how === "add" ? sign(p.value) : p.value}</span>
              </div>
            ))}
          </div>
          {onOverrides && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <label style={{ fontSize: 12.5, color: STONE.inkFaint, display: "flex", gap: 6, alignItems: "center" }}>Override
                <input key={`ov-${detail}-${ov.ability[detail] ?? ""}`} inputMode="numeric" defaultValue={ov.ability[detail] ?? ""} placeholder="none"
                  onBlur={(e) => { const v = parseInt(e.target.value, 10); const d = detail; onOverrides((o) => { const ab = { ...o.ability }; if (Number.isFinite(v) && v > 0) ab[d] = Math.min(30, v); else delete ab[d]; return { ...o, ability: ab }; }); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  style={{ ...field, width: 64 }} />
              </label>
              {typeof ov.ability[detail] === "number" && (
                <button type="button" className="forge-btn" onClick={() => { const d = detail; onOverrides((o) => { const ab = { ...o.ability }; delete ab[d]; return { ...o, ability: ab }; }); }} style={btn()}>Clear override</button>
              )}
              <span style={{ fontSize: 11.5, color: STONE.inkFaint }}>An override replaces the score; everything that uses it follows.</span>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        <div style={{ ...box, textAlign: "center" }}><div style={tiny}>Armor class</div><div title={sheet.acFormula || undefined} style={{ ...mono, fontSize: 26, fontWeight: 700, color: STONE.ink }}>{sheet.ac}</div></div>
        <button type="button" className="forge-btn" disabled={busy} onClick={() => d20("Initiative", sheet.initiative, "initiative")} style={{ ...box, textAlign: "center", cursor: "pointer" }}>
          <div style={tiny}>Initiative</div><div style={{ ...mono, fontSize: 26, fontWeight: 700, color: STONE.ink }}>{sign(sheet.initiative - exPenalty)}</div>
        </button>
        <div style={{ ...box, textAlign: "center" }}>
          <div style={tiny}>Speed</div><div style={{ ...mono, fontSize: 26, fontWeight: 700, color: STONE.ink }}>{speed} ft</div>
          {sheet.otherSpeeds.length > 0 && <div style={{ fontSize: 11.5, color: STONE.inkFaint }}>{sheet.otherSpeeds.join(", ")}</div>}
        </div>
        {sheet.isCaster && <div style={{ ...box, textAlign: "center" }}><div style={tiny}>Spell save DC</div><div style={{ ...mono, fontSize: 26, fontWeight: 700, color: STONE.ink }}>{sheet.spellDC}</div><div style={{ fontSize: 11.5, color: STONE.inkFaint }}>attack {sign(sheet.spellAttack)}</div></div>}
      </div>

      <div style={{ ...box }} role="region" aria-label="Hit points">
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={tiny}>Hit points{inFight ? " (in the fight)" : ""}</div>
            <div style={{ ...mono, fontSize: 30, fontWeight: 700, color: hp === 0 ? C.warn : STONE.ink, lineHeight: 1.1 }}>
              {hp}<span style={{ fontSize: 16, color: STONE.inkFaint }}> / {hpMax}</span>
              {onOverrides && (
                <button type="button" onClick={() => setMaxOpen((v) => !v)} aria-expanded={maxOpen} title="Adjust maximum HP"
                  style={{ ...mono, fontSize: 11, marginLeft: 8, verticalAlign: "middle", background: "transparent", color: ov.hpMaxOverride || ov.hpMaxMod ? C.sun : STONE.inkFaint, border: `1px solid ${ov.hpMaxOverride || ov.hpMaxMod ? C.sun : STONE.hi}`, borderRadius: 4, padding: "1px 6px", cursor: "pointer" }}>Max HP</button>
              )}
              {temp > 0 && <span style={{ fontSize: 16, color: "#6fa3d8" }}> +{temp} temp</span>}
            </div>
          </div>
          <div style={{ flex: "1 1 120px", height: 8, background: "rgba(0,0,0,0.35)", borderRadius: 4 }}>
            <div style={{ width: `${(hp / hpMax) * 100}%`, height: 8, borderRadius: 4, background: hp / hpMax > 0.5 ? "#5fae5a" : hp / hpMax > 0.25 ? "#d9a43a" : "#d0463c" }} />
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input aria-label="Amount" value={amt} inputMode="numeric" placeholder="amount" onChange={(e) => setAmt(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
              onKeyDown={(e) => { if (e.key === "Enter") void damage(n); }} style={field} />
            <button type="button" className="forge-btn" disabled={!(n > 0) || hp >= hpMax} onClick={() => void heal(n)} style={{ ...btn(), color: C.good }}>Heal</button>
            <button type="button" className="forge-btn" disabled={!(n > 0)} onClick={() => void damage(n)} style={{ ...btn(), color: C.warn }}>Damage</button>
            <button type="button" className="forge-btn" disabled={amt === ""} onClick={() => void setTemp(n)} title="Temporary HP do not stack: this replaces what you have" style={{ ...btn(), color: "#6fa3d8" }}>Set temp</button>
          </div>
        </div>
        {maxOpen && onOverrides && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10, paddingTop: 8, borderTop: `1px solid ${STONE.hi}` }} role="group" aria-label="Maximum HP">
            <span style={{ fontSize: 12.5, color: STONE.inkFaint }}>From level, hit dice and CON: <b style={{ color: STONE.ink }}>{sheet.hpMaxRolled ?? hpMax}</b></span>
            <label style={{ fontSize: 12.5, color: STONE.inkFaint, display: "flex", gap: 6, alignItems: "center" }}>Modifier
              <input key={`hm-${ov.hpMaxMod}`} inputMode="numeric" defaultValue={ov.hpMaxMod || ""} placeholder="0"
                onBlur={(e) => { const v = parseInt(e.target.value, 10); onOverrides((o) => ({ ...o, hpMaxMod: Number.isFinite(v) ? Math.max(-999, Math.min(999, v)) : 0 })); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} style={{ ...field, width: 60 }} />
            </label>
            <label style={{ fontSize: 12.5, color: STONE.inkFaint, display: "flex", gap: 6, alignItems: "center" }}>Override
              <input key={`ho-${ov.hpMaxOverride ?? ""}`} inputMode="numeric" defaultValue={ov.hpMaxOverride ?? ""} placeholder="none"
                onBlur={(e) => { const v = parseInt(e.target.value, 10); onOverrides((o) => ({ ...o, hpMaxOverride: Number.isFinite(v) && v > 0 ? Math.min(9999, v) : null })); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} style={{ ...field, width: 64 }} />
            </label>
            <span style={{ fontSize: 11.5, color: STONE.inkFaint }}>An override replaces the maximum; the modifier adds to it (rolled HP, a curse, a boon).</span>
          </div>
        )}
        {hp > 0 && amt !== "" && n > 0 && (
          <p style={{ fontSize: 12, color: STONE.inkFaint, margin: "8px 0 0" }}>
            Heal {n}: {Math.min(hpMax, hp + n)} HP. Damage {n}: {takeDamage(hp, temp, n).hp} HP{temp ? `, ${takeDamage(hp, temp, n).temp} temp` : ""}.
          </p>
        )}
        {hp === 0 && (
          <div style={{ marginTop: 10, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }} role="group" aria-label="Death saves">
            <span style={tiny}>Death saves</span>
            {death.stable ? <span style={{ color: C.good, fontSize: 13 }}>Stable</span> : (
              <>
                <span style={{ fontSize: 13, color: STONE.ink }}>Successes {[0, 1, 2].map((i) => <span key={i} aria-hidden style={{ display: "inline-block", width: 11, height: 11, marginLeft: 3, borderRadius: 6, border: `1px solid ${C.good}`, background: i < death.s ? C.good : "transparent" }} />)}</span>
                <span style={{ fontSize: 13, color: STONE.ink }}>Failures {[0, 1, 2].map((i) => <span key={i} aria-hidden style={{ display: "inline-block", width: 11, height: 11, marginLeft: 3, borderRadius: 6, border: `1px solid ${C.warn}`, background: i < death.f ? C.warn : "transparent" }} />)}</span>
                <button type="button" className="forge-btn" disabled={busy || death.f >= 3} onClick={() => void deathSave()} style={btn(true)}>Roll a death save</button>
              </>
            )}
            <span style={{ fontSize: 11.5, color: STONE.inkFaint }}>{death.s} of 3 successes, {death.f} of 3 failures</span>
          </div>
        )}
        {dice.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: STONE.inkFaint }}>Hit dice: {dice.map((d) => `${d.left} of ${d.total} d${d.die}`).join(", ")}</div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={box}>
            <label style={forgeLabel}>Saving throws</label>
            {ABILS.map((a) => rollBtn(`${ABIL_NAME[a]} save`, sheet.saves[a] ?? 0, "save", saveProf.includes(a) ? 1 : 0))}
            {(sheet.advSaves.length > 0 || sheet.advAgainst.length > 0) && (
              <p style={{ fontSize: 12, color: STONE.inkFaint, margin: "8px 0 0" }}>
                {sheet.advSaves.length > 0 && <>Advantage on {sheet.advSaves.map((a) => ABIL_NAME[a]).join(", ")} saves{sheet.advSavesVs ? ` against ${sheet.advSavesVs}` : ""}. </>}
                {sheet.advAgainst.length > 0 && <>Advantage on saves against being {sheet.advAgainst.join(", ")}.</>}
              </p>
            )}
          </div>
          <div style={box}>
            <label style={forgeLabel}>Senses</label>
            {/* the engine keys skills in lower case; the printed names here always read 10 before phase 5i.1 */}
            {([["Passive Perception", "perception"], ["Passive Investigation", "investigation"], ["Passive Insight", "insight"]] as const).map(([l, k]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: STONE.ink, padding: "4px 0", borderBottom: `1px solid ${STONE.hi}` }}>
                <span>{l}</span><span style={{ ...mono, color: C.plum }}>{passive(k)}</span>
              </div>
            ))}
            <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: "8px 0 0" }}>{sheet.senses.length ? sheet.senses.join(", ") : "No special senses."}</p>
          </div>
        </div>

        <div style={box}>
          <label style={forgeLabel}>Skills</label>
          {/* by their proper names ("Animal Handling", not the key "animal"), in the book's order, with the ability */}
          {SKILLS.filter(([k]) => sheet.skills[k]).map(([k, label, ab]) => rollBtn(label, sheet.skills[k].val, "skill", sheet.skills[k].rank, k, ab.toUpperCase()))}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={box}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <label style={{ ...forgeLabel, flex: 1 }}>Defenses</label>
              {onCustomDefenses && <button type="button" className="forge-btn" onClick={() => setDefOpen((v) => !v)} aria-expanded={defOpen} style={{ ...btn(defOpen), fontSize: 11.5, padding: "3px 9px" }}>{defOpen ? "Done" : "Edit"}</button>}
            </div>
            {sheet.resist.length === 0 && sheet.immune.length === 0 && !(sheet.vulnerable ?? []).length && <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: 0 }}>No resistances, immunities or vulnerabilities.</p>}
            {sheet.resist.length > 0 && <p style={{ fontSize: 13, color: STONE.ink, margin: "0 0 4px" }}>Resistant: {sheet.resist.join(", ")}</p>}
            {sheet.immune.length > 0 && <p style={{ fontSize: 13, color: STONE.ink, margin: "0 0 4px" }}>Immune: {sheet.immune.join(", ")}</p>}
            {(sheet.vulnerable ?? []).length > 0 && <p style={{ fontSize: 13, color: C.warn, margin: 0 }}>Vulnerable: {(sheet.vulnerable ?? []).join(", ")}</p>}
            {defOpen && onCustomDefenses && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${STONE.hi}`, display: "grid", gap: 6 }}>
                <p style={{ fontSize: 11.5, color: STONE.inkFaint, margin: 0 }}>Ones you add by hand (a curse, a boon, a blessing). Those from your species, feats and items are worked out and cannot be removed here.</p>
                {DEF_KINDS.map(([k, label]) => (customDefenses?.[k] ?? []).length > 0 && (
                  <div key={k} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: STONE.inkFaint, minWidth: 74 }}>{label}</span>
                    {(customDefenses?.[k] ?? []).map((t) => (
                      <button key={t} type="button" className="forge-btn" aria-label={`Remove ${label.toLowerCase()} to ${t}`}
                        onClick={() => onCustomDefenses({ ...customDefenses, [k]: (customDefenses?.[k] ?? []).filter((x) => x !== t) })}
                        style={{ ...btn(), fontSize: 11.5, padding: "2px 8px" }}>{t} (remove)</button>
                    ))}
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <select aria-label="Kind of defense" value={defAdd.kind} onChange={(e) => setDefAdd({ ...defAdd, kind: e.target.value as keyof CustomDefenses })} style={{ ...field, width: "auto", fontFamily: FORGE_FONTS.body }}>
                    {DEF_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                  <select aria-label="Damage type" value={defAdd.type} onChange={(e) => setDefAdd({ ...defAdd, type: e.target.value })} style={{ ...field, width: "auto", fontFamily: FORGE_FONTS.body }}>
                    <option value="">Damage type</option>
                    {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button type="button" className="forge-btn" disabled={!defAdd.type}
                    onClick={() => { const cur = customDefenses?.[defAdd.kind] ?? []; if (!cur.includes(defAdd.type)) onCustomDefenses({ ...customDefenses, [defAdd.kind]: [...cur, defAdd.type] }); setDefAdd({ ...defAdd, type: "" }); }}
                    style={{ ...btn(), fontSize: 12, padding: "4px 10px" }}>Add</button>
                </div>
              </div>
            )}
          </div>
          <div style={box}>
            <label style={forgeLabel}>Conditions{inFight ? " (in the fight)" : ""}</label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {PLAIN_CONDS.map((c) => {
                const on = conds.includes(c);
                return <button key={c} type="button" className="forge-btn" aria-pressed={on} onClick={() => void toggleCond(c)}
                  style={{ fontSize: 11.5, padding: "3px 8px", borderRadius: 999, cursor: "pointer", border: `1px solid ${on ? "#c2a8f0" : STONE.hi}`, background: on ? "#3b2f6b" : "transparent", color: on ? "#fff" : STONE.inkFaint }}>{c}</button>;
              })}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 13, color: STONE.ink }}>Exhaustion</span>
              <button type="button" className="forge-btn" aria-label="One less level of exhaustion" disabled={ex === 0} onClick={() => void setExhaustion(ex - 1)} style={btn()}>-</button>
              <span style={{ ...mono, fontSize: 16, color: ex ? C.warn : STONE.ink, minWidth: 14, textAlign: "center" }}>{ex}</span>
              <button type="button" className="forge-btn" aria-label="One more level of exhaustion" disabled={ex === 6} onClick={() => void setExhaustion(ex + 1)} style={btn()}>+</button>
            </div>
            {ex > 0 && <p style={{ fontSize: 12, color: STONE.inkFaint, margin: "6px 0 0" }}>
              {ex >= 6 ? "Level 6: death." : ruleset === "2024" ? `-${2 * ex} to every d20 test and -${5 * ex} ft speed, already applied above.` : "2014 exhaustion: check the levels table with your GM; the sheet does not apply it."}
            </p>}
          </div>
        </div>
      </div>

      {(note || log.length > 0) && (
        <div style={box} aria-live="polite">
          {note && <p role={note.bad ? "alert" : "status"} style={{ color: note.bad ? C.warn : STONE.ink, fontSize: 12.5, margin: "0 0 6px" }}>{note.text}</p>}
          {log.map((r) => (
            <div key={r.at} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "5px 0", borderTop: `1px solid ${STONE.hi}` }}>
              <span style={{ fontSize: 13.5, color: STONE.ink }}>{r.label}<span style={{ ...mono, fontSize: 11, color: STONE.inkFaint, marginLeft: 8 }}>{r.notation}{r.logged ? "" : " · not recorded"}</span></span>
              <span style={{ ...mono, fontSize: 19, color: r.natural === 20 ? C.good : r.natural === 1 ? C.warn : C.sun }}>{r.total}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
