"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX, AXES } from "@/lib/theme";

/*
  TPDI — Player Disposition Inventory (cold-start prior)
  Single-file front door for the player-typing system.
  Scoring is methodology-honest:
    - Flavor axes (Character / Encounter / System / Table / World) are ipsatized
      within-respondent to recover PROFILE SHAPE (compositional).
    - Presence (engagement intensity) is kept separate and shown as a raw level,
      because it is the normative axis and cannot be population-scaled from n = 1.
  This is a starting prior; logged play later updates it.
*/

const C = {
  ink: SAX.inkDeep,
  ink2: "rgba(11,7,18,0.55)",
  panel: SAX.panelBg,
  line: SAX.line,
  vellum: SAX.text,
  vellumInk: SAX.parchInk,
  vellumLine: SAX.parchLine,
  brass: SAX.brass,
  brassDim: SAX.brassDim,
  muted: SAX.muted,
  agree: SAX.good,
  disagree: SAX.warn,
};

// AXES and TAVERN_ORDER now live in lib/theme.ts as the single source of truth
// for axis labels and colors (internal keys stay N/T/O/S/E/I so scoring and the
// disposition model are untouched). FLAVOR stays here because it is scoring logic
// (which axes are ipsatized), not presentation.
const FLAVOR = ["N", "T", "O", "S", "E"];

// Suggested lines (hard no, never at the table) and veils (allowed but faded to
// black, kept off-screen) as boilerplate the player can accept, drop, or extend.
const SAFETY_SUGGESTIONS = {
  lines: [
    "Harm to children",
    "Sexual violence",
    "Graphic torture",
    "Animal cruelty",
    "Self-harm or suicide",
  ],
  veils: [
    "On-screen romance / intimacy",
    "Detailed gore",
    "Bigotry aimed at the party",
    "Spiders / swarms",
  ],
};

const ITEMS = [
  { id: "n1", axis: "N", reverse: false, text: "I enjoy speaking and acting in my character's voice during play." },
  { id: "n2", axis: "N", reverse: false, text: "I make in-game choices based on who my character is, even when it is not the optimal play." },
  { id: "n3", axis: "N", reverse: false, text: "The emotional beats of the story matter more to me than the mechanical outcomes." },
  { id: "n4", axis: "N", reverse: true, text: "I mostly think of my character as a set of stats and abilities rather than a person." },
  { id: "t1", axis: "T", reverse: false, text: "In the middle of a fight, I enjoy reading the board and finding the best move available right now." },
  { id: "t2", axis: "T", reverse: false, text: "While combat is happening I am thinking about positioning, action economy, and turn order." },
  { id: "t3", axis: "T", reverse: false, text: "I get the most satisfaction when smart in-the-moment play turns a fight around." },
  { id: "t4", axis: "T", reverse: true, text: "Once a fight starts I mostly just attack and do not think much about tactics." },
  { id: "o1", axis: "O", reverse: false, text: "I enjoy designing a character build for mechanical power, apart from any particular fight." },
  { id: "o2", axis: "O", reverse: false, text: "I read rules, splatbooks, or theorycrafting threads for fun between sessions." },
  { id: "o3", axis: "O", reverse: false, text: "I plan my character's progression several levels ahead." },
  { id: "o4", axis: "O", reverse: true, text: "I do not really care how mechanically optimized my character is." },
  { id: "s1", axis: "S", reverse: false, text: "Spending time with the people at the table is a big part of why I play." },
  { id: "s2", axis: "S", reverse: false, text: "I try to pull quieter players into the action." },
  { id: "s3", axis: "S", reverse: false, text: "I keep an eye on whether everyone at the table is having a good time." },
  { id: "s4", axis: "S", reverse: true, text: "I stay focused on my own character and do not really track how others are doing." },
  { id: "e1", axis: "E", reverse: false, text: "I love uncovering the lore and history of the game world." },
  { id: "e2", axis: "E", reverse: false, text: "When the GM describes a new place, I want to investigate every corner." },
  { id: "e3", axis: "E", reverse: false, text: "Finding a hidden secret is more rewarding to me than winning a fight." },
  { id: "e4", axis: "E", reverse: true, text: "I do not care much about the setting's backstory; I am here for the action." },
  { id: "i1", axis: "I", reverse: false, text: "I think about the campaign between sessions." },
  { id: "i2", axis: "I", reverse: false, text: "When it is not my turn, I am still fully tracking what is happening." },
  { id: "i3", axis: "I", reverse: false, text: "I put real effort into preparing for sessions (notes, planning, recaps)." },
  { id: "i4", axis: "I", reverse: true, text: "My attention often drifts during sessions (phone, side conversations)." },
];

