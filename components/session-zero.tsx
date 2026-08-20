"use client";

import { useMemo, useState } from "react";
import { SAX, STONE, surfaces } from "@/lib/theme";
import { stoneField } from "@/lib/forge-theme";

// components/session-zero.tsx
//
// The free, no-login Session Zero tool. It does three things in one flow: a CHECKLIST that walks a table
// through every major session-zero topic, GUIDED INPUTS captured as you discuss each one, and a generated
// TABLE CHARTER assembled from those inputs that you download and keep. Pure client-side, nothing stored.
//
// The content-and-safety section names the standard table-safety tools (Lines and Veils, the X-Card,
// Script Change, the open-door policy). These are widely used best practice; the tool presents them
// plainly and keeps nothing, so no sensitive answer is ever retained.

type SafetyTool = "Lines and Veils" | "X-Card" | "Script Change" | "Open-door policy" | "Session debriefs";
const SAFETY_TOOLS: SafetyTool[] = ["Lines and Veils", "X-Card", "Script Change", "Open-door policy", "Session debriefs"];

const LEVELS = ["Low", "Medium", "High"] as const;
type Level = (typeof LEVELS)[number];

type Data = {
  campaign: string;
  gm: string;
  system: string;
  length: string;
  cadence: string;
  venue: string;
  tone: string;
  combat: Level;
  roleplay: Level;
  exploration: Level;
  themes: string;
  lines: string;
  veils: string;
  safety: SafetyTool[];
  safetyNotes: string;
  setting: string;
  charLevel: string;
  sources: string;
  connections: string;
  attendance: string;
  missingPc: string;
  spotlight: string;
  decisions: string;
  pvp: string;
  houseRules: string;
  deathRules: string;
  logistics: string;
};

const BLANK: Data = {
  campaign: "", gm: "", system: "", length: "", cadence: "", venue: "",
  tone: "", combat: "Medium", roleplay: "Medium", exploration: "Medium", themes: "",
  lines: "", veils: "", safety: ["Open-door policy", "X-Card"], safetyNotes: "",
  setting: "", charLevel: "", sources: "", connections: "",
  attendance: "", missingPc: "", spotlight: "", decisions: "", pvp: "",
  houseRules: "", deathRules: "", logistics: "",
};

// Each section: an id (for the discussed checkbox), a title, and a why-it-matters explainer.
const SECTIONS = [
  { id: "basics", title: "The basics", why: "Get the shared facts down so nobody is guessing when or how you play." },
  { id: "tone", title: "Tone and themes", why: "Agree on the kind of story this is, so a comedy table and a horror table do not collide." },
  { id: "safety", title: "Content and safety", why: "Set what is off the table and how anyone can pause or edit a scene, no explanation needed." },
  { id: "world", title: "World and characters", why: "Line up the setting and how characters are built and connected before anyone rolls." },
  { id: "table", title: "Table expectations", why: "The social contract: attendance, spotlight, and how the group makes decisions." },
  { id: "rules", title: "Rules and house rules", why: "Name the sources allowed and any rulings that differ from the book, up front." },
  { id: "logistics", title: "Logistics", why: "The small stuff that derails a night if unspoken: tools, notes, food, recaps." },
] as const;

