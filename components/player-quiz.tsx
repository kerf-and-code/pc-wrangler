"use client";

// components/player-quiz.tsx
//
// The free, no-login Player Disposition Inventory (the "player-type quiz"). A stripped fork of
// components/tpdi.jsx: SAME 24 items, SAME 1-5 scale, SAME scoring (flavor axes ipsatized within the
// respondent to recover profile SHAPE; Presence kept separate as a raw level). Removed for the public
// tool: the Supabase anonymous sign-in, the save/share-to-GM path, and the lines-and-veils phase, which
// are account and GM features. Nothing is stored; it computes in the browser.
//
// The funnel: this is a one-time self-report snapshot. In the product the same six axes are measured from
// what players actually DO across recorded sessions, so the read starts here and moves toward behavior.
//
// The tavern chart is drawn as a self-contained SVG radar (five flavor axes) so the tool carries no chart
// dependency; Presence shows as its own meter, exactly as tpdi renders it. Axis colours come from
// lib/theme (SAX.axis), the data-encoding hues that are the same in every Six Axes chart.

import { useEffect, useMemo, useState } from "react";
import { AXES, type AxisKey } from "@/lib/theme";

const KEYS: AxisKey[] = ["N", "T", "O", "S", "E", "I"];
const FLAVOR: AxisKey[] = ["N", "T", "O", "S", "E"];

