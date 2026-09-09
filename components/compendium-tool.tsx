"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import { getActiveCampaign, onActiveCampaignChange } from "@/lib/active-campaign";
import { listModules, getModule, isKnownSystem } from "@/lib/systems/registry";
import { attributionFor } from "@/lib/systems/attribution";
import { resolveSystemVars } from "@/lib/systems/system-theme";
import { CompendiumMatcher, type RankedMatch } from "@/lib/compendium/match";
import { useVosk } from "@/lib/compendium/useVosk";
import {
  type CompendiumEntry, type Ruleset, type MonsterDisplay, type SpellDisplay, type ItemDisplay,
  isSpell, isItem, isGear, isCondition, isFeat, isFeature, isRule, isMonster, isSpecies, isBackground, isCustom,
} from "@/lib/compendium/types";
import {
  type CustomRow, type CustomDraft, type Ruleset3, TYPED_CUSTOM,
  listCustomEntries, createCustomEntry, updateCustomEntry, deleteCustomEntry, mergeCustom, flattenForOverride,
} from "@/lib/compendium/custom";

// Working display shapes the typed editor edits in place. A new typed card starts from these blanks.
type TypedDisplay = SpellDisplay | ItemDisplay | MonsterDisplay;
const emptySpell = (): SpellDisplay => ({
  level: 0, school: null, castingTime: null, range: null, components: null, duration: null,
  concentration: false, ritual: false, attackType: null, classes: [], damage: null, description: null,
});
const emptyItem = (): ItemDisplay => ({
  type: null, rarity: null, attunement: false, attunementNote: null, variants: null, description: null,
});
const emptyMonster = (): MonsterDisplay => ({
  size: null, type: null, alignment: null, ac: null, hp: null, hitDice: null, speed: null, senses: null,
  languages: null, cr: null, xp: null,
  abilities: { str: null, dex: null, con: null, int: null, wis: null, cha: null },
  damageVulnerabilities: null, damageResistances: null, damageImmunities: null, conditionImmunities: null,
  traits: [], actions: [], bonusActions: [], reactions: [], legendaryActions: [],
});
const emptyDisplayFor = (category: string): TypedDisplay | null =>
  category === "spell" ? emptySpell() : category === "magic-item" ? emptyItem() : category === "monster" ? emptyMonster() : null;
// The card-type choices offered when creating a NEW homebrew card (an override/edit keeps its category).
const NEW_CARD_TYPES: { id: string; label: string }[] = [
  { id: "custom", label: "Custom" }, { id: "spell", label: "Spell" },
  { id: "magic-item", label: "Magic item" }, { id: "monster", label: "Monster" },
];

// components/compendium-tool.tsx
//
// The offline rules compendium: look a term up and get an instant card, by typing OR by voice. Voice
// uses on-device Vosk (see lib/compendium/useVosk); both paths feed the same match -> addCard pipeline.
// Listen mode is real: "Continuous" cards auto-dismiss after 30s (a rolodex, newest on top),
// "Push to talk" listens for one phrase and pins the card. Ruleset toggle swaps the prebuilt index
// (2014 / 2024 / both). Data is SRD 5.1/5.2 (CC-BY) plus Kerf and Code originals; nothing leaves the
// browser.
//
// HOMEBREW + OVERRIDES: a signed-in GM can add their own cards and non-destructively override shipped
// ones. Custom entries are stored per GM (lib/compendium/custom + migration p90), fetched here, and
// LAYERED over the static index at load time (mergeCustom): an override drops the shipped card by id and
// replaces it; deleting the custom row reverts. The static index stays the base and is never mutated.

const AUTO_MS = 30_000;
const MAX_CARDS = 12;
// The on-device speech model, served statically. First voice use downloads it (~40MB) then the browser
// caches it. See the deploy notes for where to place this file.
const MODEL_URL = "/compendium/model/vosk-model-small-en-us-0.15.tar.gz";

// Which game systems have a shipped static compendium index. D&D is the only one today; adding another
// is then a data-only drop of public/compendium/index-<system>.json (+ grammar-<system>.json) plus that
// system's id here. Systems NOT in this set still work in the tool - they run on the GM's homebrew cards
// alone until their index is built.
const COMPENDIUM_READY = new Set<string>(["dnd5e", "drawsteel", "lancer", "daggerheart", "pf2e"]);
// Only D&D splits its index by edition (2014 / 2024 / both); every other system is single-edition, so it
// keeps no ruleset toggle and its index carries no edition in the filename.
const hasEditions = (system: string) => system === "dnd5e";
const indexPath = (system: string, ruleset: Ruleset) =>
  system === "dnd5e" ? `/compendium/index-${ruleset}.json` : `/compendium/index-${system}.json`;
const grammarPath = (system: string, ruleset: Ruleset) =>
  system === "dnd5e" ? `/compendium/grammar-${ruleset}.json` : `/compendium/grammar-${system}.json`;
const systemLabel = (system: string) => getModule(system).label;

type ListenMode = "push" | "continuous";
interface Card { key: string; entry: CompendiumEntry; pinned: boolean; expiresAt: number | null }

// The editor's working state. `id` is set when editing an existing custom row; null for a new card or a
// fresh override of a shipped card. `overridesId` is the shadowed base card's id (null for a new card).
interface EditState {
  id: string | null;
  name: string;
  tag: string;
  ruleset: Ruleset3;
  metaLinesText: string; // one meta line per row in a textarea (generic cards only)
  body: string;          // generic cards only
  display: TypedDisplay | null; // the typed working display for spell/magic-item/monster, else null
  aliasesText: string;   // comma-separated
  overridesId: string | null;
  campaignId: string | null;
  category: string;
  baseLabel: string | null; // "Overriding <name>" hint, or null for a new card
}

