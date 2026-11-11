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
//
// Phase 4a (2026-11-07): one fight, three screens. The tabletop and the players' character sheets act
// on this same row (players through combat_act and their targeted attacks, p110), so this page now
// listens for changes and applies its own edits on top of the latest saved fight rather than over it:
// each edit is queued as a function and replayed on a fresh read when it saves. The combatant whose
// turn it is can attack a chosen target: the attack is compared with the target's AC, and on a hit the
// damage is rolled and taken off the target at once (critical hits double the dice). Save-based actions
// wait for the target's saving throw (phase 4b, p111): the damage is rolled once, a monster's save is
// rolled here at once, and a player character's save waits as a pending save until the player rolls it
// on their sheet or the tabletop (or the GM settles it: they saved, they failed). HP and conditions stay
// editable by hand for anyone at any time: the GM is never gated. The GM screen stays a reference board.
//
// Phase 4c (p112): action economy. The combatant whose turn it is shows its action, bonus action and
// reaction (click one to mark it used or give it back), how far it has moved of its speed, and attacks
// left; anyone whose reaction is used shows that too. The database gives each creature a fresh turn
// when its turn begins, so stepping the turn here needs nothing more. The GM is never blocked.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "@/components/page-shell";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";
import { loadSrd } from "@/lib/srd/srd";
import { listStatBlocks, statBlockFromMonster, type StatBlockRow, type StatBlockDoc } from "@/lib/stat-blocks";
import { monsterSourceLabel } from "@/lib/monster-sources";
import { applyAdvantage } from "@/lib/dice";
import { MARKERS, BUFFS, DEBUFFS, critDice, markerKind, MARKER_COLORS, econOf, speedNow, FRESH_ECON } from "@/lib/combat-effects";
import { MarkerGlyph } from "@/components/marker-icon";
import { openTabletop } from "@/lib/tabletop/open";
import { getModule } from "@/lib/systems/registry";
import {
  CONDITIONS, abilityMod, applyDamage, applyHealing, blockActions, combatantId, monsterCombatants, pcCombatant,
  resolveFoeBlock, sortForTurns, type Combatant, type EncounterFoe, type ParsedAction,
  isDndFamilyBlock,
} from "@/lib/combat";
import {
  initialCampaignId, initialSessionId, useRememberCampaign, useRememberSession, urlParam, setUrlParam, gmHref,
} from "@/lib/campaign-context";
import { friendlyError, notReady } from "@/lib/friendly-error";
import { askConfirm } from "@/lib/confirm";
import CampaignPicker from "@/components/ui-forge/CampaignPicker";