export default function SessionZero() {
  const [d, setD] = useState<Data>(BLANK);
  const [discussed, setDiscussed] = useState<Set<string>>(new Set());

  function set<K extends keyof Data>(k: K, v: Data[K]) {
    setD((prev) => ({ ...prev, [k]: v }));
  }
  function toggleSafety(t: SafetyTool) {
    setD((prev) => ({ ...prev, safety: prev.safety.includes(t) ? prev.safety.filter((x) => x !== t) : [...prev.safety, t] }));
  }
  function toggleDiscussed(id: string) {
    setDiscussed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const charter = useMemo(() => buildCharter(d), [d]);
  const progress = discussed.size;

  function download() {
    const name = (d.campaign.trim() || "session-zero").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const blob = new Blob([charter], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-charter.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <p style={intro}>
        Work down the checklist with the whole table. Tick each topic once you have talked it through, and
        fill in what you decide. When you are done, download the charter and keep it somewhere everyone can
        find it. Nothing here is saved or sent anywhere.
      </p>
      <div style={progressBar}>
        {progress} of {SECTIONS.length} topics discussed
      </div>

      {/* Basics */}
      <Section id="basics" d={discussed} onToggle={toggleDiscussed}>
        <Grid>
          <Field label="Campaign name"><input style={inp} value={d.campaign} onChange={(e) => set("campaign", e.target.value)} /></Field>
          <Field label="Game master"><input style={inp} value={d.gm} onChange={(e) => set("gm", e.target.value)} /></Field>
          <Field label="System"><input style={inp} placeholder="D&D 5e, Pathfinder 2e, Draw Steel..." value={d.system} onChange={(e) => set("system", e.target.value)} /></Field>
          <Field label="Session length"><input style={inp} placeholder="3-4 hours" value={d.length} onChange={(e) => set("length", e.target.value)} /></Field>
          <Field label="How often"><input style={inp} placeholder="Weekly, every other Sunday..." value={d.cadence} onChange={(e) => set("cadence", e.target.value)} /></Field>
          <Field label="Where"><input style={inp} placeholder="In person, online (which VTT)..." value={d.venue} onChange={(e) => set("venue", e.target.value)} /></Field>
        </Grid>
      </Section>

      {/* Tone */}
      <Section id="tone" d={discussed} onToggle={toggleDiscussed}>
        <Field label="What kind of game is this?">
          <input style={inp} placeholder="Heroic, gritty, comedic, horror, political intrigue, sandbox..." value={d.tone} onChange={(e) => set("tone", e.target.value)} />
        </Field>
        <div style={{ marginTop: 12 }}>
          <div style={smallLabel}>How much weight on each pillar?</div>
          <Grid>
            <LevelPick label="Combat" value={d.combat} onChange={(v) => set("combat", v)} />
            <LevelPick label="Roleplay" value={d.roleplay} onChange={(v) => set("roleplay", v)} />
            <LevelPick label="Exploration" value={d.exploration} onChange={(v) => set("exploration", v)} />
          </Grid>
        </div>
        <Field label="Themes you want in (or want to explore)"><textarea style={ta} rows={2} value={d.themes} onChange={(e) => set("themes", e.target.value)} /></Field>
      </Section>

      {/* Content and safety */}
      <Section id="safety" d={discussed} onToggle={toggleDiscussed}>
        <div style={safetyNote}>
          <strong>Lines</strong> are hard limits: content that never appears in the game.{" "}
          <strong>Veils</strong> are things that can happen but stay off-screen, faded to black.
        </div>
        <Grid>
          <Field label="Lines (never appears)"><textarea style={ta} rows={3} placeholder="One per line" value={d.lines} onChange={(e) => set("lines", e.target.value)} /></Field>
          <Field label="Veils (off-screen only)"><textarea style={ta} rows={3} placeholder="One per line" value={d.veils} onChange={(e) => set("veils", e.target.value)} /></Field>
        </Grid>
        <div style={{ marginTop: 12 }}>
          <div style={smallLabel}>Safety tools this table uses</div>
          <div style={chips}>
            {SAFETY_TOOLS.map((t) => {
              const on = d.safety.includes(t);
              return (
                <button key={t} type="button" onClick={() => toggleSafety(t)} style={{ ...chip, ...(on ? chipOn : null) }}>{t}</button>
              );
            })}
          </div>
          <p style={toolExplain}>
            The X-Card lets anyone tap out any content instantly, no reason needed. Script Change offers
            rewind, fast-forward, and pause. The open-door policy means anyone can step away at any time
            with no questions asked.
          </p>
        </div>
        <Field label="Anything else on safety or comfort"><textarea style={ta} rows={2} value={d.safetyNotes} onChange={(e) => set("safetyNotes", e.target.value)} /></Field>
      </Section>

      {/* World and characters */}
      <Section id="world" d={discussed} onToggle={toggleDiscussed}>
        <Field label="Setting in a sentence or two"><textarea style={ta} rows={2} value={d.setting} onChange={(e) => set("setting", e.target.value)} /></Field>
        <Grid>
          <Field label="Starting level / power"><input style={inp} value={d.charLevel} onChange={(e) => set("charLevel", e.target.value)} /></Field>
          <Field label="Allowed sources / content"><input style={inp} placeholder="Core only, plus X, no homebrew..." value={d.sources} onChange={(e) => set("sources", e.target.value)} /></Field>
        </Grid>
        <Field label="How do the characters know each other?"><textarea style={ta} rows={2} placeholder="Shared history, party bonds, why they stay together..." value={d.connections} onChange={(e) => set("connections", e.target.value)} /></Field>
      </Section>

      {/* Table expectations */}
      <Section id="table" d={discussed} onToggle={toggleDiscussed}>
        <Grid>
          <Field label="Attendance and scheduling"><input style={inp} placeholder="Play with 4 of 5? Cancel threshold?" value={d.attendance} onChange={(e) => set("attendance", e.target.value)} /></Field>
          <Field label="A missing player's character"><input style={inp} placeholder="GM runs them, faded out, sidelined..." value={d.missingPc} onChange={(e) => set("missingPc", e.target.value)} /></Field>
          <Field label="Sharing the spotlight"><input style={inp} value={d.spotlight} onChange={(e) => set("spotlight", e.target.value)} /></Field>
          <Field label="How the group makes decisions"><input style={inp} placeholder="Talk it out, party leader, vote..." value={d.decisions} onChange={(e) => set("decisions", e.target.value)} /></Field>
        </Grid>
        <Field label="PvP and inter-party conflict"><input style={inp} placeholder="Allowed with consent? Off the table?" value={d.pvp} onChange={(e) => set("pvp", e.target.value)} /></Field>
      </Section>

      {/* Rules */}
      <Section id="rules" d={discussed} onToggle={toggleDiscussed}>
        <Field label="House rules and rulings"><textarea style={ta} rows={2} value={d.houseRules} onChange={(e) => set("houseRules", e.target.value)} /></Field>
        <Field label="Death, dying, and revival"><input style={inp} placeholder="How lethal? Raising the dead? New characters at what level?" value={d.deathRules} onChange={(e) => set("deathRules", e.target.value)} /></Field>
      </Section>

      {/* Logistics */}
      <Section id="logistics" d={discussed} onToggle={toggleDiscussed}>
        <Field label="Tools, notes, food, recaps"><textarea style={ta} rows={2} placeholder="Who takes notes, who recaps, VTT and dice, snacks..." value={d.logistics} onChange={(e) => set("logistics", e.target.value)} /></Field>
      </Section>

      {/* Charter */}
      <div style={charterPanel}>
        <div style={charterHead}>
          <span>Your table charter</span>
          <button type="button" onClick={download} style={dlBtn}>Download charter</button>
        </div>
        <pre style={charterPre}>{charter}</pre>
      </div>
    </div>
  );
}

function buildCharter(d: Data): string {
  const lines: string[] = [];
  const title = d.campaign.trim() || "Our Campaign";
  lines.push(`# ${title} — Table Charter`, "");

  const basics: string[] = [];
  if (d.gm.trim()) basics.push(`- Game master: ${d.gm.trim()}`);
  if (d.system.trim()) basics.push(`- System: ${d.system.trim()}`);
  if (d.length.trim()) basics.push(`- Session length: ${d.length.trim()}`);
  if (d.cadence.trim()) basics.push(`- Cadence: ${d.cadence.trim()}`);
  if (d.venue.trim()) basics.push(`- Where: ${d.venue.trim()}`);
  if (basics.length) lines.push("## The basics", ...basics, "");

  const tone: string[] = [];
  if (d.tone.trim()) tone.push(`- The game is: ${d.tone.trim()}`);
  tone.push(`- Emphasis: Combat ${d.combat}, Roleplay ${d.roleplay}, Exploration ${d.exploration}`);
  if (d.themes.trim()) tone.push(`- Themes: ${d.themes.trim()}`);
  lines.push("## Tone and themes", ...tone, "");

  const safety: string[] = [];
  const asList = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const linesList = asList(d.lines);
  const veilsList = asList(d.veils);
  if (linesList.length) safety.push(`- Lines (never appears): ${linesList.join("; ")}`);
  if (veilsList.length) safety.push(`- Veils (off-screen only): ${veilsList.join("; ")}`);
  if (d.safety.length) safety.push(`- Safety tools in use: ${d.safety.join(", ")}`);
  if (d.safetyNotes.trim()) safety.push(`- Notes: ${d.safetyNotes.trim()}`);
  if (safety.length) lines.push("## Content and safety", ...safety, "");

  const world: string[] = [];
  if (d.setting.trim()) world.push(`- Setting: ${d.setting.trim()}`);
  if (d.charLevel.trim()) world.push(`- Starting level / power: ${d.charLevel.trim()}`);
  if (d.sources.trim()) world.push(`- Allowed sources: ${d.sources.trim()}`);
  if (d.connections.trim()) world.push(`- Party connections: ${d.connections.trim()}`);
  if (world.length) lines.push("## World and characters", ...world, "");

  const table: string[] = [];
  if (d.attendance.trim()) table.push(`- Attendance: ${d.attendance.trim()}`);
  if (d.missingPc.trim()) table.push(`- A missing player's character: ${d.missingPc.trim()}`);
  if (d.spotlight.trim()) table.push(`- Spotlight: ${d.spotlight.trim()}`);
  if (d.decisions.trim()) table.push(`- Decisions: ${d.decisions.trim()}`);
  if (d.pvp.trim()) table.push(`- PvP: ${d.pvp.trim()}`);
  if (table.length) lines.push("## Table expectations", ...table, "");

  const rules: string[] = [];
  if (d.houseRules.trim()) rules.push(`- House rules: ${d.houseRules.trim()}`);
  if (d.deathRules.trim()) rules.push(`- Death and revival: ${d.deathRules.trim()}`);
  if (rules.length) lines.push("## Rules", ...rules, "");

  if (d.logistics.trim()) lines.push("## Logistics", `- ${d.logistics.trim()}`, "");

  lines.push("---", "Made with the Six Axes session zero tool.");
  return lines.join("\n");
}

// ---- small presentational helpers ----

function Section({ id, d, onToggle, children }: { id: string; d: Set<string>; onToggle: (id: string) => void; children: React.ReactNode }) {
  const meta = SECTIONS.find((s) => s.id === id)!;
  const done = d.has(id);
  return (
    <div style={section}>
      <div style={sectionHead}>
        <label style={checkWrap}>
          <input type="checkbox" checked={done} onChange={() => onToggle(id)} style={{ width: 17, height: 17, accentColor: SAX.brass }} />
          <span style={{ ...sectionTitle, ...(done ? { color: "#9aa880" } : null) }}>{meta.title}</span>
        </label>
      </div>
      <p style={why}>{meta.why}</p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={fieldWrap}>
      <span style={smallLabel}>{label}</span>
      {children}
    </label>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>{children}</div>;
}

function LevelPick({ label, value, onChange }: { label: string; value: Level; onChange: (v: Level) => void }) {
  return (
    <div>
      <div style={{ ...smallLabel, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 6 }}>
        {LEVELS.map((l) => (
          <button key={l} type="button" onClick={() => onChange(l)} style={{ ...chip, flex: 1, ...(value === l ? chipOn : null) }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

// ---- styles (carved dark forge register) ----

const intro: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.6, color: STONE.inkDim, margin: "0 0 12px", fontFamily: SAX.serif };
const progressBar: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.08em",
  color: SAX.brass, border: `1px solid ${STONE.hi}`, background: "rgba(0,0,0,0.24)", borderRadius: 4, padding: "6px 10px",
  display: "inline-block", marginBottom: 18,
};
const section: React.CSSProperties = { ...surfaces.panel, padding: "16px 18px", marginBottom: 14 };
const sectionHead: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between" };
const checkWrap: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, cursor: "pointer" };
const sectionTitle: React.CSSProperties = { fontSize: 19, fontWeight: 600, color: STONE.ink, fontFamily: "var(--forge-display, 'Cinzel', serif)" };
const why: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.5, color: STONE.inkFaint, margin: "6px 0 14px", fontFamily: SAX.serif };
const fieldWrap: React.CSSProperties = { display: "block", marginTop: 12 };
const smallLabel: React.CSSProperties = {
  display: "block", fontFamily: SAX.mono, fontSize: 10.5,
  letterSpacing: "0.12em", textTransform: "uppercase", color: STONE.inkDim, marginBottom: 6,
};
const inp: React.CSSProperties = { ...stoneField(), fontSize: 14.5, boxSizing: "border-box" };
const ta: React.CSSProperties = { ...inp, cursor: "text", resize: "vertical", lineHeight: 1.5 };
const safetyNote: React.CSSProperties = {
  fontSize: 14, lineHeight: 1.55, color: STONE.inkDim, fontFamily: SAX.serif,
  background: "rgba(0,0,0,0.24)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4)",
  borderRadius: 5, padding: "10px 12px", marginBottom: 12,
};
const chips: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
const chip: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 11.5, color: STONE.inkDim,
  border: `1px solid ${STONE.hi}`, borderRadius: 3, padding: "5px 10px", background: "rgba(0,0,0,0.24)", cursor: "pointer",
};
const chipOn: React.CSSProperties = { background: `linear-gradient(180deg, ${STONE.brassHi}, ${SAX.brass})`, color: "#241a0d", borderColor: SAX.brass };
const toolExplain: React.CSSProperties = { fontSize: 13, lineHeight: 1.55, color: STONE.inkFaint, margin: "10px 0 0", fontFamily: SAX.serif };
const charterPanel: React.CSSProperties = { ...surfaces.slate, padding: "16px 18px", marginTop: 6 };
const charterHead: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12,
  fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.14em",
  textTransform: "uppercase", color: SAX.brass,
};
const dlBtn: React.CSSProperties = {
  background: `linear-gradient(180deg, ${STONE.brassHi}, ${SAX.brass})`, color: "#241a0d", border: "none", borderRadius: 3, padding: "8px 16px",
  fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer",
};
const charterPre: React.CSSProperties = {
  whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: SAX.mono,
  fontSize: 12.5, lineHeight: 1.6, color: STONE.ink, background: "rgba(0,0,0,0.28)",
  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4)",
  borderRadius: 4, padding: "14px 16px", margin: 0, maxHeight: 360, overflow: "auto",
};