export default function CompendiumTool() {
  const [ruleset, setRuleset] = useState<Ruleset>("2014");
  const [system, setSystem] = useState<string>("dnd5e");
  const [baseEntries, setBaseEntries] = useState<CompendiumEntry[]>([]);
  const [grammarPhrases, setGrammarPhrases] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<RankedMatch[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [listenMode, setListenMode] = useState<ListenMode>("continuous");
  const [grammarOn, setGrammarOn] = useState(false);
  const [partial, setPartial] = useState("");
  const hoveredRef = useRef<string | null>(null);

  // ---- homebrew / overrides ----
  const supabase = useMemo(() => createClient(), []);
  const [gmId, setGmId] = useState<string | null>(null);
  const [customRows, setCustomRows] = useState<CustomRow[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<{ id: string; name?: string } | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Merge the GM's applicable custom rows over the static index. Recomputes when the toggle or the
  // active campaign changes, so overrides and campaign-pinned cards appear/disappear correctly.
  // Non-D&D systems have no edition split, so their custom cards all filter as "both".
  const effRuleset: Ruleset3 = hasEditions(system) ? (ruleset as Ruleset3) : "both";
  const entries = useMemo(
    () => mergeCustom(baseEntries, customRows, effRuleset, activeCampaign?.id ?? null),
    [baseEntries, customRows, effRuleset, activeCampaign],
  );
  const matcher = useMemo(() => (entries.length ? new CompendiumMatcher(entries) : null), [entries]);
  // Extra spoken phrases from custom entries, so the (experimental) grammar-constrain path can reach them.
  const customSpoken = useMemo(
    () => entries.filter(isCustom).flatMap((e) => e.spoken),
    [entries],
  );

  // Load the prebuilt index + grammar for the chosen ruleset.
  useEffect(() => {
    let off = false;
    setLoading(true); setLoadError(null);
    const ready = COMPENDIUM_READY.has(system);
    const ip = indexPath(system, ruleset);
    fetch(ip)
      .then((r) => {
        // A ready system's index must exist -> a miss is a real error. A not-yet-built system simply
        // has no shipped cards; the tool still runs on the GM's homebrew, so treat its 404 as empty.
        if (!r.ok) { if (ready) throw new Error(`${ip.split("/").pop()} ${r.status}`); return [] as CompendiumEntry[]; }
        return r.json();
      })
      .then((data: CompendiumEntry[]) => { if (!off) { setBaseEntries(Array.isArray(data) ? data : []); setLoading(false); } })
      .catch((e) => { if (!off) { setLoadError(e instanceof Error ? e.message : "Could not load the compendium."); setLoading(false); } });
    fetch(grammarPath(system, ruleset))
      .then((r) => (r.ok ? r.json() : []))
      .then((g: string[]) => { if (!off) setGrammarPhrases(Array.isArray(g) ? g : []); })
      .catch(() => { if (!off) setGrammarPhrases([]); });
    return () => { off = true; };
  }, [system, ruleset]);

  // Re-skin the whole page to the picked system, the same way SystemThemeProvider skins from the active
  // campaign: set the per-system CSS vars (and data-system, which the effects overlay keys on) straight on
  // <html>. This makes selecting a game in the dropdown FEEL like that game, matching the Forge and the
  // other system pickers. On leaving the tool (or switching selection) we restore the session's active
  // campaign look so the compendium never leaves a stale theme behind for the rest of the app.
  useEffect(() => {
    const root = document.documentElement;
    const applyVars = (sys: string | null) => {
      for (const [k, v] of Object.entries(resolveSystemVars(sys))) root.style.setProperty(k, v);
      if (sys) root.setAttribute("data-system", sys);
      else root.removeAttribute("data-system");
    };
    applyVars(system);
    return () => applyVars(getActiveCampaign()?.system ?? null);
  }, [system]);

  // Who is signed in (the GM who owns any custom cards) + which campaign is active.
  const refreshCustom = useCallback(async (system = "dnd5e") => {
    try {
      const rows = await listCustomEntries(supabase, system);
      setCustomRows(rows);
    } catch { /* homebrew is additive; a failure must not break the read-only tool */ }
  }, [supabase]);

  useEffect(() => {
    let off = false;
    supabase.auth.getUser().then(({ data }) => { if (!off) setGmId(data.user?.id ?? null); }).catch(() => {});
    const readActive = () => { const ac = getActiveCampaign(); setActiveCampaign(ac ? { id: ac.id, name: ac.name } : null); };
    readActive();
    // Seed the system picker from the active campaign once, if it names a system we know. Manual picks
    // afterward are not overridden (this effect runs once).
    const ac0 = getActiveCampaign();
    if (ac0 && isKnownSystem(ac0.system)) setSystem(ac0.system as string);
    const unsub = onActiveCampaignChange(readActive); // fires with no args; re-read the signal
    return () => { off = true; unsub(); };
  }, [supabase]);

  // The GM's custom cards are per system, so (re)fetch whenever the signed-in GM or the selected system
  // changes.
  useEffect(() => {
    if (gmId) void refreshCustom(system);
    else setCustomRows([]);
  }, [gmId, system, refreshCustom]);

  // Rolodex expiry sweep.
  useEffect(() => {
    const t = setInterval(() => {
      setCards((prev) => {
        const now = Date.now();
        const next = prev.filter((c) => c.pinned || c.expiresAt == null || hoveredRef.current === c.key || now < c.expiresAt);
        return next.length === prev.length ? prev : next;
      });
    }, 500);
    return () => clearInterval(t);
  }, []);

  const addCard = useCallback((entry: CompendiumEntry) => {
    setCards((prev) => {
      const pinned = listenMode === "push";
      const card: Card = { key: `${entry.id}:${Date.now()}`, entry, pinned, expiresAt: pinned ? null : Date.now() + AUTO_MS };
      const withoutDupTop = prev[0]?.entry.id === entry.id ? prev.slice(1) : prev;
      return [card, ...withoutDupTop].slice(0, MAX_CARDS);
    });
  }, [listenMode]);

  const lookup = useCallback((raw: string) => {
    if (!matcher) return;
    const results = matcher.match(raw, 6);
    setCandidates(results);
    if (results.length) addCard(results[0].entry);
  }, [matcher, addCard]);

  // ---- voice (Vosk) ----
  const lookupRef = useRef(lookup); lookupRef.current = lookup;
  const listenModeRef = useRef(listenMode); listenModeRef.current = listenMode;
  const voskRef = useRef<ReturnType<typeof useVosk> | null>(null);

  const handleVoiceText = useCallback((text: string) => {
    setPartial("");
    lookupRef.current(text);
    if (listenModeRef.current === "push") voskRef.current?.stop();
  }, []);
  const handlePartial = useCallback((text: string) => setPartial(text), []);

  const grammarForVosk = useMemo(
    () => (grammarPhrases.length || customSpoken.length ? [...grammarPhrases, ...customSpoken] : grammarPhrases),
    [grammarPhrases, customSpoken],
  );
  const vosk = useVosk({
    modelUrl: MODEL_URL,
    onText: handleVoiceText,
    onPartial: handlePartial,
    grammar: grammarOn ? grammarForVosk : null,
  });
  voskRef.current = vosk;

  const toggleMic = () => { if (vosk.listening) { vosk.stop(); setPartial(""); } else { void vosk.start(); } };
  useEffect(() => { if (!vosk.listening) setPartial(""); }, [vosk.listening]);

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); const q = query.trim(); if (q) lookup(q); };

  const pin = (key: string) => setCards((prev) => prev.map((c) => c.key === key ? { ...c, pinned: !c.pinned, expiresAt: !c.pinned ? null : Date.now() + AUTO_MS } : c));
  const dismiss = (key: string) => setCards((prev) => prev.filter((c) => c.key !== key));
  const onEnter = (key: string) => { hoveredRef.current = key; };
  const onLeave = (key: string) => {
    hoveredRef.current = null;
    setCards((prev) => prev.map((c) => c.key === key && !c.pinned && c.expiresAt != null ? { ...c, expiresAt: Date.now() + AUTO_MS } : c));
  };

  // ---- editor open/save/delete ----
  const defaultRuleset = (): Ruleset3 => (!hasEditions(system) ? "both" : ruleset === "both" ? "both" : ruleset);

  const openNew = () => {
    setSaveErr(null);
    setEditing({
      id: null, name: "", tag: "house rule", ruleset: defaultRuleset(),
      metaLinesText: "", body: "", display: null, aliasesText: "", overridesId: null,
      campaignId: null, category: "custom", baseLabel: null,
    });
  };

  const openEditRow = (row: CustomRow) => {
    setSaveErr(null);
    setEditing({
      id: row.id, name: row.name, tag: row.tag ?? "", ruleset: row.ruleset,
      metaLinesText: row.meta_lines.join("\n"), body: row.body ?? "",
      display: TYPED_CUSTOM.has(row.category) && row.display ? (row.display as TypedDisplay) : null,
      aliasesText: row.aliases.join(", "), overridesId: row.overrides_id,
      campaignId: row.campaign_id, category: row.category,
      baseLabel: row.overrides_id ? `Overriding ${row.overrides_id}` : null,
    });
  };

  // Edit a card shown in the rolodex/results. A custom card edits its own row; a shipped card opens a
  // non-destructive override (reusing an existing override row for it if one exists).
  const openEdit = (entry: CompendiumEntry) => {
    if (entry.id.startsWith("custom:")) {
      const rowId = entry.id.slice("custom:".length);
      const row = customRows.find((r) => r.id === rowId);
      if (row) { openEditRow(row); return; }
    }
    const existing = customRows.find((r) => r.overrides_id === entry.id);
    if (existing) { openEditRow(existing); return; }
    const f = flattenForOverride(entry);
    setSaveErr(null);
    setEditing({
      id: null, name: entry.name, tag: f.tag, ruleset: (["2014", "2024", "both"].includes(entry.ruleset) ? entry.ruleset : "both") as Ruleset3,
      metaLinesText: f.metaLines.join("\n"), body: f.body, display: f.display,
      aliasesText: "", overridesId: f.overridesId, campaignId: null, category: f.category,
      baseLabel: `Overriding ${entry.name}`,
    });
  };

  const draftFrom = (e: EditState): CustomDraft => {
    // "Typed" means a spell/magic-item/monster that actually carries a display. A legacy override row
    // (category "spell" but no display, from before typed editing) stays on the generic body path so its
    // text is preserved, not wiped.
    const typed = TYPED_CUSTOM.has(e.category) && e.display != null;
    return {
      name: e.name.trim() || "Untitled",
      // Typed cards render through their own display, not a chip/meta/body, so those generic fields are
      // cleared for them and the display is what carries the content.
      tag: typed ? null : (e.tag.trim() || null),
      ruleset: e.ruleset,
      metaLines: typed ? [] : e.metaLinesText.split("\n").map((s) => s.trim()).filter(Boolean),
      body: typed ? null : (e.body.trim() || null),
      display: typed ? e.display : null,
      spoken: [],
      aliases: e.aliasesText.split(",").map((s) => s.trim()).filter(Boolean),
      overridesId: e.overridesId,
      campaignId: e.campaignId,
      category: e.category || "custom",
      system, // the system currently selected in the tool
    };
  };

  const saveEditing = async () => {
    if (!editing || !gmId) return;
    setSaveErr(null);
    try {
      const draft = draftFrom(editing);
      if (editing.id) await updateCustomEntry(supabase, editing.id, draft);
      else await createCustomEntry(supabase, gmId, draft);
      await refreshCustom(system);
      setEditing(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Could not save this card.");
    }
  };

  const deleteEditing = async () => {
    if (!editing || !editing.id) { setEditing(null); return; }
    setSaveErr(null);
    try {
      await deleteCustomEntry(supabase, editing.id);
      await refreshCustom(system);
      setEditing(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Could not delete this card.");
    }
  };

  // ---- styles ----
  const seg = (on: boolean): React.CSSProperties => ({ padding: "7px 12px", background: on ? C.surface2 : "transparent", color: on ? C.sun : C.muted, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer" });
  const label: React.CSSProperties = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted };

  const micLabel = vosk.status === "loading" ? "Loading model…" : vosk.listening ? "Stop" : "🎙 Voice";
  const micActive = vosk.listening;

  const myCards = customRows; // already the GM's own (RLS); newest first

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* controls */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={{ ...label, marginBottom: 6 }}>Game system</div>
          <select value={system} onChange={(e) => setSystem(e.target.value)}
            style={{ padding: "7px 10px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {listModules().map((m) => (
              <option key={m.id} value={m.id}>{m.label}{COMPENDIUM_READY.has(m.id) ? "" : " · homebrew only"}</option>
            ))}
          </select>
        </div>
        {hasEditions(system) && (
          <div>
            <div style={{ ...label, marginBottom: 6 }}>Ruleset</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["2014", "2024", "both"] as Ruleset[]).map((r) => (
                <button key={r} type="button" onClick={() => setRuleset(r)} style={seg(ruleset === r)}>{r === "both" ? "Both" : r}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          <div style={{ ...label, marginBottom: 6 }}>Listen mode</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={() => setListenMode("continuous")} style={seg(listenMode === "continuous")}>Continuous (auto-dismiss)</button>
            <button type="button" onClick={() => setListenMode("push")} style={seg(listenMode === "push")}>Push to talk (pinned)</button>
          </div>
        </div>
        {gmId && (
          <div>
            <div style={{ ...label, marginBottom: 6 }}>Homebrew</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={openNew} style={seg(false)}>+ New card</button>
              <button type="button" onClick={() => setManageOpen((v) => !v)} style={seg(manageOpen)}>My cards{myCards.length ? ` (${myCards.length})` : ""}</button>
            </div>
          </div>
        )}
      </div>

      {/* search + mic */}
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={loading ? "Loading compendium…" : "Type a spell, item, or condition (e.g. fireball, belt of giant strength, grappled)"}
          disabled={loading || !!loadError}
          style={{ flex: 1, minWidth: 0, padding: "11px 13px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 15 }}
        />
        <button type="submit" disabled={loading || !!loadError} style={{ padding: "0 16px", background: C.sun, color: "#1b1712", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Look up</button>
        {vosk.supported && (
          <button type="button" onClick={toggleMic} disabled={loading || !!loadError || vosk.status === "loading"}
            title={listenMode === "push" ? "Listen for one phrase" : "Listen continuously"}
            style={{ padding: "0 14px", background: micActive ? "#c0603a" : "transparent", color: micActive ? "#fff" : C.text, border: `1px solid ${micActive ? "#c0603a" : C.line}`, borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: vosk.status === "loading" ? "default" : "pointer", whiteSpace: "nowrap" }}>
            {micLabel}
          </button>
        )}
      </form>

      {/* voice status line */}
      {vosk.supported && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minHeight: 18 }}>
          {vosk.listening && <span style={{ ...label, color: "#c0603a" }}>● listening{partial ? `: "${partial}"` : "…"}</span>}
          {vosk.status === "loading" && <span style={label}>downloading the speech model, one time (~40MB)…</span>}
          {vosk.error && <span style={{ color: "#c98a7a", fontSize: 12.5 }}>Voice error: {vosk.error}</span>}
          {grammarPhrases.length > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={grammarOn} onChange={(e) => setGrammarOn(e.target.checked)} disabled={vosk.listening} style={{ accentColor: C.sun }} />
              constrain to compendium vocabulary (experimental)
            </label>
          )}
        </div>
      )}

      {loadError && (
        <p style={{ color: "#c98a7a", fontSize: 13 }}>
          Couldn&apos;t load the compendium data ({loadError}). Run <code>node scripts/build-compendium-index.mjs {hasEditions(system) ? ruleset : system}</code> and confirm <code>public/compendium/index-{hasEditions(system) ? ruleset : system}.json</code> exists.
        </p>
      )}
      {!loading && !loadError && (
        <p style={{ ...label, margin: 0 }}>
          {entries.length.toLocaleString()} entries loaded · {system === "dnd5e"
            ? "SRD 5.1 / 5.2 (CC-BY), plus original content by Kerf and Code"
            : `${attributionFor(system)?.short ?? systemLabel(system)}${baseEntries.length === 0 ? " · no shipped cards yet, showing your homebrew" : ""}`} · nothing leaves your browser
        </p>
      )}

      {/* editor */}
      {editing && (
        <EntryEditor
          state={editing}
          onChange={setEditing}
          onSave={saveEditing}
          onDelete={deleteEditing}
          onCancel={() => setEditing(null)}
          activeCampaign={activeCampaign}
          editions={hasEditions(system)}
          error={saveErr}
          label={label}
        />
      )}

      {/* my cards manager */}
      {gmId && manageOpen && !editing && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 12, background: C.surface }}>
          <div style={{ ...label, marginBottom: 8 }}>Your homebrew and overrides</div>
          {myCards.length === 0 ? (
            <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>None yet. Use “+ New card” for a homebrew entry, or open any card and press Edit to override it.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {myCards.map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 8px", border: `1px solid ${C.line}`, borderRadius: 7 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{r.name}</span>
                    <span style={{ color: C.muted, fontSize: 12 }}>
                      {" · "}{r.overrides_id ? "override" : (r.tag || "custom")}{" · "}{r.ruleset}{r.campaign_id ? " · campaign" : " · all campaigns"}
                    </span>
                  </div>
                  <button type="button" onClick={() => openEditRow(r)} style={{ background: "transparent", border: `1px solid ${C.line}`, borderRadius: 7, color: C.text, cursor: "pointer", fontSize: 12, padding: "3px 10px", flexShrink: 0 }}>Edit</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* disambiguation chips */}
      {candidates.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ ...label }}>Also:</span>
          {candidates.slice(1, 6).map((c) => (
            <button key={c.entry.id} type="button" onClick={() => addCard(c.entry)}
              style={{ padding: "4px 9px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 999, fontSize: 12, cursor: "pointer" }}>
              {c.entry.name} <span style={{ color: C.muted }}>· {entryTag(c.entry)}</span>
            </button>
          ))}
        </div>
      )}

      {/* rolodex */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
        {cards.length === 0 && !loading && (
          <p style={{ color: C.muted, fontSize: 14 }}>Look something up (type or use the mic) and its card appears here. In Continuous mode, cards fade after 30 seconds unless you hover or pin them.</p>
        )}
        {cards.map((c) => (
          <CardView key={c.key} card={c} canEdit={!!gmId} onEdit={() => openEdit(c.entry)} onPin={() => pin(c.key)} onDismiss={() => dismiss(c.key)} onEnter={() => onEnter(c.key)} onLeave={() => onLeave(c.key)} />
        ))}
      </div>
    </div>
  );
}

// The little category chip. Features carry their flavour (metamagic / invocation / fighting style)
// rather than the generic "feature", since that is what a DM is actually looking at. Custom cards carry
// the GM's own tag.
function entryTag(e: CompendiumEntry): string {
  if (isFeature(e)) {
    const k = e.display.kind;
    return k === "fighting-style" ? "fighting style" : k === "feature" ? "class feature" : k;
  }
  if (isRule(e)) return e.display.topic ? e.display.topic.toLowerCase() : "rule";
  if (isCustom(e)) return e.display.tag || "custom";
  return e.category === "magic-item" ? "item" : e.category;
}

function CardView({ card, canEdit, onEdit, onPin, onDismiss, onEnter, onLeave }: {
  card: Card; canEdit: boolean; onEdit: () => void; onPin: () => void; onDismiss: () => void; onEnter: () => void; onLeave: () => void;
}) {
  const e = card.entry;
  const chip: React.CSSProperties = { fontSize: 11, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 999, padding: "1px 8px" };
  const meta: React.CSSProperties = { color: C.muted, fontSize: 12.5, margin: "2px 0 0" };
  // "Homebrew" = one of the GM's OWN rows (id "custom:<uuid>"), not merely the custom category: shipped
  // multi-system cards (e.g. Draw Steel, id "ds-...") are also the custom category but are not homebrew.
  const homebrew = e.id.startsWith("custom:");
  return (
    <div onMouseEnter={onEnter} onMouseLeave={onLeave}
      style={{ background: C.surface, border: `1px solid ${card.pinned ? C.sun : C.line}`, borderRadius: FORGE_RADIUS, padding: 14, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: C.text, fontSize: 17, fontWeight: 700 }}>{e.name}</span>
          <span style={chip}>{entryTag(e)}</span>
          {homebrew && <span style={{ ...chip, borderColor: C.sun, color: C.sun }} title="Your homebrew or override">Homebrew</span>}
          {!homebrew && e.source === "kc" && <span style={{ ...chip, borderColor: C.line, color: C.sun }} title="Original content by Kerf and Code">Kerf &amp; Code</span>}
          {!card.pinned && card.expiresAt != null && <span style={{ ...chip, borderColor: "transparent", color: C.muted }}>auto</span>}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {canEdit && <button type="button" onClick={onEdit} title={homebrew ? "Edit this card" : "Override this card"} style={{ background: "transparent", border: `1px solid ${C.line}`, borderRadius: 7, color: C.muted, cursor: "pointer", fontSize: 12, padding: "2px 8px" }}>{homebrew ? "Edit" : "Override"}</button>}
          <button type="button" onClick={onPin} title={card.pinned ? "Unpin" : "Pin"} style={{ background: "transparent", border: `1px solid ${C.line}`, borderRadius: 7, color: card.pinned ? C.sun : C.muted, cursor: "pointer", fontSize: 12, padding: "2px 8px" }}>{card.pinned ? "Pinned" : "Pin"}</button>
          <button type="button" onClick={onDismiss} title="Dismiss" style={{ background: "transparent", border: `1px solid ${C.line}`, borderRadius: 7, color: C.muted, cursor: "pointer", fontSize: 14, padding: "2px 8px", lineHeight: 1 }}>&times;</button>
        </div>
      </div>
      <CardBody entry={e} meta={meta} />
    </div>
  );
}

function CardBody({ entry, meta }: { entry: CompendiumEntry; meta: React.CSSProperties }) {
  const body: React.CSSProperties = { color: C.text, fontSize: 14, lineHeight: 1.5, margin: "8px 0 0", whiteSpace: "pre-wrap" };
  if (isSpell(entry)) {
    const d = entry.display;
    const lvl = d.level === 0 ? `${d.school ?? ""} cantrip`.trim() : `Level ${d.level}${d.school ? ` ${d.school}` : ""}`;
    return (
      <div>
        <p style={meta}>{lvl}{d.ritual ? " · ritual" : ""}{d.concentration ? " · concentration" : ""}</p>
        <p style={meta}>{[d.castingTime && `Cast: ${d.castingTime}`, d.range && `Range: ${d.range}`, d.duration && `Duration: ${d.duration}`, d.components && `Components: ${d.components}`].filter(Boolean).join(" · ")}</p>
        {d.damage?.base && <p style={meta}>Damage: {d.damage.base}{d.damage.type ? ` ${d.damage.type}` : ""}{d.attackType ? ` (${d.attackType} attack)` : ""}</p>}
        {d.classes.length > 0 && <p style={meta}>Classes: {d.classes.join(", ")}</p>}
        {d.description && <p style={body}>{d.description}</p>}
      </div>
    );
  }
  if (isItem(entry)) {
    const d = entry.display;
    return (
      <div>
        <p style={meta}>{[d.type, d.rarity, d.attunement ? `attunement${d.attunementNote ? ` (${d.attunementNote})` : ""}` : "no attunement"].filter(Boolean).join(" · ")}</p>
        {d.variants && d.variants.options.length > 0 && <p style={meta}>{d.variants.label ? `${d.variants.label}: ` : ""}{d.variants.options.join(", ")}</p>}
        {d.description && <p style={body}>{d.description}</p>}
      </div>
    );
  }
  if (isGear(entry)) {
    const d = entry.display;
    return (
      <div>
        <p style={meta}>{[d.type, d.cost && `Cost: ${d.cost}`, d.weight != null && `Weight: ${d.weight} lb`].filter(Boolean).join(" · ")}</p>
        {d.description && <p style={body}>{d.description}</p>}
      </div>
    );
  }
  if (isCondition(entry)) {
    return <div>{entry.display.description && <p style={body}>{entry.display.description}</p>}</div>;
  }
  if (isFeat(entry)) {
    const d = entry.display;
    return (
      <div>
        <p style={meta}>{[d.featType, d.prerequisite && `Prerequisite: ${d.prerequisite}`].filter(Boolean).join(" · ")}</p>
        {d.description && <p style={body}>{d.description}</p>}
      </div>
    );
  }
  if (isFeature(entry)) {
    const d = entry.display;
    const kindLabel = d.kind === "fighting-style" ? "Fighting style"
      : d.kind === "metamagic" ? "Metamagic"
      : d.kind === "invocation" ? "Eldritch Invocation"
      : "Class feature";
    return (
      <div>
        <p style={meta}>{[kindLabel, d.className, d.subclass, d.level != null ? `level ${d.level}` : null].filter(Boolean).join(" · ")}</p>
        {d.description && <p style={body}>{d.description}</p>}
      </div>
    );
  }
  if (isRule(entry)) {
    const d = entry.display;
    const srd = entry.ruleset === "2024" ? "SRD 5.2" : "SRD 5.1";
    return (
      <div>
        {d.topic && <p style={meta}>{d.topic} rule · {srd}</p>}
        {d.description && <p style={body}>{d.description}</p>}
      </div>
    );
  }
  if (isMonster(entry)) {
    return <MonsterBody d={entry.display} meta={meta} body={body} />;
  }
  if (isSpecies(entry)) {
    const d = entry.display;
    return (
      <div>
        <p style={meta}>{[d.creatureType, d.size, d.speed && `Speed ${d.speed}${/\d$/.test(d.speed) ? " ft" : ""}`].filter(Boolean).join(" · ")}</p>
        {d.traits.map((t, i) => (
          <p key={i} style={{ ...body, margin: "4px 0 0" }}>
            {t.name && <strong style={{ color: C.text }}>{t.name}. </strong>}{t.description}
          </p>
        ))}
      </div>
    );
  }
  if (isBackground(entry)) {
    const d = entry.display;
    // The source data has no prose, so the card is a labelled field list; fields absent in one edition
    // (ability scores + feat are 2024-only, languages is 2014-only) simply drop out.
    const rows = ([
      d.abilityScores && ["Ability Scores", d.abilityScores],
      d.feat && ["Origin Feat", d.feat],
      d.skillProficiencies && ["Skill Proficiencies", d.skillProficiencies],
      d.toolProficiency && ["Tool Proficiency", d.toolProficiency],
      d.languages && ["Languages", d.languages],
      d.equipment && ["Equipment", d.equipment],
    ].filter(Boolean)) as [string, string][];
    return (
      <div>
        {rows.map(([k, v], i) => (
          <p key={i} style={{ ...body, margin: i === 0 ? "8px 0 0" : "4px 0 0" }}>
            <strong style={{ color: C.text }}>{k}: </strong>{v}
          </p>
        ))}
      </div>
    );
  }
  if (isCustom(entry)) {
    const d = entry.display;
    return (
      <div>
        {d.metaLines.length > 0 && <p style={meta}>{d.metaLines.join(" · ")}</p>}
        {d.body && <p style={body}>{d.body}</p>}
      </div>
    );
  }
  return null;
}

// Ability modifier, D&D style: floor((score - 10) / 2), shown as "16 (+3)".
function abilityCell(label: string, score: number | null): string | null {
  if (score == null) return null;
  const mod = Math.floor((score - 10) / 2);
  return `${label} ${score} (${mod >= 0 ? "+" : ""}${mod})`;
}

function MonsterBody({ d, meta, body }: { d: MonsterDisplay; meta: React.CSSProperties; body: React.CSSProperties }) {
  const line: React.CSSProperties = { ...meta, margin: "3px 0 0" };
  const abilities = [
    abilityCell("STR", d.abilities.str), abilityCell("DEX", d.abilities.dex), abilityCell("CON", d.abilities.con),
    abilityCell("INT", d.abilities.int), abilityCell("WIS", d.abilities.wis), abilityCell("CHA", d.abilities.cha),
  ].filter(Boolean).join("   ");
  const defenses = [
    d.damageVulnerabilities && `Vulnerabilities: ${d.damageVulnerabilities}`,
    d.damageResistances && `Resistances: ${d.damageResistances}`,
    d.damageImmunities && `Damage Immunities: ${d.damageImmunities}`,
    d.conditionImmunities && `Condition Immunities: ${d.conditionImmunities}`,
  ].filter(Boolean);
  const section = (title: string, items: { name: string | null; description: string | null }[]) =>
    items.length === 0 ? null : (
      <div style={{ marginTop: 8 }}>
        <p style={{ ...meta, color: C.sun, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 11, margin: 0 }}>{title}</p>
        {items.map((it, i) => (
          <p key={i} style={{ ...body, margin: "4px 0 0" }}>
            {it.name && <strong style={{ color: C.text }}>{it.name}. </strong>}{it.description}
          </p>
        ))}
      </div>
    );
  return (
    <div>
      <p style={meta}>{[d.size, d.type, d.alignment].filter(Boolean).join(" · ")}</p>
      <p style={line}>{[
        d.ac != null && `AC ${d.ac}`,
        d.hp != null && `HP ${d.hp}${d.hitDice ? ` (${d.hitDice})` : ""}`,
        d.speed && `Speed ${d.speed}`,
      ].filter(Boolean).join(" · ")}</p>
      {abilities && <p style={line}>{abilities}</p>}
      <p style={line}>{[
        d.senses && `Senses ${d.senses}`,
        d.languages && `Languages ${d.languages}`,
        d.cr && `CR ${d.cr}${d.xp != null ? ` (${d.xp.toLocaleString()} XP)` : ""}`,
      ].filter(Boolean).join(" · ")}</p>
      {defenses.map((x, i) => <p key={i} style={line}>{x}</p>)}
      {section("Traits", d.traits)}
      {section("Actions", d.actions)}
      {section("Bonus Actions", d.bonusActions)}
      {section("Reactions", d.reactions)}
      {section("Legendary Actions", d.legendaryActions)}
    </div>
  );
}

// The homebrew / override editor. One flexible form for every custom card: name, chip tag, the small
// meta lines, the body, which edition it shows under, whether it is account-wide or pinned to the active
// campaign, and optional voice aliases. Saving a fresh override of a shipped card writes a shadow row;
// the shipped index is never touched.
function EntryEditor({ state, onChange, onSave, onDelete, onCancel, activeCampaign, editions, error, label }: {
  state: EditState;
  onChange: (s: EditState) => void;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
  activeCampaign: { id: string; name?: string } | null;
  editions: boolean;
  error: string | null;
  label: React.CSSProperties;
}) {
  const set = <K extends keyof EditState>(k: K, v: EditState[K]) => onChange({ ...state, [k]: v });
  const field: React.CSSProperties = { width: "100%", padding: "8px 10px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 14, boxSizing: "border-box" };
  const seg = (on: boolean): React.CSSProperties => ({ padding: "6px 11px", background: on ? C.surface2 : "transparent", color: on ? C.sun : C.muted, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer" });
  const isOverride = !!state.overridesId;
  // Typed editor iff the category is one of the typed kinds AND a display is present (a legacy override
  // with no display edits through the generic body form, matching how it renders).
  const isTyped = TYPED_CUSTOM.has(state.category) && state.display != null;
  return (
    <div style={{ border: `1px solid ${C.sun}`, borderRadius: FORGE_RADIUS, padding: 14, background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ color: C.text, fontSize: 15, fontWeight: 700 }}>{state.id ? "Edit card" : isOverride ? "Override card" : "New card"}</span>
        {state.baseLabel && <span style={{ ...label, color: C.muted }}>{state.baseLabel}</span>}
      </div>

      <div>
        <div style={{ ...label, marginBottom: 4 }}>Name</div>
        <input value={state.name} onChange={(e) => set("name", e.target.value)} placeholder="Card title" style={field} />
      </div>

      {/* Card type: only for a brand-new card. An override or an existing edit keeps the base category. */}
      {!state.id && !isOverride && (
        <div>
          <div style={{ ...label, marginBottom: 4 }}>Card type</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {NEW_CARD_TYPES.map((t) => (
              <button key={t.id} type="button"
                onClick={() => onChange({ ...state, category: t.id, display: emptyDisplayFor(t.id) })}
                style={seg(state.category === t.id)}>{t.label}</button>
            ))}
          </div>
        </div>
      )}

      {editions && (
        <div>
          <div style={{ ...label, marginBottom: 4 }}>Shows under</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["2014", "2024", "both"] as Ruleset3[]).map((r) => (
              <button key={r} type="button" onClick={() => set("ruleset", r)} style={seg(state.ruleset === r)}>{r === "both" ? "Both" : r}</button>
            ))}
          </div>
        </div>
      )}

      {isTyped ? (
        state.category === "spell" ? (
          <SpellForm value={state.display as SpellDisplay} onChange={(d) => set("display", d)} field={field} seg={seg} />
        ) : state.category === "magic-item" ? (
          <ItemForm value={state.display as ItemDisplay} onChange={(d) => set("display", d)} field={field} seg={seg} />
        ) : (
          <MonsterForm value={state.display as MonsterDisplay} onChange={(d) => set("display", d)} field={field} />
        )
      ) : (
        <>
          <div>
            <div style={{ ...label, marginBottom: 4 }}>Tag (chip)</div>
            <input value={state.tag} onChange={(e) => set("tag", e.target.value)} placeholder="house rule" style={field} />
          </div>
          <div>
            <div style={{ ...label, marginBottom: 4 }}>Meta lines (one per line, shown above the body)</div>
            <textarea value={state.metaLinesText} onChange={(e) => set("metaLinesText", e.target.value)} rows={2} placeholder={"Level 3 Evocation\nRange 150 ft"} style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />
          </div>
          <div>
            <div style={{ ...label, marginBottom: 4 }}>Body</div>
            <textarea value={state.body} onChange={(e) => set("body", e.target.value)} rows={5} placeholder="The rules text for this card." style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />
          </div>
        </>
      )}

      <div>
        <div style={{ ...label, marginBottom: 4 }}>Voice aliases (comma-separated, optional)</div>
        <input value={state.aliasesText} onChange={(e) => set("aliasesText", e.target.value)} placeholder="fb, big boom" style={field} />
      </div>

      <div>
        <div style={{ ...label, marginBottom: 4 }}>Scope</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" onClick={() => set("campaignId", null)} style={seg(state.campaignId == null)}>All my campaigns</button>
          {activeCampaign && (
            <button type="button" onClick={() => set("campaignId", activeCampaign.id)} style={seg(state.campaignId === activeCampaign.id)}>
              Only {activeCampaign.name || "this campaign"}
            </button>
          )}
          {!activeCampaign && state.campaignId != null && (
            <span style={{ ...label, alignSelf: "center" }}>pinned to a campaign</span>
          )}
        </div>
      </div>

      {error && <p style={{ color: "#c98a7a", fontSize: 12.5, margin: 0 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" onClick={onSave} style={{ padding: "8px 16px", background: C.sun, color: "#1b1712", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Save</button>
        <button type="button" onClick={onCancel} style={{ padding: "8px 14px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 14, cursor: "pointer" }}>Cancel</button>
        <span style={{ flex: 1 }} />
        {state.id && (
          <button type="button" onClick={onDelete} title={isOverride ? "Delete this override (reverts to the shipped card)" : "Delete this card"} style={{ padding: "8px 14px", background: "transparent", color: "#c98a7a", border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 14, cursor: "pointer" }}>
            {isOverride ? "Delete override (revert)" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---- typed homebrew sub-forms --------------------------------------------------------------------
// Field-based editors for the three categories with a real card layout, so a homebrew or override of a
// spell / magic item / monster is edited (and then rendered) as that thing rather than a generic blob.
// They edit a display object in place and hand the whole updated object back through onChange.

const orNull = (s: string): string | null => { const t = s.trim(); return t ? t : null; };
const toNum = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const csvList = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);
const fLabel: React.CSSProperties = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, marginBottom: 4 };

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{children}</div>;
}
function Labeled({ label, min = 120, children }: { label: string; min?: number; children: React.ReactNode }) {
  return (
    <div style={{ flex: `1 1 ${min}px`, minWidth: min }}>
      <div style={fLabel}>{label}</div>
      {children}
    </div>
  );
}

function SpellForm({ value, onChange, field, seg }: {
  value: SpellDisplay; onChange: (d: SpellDisplay) => void; field: React.CSSProperties; seg: (on: boolean) => React.CSSProperties;
}) {
  const set = (patch: Partial<SpellDisplay>) => onChange({ ...value, ...patch });
  const dmg = value.damage;
  const setDamage = (base: string, type: string) => {
    const b = orNull(base);
    onChange({ ...value, damage: b ? { base: b, type: orNull(type), scaling: dmg?.scaling ?? null } : null });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <FieldRow>
        <Labeled label="Level (0 = cantrip)"><input type="number" min={0} max={9} value={value.level} onChange={(e) => set({ level: toNum(e.target.value) ?? 0 })} style={field} /></Labeled>
        <Labeled label="School"><input value={value.school ?? ""} onChange={(e) => set({ school: orNull(e.target.value) })} placeholder="Evocation" style={field} /></Labeled>
      </FieldRow>
      <FieldRow>
        <Labeled label="Casting time"><input value={value.castingTime ?? ""} onChange={(e) => set({ castingTime: orNull(e.target.value) })} placeholder="1 action" style={field} /></Labeled>
        <Labeled label="Range"><input value={value.range ?? ""} onChange={(e) => set({ range: orNull(e.target.value) })} placeholder="150 feet" style={field} /></Labeled>
      </FieldRow>
      <FieldRow>
        <Labeled label="Components"><input value={value.components ?? ""} onChange={(e) => set({ components: orNull(e.target.value) })} placeholder="V, S, M" style={field} /></Labeled>
        <Labeled label="Duration"><input value={value.duration ?? ""} onChange={(e) => set({ duration: orNull(e.target.value) })} placeholder="Instantaneous" style={field} /></Labeled>
      </FieldRow>
      <FieldRow>
        <Labeled label="Concentration" min={110}><button type="button" onClick={() => set({ concentration: !value.concentration })} style={seg(value.concentration)}>{value.concentration ? "Yes" : "No"}</button></Labeled>
        <Labeled label="Ritual" min={110}><button type="button" onClick={() => set({ ritual: !value.ritual })} style={seg(value.ritual)}>{value.ritual ? "Yes" : "No"}</button></Labeled>
      </FieldRow>
      <FieldRow>
        <Labeled label="Damage (e.g. 8d6)"><input value={dmg?.base ?? ""} onChange={(e) => setDamage(e.target.value, dmg?.type ?? "")} placeholder="8d6" style={field} /></Labeled>
        <Labeled label="Damage type"><input value={dmg?.type ?? ""} onChange={(e) => setDamage(dmg?.base ?? "", e.target.value)} placeholder="fire" style={field} /></Labeled>
        <Labeled label="Attack type"><input value={value.attackType ?? ""} onChange={(e) => set({ attackType: orNull(e.target.value) })} placeholder="ranged" style={field} /></Labeled>
      </FieldRow>
      <div>
        <div style={fLabel}>Classes (comma-separated)</div>
        <input value={value.classes.join(", ")} onChange={(e) => set({ classes: csvList(e.target.value) })} placeholder="Wizard, Sorcerer" style={field} />
      </div>
      <div>
        <div style={fLabel}>Description</div>
        <textarea value={value.description ?? ""} onChange={(e) => set({ description: orNull(e.target.value) })} rows={5} placeholder="What the spell does." style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />
      </div>
    </div>
  );
}

function ItemForm({ value, onChange, field, seg }: {
  value: ItemDisplay; onChange: (d: ItemDisplay) => void; field: React.CSSProperties; seg: (on: boolean) => React.CSSProperties;
}) {
  const set = (patch: Partial<ItemDisplay>) => onChange({ ...value, ...patch });
  const v = value.variants;
  const setVariants = (vlabel: string, opts: string) => {
    const options = csvList(opts);
    onChange({ ...value, variants: options.length ? { label: orNull(vlabel), options } : null });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <FieldRow>
        <Labeled label="Type"><input value={value.type ?? ""} onChange={(e) => set({ type: orNull(e.target.value) })} placeholder="Wondrous item" style={field} /></Labeled>
        <Labeled label="Rarity"><input value={value.rarity ?? ""} onChange={(e) => set({ rarity: orNull(e.target.value) })} placeholder="rare" style={field} /></Labeled>
      </FieldRow>
      <FieldRow>
        <Labeled label="Attunement" min={140}><button type="button" onClick={() => set({ attunement: !value.attunement })} style={seg(value.attunement)}>{value.attunement ? "Required" : "Not required"}</button></Labeled>
        <Labeled label="Attunement note"><input value={value.attunementNote ?? ""} onChange={(e) => set({ attunementNote: orNull(e.target.value) })} placeholder="by a spellcaster" style={field} /></Labeled>
      </FieldRow>
      <FieldRow>
        <Labeled label="Variants label"><input value={v?.label ?? ""} onChange={(e) => setVariants(e.target.value, (v?.options ?? []).join(", "))} placeholder="Bonus" style={field} /></Labeled>
        <Labeled label="Variant options (comma)"><input value={(v?.options ?? []).join(", ")} onChange={(e) => setVariants(v?.label ?? "", e.target.value)} placeholder="+1, +2, +3" style={field} /></Labeled>
      </FieldRow>
      <div>
        <div style={fLabel}>Description</div>
        <textarea value={value.description ?? ""} onChange={(e) => set({ description: orNull(e.target.value) })} rows={5} placeholder="What the item does." style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />
      </div>
    </div>
  );
}

type TraitSection = "traits" | "actions" | "bonusActions" | "reactions" | "legendaryActions";
const traitsToText = (a: MonsterDisplay["traits"]): string => a.map((t) => `${t.name ? t.name + ". " : ""}${t.description ?? ""}`).join("\n");
const textToTraits = (s: string): MonsterDisplay["traits"] =>
  s.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*?)\.\s+([\s\S]*)$/);
    return m ? { name: m[1], description: m[2] } : { name: null, description: l };
  });

function MonsterForm({ value, onChange, field }: {
  value: MonsterDisplay; onChange: (d: MonsterDisplay) => void; field: React.CSSProperties;
}) {
  const set = (patch: Partial<MonsterDisplay>) => onChange({ ...value, ...patch });
  const setAb = (k: keyof MonsterDisplay["abilities"], s: string) => onChange({ ...value, abilities: { ...value.abilities, [k]: toNum(s) } });
  const section = (labelText: string, key: TraitSection) => (
    <div>
      <div style={fLabel}>{labelText} (one per line, &quot;Name. Effect&quot;)</div>
      <textarea value={traitsToText(value[key])} onChange={(e) => set({ [key]: textToTraits(e.target.value) } as Partial<MonsterDisplay>)} rows={3} style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <FieldRow>
        <Labeled label="Size" min={90}><input value={value.size ?? ""} onChange={(e) => set({ size: orNull(e.target.value) })} placeholder="Large" style={field} /></Labeled>
        <Labeled label="Type"><input value={value.type ?? ""} onChange={(e) => set({ type: orNull(e.target.value) })} placeholder="dragon" style={field} /></Labeled>
        <Labeled label="Alignment"><input value={value.alignment ?? ""} onChange={(e) => set({ alignment: orNull(e.target.value) })} placeholder="chaotic evil" style={field} /></Labeled>
      </FieldRow>
      <FieldRow>
        <Labeled label="AC" min={80}><input value={value.ac == null ? "" : String(value.ac)} onChange={(e) => set({ ac: orNull(e.target.value) })} placeholder="18" style={field} /></Labeled>
        <Labeled label="HP" min={80}><input value={value.hp == null ? "" : String(value.hp)} onChange={(e) => set({ hp: orNull(e.target.value) })} placeholder="152" style={field} /></Labeled>
        <Labeled label="Hit dice" min={100}><input value={value.hitDice ?? ""} onChange={(e) => set({ hitDice: orNull(e.target.value) })} placeholder="16d10 + 64" style={field} /></Labeled>
        <Labeled label="Speed"><input value={value.speed ?? ""} onChange={(e) => set({ speed: orNull(e.target.value) })} placeholder="40 ft., fly 80 ft." style={field} /></Labeled>
      </FieldRow>
      <FieldRow>
        <Labeled label="Senses"><input value={value.senses ?? ""} onChange={(e) => set({ senses: orNull(e.target.value) })} placeholder="darkvision 60 ft." style={field} /></Labeled>
        <Labeled label="Languages"><input value={value.languages ?? ""} onChange={(e) => set({ languages: orNull(e.target.value) })} placeholder="Common, Draconic" style={field} /></Labeled>
        <Labeled label="CR" min={90}><input value={value.cr ?? ""} onChange={(e) => set({ cr: orNull(e.target.value) })} placeholder="10" style={field} /></Labeled>
        <Labeled label="XP" min={90}><input type="number" value={value.xp ?? ""} onChange={(e) => set({ xp: toNum(e.target.value) })} placeholder="5900" style={field} /></Labeled>
      </FieldRow>
      <FieldRow>
        {(["str", "dex", "con", "int", "wis", "cha"] as const).map((k) => (
          <Labeled key={k} label={k.toUpperCase()} min={70}>
            <input type="number" value={value.abilities[k] ?? ""} onChange={(e) => setAb(k, e.target.value)} style={field} />
          </Labeled>
        ))}
      </FieldRow>
      <FieldRow>
        <Labeled label="Vulnerabilities"><input value={value.damageVulnerabilities ?? ""} onChange={(e) => set({ damageVulnerabilities: orNull(e.target.value) })} style={field} /></Labeled>
        <Labeled label="Resistances"><input value={value.damageResistances ?? ""} onChange={(e) => set({ damageResistances: orNull(e.target.value) })} style={field} /></Labeled>
      </FieldRow>
      <FieldRow>
        <Labeled label="Damage immunities"><input value={value.damageImmunities ?? ""} onChange={(e) => set({ damageImmunities: orNull(e.target.value) })} style={field} /></Labeled>
        <Labeled label="Condition immunities"><input value={value.conditionImmunities ?? ""} onChange={(e) => set({ conditionImmunities: orNull(e.target.value) })} style={field} /></Labeled>
      </FieldRow>
      {section("Traits", "traits")}
      {section("Actions", "actions")}
      {section("Bonus actions", "bonusActions")}
      {section("Reactions", "reactions")}
      {section("Legendary actions", "legendaryActions")}
    </div>
  );
}
