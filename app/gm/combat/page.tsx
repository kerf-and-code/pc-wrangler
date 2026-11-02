"use client";

// app/gm/combat/page.tsx
//
// The combat runner. Takes a fight from the Encounters page (or starts an empty one) and runs it:
// initiative, turn order and rounds, HP with damage and healing, temporary HP, AC, conditions, and
// one-click attack, damage and initiative rolls straight from each monster's stat block.
//
// Rolls go through /api/rolls/gm, the same logged roller as the Roll page, so every monster roll lands
// in vtt_events for this session with the monster's name: Mechanics shows them beside the players'
// rolls, and the encounter-calibration loop on the roadmap can compare the balancer's verdict with
// what actually happened.
//
// The fight lives in public.combats (p101): every change saves automatically, so a reload, a crash or
// moving from laptop to tablet mid-fight loses nothing. combatants are stored IN TURN ORDER and `turn`
// indexes into them; initiative edits do not reorder the list until the GM presses "Sort", so the
// current turn never jumps while someone fixes a typo. Players see the order (never monster HP, AC or
// stat blocks, and never hidden monsters) on their Initiative page through combat_for_player().

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "@/components/page-shell";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";
import { loadSrd } from "@/lib/srd/srd";
import { listStatBlocks, statBlockFromMonster, type StatBlockRow, type StatBlockDoc } from "@/lib/stat-blocks";
import { monsterSourceLabel } from "@/lib/monster-sources";
import { applyAdvantage } from "@/lib/dice";
import {
  CONDITIONS, abilityMod, applyDamage, applyHealing, blockActions, combatantId, monsterCombatants, pcCombatant,
  resolveFoeBlock, sortForTurns, type Combatant, type EncounterFoe, type ParsedAction,
} from "@/lib/combat";
import {
  initialCampaignId, initialSessionId, useRememberCampaign, useRememberSession, urlParam, setUrlParam, gmHref,
} from "@/lib/campaign-context";

type Campaign = { id: string; name: string; system: string | null; share_code: string | null };
type Sess = { id: string; session_number: number | null; status: string | null };
type Pc = { id: string; name: string };
type CombatRow = { id: string; name: string; rules: string; status: string; round: number; turn: number; combatants: Combatant[]; session_id: string | null; encounter_id: string | null };
type SavedEnc = { id: string; name: string; rules: string; foes: EncounterFoe[] };
type RollLog = { id: string; who: string; label: string; notation: string; total: number; natural: number | null };
type AdvMode = "flat" | "adv" | "dis";

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const d20 = (bonus: number) => `1d20${bonus ? signed(bonus) : ""}`;