const SCALE = [
  { v: 1, label: "Strongly disagree" },
  { v: 2, label: "Disagree" },
  { v: 3, label: "Neither" },
  { v: 4, label: "Agree" },
  { v: 5, label: "Strongly agree" },
];

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function scoreColor(v) {
  if (v <= 2) return C.disagree;
  if (v >= 4) return C.agree;
  return C.muted;
}

// Decorative astrolabe ring used as the signature motif.
// `axes` mounts six battle-axes on the wheel (the "Six Axes" mark) so they spin with it.
function Astrolabe({ size = 320, spin = false, axes = true }) {
  const r = size / 2;
  const ticks = Array.from({ length: 60 });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true"
      style={{ display: "block" }}>
      <g style={spin ? { transformOrigin: "center", animation: "tpdi-spin 90s linear infinite" } : undefined}>
        <circle cx={r} cy={r} r={r - 4} fill="none" stroke={C.brassDim} strokeWidth="1" opacity="0.5" />
        <circle cx={r} cy={r} r={r - 18} fill="none" stroke={C.brassDim} strokeWidth="1" opacity="0.3" />
        {ticks.map((_, i) => {
          const a = (i / 60) * Math.PI * 2;
          const long = i % 5 === 0;
          const outer = r - 6;
          const inner = r - (long ? 16 : 11);
          return (
            <line key={i}
              x1={r + outer * Math.cos(a)} y1={r + outer * Math.sin(a)}
              x2={r + inner * Math.cos(a)} y2={r + inner * Math.sin(a)}
              stroke={C.brass} strokeWidth={long ? 1.2 : 0.6} opacity={long ? 0.6 : 0.35} />
          );
        })}
        {axes && (
          <>
            {/* hub the hafts meet at */}
            <circle cx={r} cy={r} r={r * 0.085} fill="none" stroke={C.brassDim} strokeWidth="1" opacity="0.5" />
            <circle cx={r} cy={r} r={r * 0.04} fill={C.brass} opacity="0.9" />
            {Array.from({ length: 6 }).map((_, i) => (
              <g key={`axe-${i}`} transform={`translate(${r} ${r}) rotate(${i * 60})`}>
                {/* haft from the hub outward, with a small pommel */}
                <circle cx="0" cy={-r * 0.12} r={r * 0.025} fill={C.brassDim} />
                <line x1="0" y1={-r * 0.12} x2="0" y2={-r * 0.58} stroke={C.brassDim} strokeWidth={r * 0.022} strokeLinecap="round" />
                {/* eye where the head meets the haft */}
                <circle cx="0" cy={-r * 0.6} r={r * 0.045} fill={C.brass} />
                {/* double-bit head: a blade flaring to each side, cutting edge outward */}
                <path d={`M ${r * 0.02} ${-r * 0.66} Q ${r * 0.12} ${-r * 0.71} ${r * 0.20} ${-r * 0.70} Q ${r * 0.27} ${-r * 0.67} ${r * 0.27} ${-r * 0.60} Q ${r * 0.27} ${-r * 0.53} ${r * 0.20} ${-r * 0.50} Q ${r * 0.12} ${-r * 0.49} ${r * 0.02} ${-r * 0.54} Z`} fill={C.brass} opacity="0.95" />
                <path d={`M ${-r * 0.02} ${-r * 0.66} Q ${-r * 0.12} ${-r * 0.71} ${-r * 0.20} ${-r * 0.70} Q ${-r * 0.27} ${-r * 0.67} ${-r * 0.27} ${-r * 0.60} Q ${-r * 0.27} ${-r * 0.53} ${-r * 0.20} ${-r * 0.50} Q ${-r * 0.12} ${-r * 0.49} ${-r * 0.02} ${-r * 0.54} Z`} fill={C.brass} opacity="0.95" />
              </g>
            ))}
          </>
        )}
      </g>
    </svg>
  );
}

