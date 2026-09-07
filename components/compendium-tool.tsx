"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { CompendiumMatcher, type RankedMatch } from "@/lib/compendium/match";
import { useVosk } from "@/lib/compendium/useVosk";
import {
  type CompendiumEntry, type Ruleset, type MonsterDisplay,
  isSpell, isItem, isGear, isCondition, isFeat, isFeature, isRule, isMonster, isSpecies, isBackground,
} from "@/lib/compendium/types";

// components/compendium-tool.tsx
//
// The offline rules compendium: look a term up and get an instant card, by typing OR by voice. Voice
// uses on-device Vosk (see lib/compendium/useVosk); both paths feed the same match -> addCard pipeline.
// Listen mode is real: "Continuous" cards auto-dismiss after 30s (a rolodex, newest on top),
// "Push to talk" listens for one phrase and pins the card. Ruleset toggle swaps the prebuilt index
// (2014 / 2024 / both). Data is SRD 5.1 (CC-BY); nothing leaves the browser.

const AUTO_MS = 30_000;
const MAX_CARDS = 12;
// The on-device speech model, served statically. First voice use downloads it (~40MB) then the browser
// caches it. See the deploy notes for where to place this file.
const MODEL_URL = "/compendium/model/vosk-model-small-en-us-0.15.tar.gz";

type ListenMode = "push" | "continuous";
interface Card { key: string; entry: CompendiumEntry; pinned: boolean; expiresAt: number | null }

export default function CompendiumTool() {
  const [ruleset, setRuleset] = useState<Ruleset>("2014");
  const [entries, setEntries] = useState<CompendiumEntry[]>([]);
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

  const matcher = useMemo(() => (entries.length ? new CompendiumMatcher(entries) : null), [entries]);

  // Load the prebuilt index + grammar for the chosen ruleset.
  useEffect(() => {
    let off = false;
    setLoading(true); setLoadError(null);
    fetch(`/compendium/index-${ruleset}.json`)
      .then((r) => { if (!r.ok) throw new Error(`index-${ruleset}.json ${r.status}`); return r.json(); })
      .then((data: CompendiumEntry[]) => { if (!off) { setEntries(Array.isArray(data) ? data : []); setLoading(false); } })
      .catch((e) => { if (!off) { setLoadError(e instanceof Error ? e.message : "Could not load the compendium."); setLoading(false); } });
    fetch(`/compendium/grammar-${ruleset}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((g: string[]) => { if (!off) setGrammarPhrases(Array.isArray(g) ? g : []); })
      .catch(() => { if (!off) setGrammarPhrases([]); });
    return () => { off = true; };
  }, [ruleset]);

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

  const vosk = useVosk({
    modelUrl: MODEL_URL,
    onText: handleVoiceText,
    onPartial: handlePartial,
    grammar: grammarOn ? grammarPhrases : null,
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

  // ---- styles ----
  const seg = (on: boolean): React.CSSProperties => ({ padding: "7px 12px", background: on ? C.surface2 : "transparent", color: on ? C.sun : C.muted, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer" });
  const label: React.CSSProperties = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted };

  const micLabel = vosk.status === "loading" ? "Loading model…" : vosk.listening ? "Stop" : "🎙 Voice";
  const micActive = vosk.listening;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* controls */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={{ ...label, marginBottom: 6 }}>Ruleset</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["2014", "2024", "both"] as Ruleset[]).map((r) => (
              <button key={r} type="button" onClick={() => setRuleset(r)} style={seg(ruleset === r)}>{r === "both" ? "Both" : r}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ ...label, marginBottom: 6 }}>Listen mode</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={() => setListenMode("continuous")} style={seg(listenMode === "continuous")}>Continuous (auto-dismiss)</button>
            <button type="button" onClick={() => setListenMode("push")} style={seg(listenMode === "push")}>Push to talk (pinned)</button>
          </div>
        </div>
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
          Couldn&apos;t load the compendium data ({loadError}). Run <code>node scripts/build-compendium-index.mjs {ruleset}</code> and confirm <code>public/compendium/index-{ruleset}.json</code> exists.
        </p>
      )}
      {!loading && !loadError && (
        <p style={{ ...label, margin: 0 }}>{entries.length.toLocaleString()} entries loaded · SRD 5.1 / 5.2 (CC-BY), plus original content by Kerf and Code · nothing leaves your browser</p>
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
          <CardView key={c.key} card={c} onPin={() => pin(c.key)} onDismiss={() => dismiss(c.key)} onEnter={() => onEnter(c.key)} onLeave={() => onLeave(c.key)} />
        ))}
      </div>
    </div>
  );
}

// The little category chip. Features carry their flavour (metamagic / invocation / fighting style)
// rather than the generic "feature", since that is what a DM is actually looking at.
function entryTag(e: CompendiumEntry): string {
  if (isFeature(e)) {
    const k = e.display.kind;
    return k === "fighting-style" ? "fighting style" : k === "feature" ? "class feature" : k;
  }
  if (isRule(e)) return e.display.topic ? e.display.topic.toLowerCase() : "rule";
  return e.category === "magic-item" ? "item" : e.category;
}

function CardView({ card, onPin, onDismiss, onEnter, onLeave }: {
  card: Card; onPin: () => void; onDismiss: () => void; onEnter: () => void; onLeave: () => void;
}) {
  const e = card.entry;
  const chip: React.CSSProperties = { fontSize: 11, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 999, padding: "1px 8px" };
  const meta: React.CSSProperties = { color: C.muted, fontSize: 12.5, margin: "2px 0 0" };
  return (
    <div onMouseEnter={onEnter} onMouseLeave={onLeave}
      style={{ background: C.surface, border: `1px solid ${card.pinned ? C.sun : C.line}`, borderRadius: FORGE_RADIUS, padding: 14, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: C.text, fontSize: 17, fontWeight: 700 }}>{e.name}</span>
          <span style={chip}>{entryTag(e)}</span>
          {e.source === "kc" && <span style={{ ...chip, borderColor: C.line, color: C.sun }} title="Original content by Kerf and Code">Kerf &amp; Code</span>}
          {!card.pinned && card.expiresAt != null && <span style={{ ...chip, borderColor: "transparent", color: C.muted }}>auto</span>}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
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