type Item = { id: string; axis: AxisKey; reverse: boolean; text: string };
const ITEMS: Item[] = [
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

// What each axis measures, and why it helps a GM understand the player. Written from the items above.
const AXIS_EXPLAIN: Record<AxisKey, { measures: string; matters: string }> = {
  N: { measures: "How much you play for the character and the story: acting in voice, choosing what your character would do over the optimal move, caring about the emotional beats.", matters: "A high Voice player wants scenes that are theirs, a hard conversation, a reunion, a moment of truth. Starve those and they quietly check out." },
  T: { measures: "How much you enjoy the puzzle of a fight: reading the board, positioning, action economy, finding the move that turns it around.", matters: "Tactics players light up at a genuinely hard, fair fight. Give them terrain and choices, not just a bag of hit points to grind down." },
  O: { measures: "How much you enjoy the machine itself: builds, rules mastery, theorycraft, planning your progression several levels ahead.", matters: "Arcana players want their cleverness rewarded: meaningful level-up choices and gear that changes how they play. A system with no depth bores them." },
  S: { measures: "How much you play for the people: pulling quieter players in, watching whether everyone is enjoying themselves, the social glue of the table.", matters: "Rapport players are your co-hosts. They smooth the table and include others, so lean on them, and make sure they get looked after too." },
  E: { measures: "How much the world pulls you: lore and history, poking into every corner, valuing a found secret over a won fight.", matters: "Exploration players reward a world with hidden depth. Seed secrets and history for them; a corridor with nothing to find leaves them cold." },
  I: { measures: "How present you are: thinking about the campaign between sessions, tracking play when it is not your turn, preparing, staying engaged. Shown on its own, because it is a level of engagement, not a flavour.", matters: "Presence tells you how much fuel a player brings. It is not good or bad by itself, but a whole table running low is a cue to change pace or check in." },
};

type Answer = number | "NB";
type Phase = "intro" | "quiz" | "results";

export default function PlayerQuiz() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [order, setOrder] = useState<Item[]>(ITEMS);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  const reduce = useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // Shuffle on mount only, so server and first client render match (no hydration mismatch).
  useEffect(() => { setOrder(shuffle(ITEMS)); }, []);

  const current = order[idx];
  const answered = Object.keys(answers).length;
  const result = useMemo(() => scoreTpdi(answers), [answers]);

  function record(val: Answer) {
    setAnswers((a) => ({ ...a, [current.id]: val }));
    if (idx < order.length - 1) setIdx(idx + 1);
    else setPhase("results");
  }
  function back() { if (idx > 0) setIdx(idx - 1); }

  useEffect(() => {
    if (phase !== "quiz") return;
    function onKey(e: KeyboardEvent) {
      if (e.key >= "1" && e.key <= "5") record(Number(e.key));
      else if (e.key === "0") record("NB");
      else if (e.key === "Backspace" || e.key === "ArrowLeft") { e.preventDefault(); back(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx, current]);

  // ---------- INTRO ----------
  if (phase === "intro") {
    return (
      <div>
        <p style={body}>
          Twenty-four quick reads on what pulls you to the table. There are no better or worse answers,
          and no type is the right one. This is a starting read of your preferences; in Six Axes, logged
          sessions refine it toward how you actually play.
        </p>
        <p style={{ ...small, marginTop: 10 }}>
          Answer for how you tend to play in general, not one character or one night. If a statement does
          not fit your experience yet, mark it &quot;no basis to answer.&quot; Nothing is saved.
        </p>
        <button onClick={() => { setAnswers({}); setIdx(0); setPhase("quiz"); }} style={cta}>Begin</button>
        <Explainer />
      </div>
    );
  }

  // ---------- QUIZ ----------
  if (phase === "quiz" && current) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{ flex: 1, height: 4, background: "#e3dbc9", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${(answered / ITEMS.length) * 100}%`, height: "100%", background: "#8a6a2f", transition: reduce ? "none" : "width .3s ease" }} />
          </div>
          <div style={mono}>{String(idx + 1).padStart(2, "0")} / {ITEMS.length}</div>
        </div>

        <div style={statement}><p style={statementText}>{current.text}</p></div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 16 }}>
          {SCALE.map((s) => {
            const chosen = answers[current.id] === s.v;
            return (
              <button key={s.v} onClick={() => record(s.v)} aria-label={s.label}
                style={{ ...likert, background: chosen ? scoreColor(s.v) : "#fffdf8", color: chosen ? "#fff" : "#4a443a", borderColor: chosen ? scoreColor(s.v) : "#c9bfa8" }}>
                <span style={{ fontFamily: MONO, fontSize: 15 }}>{s.v}</span>
                <span style={{ fontSize: 10.5, lineHeight: 1.2, height: 26 }}>{s.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
          <button onClick={back} disabled={idx === 0} style={{ ...ghost, color: idx === 0 ? "#cfc3a4" : "#8a7a55", cursor: idx === 0 ? "default" : "pointer" }}>Back</button>
          <button onClick={() => record("NB")} style={nbBtn}>No basis to answer</button>
        </div>
        <div style={{ ...mono, textAlign: "center", marginTop: 16, color: "#a89a78" }}>tip: keys 1 to 5 to answer, 0 to skip</div>
      </div>
    );
  }

  // ---------- RESULTS ----------
  return (
    <div>
      <h2 style={h2}>Your starting profile</h2>
      <p style={body}>
        The shape below is your relative emphasis across the five flavour axes: what pulls you, compared to
        your own baseline. Presence sits on its own because it measures how much you show up, not what you
        are into.
      </p>

      <RadarChart axisMean={result.axisMean} />

      {/* Leans */}
      <div style={panel}>
        <div style={panelEyebrow}>Your profile leans</div>
        {result.weights.slice(0, 3).map((w) => {
          const ax = AXES[w.key];
          return (
            <div key={w.key} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5, gap: 8 }}>
                <span style={{ fontSize: 15 }}>
                  <span style={{ color: ax.color, fontWeight: 600 }}>{ax.tavernName}</span>
                  <span style={{ color: "#8a8069", fontSize: 12.5 }}> · {ax.facet}</span>
                </span>
                <span style={{ fontFamily: MONO, fontSize: 13, color: "#4a443a" }}>{Math.round(w.w * 100)}%</span>
              </div>
              <div style={{ height: 5, background: "#e3dbc9", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${w.w * 100}%`, height: "100%", background: ax.color }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Presence meter */}
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <span style={panelEyebrow}>Presence</span>
          <span style={{ fontFamily: MONO, fontSize: 12, color: "#8a8069" }}>{result.intensity === null ? "no data" : `${result.intensity.toFixed(1)} / 5`}</span>
        </div>
        <div style={{ height: 6, background: "#e3dbc9", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${result.intensity === null ? 0 : ((result.intensity - 1) / 4) * 100}%`, height: "100%", background: AXES.I.color }} />
        </div>
        <p style={{ ...small, marginTop: 10 }}>Shown as a raw level. A true Presence score is set against other players, so it calibrates once there is a table to compare against.</p>
      </div>

      <p style={{ ...small, marginTop: 16 }}>
        This is a preference, not a verdict, and it is meant to change.
        {result.nbCount > 0 && <span> You skipped {result.nbCount} {result.nbCount === 1 ? "item" : "items"}, so confidence is lower on those axes.</span>}
      </p>

      <div style={{ marginTop: 18 }}>
        <button onClick={() => { setAnswers({}); setIdx(0); setOrder(shuffle(ITEMS)); setPhase("intro"); }} style={ghostBtn}>Retake</button>
      </div>

      <Explainer />
    </div>
  );
}

// The six axes explained, plus the in-game / per-session / GM-value framing. Shown on the intro and after
// the result so a search visitor who never takes the quiz still gets the point.
function Explainer() {
  return (
    <div style={{ marginTop: 30 }}>
      <h2 style={h2}>What the six axes mean</h2>
      <p style={body}>The axes spell TAVERN, the place you meet your characters. Five are flavours, what pulls you; the sixth, Presence, is how much you show up.</p>
      <div style={{ marginTop: 8 }}>
        {KEYS.map((k) => {
          const ax = AXES[k];
          const ex = AXIS_EXPLAIN[k];
          return (
            <div key={k} style={axRow}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: ax.color, display: "inline-block" }} />
                <span style={{ fontWeight: 600, fontSize: 16 }}>{ax.tavernName}</span>
                <span style={{ color: "#8a8069", fontSize: 12.5 }}>{ax.name.replace("The ", "")}</span>
              </div>
              <p style={{ ...small, margin: "6px 0 0" }}><strong style={{ color: "#4a443a" }}>Measures.</strong> {ex.measures}</p>
              <p style={{ ...small, margin: "4px 0 0" }}><strong style={{ color: "#4a443a" }}>For the GM.</strong> {ex.matters}</p>
            </div>
          );
        })}
      </div>

      <h2 style={{ ...h2, marginTop: 26 }}>What this does at the table</h2>
      <p style={body}>
        On its own, this quiz is a map of your table: who wants the spotlight scene, who wants the hard
        fight, who is your social anchor, who is quietly disengaging. It is a read of what each player
        enjoys, so you can aim prep at it.
      </p>
      <p style={body}>
        <strong style={{ color: "#2a2620" }}>How it changes each session.</strong> The quiz is a one-time
        self-report, how you think you play. In Six Axes, the same six axes are measured from what players
        actually do in each recorded session, so the read moves off the survey and toward observed
        behaviour, session by session. Watching self-perception meet reality over a campaign is the point.
      </p>
      <p style={body}>
        <strong style={{ color: "#2a2620" }}>What it offers the GM.</strong> A living read of every player,
        not a one-night guess. It surfaces who has not had their kind of moment in a while, who is leaning
        in, and who is drifting, so the table stays balanced and everyone gets a night that plays to what
        they came for.
      </p>
    </div>
  );
}

// Self-contained SVG radar over the five flavour axes. Values map the 1..5 answer scale to radius.
function RadarChart({ axisMean }: { axisMean: Record<AxisKey, number | null> }) {
  const size = 320, cx = 160, cy = 156, R = 116;
  const n = FLAVOR.length;
  const ang = (i: number) => -Math.PI / 2 + i * ((2 * Math.PI) / n);
  const radiusFor = (val: number | null) => (val === null ? 0 : (Math.max(1, Math.min(5, val)) - 1) / 4) * R;
  const pt = (i: number, r: number): [number, number] => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const poly = (rs: number[]) => rs.map((r, i) => pt(i, r).join(",")).join(" ");
  const rings = [0.25, 0.5, 0.75, 1].map((f) => poly(FLAVOR.map(() => f * R)));
  const dataPts = poly(FLAVOR.map((k) => radiusFor(axisMean[k])));

  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "6px 0 2px" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Your disposition across the five flavour axes">
        {rings.map((p, i) => <polygon key={i} points={p} fill="none" stroke="#d8cdb4" strokeWidth={1} />)}
        {FLAVOR.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#d8cdb4" strokeWidth={1} />; })}
        <polygon points={dataPts} fill="rgba(200,162,75,0.28)" stroke="#a9822f" strokeWidth={2} />
        {FLAVOR.map((k, i) => {
          const [x, y] = pt(i, radiusFor(axisMean[k]));
          return <circle key={k} cx={x} cy={y} r={3} fill={AXES[k].color} />;
        })}
        {FLAVOR.map((k, i) => {
          const [x, y] = pt(i, R + 18);
          return <text key={k} x={x} y={y} fill={AXES[k].color} fontSize={13} fontWeight={600} textAnchor="middle" dominantBaseline="middle" style={{ fontFamily: "'Iowan Old Style', Georgia, serif" }}>{AXES[k].tavernName}</text>;
        })}
      </svg>
    </div>
  );
}

// ---------- scoring (ported verbatim from tpdi.jsx) ----------
function scoreTpdi(answers: Record<string, Answer>) {
  const byAxis: Record<AxisKey, number[]> = { N: [], T: [], O: [], S: [], E: [], I: [] };
  for (const it of ITEMS) {
    const raw = answers[it.id];
    if (raw === undefined || raw === "NB") continue;
    byAxis[it.axis].push(it.reverse ? 6 - raw : raw);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const axisMean = {} as Record<AxisKey, number | null>;
  for (const k of KEYS) axisMean[k] = mean(byAxis[k]);

  const flavorVals = FLAVOR.map((k) => axisMean[k]).filter((v): v is number => v !== null);
  const personMean = flavorVals.length ? flavorVals.reduce((s, x) => s + x, 0) / flavorVals.length : 3;

  const ipsa = {} as Record<AxisKey, number | null>;
  for (const k of FLAVOR) ipsa[k] = axisMean[k] === null ? null : (axisMean[k] as number) - personMean;

  const kGain = 1.25;
  const present = FLAVOR.filter((k) => ipsa[k] !== null);
  const exps = present.map((k) => Math.exp(kGain * (ipsa[k] as number)));
  const sumE = exps.reduce((s, x) => s + x, 0) || 1;
  const weights = present.map((k, i) => ({ key: k, w: exps[i] / sumE })).sort((a, b) => b.w - a.w);

  const nbCount = ITEMS.filter((it) => answers[it.id] === "NB").length;
  return { axisMean, weights, intensity: axisMean.I, nbCount };
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function scoreColor(v: number) {
  if (v <= 2) return "#a44a3a";
  if (v >= 4) return "#5a7d4a";
  return "#8a8069";
}

// ---------- styles ----------
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const body: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.7, color: "#3a352c", margin: "0 0 12px" };
const small: React.CSSProperties = { fontSize: 13.5, color: "#7a6f57", lineHeight: 1.6, margin: 0 };
const mono: React.CSSProperties = { fontFamily: MONO, fontSize: 12, color: "#8a8069" };
const h2: React.CSSProperties = { fontSize: 24, fontWeight: 600, color: "#2a2620", margin: "0 0 8px" };
const cta: React.CSSProperties = { marginTop: 20, background: "#3a352c", color: "#f6f2e9", border: "none", borderRadius: 3, padding: "13px 28px", fontFamily: MONO, fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" };
const statement: React.CSSProperties = { background: "#fffdf8", border: "1px solid #cfc3a4", borderRadius: 6, padding: "28px 26px", minHeight: 130, display: "flex", alignItems: "center" };
const statementText: React.CSSProperties = { fontSize: 22, lineHeight: 1.35, fontWeight: 500, margin: 0, color: "#2a2620" };
const likert: React.CSSProperties = { border: "1px solid", borderRadius: 4, padding: "15px 6px 11px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" };
const ghost: React.CSSProperties = { background: "none", border: "none", fontSize: 14, padding: 6 };
const ghostBtn: React.CSSProperties = { background: "none", color: "#8a6a2f", border: "1px solid #c9bfa8", borderRadius: 3, padding: "11px 22px", fontSize: 15, cursor: "pointer", fontFamily: "'Iowan Old Style', Georgia, serif" };
const nbBtn: React.CSSProperties = { background: "none", border: "1px solid #c9bfa8", color: "#7a6f57", borderRadius: 3, padding: "7px 12px", fontSize: 12.5, cursor: "pointer" };
const panel: React.CSSProperties = { background: "#fffdf8", border: "1px solid #ddd4c2", borderRadius: 6, padding: "18px 20px", marginTop: 12 };
const panelEyebrow: React.CSSProperties = { fontFamily: MONO, fontSize: 11, letterSpacing: "0.16em", color: "#9a7b2e", textTransform: "uppercase" };
const axRow: React.CSSProperties = { padding: "12px 0", borderTop: "1px solid #e3dbc9" };
