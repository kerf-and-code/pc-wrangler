"use client";

import { useMemo, useState } from "react";

// components/pacing-calculator.tsx
//
// The free, no-login session pacing tool. Two calculators sharing one set of per-beat minute estimates:
//   - SESSION BUDGET: does tonight's plan fit the clock? Available time (session length minus overhead and
//     downtime) versus the planned beats, with a verdict.
//   - ARC ESTIMATOR: how many sessions will this arc take? Total content minutes divided by the usable
//     minutes per session.
// System-aware: combat length varies a lot by system, so the combat default follows the chosen system.
// Every number is an editable planning estimate, not a promise; real tables run long and short.

type Sys = { id: string; label: string; combat: number };
const SYSTEMS: Sys[] = [
  { id: "dnd", label: "D&D 5e", combat: 55 },
  { id: "pf2e", label: "Pathfinder 2e", combat: 45 },
  { id: "drawsteel", label: "Draw Steel", combat: 40 },
  { id: "daggerheart", label: "Daggerheart", combat: 35 },
  { id: "coc", label: "Call of Cthulhu", combat: 20 },
  { id: "other", label: "Other / narrative", combat: 40 },
];

function clampNum(v: string, min = 0, max = 9999): number {
  const n = parseFloat(v);
  if (!isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

export default function PacingCalculator() {
  const [sys, setSys] = useState<string>("dnd");

  // shared clock + per-beat minutes
  const [hours, setHours] = useState(3.5);
  const [overhead, setOverhead] = useState(25); // recap, setup, breaks
  const [combatMin, setCombatMin] = useState(55);
  const [socialMin, setSocialMin] = useState(20);
  const [exploreMin, setExploreMin] = useState(20);

  // this session's plan
  const [combatCount, setCombatCount] = useState(2);
  const [socialCount, setSocialCount] = useState(2);
  const [exploreCount, setExploreCount] = useState(1);
  const [downtime, setDowntime] = useState(15);

  // the whole arc
  const [arcCombat, setArcCombat] = useState(8);
  const [arcSocial, setArcSocial] = useState(10);
  const [arcExplore, setArcExplore] = useState(6);

  function changeSystem(id: string) {
    setSys(id);
    const s = SYSTEMS.find((x) => x.id === id);
    if (s) setCombatMin(s.combat);
  }

  const session = useMemo(() => {
    const available = Math.round(hours * 60 - overhead - downtime);
    const planned = combatCount * combatMin + socialCount * socialMin + exploreCount * exploreMin;
    const remaining = available - planned;
    return { available, planned, remaining };
  }, [hours, overhead, downtime, combatCount, combatMin, socialCount, socialMin, exploreCount, exploreMin]);

  const arc = useMemo(() => {
    const usable = Math.max(1, Math.round(hours * 60 - overhead));
    const total = arcCombat * combatMin + arcSocial * socialMin + arcExplore * exploreMin;
    const sessions = Math.ceil(total / usable);
    return { usable, total, sessions };
  }, [hours, overhead, arcCombat, combatMin, arcSocial, socialMin, arcExplore, exploreMin]);

  return (
    <div>
      {/* Shared settings */}
      <div style={panel}>
        <div style={panelHead}>The clock</div>
        <Grid>
          <Field label="System">
            <select value={sys} onChange={(e) => changeSystem(e.target.value)} style={inp}>
              {SYSTEMS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Session length (hours)"><input type="number" step="0.5" min="0" style={inp} value={hours} onChange={(e) => setHours(clampNum(e.target.value, 0, 24))} /></Field>
          <Field label="Overhead (min): recap, setup, breaks"><input type="number" min="0" style={inp} value={overhead} onChange={(e) => setOverhead(clampNum(e.target.value, 0, 600))} /></Field>
        </Grid>
        <div style={{ marginTop: 12 }}>
          <div style={smallLabel}>Minutes per beat (adjust to your table)</div>
          <Grid>
            <Field label="Combat encounter"><input type="number" min="0" style={inp} value={combatMin} onChange={(e) => setCombatMin(clampNum(e.target.value, 0, 600))} /></Field>
            <Field label="Roleplay / social scene"><input type="number" min="0" style={inp} value={socialMin} onChange={(e) => setSocialMin(clampNum(e.target.value, 0, 600))} /></Field>
            <Field label="Exploration / investigation"><input type="number" min="0" style={inp} value={exploreMin} onChange={(e) => setExploreMin(clampNum(e.target.value, 0, 600))} /></Field>
          </Grid>
        </div>
      </div>

      {/* Session budget */}
      <div style={panel}>
        <div style={panelHead}>Tonight's session</div>
        <Grid>
          <Field label="Combats"><input type="number" min="0" style={inp} value={combatCount} onChange={(e) => setCombatCount(clampNum(e.target.value, 0, 99))} /></Field>
          <Field label="Roleplay scenes"><input type="number" min="0" style={inp} value={socialCount} onChange={(e) => setSocialCount(clampNum(e.target.value, 0, 99))} /></Field>
          <Field label="Exploration beats"><input type="number" min="0" style={inp} value={exploreCount} onChange={(e) => setExploreCount(clampNum(e.target.value, 0, 99))} /></Field>
          <Field label="Downtime / shopping (min)"><input type="number" min="0" style={inp} value={downtime} onChange={(e) => setDowntime(clampNum(e.target.value, 0, 600))} /></Field>
        </Grid>
        <div style={readout}>
          <Stat label="Time available" value={fmt(session.available)} />
          <Stat label="Plan needs" value={fmt(session.planned)} />
          <Stat
            label={session.remaining >= 0 ? "Slack left" : "Over by"}
            value={fmt(Math.abs(session.remaining))}
            tone={session.remaining >= 0 ? "good" : "bad"}
          />
        </div>
        <p style={verdict}>
          {session.remaining >= 20
            ? "Comfortable. You have room for a scene to breathe or run long."
            : session.remaining >= 0
            ? "Tight but workable. Expect little slack, and have a beat you can cut."
            : "Over the clock. Cut a beat, shorten a fight, or plan to carry content to next session."}
        </p>
      </div>

      {/* Arc estimator */}
      <div style={panel}>
        <div style={panelHead}>The whole arc</div>
        <p style={hint}>Roughly how much of each beat the arc contains, start to finish.</p>
        <Grid>
          <Field label="Total combats"><input type="number" min="0" style={inp} value={arcCombat} onChange={(e) => setArcCombat(clampNum(e.target.value, 0, 999))} /></Field>
          <Field label="Total roleplay scenes"><input type="number" min="0" style={inp} value={arcSocial} onChange={(e) => setArcSocial(clampNum(e.target.value, 0, 999))} /></Field>
          <Field label="Total exploration beats"><input type="number" min="0" style={inp} value={arcExplore} onChange={(e) => setArcExplore(clampNum(e.target.value, 0, 999))} /></Field>
        </Grid>
        <div style={readout}>
          <Stat label="Content time" value={fmt(arc.total)} />
          <Stat label="Usable per session" value={fmt(arc.usable)} />
          <Stat label="Sessions needed" value={`${arc.sessions}`} tone="good" />
        </div>
        <p style={verdict}>
          About {arc.sessions} session{arc.sessions === 1 ? "" : "s"} at this pace. Add a session or two of
          cushion: tables slow down for the parts they love, and the plan never survives contact intact.
        </p>
      </div>

      <p style={foot}>
        These are planning estimates, not a stopwatch. In Six Axes, session recaps show how your table
        actually spends its time, so these numbers get calibrated to how you really play.
      </p>
    </div>
  );
}

function fmt(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={smallLabel}>{label}</span>
      {children}
    </label>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>{children}</div>;
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "#3d6b3d" : tone === "bad" ? "#a4442e" : "#2a2620";
  return (
    <div style={statBox}>
      <div style={statLabel}>{label}</div>
      <div style={{ ...statValue, color }}>{value}</div>
    </div>
  );
}

// ---- styles (cream document register) ----

const panel: React.CSSProperties = { border: "1px solid #ddd4c2", background: "#fffdf8", borderRadius: 6, padding: "16px 18px", marginBottom: 16 };
const panelHead: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, letterSpacing: "0.14em",
  textTransform: "uppercase", color: "#8a7a55", marginBottom: 12,
};
const smallLabel: React.CSSProperties = {
  display: "block", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 10.5,
  letterSpacing: "0.12em", textTransform: "uppercase", color: "#8a7a55", marginBottom: 6,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 4, border: "1px solid #d8cdb4", background: "#fff",
  color: "#2a2620", fontSize: 14.5, fontFamily: "inherit", boxSizing: "border-box",
};
const readout: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 };
const statBox: React.CSSProperties = { flex: "1 1 120px", border: "1px solid #e0d6bf", background: "#faf6ec", borderRadius: 5, padding: "10px 12px" };
const statLabel: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 10, letterSpacing: "0.1em",
  textTransform: "uppercase", color: "#8a7a55", marginBottom: 5,
};
const statValue: React.CSSProperties = { fontSize: 22, fontWeight: 600 };
const verdict: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.55, color: "#4a443a", margin: "14px 0 0" };
const hint: React.CSSProperties = { fontSize: 13.5, color: "#7a7060", margin: "0 0 12px" };
const foot: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.6, color: "#7a7060", margin: "4px 0 0" };