type Campaign = { id: string; name: string; system: string | null; share_code: string | null };
type Sess = { id: string; session_number: number | null; status: string | null };
type Pc = { id: string; name: string };
type CombatRow = { id: string; name: string; rules: string; status: string; round: number; turn: number; combatants: Combatant[]; session_id: string | null; encounter_id: string | null };
type SavedEnc = { id: string; name: string; rules: string; foes: EncounterFoe[] };
type RollLog = { id: string; who: string; label: string; notation: string; total: number; natural: number | null };
type AdvMode = "flat" | "adv" | "dis";
type HpSnap = { hp: number | null; tempHp: number; defeated: boolean };
type PendingSave = { id: string; by: string; byId?: string; label: string; ability: string; dc: number; damage: number; type?: string; half: boolean; conditions?: string[]; at?: number };
type WithSaves = Combatant & { pendingSaves?: PendingSave[]; lastSave?: unknown };
type SaveLine = { name: string; text: string };
const ABIL3 = (a: string | null | undefined): string => {
  const k = (a ?? "").trim().toLowerCase().slice(0, 3);
  return ["str", "dex", "con", "int", "wis", "cha"].includes(k) ? k : "dex";
};
const pendingOf = (c: Combatant): PendingSave[] => ((c as WithSaves).pendingSaves ?? []);
type AttackResult = {
  key: string; attacker: string; action: string; targetId: string; targetName: string;
  total: number | null; natural: number | null; ac: number | null;
  outcome: "hit" | "crit" | "miss" | "unknown" | "save";
  damage: number | null; parts: string; before: HpSnap | null; applied: number | null;
};

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
      setBlocks(own.filter((b) => isDndFamilyBlock(b.system)));
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
      // D&D encounters only: other systems save a different shape (audit G1) and cannot run here yet.
      supabase.from("encounters").select("id, name, rules, foes").eq("campaign_id", cid).in("rules", ["2014", "2024"]).order("updated_at", { ascending: false }),
      supabase.from("combats").select("id, name, rules, status, round, turn, combatants, session_id, encounter_id").eq("campaign_id", cid).eq("status", "active").order("updated_at", { ascending: false }),
    ]);
    if (encErr || cbErr) {
      const msg = (encErr || cbErr)!.message;
      setErr(msg.includes("does not exist") ? notReady("Combat", "p101") : friendlyError(msg));
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

  // ---- autosave (debounced, replayed on the latest saved fight) ----
  // Players and the tabletop write this row too, so an edit here is kept as a function and, when it
  // saves, replayed on a fresh read of the row: a player's heal between two of the GM's edits survives.
  const queue = useRef<((c: CombatRow) => CombatRow)[]>([]);
  const combatRef = useRef<CombatRow | null>(null);
  combatRef.current = combat;
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    const cur = combatRef.current;
    if (!cur || !queue.current.length || saving.current) return;
    saving.current = true;
    const fns = queue.current.splice(0);
    setSaveState("saving");
    const { data: fresh } = await supabase.from("combats").select("id, name, rules, status, round, turn, combatants, session_id, encounter_id").eq("id", cur.id).maybeSingle();
    const next = fns.reduce((acc, f) => f(acc), (fresh as CombatRow | null) ?? cur);
    const { data: saved, error } = await supabase.from("combats").update({
      name: next.name, round: next.round, turn: next.turn, combatants: next.combatants, session_id: next.session_id || null,
      updated_at: new Date().toISOString(),
    }).eq("id", next.id).select("id, name, rules, status, round, turn, combatants, session_id, encounter_id").maybeSingle();
    saving.current = false;
    setSaveState(error ? "error" : "idle");
    if (error) { setErr(`Not saved: ${error.message}`); return; }
    // show the fight as saved (the database starts a fresh turn when the turn moves), with anything
    // queued meanwhile still applied on top
    const shown = (saved as CombatRow | null) ?? next;
    setCombat((c) => (c && c.id === next.id ? queue.current.reduce((acc, f) => f(acc), shown) : c));
    if (queue.current.length) { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), 150); }
  }, [supabase]);
  const update = useCallback((fn: (c: CombatRow) => CombatRow) => {
    setCombat((cur) => (cur ? fn(cur) : cur));
    queue.current.push(fn);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void flush(); }, 400);
  }, [flush]);
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush(); } }, [flush]);

  // Live: a change from the tabletop or a player's sheet shows here at once (only the GM passes
  // combats' RLS, which is what this page needs). Ignored while this page has its own edits in flight;
  // those replay on a fresh read anyway.
  const liveId = combat?.id ?? null;
  useEffect(() => {
    if (!liveId) return;
    const ch = supabase.channel(`combat-page:${liveId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "combats", filter: `id=eq.${liveId}` }, (p) => {
        if (queue.current.length || saving.current || timer.current) return;
        const row = p.new as CombatRow;
        if (row.status && row.status !== "active") { setCombat(null); return; }
        setCombat((c) => (c && c.id === row.id ? { ...c, ...row } : c));
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [supabase, liveId]);

  const setCombatant = (id: string, fn: (c: Combatant) => Combatant) =>
    update((cb) => ({ ...cb, combatants: cb.combatants.map((x) => (x.id === id ? fn(x) : x)) }));

  // ---- tokens on the table (phase 5i) ----
  // The campaign's active tabletop scene and the tokens on it, so a combatant without one (a monster
  // added from an encounter here, or one whose token was deleted) can be put on the table, linked by
  // tokenId so its token shows its HP and its turn.
  const [table, setTable] = useState<{ sceneId: string; n: number; tokenIds: string[]; pcChars: string[] } | null>(null);
  const loadTable = useCallback(async (cid: string) => {
    const { data: sc } = await supabase.from("vtt_scenes").select("id, battle_map_id").eq("campaign_id", cid).eq("is_active", true).maybeSingle();
    if (!sc) { setTable(null); return; }
    const [{ data: toks }, { data: bm }] = await Promise.all([
      supabase.from("vtt_tokens").select("id, character_id").eq("scene_id", (sc as { id: string }).id),
      supabase.from("battle_maps").select("n").eq("id", (sc as { battle_map_id: string }).battle_map_id).maybeSingle(),
    ]);
    const rows = (toks ?? []) as { id: string; character_id: string | null }[];
    setTable({ sceneId: (sc as { id: string }).id, n: Number((bm as { n?: number } | null)?.n) || 20,
      tokenIds: rows.map((r) => r.id), pcChars: rows.map((r) => r.character_id).filter((x): x is string => !!x) });
  }, [supabase]);
  useEffect(() => { if (campaignId) void loadTable(campaignId); }, [campaignId, loadTable]);
  const hasToken = (c: Combatant) => !!table && ((c as Combatant & { tokenId?: string | null }).tokenId
    ? table.tokenIds.includes((c as Combatant & { tokenId?: string | null }).tokenId!)
    : c.kind === "pc" && !!c.characterId && table.pcChars.includes(c.characterId));
  const sizeSquares = (size: string | null | undefined) => { const s = (size ?? "").toLowerCase(); return s.startsWith("tiny") ? 0.5 : s.startsWith("large") ? 2 : s.startsWith("huge") ? 3 : s.startsWith("garg") ? 4 : 1; };
  async function putOnTable(list: Combatant[]) {
    if (!table || !campaignId || !list.length) return;
    // in a row from the middle of the map; the GM drags them where they belong on the tabletop
    const mid = Math.max(1, Math.floor(table.n / 2));
    const rows = list.map((c, i) => {
      const size = sizeSquares(c.block?.size);
      const step = Math.max(1, size);
      return { campaign_id: campaignId, scene_id: table.sceneId, kind: c.kind === "pc" ? "pc" : "monster", character_id: c.kind === "pc" ? c.characterId ?? null : null,
        stat_block_id: null, name: c.name, image_url: null, x: Math.min(table.n - size, mid - 2 + (i % 5) * step) + (size < 1 ? 0.25 : 0), y: Math.min(table.n - size, mid + Math.floor(i / 5) * step) + (size < 1 ? 0.25 : 0),
        size, rot: 0, layer: "token", hidden: !!c.hidden, controlled_by: [], style: c.kind === "pc" ? {} : { stats: { hp: c.maxHp ?? null, ac: c.ac ?? null } } };
    });
    const { data, error } = await supabase.from("vtt_tokens").insert(rows).select("id");
    if (error) { setErr(`Could not put the token on the table: ${error.message}`); return; }
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    const link = new Map(list.map((c, i) => [c.id, ids[i]]).filter(([, id]) => !!id) as [string, string][]);
    update((cb) => ({ ...cb, combatants: cb.combatants.map((x) => (link.has(x.id) ? { ...x, tokenId: link.get(x.id)! } as Combatant : x)) }));
    setNote(`${ids.length} token${ids.length === 1 ? "" : "s"} put on the table's active scene. Drag ${ids.length === 1 ? "it" : "them"} into place on the tabletop.`);
    void loadTable(campaignId);
  }

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
    if (error) { setErr(error.message.includes("does not exist") ? notReady("Combat", "p101") : friendlyError(error, "start the fight")); return; }
    setCombat(data as CombatRow);
    setNote(unresolved ? `${unresolved} monster${unresolved === 1 ? " has" : "s have"} no stat block (typed in by hand). Set their HP and AC below.` : null);
  }

  async function endFight() {
    if (!combat) return;
    if (!await askConfirm(`End "${combat.name}"? Players stop seeing it, and it leaves this page. The rolls stay in this session's Mechanics.`)) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    await flush();
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

  // ---- attacking a target ----
  const [targetBy, setTargetBy] = useState<Record<string, string>>({});
  const [saveTargetsBy, setSaveTargetsBy] = useState<Record<string, string[]>>({});
  const [failCondBy, setFailCondBy] = useState<Record<string, string>>({});
  const [saveLines, setSaveLines] = useState<{ title: string; lines: SaveLine[] } | null>(null);
  const [result, setResult] = useState<AttackResult | null>(null);
  const snap = (c: Combatant): HpSnap => ({ hp: c.hp, tempHp: c.tempHp, defeated: c.defeated });
  const hurt = (id: string, amount: number) => setCombatant(id, (x) => applyDamage(x, amount));

  async function rollDamage(att: Combatant, a: ParsedAction, crit: boolean): Promise<{ total: number; parts: string } | null> {
    let total = 0; const parts: string[] = [];
    for (const d of a.damage) {
      const dr = await roll(att, crit ? critDice(d.dice) : d.dice, "damage", `${a.name} damage${d.type ? ` (${d.type})` : ""}`);
      if (!dr) return null;
      total += dr.total; parts.push(`${dr.total}${d.type ? ` ${d.type}` : ""}`);
    }
    return { total, parts: parts.join(" + ") };
  }

  async function attackWith(att: Combatant, a: ParsedAction) {
    const tgt = live.find((c) => c.id === targetBy[att.id]); if (!tgt) return;
    setRolling(true);
    try {
      const r = await roll(att, applyAdvantage(d20(a.toHit ?? 0), adv), "attack", `${a.name} vs ${tgt.name}`);
      if (!r) return;
      const outcome: AttackResult["outcome"] = r.natural === 20 ? "crit" : r.natural === 1 ? "miss" : tgt.ac == null ? "unknown" : r.total >= tgt.ac ? "hit" : "miss";
      let damage: number | null = null, parts = "", applied: number | null = null;
      const before = snap(tgt);
      if ((outcome === "hit" || outcome === "crit") && a.damage.length) {
        const d = await rollDamage(att, a, outcome === "crit");
        if (d) { damage = d.total; parts = d.parts; hurt(tgt.id, d.total); applied = d.total; }
      }
      setResult({ key: combatantId(), attacker: att.name, action: a.name, targetId: tgt.id, targetName: tgt.name, total: r.total, natural: r.natural, ac: tgt.ac, outcome, damage, parts, before, applied });
    } finally { setRolling(false); }
  }

  // Settle one pending save: full, half or no damage, conditions on a failure, and it comes off.
  const settleSave = (targetId: string, ps: PendingSave, saved: boolean, total: number | null) => {
    const dmg = saved ? (ps.half ? Math.floor(ps.damage / 2) : 0) : ps.damage;
    setCombatant(targetId, (x) => {
      let y = dmg > 0 ? applyDamage(x, dmg) : x;
      if (!saved && ps.conditions?.length) y = { ...y, conditions: [...new Set([...y.conditions, ...ps.conditions])] };
      return { ...y, pendingSaves: pendingOf(y).filter((p) => p.id !== ps.id),
        lastSave: { label: ps.label, by: ps.by, total, dc: ps.dc, saved, damage: dmg, at: Date.now() / 1000 } } as Combatant;
    });
    return dmg;
  };

  // A monster rolls its own save here: the ability modifier (stat blocks do not list save proficiencies,
  // so a proficient monster's bonus is typed into the roll log's notation by hand if it matters).
  async function rollMonsterSave(tgt: Combatant, ps: PendingSave): Promise<SaveLine | null> {
    const bonus = tgt.block ? abilityMod((tgt.block as unknown as Record<string, number>)[ps.ability]) : 0;
    const r = await roll(tgt, d20(bonus), "save", `${ps.ability.toUpperCase()} save vs ${ps.label}`);
    if (!r) return null;
    const saved = r.total >= ps.dc;
    const dmg = settleSave(tgt.id, ps, saved, r.total);
    return { name: tgt.name, text: `${r.total} vs DC ${ps.dc}: ${saved ? "saved" : "failed"}, ${dmg} damage` };
  }

  async function saveActionOn(att: Combatant, a: ParsedAction) {
    if (!a.save) return;
    const ids = saveTargetsBy[att.id]?.length ? saveTargetsBy[att.id] : targetBy[att.id] ? [targetBy[att.id]] : [];
    const tgts = live.filter((c) => ids.includes(c.id));
    if (!tgts.length) return;
    setRolling(true);
    try {
      const d = a.damage.length ? await rollDamage(att, a, false) : null;
      const failCond = failCondBy[att.id];
      const base = { by: att.name, byId: att.id, label: a.name, ability: ABIL3(a.save.ability), dc: a.save.dc, damage: d?.total ?? 0,
        type: a.damage[0]?.type ?? "", half: !!d, conditions: failCond ? [failCond] : [] };
      const lines: SaveLine[] = [];
      for (const t of tgts) {
        const ps: PendingSave = { ...base, id: combatantId(), at: Date.now() / 1000 };
        if (t.kind === "monster") {
          const line = await rollMonsterSave(t, ps);
          if (line) lines.push(line);
        } else {
          setCombatant(t.id, (x) => ({ ...x, pendingSaves: [...pendingOf(x), ps] } as Combatant));
          lines.push({ name: t.name, text: `waiting for their ${ps.ability.toUpperCase()} save (DC ${ps.dc})` });
        }
      }
      setResult(null);
      setSaveLines({ title: `${att.name}: ${a.name}${d ? `, ${d.total} damage (${d.parts})` : ""}, ${base.ability.toUpperCase()} save DC ${base.dc}${failCond ? `, ${failCond} on a failure` : ""}`, lines });
    } finally { setRolling(false); }
  }

  function applyResult(amount: number) {
    if (!result) return;
    const tgt = live.find((c) => c.id === result.targetId); if (!tgt) return;
    hurt(tgt.id, amount);
    setResult({ ...result, before: snap(tgt), applied: amount });
  }
  function undoResult() {
    if (!result?.before || result.applied == null) return;
    const b = result.before;
    setCombatant(result.targetId, (x) => ({ ...x, hp: b.hp, tempHp: b.tempHp, defeated: b.defeated }));
    setResult({ ...result, applied: null });
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
  // Audit G3: this tracker is D&D 5e shaped (d20 rolls against AC, 5e criticals). For another system it
  // still tracks turns, HP and conditions, but says so and stops declaring hits and misses.
  const rulesModule = getModule(campaign?.system);
  const dndRules = rulesModule.id === "dnd5e" || rulesModule.id === "darkmatter";

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
      {campaign && !dndRules && (
        <p role="note" style={{ color: C.text, fontSize: 13.5, margin: "0 0 14px", lineHeight: 1.6, maxWidth: 760, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "10px 12px" }}>
          This tracker is built for D&amp;D: its rolls are d20s against AC. In {rulesModule.label} use it for turn order, HP and
          conditions, and roll with your own system&apos;s dice; it won&apos;t call hits or misses.
        </p>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <CampaignPicker campaigns={campaigns} value={campaignId} onChange={setCampaignId} label={null} selectStyle={input} />
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
      {loading && <p role="status" style={{ color: C.muted }}>Loading…</p>}

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
              <button type="button" style={btn()} onClick={() => openTabletop(campaignId)} title="The shared table in its own window, on the same fight">Open the tabletop</button>
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
                <CombatantRow key={c.id} c={c} isTurn={i === combat.turn} isSelected={selected?.id === c.id} busy={rolling}
                  onRollSave={(ps) => { setRolling(true); void rollMonsterSave(c, ps).finally(() => setRolling(false)); }}
                  onSettle={(ps, saved) => settleSave(c.id, ps, saved, null)}
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
                <button title={!addPc ? "Choose a player character first" : undefined} type="button" style={btn()} disabled={!addPc} onClick={() => { const p = pcs.find((x) => x.id === addPc); if (p) addCombatants([pcCombatant(p)]); setAddPc(""); }}>Add PC</button>
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
                <input aria-label="Custom name" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="Custom name" style={{ ...input, flex: "1 1 140px" }} />
                <input aria-label="Hp" value={custom.hp} onChange={(e) => setCustom({ ...custom, hp: e.target.value })} placeholder="HP" inputMode="numeric" style={{ ...input, width: 64 }} />
                <input aria-label="Ac" value={custom.ac} onChange={(e) => setCustom({ ...custom, ac: e.target.value })} placeholder="AC" inputMode="numeric" style={{ ...input, width: 64 }} />
                <input aria-label="Init +" value={custom.init} onChange={(e) => setCustom({ ...custom, init: e.target.value })} placeholder="Init +" inputMode="numeric" style={{ ...input, width: 70 }} />
                <button title={!custom.name.trim() ? "Name the combatant first" : undefined} type="button" style={btn()} disabled={!custom.name.trim()} onClick={() => {
                  const hp = Number(custom.hp); const ac = Number(custom.ac); const ib = Number(custom.init);
                  const [m] = monsterCombatants(custom.name.trim(), 1, null);
                  addCombatants([{ ...m, hp: custom.hp ? hp : null, maxHp: custom.hp ? hp : null, ac: custom.ac ? ac : null, initBonus: custom.init ? ib : 0 }]);
                  setCustom({ name: "", hp: "", ac: "", init: "" });
                }}>Add custom</button>
              </div>
            </div>
          </div>

          <div>
            {combat && table && (() => {
              const missing = live.filter((c) => !hasToken(c) && !(c.kind === "monster" && c.defeated));
              if (!missing.length) return null;
              return (
                <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ flex: "1 1 200px", color: C.muted, fontSize: 13 }}>{missing.length} in this fight {missing.length === 1 ? "has" : "have"} no token on the table&apos;s active scene.</span>
                  {selected && !hasToken(selected) && <button type="button" style={btn()} onClick={() => void putOnTable([selected])}>Put {selected.name} on the table</button>}
                  <button type="button" style={btn(true)} onClick={() => void putOnTable(missing)}>Put all {missing.length} on the table</button>
                </div>
              );
            })()}
            {combat && !table && <p style={{ color: C.muted, fontSize: 12.5, margin: "0 0 10px" }}>No tabletop scene is active for this campaign, so there is nowhere to put tokens yet.</p>}
            {selected && (
              <DetailPanel c={selected} adv={adv} onAdv={setAdv} box={box} btn={btn} eyebrow={eyebrow} input={input}
                onRoll={(notation, kind, label) => void roll(selected, notation, kind, label)}
                isTurn={current?.id === selected.id} currentName={current?.name ?? null} busy={rolling}
                others={live.filter((x) => x.id !== selected.id && !(x.kind === "monster" && x.defeated))}
                targetId={targetBy[selected.id] ?? ""} onTarget={(id) => setTargetBy((m) => ({ ...m, [selected.id]: id }))}
                saveTargets={saveTargetsBy[selected.id] ?? []} onSaveTargets={(ids) => setSaveTargetsBy((m) => ({ ...m, [selected.id]: ids }))}
                failCond={failCondBy[selected.id] ?? ""} onFailCond={(k) => setFailCondBy((m) => ({ ...m, [selected.id]: k }))}
                onAttack={(a) => void attackWith(selected, a)} onSaveAction={(a) => void saveActionOn(selected, a)} />
            )}
            {saveLines && (
              <div style={{ ...box, borderColor: C.sun }} role="status">
                <div style={eyebrow}>Saving throws</div>
                <div style={{ color: C.text, fontSize: 13.5, marginBottom: 6 }}>{saveLines.title}</div>
                {saveLines.lines.map((l, i) => <div key={i} style={{ fontSize: 13, color: C.text }}><strong>{l.name}</strong>: {l.text}</div>)}
                <p style={{ color: C.muted, fontSize: 12, margin: "6px 0 0" }}>Player characters roll on their sheet or the tabletop; their rows below show the save until it is settled.</p>
                <button type="button" style={{ ...btn(), color: C.muted, marginTop: 8 }} onClick={() => setSaveLines(null)}>Clear</button>
              </div>
            )}
            {result && (() => {
              const tgt = live.find((x) => x.id === result.targetId);
              const verdict = result.outcome === "crit" ? "Critical hit" : result.outcome === "hit" ? "Hit" : result.outcome === "miss" ? "Miss" : result.outcome === "unknown" ? "AC not set" : "Saving throw";
              return (
                <div style={{ ...box, borderColor: result.outcome === "miss" ? C.line : C.sun }} role="status">
                  <div style={eyebrow}>Result</div>
                  <div style={{ color: C.text, fontSize: 14 }}>
                    <strong>{result.attacker}</strong> {result.action} &rarr; <strong>{result.targetName}</strong>
                  </div>
                  <div style={{ color: C.text, fontSize: 13.5, marginTop: 4 }}>
                    {result.total != null && <>{result.total}{dndRules && result.ac != null ? ` vs AC ${result.ac}` : ""}{dndRules ? ": " : ""}</>}
                    {dndRules && <strong style={{ color: result.outcome === "miss" ? C.muted : C.sun }}>{verdict}</strong>}
                    {result.damage != null && <> · {result.damage} damage{result.parts ? ` (${result.parts})` : ""}{result.outcome === "crit" ? ", dice doubled" : ""}</>}
                  </div>
                  {tgt && (
                    <div style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>
                      {tgt.name}: {result.before && result.applied != null ? <>{result.before.hp ?? "?"} &rarr; </> : null}<strong style={{ color: C.text }}>{tgt.hp ?? "?"}</strong>{tgt.maxHp != null ? ` / ${tgt.maxHp}` : ""} HP{tgt.tempHp ? ` (+${tgt.tempHp} temp)` : ""}{tgt.defeated ? (tgt.kind === "pc" ? ", down" : ", defeated") : ""}
                    </div>
                  )}
                  {tgt && tgt.conditions.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                      {tgt.conditions.map((k) => <span key={k} style={{ fontSize: 11.5, padding: "0 7px 0 4px", borderRadius: 999, border: `1px solid ${MARKER_COLORS[markerKind(k)].line}`, color: MARKER_COLORS[markerKind(k)].line, display: "inline-flex", alignItems: "center", gap: 4 }}><MarkerGlyph name={k} size={13} />{k}</span>)}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
                    {result.applied == null && result.damage != null && (
                      <>
                        <button type="button" style={btn(true)} onClick={() => applyResult(result.damage as number)}>{result.outcome === "save" ? "Failed save: " : "Apply "}{result.damage}</button>
                        <button type="button" style={btn()} onClick={() => applyResult(Math.floor((result.damage as number) / 2))}>{result.outcome === "save" ? "Saved: " : "Half: "}{Math.floor((result.damage as number) / 2)}</button>
                      </>
                    )}
                    {result.applied != null && <button type="button" style={btn()} onClick={undoResult}>Undo the {result.applied} damage</button>}
                    {tgt && (
                      <select value="" aria-label={`Add a condition to ${tgt.name}`} style={{ ...input, padding: "4px 6px", fontSize: 12 }}
                        onChange={(e) => { const v = e.target.value; if (v) setCombatant(tgt.id, (x) => ({ ...x, conditions: x.conditions.includes(v) ? x.conditions : [...x.conditions, v] })); }}>
                        <option value="">+ condition on {tgt.name}</option>
                        {MARKERS.filter((k) => !tgt.conditions.includes(k)).map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    )}
                    <button type="button" style={{ ...btn(), color: C.muted }} onClick={() => setResult(null)}>Clear</button>
                  </div>
                </div>
              );
            })()}
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
function CombatantRow({ c, isTurn, isSelected, onSelect, onChange, onRemove, input, btn, busy, onRollSave, onSettle }: {
  c: Combatant; isTurn: boolean; isSelected: boolean; onSelect: () => void; busy: boolean;
  onRollSave: (ps: PendingSave) => void; onSettle: (ps: PendingSave, saved: boolean) => number;
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
          placeholder="Init" inputMode="numeric" title="Initiative" aria-label={`Initiative for ${c.name}`} style={{ ...input, width: 54, textAlign: "center", fontFamily: SAX.mono }} />
        {/* Audit U15: the name is a real button, so a keyboard can pick who the attack, save and detail panel act for. */}
        <button type="button" aria-pressed={isSelected} onClick={(e) => { e.stopPropagation(); onSelect(); }}
          title={isSelected ? "Selected" : `Select ${c.name}`}
          style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left", font: "inherit", color: C.text, fontSize: 15, fontWeight: 700, textDecoration: c.defeated ? "line-through" : undefined, minHeight: "var(--sax-tap, 0px)" }}>{c.name}</button>
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
        <button title={!(n > 0) ? "Type an amount first" : undefined} type="button" style={{ ...btn(), color: C.warn }} disabled={!(n > 0)} onClick={() => { onChange((x) => applyDamage(x, n)); setAmt(""); }}>Damage</button>
        <button title={!(n > 0) ? "Type an amount first" : undefined} type="button" style={{ ...btn(), color: C.good }} disabled={!(n > 0)} onClick={() => { onChange((x) => applyHealing(x, n)); setAmt(""); }}>Heal</button>
      </div>
      {(isTurn || econOf(c).reaction) && (() => {
        const e = econOf(c), sp = speedNow(c.speed, c.conditions);
        const pill = (k: "action" | "bonus" | "reaction", label: string, color: string) => {
          const used = e[k];
          return (
            <button key={k} type="button" aria-pressed={used} title={used ? "Used: click to give it back" : "Ready: click to mark it used"}
              onClick={() => onChange((x) => ({ ...x, econ: { ...econOf(x), [k]: !used, ...(k === "action" && used ? { attacks: 0 } : {}) } }))}
              style={{ ...btn(), padding: "2px 9px", fontSize: 12, color: used ? C.muted : color, textDecoration: used ? "line-through" : "none" }}>{label}</button>
          );
        };
        return (
          <div onClick={(ev) => ev.stopPropagation()} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            {isTurn && pill("action", "Action", "#d9a43a")}
            {isTurn && pill("bonus", "Bonus action", C.good)}
            {pill("reaction", "Reaction", "#c2a8f0")}
            {isTurn && (
              <>
                <span style={{ fontSize: 12, color: C.muted }}>moved {e.moved}{sp != null ? ` of ${sp + e.dash}` : ""} ft{e.attacks ? `, ${e.attacks} attack${e.attacks === 1 ? "" : "s"} left` : ""}</span>
                <span style={{ fontFamily: SAX.mono, fontSize: 12, color: C.muted }}>speed</span>
                <input value={c.speed ?? ""} onChange={(ev) => onChange((x) => ({ ...x, speed: numOrNull(ev.target.value) }))} inputMode="numeric" placeholder="ft"
                  style={{ ...input, width: 46, textAlign: "center", padding: "2px 4px" }} aria-label="Walking speed in feet" />
                <button type="button" onClick={() => onChange((x) => ({ ...x, econ: { ...FRESH_ECON } }))} style={{ ...btn(), padding: "2px 9px", fontSize: 12, color: C.muted }} title="Give back everything this turn">Fresh turn</button>
              </>
            )}
          </div>
        );
      })()}
      {pendingOf(c).map((ps) => (
        <div key={ps.id} onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8, padding: "6px 8px", border: `1px solid ${C.warn}`, borderRadius: FORGE_RADIUS }}>
          <span style={{ fontSize: 12.5, color: C.text, flex: "1 1 220px" }}>
            {ps.ability.toUpperCase()} save DC {ps.dc} vs {ps.by}&apos;s {ps.label}{ps.damage ? `: ${ps.damage}${ps.type ? ` ${ps.type}` : ""}${ps.half ? ", half on a success" : ""}` : ""}{ps.conditions?.length ? `, ${ps.conditions.join(", ")} on a failure` : ""}
            {c.kind === "pc" && <span style={{ color: C.muted }}> (waiting for the player)</span>}
          </span>
          {c.kind === "monster" && <button type="button" disabled={busy} style={{ ...btn(true), padding: "3px 10px" }} onClick={() => onRollSave(ps)}>Roll save</button>}
          <button type="button" style={{ ...btn(), padding: "3px 10px", color: C.good }} onClick={() => onSettle(ps, true)}>{c.kind === "pc" ? "They saved" : "Saved"}</button>
          <button type="button" style={{ ...btn(), padding: "3px 10px", color: C.warn }} onClick={() => onSettle(ps, false)}>{c.kind === "pc" ? "They failed" : "Failed"}</button>
        </div>
      ))}
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        {c.conditions.map((k) => (
          <button key={k} type="button" title="Remove condition" onClick={() => onChange((x) => ({ ...x, conditions: x.conditions.filter((y) => y !== k) }))}
            style={{ fontSize: 11.5, color: MARKER_COLORS[markerKind(k)].line, background: "transparent", border: `1px solid ${MARKER_COLORS[markerKind(k)].line}`, borderRadius: 999, padding: "1px 8px 1px 4px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><MarkerGlyph name={k} size={13} />{k} ×</button>
        ))}
        <select value="" onChange={(e) => { const v = e.target.value; if (v) onChange((x) => ({ ...x, conditions: x.conditions.includes(v) ? x.conditions : [...x.conditions, v] })); }}
          style={{ ...input, padding: "3px 6px", fontSize: 12 }} aria-label="Add a condition">
          <option value="">+ condition or effect</option>
          <optgroup label="Conditions">{CONDITIONS.filter((k) => !c.conditions.includes(k)).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
          <optgroup label="Buffs">{BUFFS.filter((k) => !c.conditions.includes(k)).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
          <optgroup label="Debuffs">{DEBUFFS.filter((k) => !c.conditions.includes(k)).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
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
function DetailPanel({ c, adv, onAdv, onRoll, box, btn, eyebrow, input, isTurn, currentName, busy, others, targetId, onTarget, onAttack, onSaveAction, saveTargets, onSaveTargets, failCond, onFailCond }: {
  saveTargets: string[]; onSaveTargets: (ids: string[]) => void; failCond: string; onFailCond: (k: string) => void;
  c: Combatant; adv: AdvMode; onAdv: (m: AdvMode) => void; onRoll: (notation: string, kind: string, label: string) => void;
  box: React.CSSProperties; btn: (p?: boolean) => React.CSSProperties; eyebrow: React.CSSProperties; input: React.CSSProperties;
  isTurn: boolean; currentName: string | null; busy: boolean; others: Combatant[]; targetId: string;
  onTarget: (id: string) => void; onAttack: (a: ParsedAction) => void; onSaveAction: (a: ParsedAction) => void;
}) {
  const tgt = others.find((o) => o.id === targetId) ?? null;
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
      {c.kind === "monster" && b && (
        isTurn ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "0 0 10px", padding: "8px 10px", border: `1px solid ${C.sun}`, borderRadius: FORGE_RADIUS }}>
            <span style={{ fontSize: 12.5, color: C.sun, fontWeight: 700 }}>Target</span>
            <select value={targetId} onChange={(e) => onTarget(e.target.value)} style={{ ...input, padding: "4px 6px", fontSize: 12.5 }} aria-label={`Who ${c.name} attacks`}>
              <option value="">Pick who {c.name} attacks…</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}{o.ac != null ? ` (AC ${o.ac})` : ""}{o.hp != null ? `, ${o.hp} HP` : ""}</option>)}
            </select>
            {tgt && <span style={{ fontSize: 12, color: C.muted }}>Attack buttons roll against {tgt.name} and take the damage off on a hit.</span>}
            {groups.some((g) => g.actions.some((a) => a.save)) && (
              <div style={{ flexBasis: "100%", display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
                <span style={{ fontSize: 12, color: C.muted }}>Save effects hit:</span>
                {others.map((o) => {
                  const on = saveTargets.includes(o.id);
                  return <button key={o.id} type="button" aria-pressed={on} onClick={() => onSaveTargets(on ? saveTargets.filter((x) => x !== o.id) : [...saveTargets, o.id])}
                    style={{ ...btn(on), padding: "2px 8px", fontSize: 11.5, minHeight: "var(--sax-tap, 0px)" }}>{o.name}</button>;
                })}
                <select value={failCond} onChange={(e) => onFailCond(e.target.value)} style={{ ...input, padding: "3px 6px", fontSize: 12 }} aria-label="Condition on a failed save">
                  <option value="">no condition on a failure</option>
                  {CONDITIONS.map((k) => <option key={k} value={k}>{k} on a failure</option>)}
                </select>
              </div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>Targeted attacks are for the combatant whose turn it is{currentName ? ` (${currentName})` : ""}. Rolls below still work, and HP and conditions can be changed by hand.</p>
        )
      )}
      {groups.map((g) => (
        <div key={g.group} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, color: C.sun, fontWeight: 700, marginBottom: 4 }}>{g.group}</div>
          {g.actions.map((a, i) => <ActionLine key={`${a.name}-${i}`} a={a} adv={adv} onRoll={onRoll} btn={btn}
            target={isTurn && tgt ? tgt : null} saveCount={isTurn ? (saveTargets.length || (tgt ? 1 : 0)) : 0} busy={busy} onAttack={() => onAttack(a)} onSaveAction={() => onSaveAction(a)} />)}
        </div>
      ))}
    </div>
  );
}

function ActionLine({ a, adv, onRoll, btn, target, saveCount, busy, onAttack, onSaveAction }: {
  a: ParsedAction; adv: AdvMode; onRoll: (n: string, k: string, l: string) => void; btn: (p?: boolean) => React.CSSProperties;
  target: Combatant | null; saveCount: number; busy: boolean; onAttack: () => void; onSaveAction: () => void;
}) {
  const [open, setOpen] = useState(false);
  const small: React.CSSProperties = { ...btn(), padding: "3px 9px", fontSize: 12, minHeight: "var(--sax-tap, 0px)" };
  return (
    <div style={{ padding: "6px 0", borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ background: "none", border: "none", color: C.text, fontWeight: 700, fontSize: 13, cursor: "pointer", padding: 0 }} title="Show the full text">{a.name}</button>
        {a.toHit != null && target && <button type="button" disabled={busy} style={{ ...small, background: C.brass, color: C.ink, border: "none" }} onClick={onAttack} title={`Roll ${signed(a.toHit)} against ${target.name}; on a hit the damage comes off at once`}>Attack {target.name} {signed(a.toHit)}</button>}
        {a.toHit != null && !target && <button type="button" style={small} onClick={() => onRoll(applyAdvantage(d20(a.toHit as number), adv), "attack", a.name)}>Attack {signed(a.toHit)}</button>}
        {a.toHit == null && a.save && saveCount > 0 && <button type="button" disabled={busy} style={{ ...small, background: C.brass, color: C.ink, border: "none" }} onClick={onSaveAction}
          title="Roll the damage once; monsters roll their saves now, player characters roll theirs on their sheet or the tabletop">Use on {saveCount === 1 && target ? target.name : `${saveCount} targets`}</button>}
        {a.damage.map((d, i) => (
          <button key={i} type="button" style={small} onClick={() => onRoll(d.dice, "damage", `${a.name} damage${d.type ? ` (${d.type})` : ""}`)}>{d.dice}{d.type ? ` ${d.type}` : ""}</button>
        ))}
        {a.save && <span style={{ fontSize: 12, color: C.plum }}>DC {a.save.dc}{a.save.ability ? ` ${a.save.ability}` : ""}</span>}
      </div>
      {open && <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.5, margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{a.desc}</p>}
    </div>
  );
}