export default function CombatPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  useRememberCampaign(campaignId, campaigns);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [sessionId, setSessionId] = useState("");
  useRememberSession(campaignId, sessionId);
  const [pcs, setPcs] = useState<Pc[]>([]);
  const [blocks, setBlocks] = useState<StatBlockRow[]>([]);
  const [saved, setSaved] = useState<SavedEnc[]>([]);
  const [combat, setCombat] = useState<CombatRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adv, setAdv] = useState<AdvMode>("flat");
  const [log, setLog] = useState<RollLog[]>([]);
  const [rolling, setRolling] = useState(false);
  const [undo, setUndo] = useState<{ c: Combatant; index: number } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");

  // ---- load ----
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setErr("Sign in to run a fight."); setLoading(false); return; }
      const [{ data: camps }, own] = await Promise.all([
        supabase.from("campaigns").select("id, name, system, share_code").eq("gm_id", user.id).order("created_at", { ascending: false }),
        listStatBlocks(supabase).catch(() => [] as StatBlockRow[]),
      ]);
      const list = (camps as Campaign[]) || [];
      setCampaigns(list);
      setBlocks(own.filter((b) => !b.system || b.system === "dnd5e"));
      setCampaignId(initialCampaignId(list));
      setLoading(false);
      try { const n = sessionStorage.getItem("sax_combat_note"); if (n) { setNote(n); sessionStorage.removeItem("sax_combat_note"); } } catch { /* ignore */ }
    })();
  }, [supabase]);

  const loadCampaign = useCallback(async (cid: string) => {
    setErr(null);
    const [{ data: s }, { data: p }, { data: enc, error: encErr }, { data: cbs, error: cbErr }] = await Promise.all([
      supabase.from("sessions").select("id, session_number, status").eq("campaign_id", cid).order("session_number", { ascending: false }),
      supabase.from("characters").select("id, name").eq("campaign_id", cid).eq("kind", "pc").eq("active", true).is("alter_ego_of", null).order("name"),
      supabase.from("encounters").select("id, name, rules, foes").eq("campaign_id", cid).order("updated_at", { ascending: false }),
      supabase.from("combats").select("id, name, rules, status, round, turn, combatants, session_id, encounter_id").eq("campaign_id", cid).eq("status", "active").order("updated_at", { ascending: false }),
    ]);
    if (encErr || cbErr) {
      const msg = (encErr || cbErr)!.message;
      setErr(msg.includes("does not exist") ? "The combat tables are not set up yet. Run migration p101 in Supabase." : msg);
    }
    const sl = (s as Sess[]) || [];
    setSessions(sl);
    setSessionId(initialSessionId(cid, sl));
    setPcs((p as Pc[]) || []);
    setSaved((enc as SavedEnc[]) || []);
    const active = (cbs as CombatRow[]) || [];
    const wanted = urlParam("combat");
    const pick = active.find((c) => c.id === wanted) ?? active[0] ?? null;
    setCombat(pick);
    setSelectedId(null);
    setLog([]);
  }, [supabase]);
  useEffect(() => { if (campaignId) void loadCampaign(campaignId); }, [campaignId, loadCampaign]);
  useEffect(() => { setUrlParam("combat", combat?.id ?? null); }, [combat?.id]);

  // ---- autosave (debounced) ----
  const pending = useRef<CombatRow | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    const c = pending.current;
    if (!c) return;
    pending.current = null;
    setSaveState("saving");
    const { error } = await supabase.from("combats").update({
      name: c.name, round: c.round, turn: c.turn, combatants: c.combatants, session_id: c.session_id || null,
      updated_at: new Date().toISOString(),
    }).eq("id", c.id);
    setSaveState(error ? "error" : "idle");
    if (error) setErr(`Not saved: ${error.message}`);
  }, [supabase]);
  const update = useCallback((fn: (c: CombatRow) => CombatRow) => {
    setCombat((cur) => {
      if (!cur) return cur;
      const next = fn(cur);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 400);
      return next;
    });
  }, [flush]);
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush(); } }, [flush]);

  const setCombatant = (id: string, fn: (c: Combatant) => Combatant) =>
    update((cb) => ({ ...cb, combatants: cb.combatants.map((x) => (x.id === id ? fn(x) : x)) }));

  // ---- starting a fight ----
  const libraryFor = useCallback((ed: string) =>
    loadSrd("monsters", (ed === "2014" || ed === "2024" ? ed : "both") as "2014" | "2024" | "both") as unknown as Record<string, unknown>[], []);

  async function startFight(enc: SavedEnc | null) {
    if (!campaignId) return;
    setErr(null);
    const monsters: Combatant[] = [];
    let unresolved = 0;
    for (const f of enc?.foes ?? []) {
      const block = resolveFoeBlock(f, blocks as unknown as { id: string; block: unknown; system?: string | null }[], libraryFor, statBlockFromMonster);
      if (!block) unresolved += f.count;
      monsters.push(...monsterCombatants(f.name, f.count, block));
    }
    const combatants = [...pcs.map(pcCombatant), ...monsters];
    const { data, error } = await supabase.from("combats").insert({
      campaign_id: campaignId, encounter_id: enc?.id ?? null, session_id: sessionId || null,
      name: enc?.name ?? "Combat", rules: enc?.rules ?? "2024", combatants,
    }).select("id, name, rules, status, round, turn, combatants, session_id, encounter_id").single();
    if (error) { setErr(error.message.includes("does not exist") ? "Run migration p101 in Supabase first." : `Could not start: ${error.message}`); return; }
    setCombat(data as CombatRow);
    setNote(unresolved ? `${unresolved} monster${unresolved === 1 ? " has" : "s have"} no stat block (typed in by hand). Set their HP and AC below.` : null);
  }

  async function endFight() {
    if (!combat) return;
    if (!window.confirm(`End "${combat.name}"? Players stop seeing it, and it leaves this page. The rolls stay in this session's Mechanics.`)) return;
    if (timer.current) { clearTimeout(timer.current); await flush(); }
    const { error } = await supabase.from("combats").update({ status: "ended", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", combat.id);
    if (error) { setErr(`Not ended: ${error.message}`); return; }
    setCombat(null); setSelectedId(null); setLog([]);
    void loadCampaign(campaignId);
  }

  // ---- turns ----
  const live = combat?.combatants ?? [];
  const canAct = (c: Combatant) => !(c.kind === "monster" && c.defeated);
  function step(dir: 1 | -1) {
    update((cb) => {
      const n = cb.combatants.length;
      if (!n) return cb;
      let turn = cb.turn, round = cb.round;
      for (let i = 0; i < n; i++) {
        turn += dir;
        if (turn >= n) { turn = 0; round += 1; }
        if (turn < 0) { turn = n - 1; round = Math.max(1, round - 1); }
        if (canAct(cb.combatants[turn])) break;
      }
      return { ...cb, turn, round };
    });
    setSelectedId(null);
  }
  // N / P move the turn from the keyboard, the action a GM repeats most in a fight. Ignored while
  // typing in a field (HP, damage, names) or with a modifier held, so it never fights the inputs.
  const stepRef = useRef(step);
  stepRef.current = step;
  const hasFight = !!combat;
  useEffect(() => {
    if (!hasFight) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === "n") { e.preventDefault(); stepRef.current(1); }
      else if (k === "p") { e.preventDefault(); stepRef.current(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasFight]);
  function sortNow() {
    update((cb) => {
      const currentId = cb.combatants[cb.turn]?.id;
      const sorted = sortForTurns(cb.combatants);
      const turn = Math.max(0, sorted.findIndex((c) => c.id === currentId));
      return { ...cb, combatants: sorted, turn };
    });
  }

  // ---- rolling ----
  const roll = useCallback(async (who: Combatant, notation: string, kind: string, label: string) => {
    if (!campaignId) return null;
    const res = await fetch("/api/rolls/gm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, sessionId: sessionId || null, notation, kind, actorName: who.name, characterId: who.kind === "pc" ? who.characterId ?? null : null, label }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(out.error ?? "Could not roll."); return null; }
    const r = out.result as { total: number; natural: number | null; notation: string };
    setLog((l) => [{ id: combatantId(), who: who.name, label, notation: r.notation, total: r.total, natural: r.natural }, ...l].slice(0, 30));
    return r;
  }, [campaignId, sessionId]);

  async function rollMonsterInitiative() {
    if (!combat) return;
    const targets = combat.combatants.filter((c) => c.kind === "monster" && c.initiative == null);
    if (!targets.length) { setNote("Every monster already has initiative. Clear one to roll it again."); return; }
    setRolling(true);
    const got: Record<string, number> = {};
    for (const c of targets) {
      const r = await roll(c, d20(c.initBonus), "initiative", "Initiative");
      if (!r) break;
      got[c.id] = r.total;
    }
    setRolling(false);
    update((cb) => {
      const withInit = cb.combatants.map((c) => (got[c.id] != null ? { ...c, initiative: got[c.id] } : c));
      // Before the first turn has been taken, put everyone in order at once; mid-fight, leave the order
      // alone and let the GM press Sort.
      if (cb.round === 1 && cb.turn === 0) return { ...cb, combatants: sortForTurns(withInit), turn: 0 };
      return { ...cb, combatants: withInit };
    });
  }

  // ---- adding and removing ----
  const [addPc, setAddPc] = useState("");
  const [monQuery, setMonQuery] = useState("");
  const [custom, setCustom] = useState({ name: "", hp: "", ac: "", init: "" });
  // The whole library in both editions, so a 2024 fight can still add a third-party (2014-file) monster.
  const library = useMemo(() => libraryFor("both"), [libraryFor]);
  const monHits = useMemo(() => {
    const q = monQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const own = blocks.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 6)
      .map((b) => ({ key: `mine:${b.id}`, label: `${b.name} (yours)`, name: b.name, block: b.block as StatBlockDoc }));
    const lib = library.filter((m) => String(m.name ?? "").toLowerCase().includes(q)).slice(0, 12)
      .map((m, i) => ({ key: `lib:${String(m.source_key)}:${String(m.name)}:${i}`, label: `${String(m.name)} (CR ${String(m.cr ?? "?")}, ${monsterSourceLabel(m.source_key as string)})`, name: String(m.name), block: statBlockFromMonster(m) }));
    return [...own, ...lib];
  }, [monQuery, blocks, library]);

  const addCombatants = (cs: Combatant[]) => update((cb) => ({ ...cb, combatants: [...cb.combatants, ...cs] }));
  function removeCombatant(id: string) {
    update((cb) => {
      const index = cb.combatants.findIndex((c) => c.id === id);
      if (index < 0) return cb;
      setUndo({ c: cb.combatants[index], index });
      const combatants = cb.combatants.filter((c) => c.id !== id);
      const turn = index < cb.turn ? cb.turn - 1 : Math.min(cb.turn, Math.max(0, combatants.length - 1));
      return { ...cb, combatants, turn };
    });
    if (selectedId === id) setSelectedId(null);
  }
  function undoRemove() {
    if (!undo) return;
    update((cb) => {
      const combatants = [...cb.combatants];
      combatants.splice(Math.min(undo.index, combatants.length), 0, undo.c);
      return { ...cb, combatants, turn: undo.index <= cb.turn ? cb.turn + 1 : cb.turn };
    });
    setUndo(null);
  }
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 8000); return () => clearTimeout(t); }, [undo]);

  // ---- derived ----
  const current = live[combat?.turn ?? 0] ?? null;
  const selected = live.find((c) => c.id === selectedId) ?? current;
  const campaign = campaigns.find((c) => c.id === campaignId);
  const playerLink = campaign?.share_code ? `/initiative?share=${encodeURIComponent(campaign.share_code)}` : null;

  // ---- styles ----
  const box: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "14px 16px", marginBottom: 14 };
  const input: React.CSSProperties = { background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "6px 8px", fontSize: 13.5 };
  const btn = (primary = false): React.CSSProperties => ({ background: primary ? C.brass : "transparent", color: primary ? C.ink : C.text, border: primary ? "none" : `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: SAX.mono, cursor: "pointer" });
  const eyebrow: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.muted, marginBottom: 8 };

  return (
    <PageShell width={1240}>
      <h1 style={{ fontFamily: SAX.serif, fontSize: 30, margin: "4px 0 2px", color: C.text }}>Combat</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 14px", lineHeight: 1.6, maxWidth: 760 }}>
        Run a fight: initiative, HP, conditions, and one-click rolls from each monster&apos;s stat block. Monster rolls are logged to the session,
        so they show up in Mechanics next to the players&apos;. Build and balance fights on <a href="/gm/encounters" style={{ color: C.sun }}>Encounters</a>, then press Run.
        {campaignId && <> Everything else for the night is on <a href={gmHref("/gm/tonight", { campaign: campaignId, session: sessionId || null })} style={{ color: C.sun }}>Tonight</a>.</>}
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={input} aria-label="Campaign">
          {campaigns.length === 0 && <option value="">No campaigns yet</option>}
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sessionId} onChange={(e) => { setSessionId(e.target.value); if (combat) update((cb) => ({ ...cb, session_id: e.target.value || null })); }} style={input} aria-label="Session the rolls are logged to">
          <option value="">Rolls not tied to a session</option>
          {sessions.map((s) => <option key={s.id} value={s.id}>Session {s.session_number ?? "?"}{s.status === "live" ? " (live)" : s.status === "scheduled" ? " (scheduled)" : ""}</option>)}
        </select>
        {playerLink && combat && (
          <span style={{ color: C.muted, fontSize: 12.5 }}>
            Players follow along at <a href={playerLink} target="_blank" rel="noopener noreferrer" style={{ color: C.sun }}>their Initiative page</a> (hidden monsters and all monster HP stay private).
          </span>
        )}
      </div>

      {err && <p role="alert" style={{ color: C.warn, fontSize: 13, margin: "0 0 10px" }}>{err}</p>}
      {note && <p role="status" style={{ color: C.muted, fontSize: 13, margin: "0 0 10px" }}>{note}</p>}
      {loading && <p style={{ color: C.muted }}>Loading…</p>}

      {!loading && campaignId && !combat && (
        <div style={box}>
          <div style={eyebrow}>Start a fight</div>
          {saved.length === 0 ? (
            <p style={{ color: C.muted, fontSize: 13.5, margin: "0 0 10px" }}>No saved encounters yet. Build one on <a href="/gm/encounters" style={{ color: C.sun }}>Encounters</a> and press Run, or start an empty fight and add combatants here.</p>
          ) : (
            <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              {saved.map((e) => (
                <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{e.name}</span>
                  <span style={{ color: C.muted, fontSize: 12.5 }}>{e.foes.reduce((n, f) => n + f.count, 0)} monsters · {e.rules} rules</span>
                  <button type="button" style={btn(true)} onClick={() => void startFight(e)}>Start</button>
                </div>
              ))}
            </div>
          )}
          <button type="button" style={btn()} onClick={() => void startFight(null)}>Start an empty fight with the party</button>
        </div>
      )}

      {combat && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.55fr) minmax(300px, 1fr)", gap: 16, alignItems: "start" }} className="sax-combat-grid">
          <style>{`@media (max-width: 900px){ .sax-combat-grid{ grid-template-columns: minmax(0,1fr) !important; } }`}</style>
          <div>
            <div style={{ ...box, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input value={combat.name} onChange={(e) => update((cb) => ({ ...cb, name: e.target.value }))} style={{ ...input, fontWeight: 700, flex: "1 1 180px" }} aria-label="Fight name" />
              <span style={{ fontFamily: SAX.mono, fontSize: 13, color: C.text }}>Round {combat.round}</span>
              <button type="button" style={btn()} onClick={() => step(-1)} title="Previous turn (P)">Prev</button>
              <button type="button" style={btn(true)} onClick={() => step(1)} title="Next turn, skips defeated monsters (N)">Next turn</button>
              <button type="button" style={btn()} onClick={() => void rollMonsterInitiative()} disabled={rolling} title="Roll initiative for every monster that has none, logged to the session">{rolling ? "Rolling…" : "Roll monster initiative"}</button>
              <button type="button" style={btn()} onClick={sortNow} title="Order everyone by initiative; the current turn stays with the same combatant">Sort</button>
              <button type="button" style={{ ...btn(), color: C.warn }} onClick={() => void endFight()}>End fight</button>
              <span style={{ fontSize: 11.5, color: saveState === "error" ? C.warn : C.muted }}>{saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved"}</span>
            </div>
            {undo && (
              <p role="status" style={{ fontSize: 13, color: C.text, margin: "0 0 10px" }}>
                Removed {undo.c.name}. <button type="button" onClick={undoRemove} style={{ ...btn(), padding: "2px 10px", color: C.sun, borderColor: C.sun }}>Undo</button>
              </p>
            )}

            <div style={{ display: "grid", gap: 8 }}>
              {live.length === 0 && <div style={{ ...box, color: C.muted, fontSize: 13.5 }}>No combatants. Add the party and monsters below.</div>}
              {live.map((c, i) => (
                <CombatantRow key={c.id} c={c} isTurn={i === combat.turn} isSelected={selected?.id === c.id}
                  onSelect={() => setSelectedId(c.id)} onChange={(fn) => setCombatant(c.id, fn)} onRemove={() => removeCombatant(c.id)}
                  input={input} btn={btn} />
              ))}
            </div>

            <div style={{ ...box, marginTop: 14 }}>
              <div style={eyebrow}>Add to the fight</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                <select value={addPc} onChange={(e) => setAddPc(e.target.value)} style={input} aria-label="Add a player character">
                  <option value="">Player character…</option>
                  {pcs.filter((p) => !live.some((c) => c.characterId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button type="button" style={btn()} disabled={!addPc} onClick={() => { const p = pcs.find((x) => x.id === addPc); if (p) addCombatants([pcCombatant(p)]); setAddPc(""); }}>Add PC</button>
              </div>
              <input value={monQuery} onChange={(e) => setMonQuery(e.target.value)} placeholder="Search your stat blocks and the monster library" style={{ ...input, width: "100%", marginBottom: 6 }} aria-label="Search monsters" />
              {monHits.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {monHits.map((h) => (
                    <button key={h.key} type="button" style={{ ...btn(), fontFamily: "inherit", fontWeight: 600 }}
                      onClick={() => { const n = live.filter((c) => c.name === h.name || c.name.startsWith(`${h.name} `)).length; addCombatants(monsterCombatants(n ? `${h.name} ${n + 1}` : h.name, 1, h.block)); }}>
                      + {h.label}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="Custom name" style={{ ...input, flex: "1 1 140px" }} />
                <input value={custom.hp} onChange={(e) => setCustom({ ...custom, hp: e.target.value })} placeholder="HP" inputMode="numeric" style={{ ...input, width: 64 }} />
                <input value={custom.ac} onChange={(e) => setCustom({ ...custom, ac: e.target.value })} placeholder="AC" inputMode="numeric" style={{ ...input, width: 64 }} />
                <input value={custom.init} onChange={(e) => setCustom({ ...custom, init: e.target.value })} placeholder="Init +" inputMode="numeric" style={{ ...input, width: 70 }} />
                <button type="button" style={btn()} disabled={!custom.name.trim()} onClick={() => {
                  const hp = Number(custom.hp); const ac = Number(custom.ac); const ib = Number(custom.init);
                  const [m] = monsterCombatants(custom.name.trim(), 1, null);
                  addCombatants([{ ...m, hp: custom.hp ? hp : null, maxHp: custom.hp ? hp : null, ac: custom.ac ? ac : null, initBonus: custom.init ? ib : 0 }]);
                  setCustom({ name: "", hp: "", ac: "", init: "" });
                }}>Add custom</button>
              </div>
            </div>
          </div>

          <div>
            {selected && (
              <DetailPanel c={selected} adv={adv} onAdv={setAdv} box={box} btn={btn} eyebrow={eyebrow}
                onRoll={(notation, kind, label) => void roll(selected, notation, kind, label)} />
            )}
            <div style={box}>
              <div style={eyebrow}>Roll log</div>
              {log.length === 0 ? <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Rolls you make here appear in this list and in the session&apos;s Mechanics.</p> : (
                <div style={{ display: "grid", gap: 4 }}>
                  {log.map((r) => (
                    <div key={r.id} style={{ fontSize: 13, color: C.text }}>
                      <strong>{r.who}</strong> <span style={{ color: C.muted }}>{r.label} ({r.notation})</span>{" "}
                      <span style={{ fontFamily: SAX.mono, fontWeight: 700, color: r.natural === 20 ? C.good : r.natural === 1 ? C.warn : C.text }}>{r.total}</span>
                      {r.natural === 20 && <span style={{ color: C.good, fontSize: 11.5 }}> natural 20</span>}
                      {r.natural === 1 && <span style={{ color: C.warn, fontSize: 11.5 }}> natural 1</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

/* ---------------------------------------------------------------- one row in the turn order */
function CombatantRow({ c, isTurn, isSelected, onSelect, onChange, onRemove, input, btn }: {
  c: Combatant; isTurn: boolean; isSelected: boolean; onSelect: () => void;
  onChange: (fn: (c: Combatant) => Combatant) => void; onRemove: () => void;
  input: React.CSSProperties; btn: (p?: boolean) => React.CSSProperties;
}) {
  const [amt, setAmt] = useState("");
  const n = Number(amt);
  const bloodied = c.kind === "monster" && c.hp != null && c.maxHp != null && c.maxHp > 0 && c.hp <= c.maxHp / 2 && c.hp > 0;
  const numOrNull = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return (
    <div onClick={onSelect}
      style={{ background: C.panel, border: `1px solid ${isTurn ? C.sun : isSelected ? C.brass : C.line}`, borderLeft: `4px solid ${isTurn ? C.sun : "transparent"}`,
        borderRadius: FORGE_RADIUS, padding: "10px 12px", opacity: c.defeated ? 0.5 : 1, cursor: "pointer" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input value={c.initiative ?? ""} onClick={(e) => e.stopPropagation()} onChange={(e) => onChange((x) => ({ ...x, initiative: numOrNull(e.target.value) }))}
          placeholder="Init" inputMode="numeric" title="Initiative" style={{ ...input, width: 54, textAlign: "center", fontFamily: SAX.mono }} />
        <span style={{ color: C.text, fontSize: 15, fontWeight: 700, textDecoration: c.defeated ? "line-through" : undefined }}>{c.name}</span>
        <span style={{ fontSize: 11, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 999, padding: "0 7px" }}>{c.kind === "pc" ? "PC" : "monster"}</span>
        {isTurn && <span style={{ fontSize: 11, color: C.sun, fontWeight: 700 }}>TURN</span>}
        {bloodied && <span style={{ fontSize: 11, color: C.warn }}>bloodied</span>}
        {c.hidden && <span style={{ fontSize: 11, color: C.plum }}>hidden from players</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: SAX.mono, fontSize: 12.5, color: C.muted }}>AC</span>
        <input value={c.ac ?? ""} onClick={(e) => e.stopPropagation()} onChange={(e) => onChange((x) => ({ ...x, ac: numOrNull(e.target.value) }))} inputMode="numeric" style={{ ...input, width: 46, textAlign: "center" }} aria-label="Armor class" />
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <span style={{ fontFamily: SAX.mono, fontSize: 12.5, color: C.muted }}>HP</span>
        <input value={c.hp ?? ""} onChange={(e) => onChange((x) => ({ ...x, hp: numOrNull(e.target.value) }))} inputMode="numeric" style={{ ...input, width: 54, textAlign: "center" }} aria-label="Current HP" />
        <span style={{ color: C.muted }}>/</span>
        <input value={c.maxHp ?? ""} onChange={(e) => onChange((x) => ({ ...x, maxHp: numOrNull(e.target.value) }))} inputMode="numeric" style={{ ...input, width: 54, textAlign: "center" }} aria-label="Max HP" />
        <span style={{ fontFamily: SAX.mono, fontSize: 12.5, color: C.muted }}>temp</span>
        <input value={c.tempHp || ""} onChange={(e) => onChange((x) => ({ ...x, tempHp: Math.max(0, Number(e.target.value) || 0) }))} inputMode="numeric" style={{ ...input, width: 46, textAlign: "center" }} aria-label="Temporary HP" />
        <input value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="amount" inputMode="numeric" style={{ ...input, width: 72 }} aria-label="Damage or healing amount"
          onKeyDown={(e) => { if (e.key === "Enter" && n > 0) { onChange((x) => applyDamage(x, n)); setAmt(""); } }} />
        <button type="button" style={{ ...btn(), color: C.warn }} disabled={!(n > 0)} onClick={() => { onChange((x) => applyDamage(x, n)); setAmt(""); }}>Damage</button>
        <button type="button" style={{ ...btn(), color: C.good }} disabled={!(n > 0)} onClick={() => { onChange((x) => applyHealing(x, n)); setAmt(""); }}>Heal</button>
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        {c.conditions.map((k) => (
          <button key={k} type="button" title="Remove condition" onClick={() => onChange((x) => ({ ...x, conditions: x.conditions.filter((y) => y !== k) }))}
            style={{ fontSize: 11.5, color: C.text, background: "rgba(200,162,75,0.12)", border: `1px solid ${C.line}`, borderRadius: 999, padding: "1px 8px", cursor: "pointer" }}>{k} ×</button>
        ))}
        <select value="" onChange={(e) => { const v = e.target.value; if (v) onChange((x) => ({ ...x, conditions: x.conditions.includes(v) ? x.conditions : [...x.conditions, v] })); }}
          style={{ ...input, padding: "3px 6px", fontSize: 12 }} aria-label="Add a condition">
          <option value="">+ condition</option>
          {CONDITIONS.filter((k) => !c.conditions.includes(k)).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        {c.kind === "monster" && (
          <label style={{ fontSize: 12, color: C.muted, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }} title="Hidden monsters are left out of the players' Initiative page">
            <input type="checkbox" checked={c.hidden} onChange={(e) => onChange((x) => ({ ...x, hidden: e.target.checked }))} /> hidden
          </label>
        )}
        <label style={{ fontSize: 12, color: C.muted, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={c.defeated} onChange={(e) => onChange((x) => ({ ...x, defeated: e.target.checked }))} /> {c.kind === "pc" ? "down" : "defeated"}
        </label>
        <button type="button" onClick={onRemove} title="Remove from the fight (Undo is offered)" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the selected combatant's sheet */
function DetailPanel({ c, adv, onAdv, onRoll, box, btn, eyebrow }: {
  c: Combatant; adv: AdvMode; onAdv: (m: AdvMode) => void; onRoll: (notation: string, kind: string, label: string) => void;
  box: React.CSSProperties; btn: (p?: boolean) => React.CSSProperties; eyebrow: React.CSSProperties;
}) {
  const b = c.block;
  const groups = blockActions(b);
  const seg = (on: boolean): React.CSSProperties => ({ ...btn(on), padding: "4px 10px" });
  const abil = b ? (["str", "dex", "con", "int", "wis", "cha"] as const).map((k) => `${k.toUpperCase()} ${b[k]} (${signed(abilityMod(b[k]))})`) : [];
  return (
    <div style={box}>
      <div style={eyebrow}>{c.name}</div>
      {!b ? (
        <p style={{ color: C.muted, fontSize: 13, margin: "0 0 8px" }}>
          {c.kind === "pc" ? "A player character: players roll their own dice. Track HP, conditions and initiative here." : "No stat block for this combatant (typed in by hand)."}
        </p>
      ) : (
        <>
          <p style={{ color: C.muted, fontSize: 12.5, margin: "0 0 4px" }}>{[b.size, b.type, b.alignment].filter(Boolean).join(" · ")}</p>
          <p style={{ color: C.text, fontSize: 12.5, margin: "0 0 4px" }}>{[`AC ${b.ac ?? "?"}`, `HP ${b.hp ?? "?"}${b.hit_dice ? ` (${b.hit_dice})` : ""}`, b.speed && `Speed ${b.speed}`, `CR ${b.cr}`].filter(Boolean).join(" · ")}</p>
          <p style={{ color: C.muted, fontSize: 12, margin: "0 0 8px", fontFamily: SAX.mono }}>{abil.join("  ")}</p>
          {(b.damage_resistances?.length || b.damage_immunities?.length || b.condition_immunities?.length) ? (
            <p style={{ color: C.muted, fontSize: 12, margin: "0 0 8px" }}>
              {[b.damage_resistances?.length && `Resists ${b.damage_resistances.join(", ")}`, b.damage_immunities?.length && `Immune ${b.damage_immunities.join(", ")}`, b.condition_immunities?.length && `Condition immune ${b.condition_immunities.join(", ")}`].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.muted }}>Attack rolls:</span>
        <button type="button" style={seg(adv === "flat")} onClick={() => onAdv("flat")}>Normal</button>
        <button type="button" style={seg(adv === "adv")} onClick={() => onAdv("adv")}>Advantage</button>
        <button type="button" style={seg(adv === "dis")} onClick={() => onAdv("dis")}>Disadvantage</button>
        <button type="button" style={btn()} onClick={() => onRoll(d20(c.initBonus), "initiative", "Initiative")}>Initiative {signed(c.initBonus)}</button>
      </div>
      {groups.map((g) => (
        <div key={g.group} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, color: C.sun, fontWeight: 700, marginBottom: 4 }}>{g.group}</div>
          {g.actions.map((a, i) => <ActionLine key={`${a.name}-${i}`} a={a} adv={adv} onRoll={onRoll} btn={btn} />)}
        </div>
      ))}
    </div>
  );
}

function ActionLine({ a, adv, onRoll, btn }: { a: ParsedAction; adv: AdvMode; onRoll: (n: string, k: string, l: string) => void; btn: (p?: boolean) => React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const small: React.CSSProperties = { ...btn(), padding: "3px 9px", fontSize: 12 };
  return (
    <div style={{ padding: "6px 0", borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ background: "none", border: "none", color: C.text, fontWeight: 700, fontSize: 13, cursor: "pointer", padding: 0 }} title="Show the full text">{a.name}</button>
        {a.toHit != null && <button type="button" style={small} onClick={() => onRoll(applyAdvantage(d20(a.toHit as number), adv), "attack", a.name)}>Attack {signed(a.toHit)}</button>}
        {a.damage.map((d, i) => (
          <button key={i} type="button" style={small} onClick={() => onRoll(d.dice, "damage", `${a.name} damage${d.type ? ` (${d.type})` : ""}`)}>{d.dice}{d.type ? ` ${d.type}` : ""}</button>
        ))}
        {a.save && <span style={{ fontSize: 12, color: C.plum }}>DC {a.save.dc}{a.save.ability ? ` ${a.save.ability}` : ""}</span>}
      </div>
      {open && <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.5, margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{a.desc}</p>}
    </div>
  );
}