export default function TPDI() {
  const [phase, setPhase] = useState("intro"); // intro | quiz | safety | results
  const [order, setOrder] = useState(ITEMS);
  useEffect(() => { setOrder(shuffled(ITEMS)); }, []);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // id -> 1..5 or "NB"
  const [lines, setLines] = useState(() => [...SAFETY_SUGGESTIONS.lines]);
  const [veils, setVeils] = useState(() => [...SAFETY_SUGGESTIONS.veils]);
  const [customLine, setCustomLine] = useState("");
  const [customVeil, setCustomVeil] = useState("");
  const [safetyNote, setSafetyNote] = useState("");
  const [saveError, setSaveError] = useState(null);
  const liveRef = useRef(null);

  const reduce = useMemo(
    () => typeof window !== "undefined" && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const current = order[idx];
  const answeredCount = Object.keys(answers).length;

  // --- Supabase: durable identity + persistence ---
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [existing, setExisting] = useState(null); // { scores, created_at } of last saved profile
  const [viewSaved, setViewSaved] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [joinCampaign, setJoinCampaign] = useState(null); // { id, name } resolved from a share link

  useEffect(() => {
    let active = true;
    (async () => {
      // ensure a session, creating an anonymous one if needed
      let { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) { console.error("anon sign-in failed:", error.message); return; }
        user = data.user;
      }
      if (!active || !user) return;
      setUserId(user.id);
      // read-back: most recent profile for this respondent (RLS restricts to own rows)
      const { data: rows, error } = await supabase
        .from("tpdi_responses")
        .select("id, scores, created_at, campaign_id")
        .order("created_at", { ascending: false })
        .limit(1);
      if (active && !error && rows && rows.length) setExisting(rows[0]);
    })();
    return () => { active = false; };
  }, [supabase]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("wrangler_player_name");
      if (saved) setPlayerName(saved);
      const code = new URLSearchParams(window.location.search).get("share");
      if (code) {
        supabase.rpc("resolve_share_code", { code }).then(({ data }) => {
          if (data && data.length) setJoinCampaign({ id: data[0].campaign_id, name: data[0].campaign_name });
        });
      }
    } catch (e) { /* no window */ }
  }, [supabase]);

  async function saveProfile() {
    if (!userId || saving || saved) return;
    setSaving(true);
    try { window.localStorage.setItem("wrangler_player_name", playerName.trim()); } catch (e) { /* no window */ }
    const row = {
      respondent_id: userId,
      player_name: playerName.trim() || null,
      campaign_id: joinCampaign ? joinCampaign.id : null,
      instrument_version: "tpdi-v1.0-draft",
      answers,
      scores: result,
      safety: { lines, veils, note: safetyNote.trim() || null },
      item_order: order.map((it) => it.id),
    };
    let error;
    let savedData;
    if (existing && existing.id) {
      const res = await supabase.from("tpdi_responses").update(row).eq("id", existing.id).select("id, safety");
      error = res.error; savedData = res.data;
    } else {
      const res = await supabase.from("tpdi_responses").insert(row).select("id, safety");
      error = res.error; savedData = res.data;
    }
    setSaving(false);
    console.log("tpdi save:", { path: existing && existing.id ? "update" : "insert", error, savedData });
    if (error) {
      setSaveError(error.message || "Save failed.");
    } else if (!savedData || savedData.length === 0) {
      // No error but nothing written back = the row filter matched nothing
      // (e.g. an update against a row this user can't write). Fall back to insert.
      const res = await supabase.from("tpdi_responses").insert(row).select("id, safety");
      console.log("tpdi save fallback insert:", { error: res.error, data: res.data });
      if (res.error) { setSaveError(res.error.message || "Save failed."); }
      else { setSaveError(null); setSaved(true); setExisting({ id: res.data?.[0]?.id, scores: result, created_at: new Date().toISOString() }); }
    } else {
      setSaveError(null); setSaved(true);
      setExisting({ id: savedData[0].id, scores: result, created_at: new Date().toISOString() });
    }
  }

  function record(val) {
    setAnswers((a) => ({ ...a, [current.id]: val }));
    if (idx < order.length - 1) setIdx(idx + 1);
    else setPhase("safety");
  }

  function back() {
    if (phase === "quiz" && idx > 0) setIdx(idx - 1);
  }

  useEffect(() => {
    if (phase !== "quiz") return;
    function onKey(e) {
      if (e.key >= "1" && e.key <= "5") record(Number(e.key));
      else if (e.key === "0") record("NB");
      else if (e.key === "Backspace" || e.key === "ArrowLeft") { e.preventDefault(); back(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, idx, current]); // eslint-disable-line

  // ---- scoring ----
  const result = useMemo(() => {
    const byAxis = {};
    for (const k of Object.keys(AXES)) byAxis[k] = [];
    for (const it of ITEMS) {
      const raw = answers[it.id];
      if (raw === undefined || raw === "NB") continue;
      byAxis[it.axis].push(it.reverse ? 6 - raw : raw);
    }
    const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const axisMean = {};
    for (const k of Object.keys(AXES)) axisMean[k] = mean(byAxis[k]);

    const flavorVals = FLAVOR.map((k) => axisMean[k]).filter((v) => v !== null);
    const personMean = flavorVals.length ? flavorVals.reduce((s, x) => s + x, 0) / flavorVals.length : 3;

    const ipsa = {};
    for (const k of FLAVOR) ipsa[k] = axisMean[k] === null ? null : axisMean[k] - personMean;

    // soft convex weights from positive ipsatized emphasis (softmax)
    const kGain = 1.25;
    const present = FLAVOR.filter((k) => ipsa[k] !== null);
    const exps = present.map((k) => Math.exp(kGain * ipsa[k]));
    const sumE = exps.reduce((s, x) => s + x, 0) || 1;
    const weights = present.map((k, i) => ({ key: k, w: exps[i] / sumE }))
      .sort((a, b) => b.w - a.w);

    const nbCount = ITEMS.filter((it) => answers[it.id] === "NB").length;

    return { axisMean, ipsa, weights, intensity: axisMean.I, personMean, nbCount };
  }, [answers]);

  const shown = viewSaved && existing ? existing.scores : result;

  const radarData = FLAVOR.map((k) => ({
    axis: AXES[k].tavernName,
    value: shown.axisMean[k] === null ? 0 : shown.axisMean[k],
    full: 5,
  }));

  // ---------------- render ----------------
  return (
    <PageShell width={720}>
      <style>{`
        @keyframes tpdi-spin { to { transform: rotate(360deg); } }
        @keyframes tpdi-fade { from { opacity: 0; transform: translateY(6px);} to {opacity:1; transform:none;} }
        .tpdi-fade { animation: ${reduce ? "none" : "tpdi-fade .35s ease both"}; }
        .tpdi-foc:focus-visible { outline: 2px solid ${C.brass}; outline-offset: 2px; }
        .tpdi-serif { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
        .tpdi-mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
      `}</style>

      {/* eyebrow */}
        <div className="tpdi-mono" style={{ fontSize: 11, letterSpacing: "0.22em", color: C.brass, textTransform: "uppercase", marginBottom: 22 }}>
          Player Disposition Inventory
        </div>

        {/* ---------- INTRO ---------- */}
        {phase === "intro" && (
          <div className="tpdi-fade">
            <div style={{ position: "relative", height: 240, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
              <img
                src="/astrolabe.png"
                alt=""
                draggable={false}
                style={{
                  width: 240,
                  height: 240,
                  transformOrigin: "center",
                  animation: reduce ? "none" : "tpdi-spin 90s linear infinite",
                }}
              />
            </div>

            <h1 className="tpdi-serif" style={{ fontSize: 40, lineHeight: 1.08, fontWeight: 600, margin: "8px 0 16px" }}>
              How do you play?
            </h1>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: "#D8D0C0", maxWidth: 560 }}>
              Twenty-four quick reads on what pulls you to the table. There are no better or worse
              answers, and no type is the right one. This is a starting read of your preferences. Once
              you log real sessions, how you actually play refines it.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: C.muted, maxWidth: 560, marginTop: 14 }}>
              Answer for how you tend to play in general, not one character or one night. If a
              statement does not fit your experience yet, you can mark it as no basis to answer.
            </p>

            <input value={playerName} onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Your name (optional)"
              style={{ marginTop: 22, background: C.ink2, color: C.vellum, border: `1px solid ${C.line}`,
                borderRadius: 10, padding: "12px 14px", fontSize: 15, width: "100%", maxWidth: 320, display: "block" }} />
            <p style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>
              Add your name if your GM is collecting profiles for the table.
            </p>
            {joinCampaign && (
              <div style={{ marginTop: 12, fontSize: 13, color: C.brass }}>
                Joining <strong style={{ color: C.vellum }}>{joinCampaign.name}</strong>. Your result will be shared with your GM.
              </div>
            )}

            <button onClick={() => { setViewSaved(false); setPhase("quiz"); }} className="tpdi-foc"
              style={{ marginTop: 28, background: C.brass, color: C.ink, border: "none", borderRadius: 10,
                padding: "14px 26px", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
              Begin
            </button>
            {existing && (
              <button onClick={() => { setViewSaved(true); setPhase("results"); }} className="tpdi-foc"
                style={{ marginTop: 28, marginLeft: 12, background: "none", color: C.brass,
                  border: `1px solid ${C.brassDim}`, borderRadius: 10, padding: "14px 22px",
                  fontSize: 15, cursor: "pointer" }}>
                View your last profile
              </button>
            )}
          </div>
        )}

        {/* ---------- QUIZ ---------- */}
        {phase === "quiz" && current && (
          <div>
            {/* progress */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
              <div style={{ flex: 1, height: 3, background: C.line, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(answeredCount / ITEMS.length) * 100}%`, height: "100%", background: C.brass, transition: reduce ? "none" : "width .3s ease" }} />
              </div>
              <div className="tpdi-mono" style={{ fontSize: 12, color: C.muted }}>
                {String(idx + 1).padStart(2, "0")} / {ITEMS.length}
              </div>
            </div>

            <div key={current.id} className="tpdi-fade" ref={liveRef} aria-live="polite">
              {/* statement card on vellum */}
              <div style={{ background: SAX.parch, color: C.vellumInk, borderRadius: 14, padding: "30px 26px",
                border: `1px solid ${C.vellumLine}`, minHeight: 150, display: "flex", alignItems: "center" }}>
                <p className="tpdi-serif" style={{ fontSize: 23, lineHeight: 1.34, fontWeight: 500, margin: 0 }}>
                  {current.text}
                </p>
              </div>

              {/* likert */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 18 }}>
                {SCALE.map((s) => {
                  const chosen = answers[current.id] === s.v;
                  return (
                    <button key={s.v} onClick={() => record(s.v)} className="tpdi-foc"
                      aria-label={s.label}
                      style={{
                        background: chosen ? scoreColor(s.v) : C.panel,
                        color: chosen ? "#fff" : "#D8D0C0",
                        border: `1px solid ${chosen ? scoreColor(s.v) : C.line}`,
                        borderRadius: 10, padding: "16px 6px 12px", cursor: "pointer",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                        transition: reduce ? "none" : "background .15s ease, border-color .15s ease",
                      }}>
                      <span className="tpdi-mono" style={{ fontSize: 15 }}>{s.v}</span>
                      <span style={{ fontSize: 10.5, lineHeight: 1.2, color: chosen ? "rgba(255,255,255,.85)" : C.muted, height: 26 }}>
                        {s.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* footer controls */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 }}>
                <button onClick={back} disabled={idx === 0} className="tpdi-foc"
                  style={{ background: "none", border: "none", color: idx === 0 ? C.line : C.muted,
                    cursor: idx === 0 ? "default" : "pointer", fontSize: 14, padding: 6 }}>
                  &larr; Back
                </button>
                <button onClick={() => record("NB")} className="tpdi-foc"
                  style={{ background: "none", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 8,
                    padding: "7px 12px", fontSize: 12.5, cursor: "pointer" }}>
                  No basis to answer
                </button>
              </div>

              <div className="tpdi-mono" style={{ fontSize: 11, color: C.line, textAlign: "center", marginTop: 18 }}>
                tip: keys 1&ndash;5 to answer, 0 to skip
              </div>
            </div>
          </div>
        )}

        {/* ---------- SAFETY (lines & veils) ---------- */}
        {phase === "safety" && (
          <div className="tpdi-fade">
            <h2 className="tpdi-serif" style={{ fontSize: 30, fontWeight: 600, margin: "4px 0 6px" }}>
              Your table safety
            </h2>
            <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.6, maxWidth: 560, marginBottom: 18 }}>
              Before you sit down: a <strong style={{ color: C.vellum }}>line</strong> is a hard no that never
              appears at the table; a <strong style={{ color: C.vellum }}>veil</strong> can happen in the story
              but fades to black, off screen. These are suggestions, keep what fits, remove what doesn&apos;t,
              and add your own. Your GM sees the table&apos;s combined list, never who said what.
            </p>

            {[
              { title: "Lines", subtitle: "hard no, never at the table", items: lines, setItems: setLines, custom: customLine, setCustom: setCustomLine, accent: C.brass },
              { title: "Veils", subtitle: "allowed, but off screen", items: veils, setItems: setVeils, custom: customVeil, setCustom: setCustomVeil, accent: "#6C76B0" },
            ].map((grp) => (
              <div key={grp.title} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 20px", marginBottom: 14 }}>
                <div className="tpdi-mono" style={{ fontSize: 11, letterSpacing: "0.18em", color: grp.accent, textTransform: "uppercase", marginBottom: 3 }}>
                  {grp.title}
                </div>
                <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 12 }}>{grp.subtitle}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {grp.items.map((item) => (
                    <span key={item} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, background: "rgba(11,7,18,0.5)", border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 8px 6px 13px" }}>
                      {item}
                      <button onClick={() => grp.setItems((xs) => xs.filter((x) => x !== item))} aria-label={`Remove ${item}`}
                        style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 4px" }}>
                        &times;
                      </button>
                    </span>
                  ))}
                  {grp.items.length === 0 && <span style={{ color: C.line, fontSize: 13 }}>None kept.</span>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={grp.custom} onChange={(e) => grp.setCustom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && grp.custom.trim()) {
                        grp.setItems((xs) => Array.from(new Set([...xs, grp.custom.trim()])));
                        grp.setCustom("");
                      }
                    }}
                    placeholder={`Add a ${grp.title.slice(0, -1).toLowerCase()}...`}
                    style={{ flex: 1, background: "rgba(11,7,18,0.6)", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 11px", color: C.vellum, fontSize: 13 }} />
                  <button onClick={() => { if (grp.custom.trim()) { grp.setItems((xs) => Array.from(new Set([...xs, grp.custom.trim()]))); grp.setCustom(""); } }}
                    className="tpdi-foc" style={{ background: "none", border: `1px solid ${C.line}`, color: C.vellum, borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>
                    Add
                  </button>
                </div>
              </div>
            ))}

            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 20px", marginBottom: 16 }}>
              <div className="tpdi-mono" style={{ fontSize: 11, letterSpacing: "0.18em", color: C.muted, textTransform: "uppercase", marginBottom: 10 }}>
                Anything else for your GM (optional)
              </div>
              <textarea value={safetyNote} onChange={(e) => setSafetyNote(e.target.value)} rows={2}
                placeholder="A content note, an ask, a heads-up..."
                style={{ width: "100%", background: "rgba(11,7,18,0.6)", border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", color: C.vellum, fontSize: 13.5, resize: "vertical" }} />
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                onClick={async () => { await saveProfile(); setPhase("results"); }}
                disabled={saving || !userId}
                className="tpdi-foc"
                style={{ background: C.brass, border: "none", color: "#1a1206", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
                {saving ? "Saving..." : saved ? "Saved \u2014 see results" : "Save & continue to results"}
              </button>
              <span style={{ color: C.muted, fontSize: 12.5 }}>
                {saved ? "Your profile and safety notes are saved." : "This saves your profile and safety notes."}
              </span>
            </div>
            {saveError && (
              <div style={{ marginTop: 12, background: "rgba(120,40,40,0.25)", border: `1px solid ${C.warn}`, borderRadius: 8, padding: "10px 12px", color: C.vellum, fontSize: 13 }}>
                Save error: {saveError}
              </div>
            )}
          </div>
        )}

        {/* ---------- RESULTS ---------- */}
        {phase === "results" && (
          <div className="tpdi-fade">
            <h2 className="tpdi-serif" style={{ fontSize: 30, fontWeight: 600, margin: "4px 0 6px" }}>
              {viewSaved ? "Your saved profile" : "Your starting profile"}
            </h2>
            <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.6, maxWidth: 560, marginBottom: 18 }}>
              The shape below is relative emphasis across the five flavor axes: what pulls you, compared
              to your own baseline. Presence is shown on its own because it measures how much you show
              up, not what you are into.
            </p>

            {/* radar inside astrolabe frame */}
            <div style={{ position: "relative", display: "flex", justifyContent: "center", marginTop: 4 }}>
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
                <Astrolabe size={360} spin={false} axes={false} />
              </div>
              <div style={{ width: "100%", maxWidth: 380, height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid stroke={C.line} />
                    <PolarAngleAxis dataKey="axis" tick={{ fill: "#D8D0C0", fontSize: 12 }} />
                    <PolarRadiusAxis domain={[1, 5]} tick={false} axisLine={false} />
                    <Radar dataKey="value" stroke={C.brass} fill={C.brass} fillOpacity={0.32} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* leans summary */}
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "20px 22px", marginTop: 8 }}>
              <div className="tpdi-mono" style={{ fontSize: 11, letterSpacing: "0.18em", color: C.brass, textTransform: "uppercase", marginBottom: 14 }}>
                Your profile leans
              </div>
              {shown.weights.slice(0, 3).map((w) => {
                const ax = AXES[w.key];
                return (
                  <div key={w.key} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                      <span style={{ fontSize: 15 }}>
                        <span className="tpdi-serif" style={{ color: ax.color, fontWeight: 600 }}>{ax.tavernName}</span>
                        <span style={{ color: C.muted, fontSize: 12.5 }}>{"  "}&middot; {ax.name.replace("The ", "")} &middot; {ax.facet}</span>
                      </span>
                      <span className="tpdi-mono" style={{ fontSize: 13, color: "#D8D0C0" }}>{Math.round(w.w * 100)}%</span>
                    </div>
                    <div style={{ height: 5, background: C.line, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${w.w * 100}%`, height: "100%", background: ax.color }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* presence meter */}
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 22px", marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <span className="tpdi-mono" style={{ fontSize: 11, letterSpacing: "0.18em", color: C.brass, textTransform: "uppercase" }}>Presence</span>
                <span className="tpdi-mono" style={{ fontSize: 12, color: C.muted }}>
                  {shown.intensity === null ? "no data" : `${shown.intensity.toFixed(1)} / 5`}
                </span>
              </div>
              <div style={{ height: 6, background: C.line, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${shown.intensity === null ? 0 : ((shown.intensity - 1) / 4) * 100}%`, height: "100%", background: C.brass }} />
              </div>
              <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, marginTop: 12, marginBottom: 0 }}>
                Shown as a raw level. A true presence score is set against other players, so this gets
                calibrated once there is a population to compare against.
              </p>
            </div>

            {/* honesty / framing note */}
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginTop: 18 }}>
              This is a preference, not a verdict, and it is meant to change. It is the prior your GM
              tools start from; logged sessions update it toward how you actually play.
              {shown.nbCount > 0 && (
                <span> You skipped {shown.nbCount} {shown.nbCount === 1 ? "item" : "items"}, so confidence is lower on the affected axes.</span>
              )}
            </p>

            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 22, flexWrap: "wrap" }}>
              {!viewSaved && (
                <button onClick={saveProfile} disabled={saving || saved || !userId} className="tpdi-foc"
                  style={{ background: saved ? "none" : C.brass, color: saved ? C.agree : C.ink,
                    border: saved ? `1px solid ${C.agree}` : "none", borderRadius: 10,
                    padding: "12px 22px", fontSize: 15, fontWeight: 600,
                    cursor: saving || saved || !userId ? "default" : "pointer", opacity: !userId ? 0.6 : 1 }}>
                  {saved ? "Saved" : saving ? "Saving..." : "Save my profile"}
                </button>
              )}
              <button onClick={() => { setAnswers({}); setIdx(0); setOrder(shuffled(ITEMS)); setSaved(false); setViewSaved(false); setPhase("intro"); }} className="tpdi-foc"
                style={{ background: "none", color: C.brass, border: `1px solid ${C.brassDim}`,
                  borderRadius: 10, padding: "12px 22px", fontSize: 15, cursor: "pointer" }}>
                {viewSaved ? "Take it again" : "Retake"}
              </button>
            </div>
          </div>
        )}
    </PageShell>
  );
}
