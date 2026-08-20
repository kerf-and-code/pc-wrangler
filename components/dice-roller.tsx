"use client";

import { useMemo, useState } from "react";
import { SAX, STONE, surfaces } from "@/lib/theme";
import { stoneField } from "@/lib/forge-theme";
import { roll, applyAdvantage, parseDice, DiceError } from "@/lib/dice";
import { countsToNotation, notationToCounts } from "@/components/dice-picker";
import {
  cocBand, pf2eDegree, dualityOutcome, powerRollNotation, drawSteelOutcome, poolOutcome,
} from "@/lib/tools/roller-outcomes";

// components/dice-roller.tsx
//
// The free, no-login dice roller. Rolls happen client-side through @/lib/dice, the SAME crypto
// rejection-sampling RNG the app uses (chi-square verified fair), so the fairness carries over unchanged.
// A system dropdown switches between D&D (with advantage), Pathfinder 2e degrees, Call of Cthulhu d100,
// Draw Steel power rolls, Daggerheart duality, and a d10 success pool, each read by the same outcome
// logic the in-app roller uses. Nothing is saved: the log lives in memory and clears on refresh.

type Mode = "dnd" | "pf2e" | "coc" | "drawsteel" | "daggerheart" | "pool";
const MODES: { id: Mode; label: string }[] = [
  { id: "dnd", label: "D&D 5e / custom dice" },
  { id: "pf2e", label: "Pathfinder 2e" },
  { id: "coc", label: "Call of Cthulhu" },
  { id: "drawsteel", label: "Draw Steel" },
  { id: "daggerheart", label: "Daggerheart" },
  { id: "pool", label: "d10 success pool" },
];

type LogEntry = {
  id: number;
  headline: string;
  band?: string;
  detail: string;
  tone: Tone;
};
type Tone = "good" | "bad" | "warn" | "neutral";

const STD_DICE = [4, 6, 8, 10, 12, 20];

let SEQ = 0;

function withMod(base: string, modStr: string): string {
  const m = parseInt(modStr, 10) || 0;
  return `${base}${m > 0 ? ` + ${m}` : m < 0 ? ` - ${-m}` : ""}`;
}
function diceStr(dice: { value: number; kept: boolean }[]): string {
  return dice.map((d) => (d.kept ? `${d.value}` : `(${d.value})`)).join(" ");
}
function toneOf(band?: string): Tone {
  if (!band) return "neutral";
  const b = band.toLowerCase();
  if (b.startsWith("tier 3") || b === "critical success" || b === "with hope" || b === "success with hope"
    || b === "critical" || b === "extreme" || b === "success" || b === "critical · " || b.startsWith("critical ·")) return "good";
  if (b.startsWith("tier 1") || b === "critical failure" || b === "failure" || b === "failure with fear"
    || b === "fumble") return "bad";
  return "warn";
}

export default function DiceRoller() {
  const [mode, setMode] = useState<Mode>("dnd");

  // shared
  const [log, setLog] = useState<LogEntry[]>([]);

  // dnd / custom
  const [text, setText] = useState("1d20");
  const [adv, setAdv] = useState<"flat" | "adv" | "dis">("flat");
  // pf2e
  const [pfMod, setPfMod] = useState("");
  const [pfDc, setPfDc] = useState("");
  // coc
  const [cocTarget, setCocTarget] = useState(50);
  // draw steel
  const [dsMod, setDsMod] = useState("");
  const [dsEb, setDsEb] = useState(0);
  // daggerheart
  const [dhMod, setDhMod] = useState("");
  const [dhDiff, setDhDiff] = useState("");
  // pool
  const [poolSize, setPoolSize] = useState(5);
  const [poolDiff, setPoolDiff] = useState("");

  const advMeaningful = useMemo(() => {
    try { return parseDice(text || "1d20").terms.some((t) => t.sides === 20 && t.count === 1 && !t.keep); }
    catch { return false; }
  }, [text]);

  const finalNotation = useMemo(() => {
    switch (mode) {
      case "dnd": return applyAdvantage(text.trim() || "1d20", adv);
      case "pf2e": return withMod("1d20", pfMod);
      case "coc": return "1d100";
      case "drawsteel": return powerRollNotation(dsMod, dsEb);
      case "daggerheart": return withMod("2d12", dhMod);
      case "pool": return `${Math.max(1, Math.min(30, poolSize))}d10`;
    }
  }, [mode, text, adv, pfMod, dsMod, dsEb, dhMod, poolSize]);

  const invalid = useMemo(() => {
    try { parseDice(finalNotation); return null; }
    catch (e) { return e instanceof DiceError ? e.message : "Cannot read that roll."; }
  }, [finalNotation]);

  function pushLog(e: Omit<LogEntry, "id">) {
    setLog((l) => [{ ...e, id: ++SEQ }, ...l].slice(0, 50));
  }

  function doRoll() {
    if (invalid) return;
    const r = roll(finalNotation);
    if (mode === "dnd") {
      pushLog({
        headline: `${r.total}`,
        detail: `${r.notation} · ${diceStr(r.dice)}${r.natural === 20 ? " · natural 20" : r.natural === 1 ? " · natural 1" : ""}`,
        tone: r.natural === 20 ? "good" : r.natural === 1 ? "bad" : "neutral",
      });
    } else if (mode === "pf2e") {
      const dc = parseInt(pfDc, 10);
      const hasDc = pfDc.trim() !== "" && Number.isFinite(dc);
      const band = hasDc ? pf2eDegree(r.total, dc, r.natural) : undefined;
      pushLog({
        headline: `${r.total}`, band,
        detail: `${r.notation} · d20 ${r.dice[0]?.value}${band && hasDc ? ` vs DC ${dc}` : ""}${r.natural === 20 ? " · nat 20" : r.natural === 1 ? " · nat 1" : ""}`,
        tone: toneOf(band),
      });
    } else if (mode === "coc") {
      const band = cocBand(r.total, cocTarget);
      pushLog({ headline: `${r.total}`, band, detail: `d100 vs skill ${cocTarget}`, tone: toneOf(band) });
    } else if (mode === "drawsteel") {
      const band = r.dice.length >= 2
        ? drawSteelOutcome(r.dice[0].value, r.dice[1].value, r.total, dsEb === 2, dsEb === -2)
        : undefined;
      pushLog({ headline: `${r.total}`, band, detail: `${r.notation} · ${diceStr(r.dice)}`, tone: toneOf(band) });
    } else if (mode === "daggerheart") {
      const hope = r.dice[0]?.value ?? 0;
      const fear = r.dice[1]?.value ?? 0;
      const diff = parseInt(dhDiff, 10);
      const hasDiff = dhDiff.trim() !== "" && Number.isFinite(diff);
      const band = dualityOutcome(hope, fear, r.total, hasDiff ? diff : null);
      pushLog({
        headline: `${r.total}`, band,
        detail: `Hope ${hope} · Fear ${fear}${hasDiff ? ` vs ${diff}` : ""}`,
        tone: band.includes("Hope") ? "good" : band.includes("Fear") ? "bad" : toneOf(band),
      });
    } else if (mode === "pool") {
      const diff = parseInt(poolDiff, 10);
      const hasDiff = poolDiff.trim() !== "" && Number.isFinite(diff);
      const po = poolOutcome(r.dice, hasDiff ? diff : null);
      pushLog({
        headline: `${po.successes}`, band: po.band,
        detail: `${r.notation} · ${diceStr(r.dice)}`,
        tone: toneOf(po.band),
      });
    }
  }

  return (
    <div>
      <div style={panel}>
        <label style={fieldLabel} htmlFor="rollsys">System</label>
        <select id="rollsys" value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={sel}>
          {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      <div style={panel}>
        {mode === "dnd" && (
          <>
            <div style={smallLabel}>Add dice</div>
            <div style={diceRow}>
              {STD_DICE.map((s) => (
                <button key={s} type="button" onClick={() => setText(mergeDie(text, s))} style={diceBtn}>d{s}</button>
              ))}
              <button type="button" onClick={() => setText(bumpMod(text, 1))} style={diceBtn}>+1</button>
              <button type="button" onClick={() => setText(bumpMod(text, -1))} style={diceBtn}>-1</button>
              <button type="button" onClick={() => setText("")} style={{ ...diceBtn, color: STONE.inkFaint }}>clear</button>
            </div>
            <label style={{ display: "block", marginTop: 12 }}>
              <span style={smallLabel}>Or type it</span>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="2d6 + 1d8 + 3, or 4d6kh3"
                style={{ ...inp, fontFamily: "ui-monospace, monospace" }} />
            </label>
            <div style={{ ...diceRow, marginTop: 12 }}>
              {(["dis", "flat", "adv"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setAdv(m)} disabled={m !== "flat" && !advMeaningful}
                  style={{ ...chip, ...(adv === m ? chipOn : null), opacity: m !== "flat" && !advMeaningful ? 0.4 : 1 }}>
                  {m === "adv" ? "Advantage" : m === "dis" ? "Disadvantage" : "Straight"}
                </button>
              ))}
              {!advMeaningful && <span style={hintInline}>Advantage needs a single d20.</span>}
            </div>
          </>
        )}

        {mode === "pf2e" && (
          <div style={grid2}>
            <Field label="Modifier"><input value={pfMod} onChange={(e) => setPfMod(e.target.value)} placeholder="e.g. 9" style={mono} /></Field>
            <Field label="DC (optional)"><input value={pfDc} onChange={(e) => setPfDc(e.target.value)} placeholder="e.g. 18" style={mono} /></Field>
            <p style={hint}>Roll 1d20 + modifier. Set a DC to read the degree: crit success at DC+10, crit failure at DC-10; a nat 20 steps up, a nat 1 steps down.</p>
          </div>
        )}

        {mode === "coc" && (
          <div>
            <Field label="Skill target (1-99)">
              <input type="number" min={1} max={99} value={cocTarget}
                onChange={(e) => setCocTarget(Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 0))))}
                style={mono} />
            </Field>
            <p style={hint}>Roll d100 under the skill. 01 is a critical; extreme at a fifth, hard at half; a fumble is 100, or 96-99 when the skill is under 50.</p>
          </div>
        )}

        {mode === "drawsteel" && (
          <div>
            <Field label="Modifier (characteristic + bonuses)"><input value={dsMod} onChange={(e) => setDsMod(e.target.value)} placeholder="e.g. 2" style={mono} /></Field>
            <div style={{ marginTop: 12 }}>
              <div style={smallLabel}>Edges / banes</div>
              <div style={diceRow}>
                {[{ v: -2, l: "Bane ×2" }, { v: -1, l: "Bane" }, { v: 0, l: "—" }, { v: 1, l: "Edge" }, { v: 2, l: "Edge ×2" }].map((o) => (
                  <button key={o.v} type="button" onClick={() => setDsEb(o.v)} style={{ ...chip, ...(dsEb === o.v ? chipOn : null) }}>{o.l}</button>
                ))}
              </div>
            </div>
            <p style={hint}>Roll 2d10 + modifier against the tiers (11 or lower, 12-16, 17+). An edge is +2 and a double edge bumps the tier; a bane is -2 and a double bane drops it. A natural 19-20 is a critical.</p>
          </div>
        )}

        {mode === "daggerheart" && (
          <div style={grid2}>
            <Field label="Modifier"><input value={dhMod} onChange={(e) => setDhMod(e.target.value)} placeholder="e.g. 2" style={mono} /></Field>
            <Field label="Difficulty (optional)"><input value={dhDiff} onChange={(e) => setDhDiff(e.target.value)} placeholder="e.g. 14" style={mono} /></Field>
            <p style={hint}>Roll 2d12 (Hope + Fear) + modifier against the Difficulty. The higher die colours the result, and matching dice are a critical success.</p>
          </div>
        )}

        {mode === "pool" && (
          <div style={grid2}>
            <Field label="Pool size">
              <input type="number" min={1} max={30} value={poolSize}
                onChange={(e) => setPoolSize(Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 0))))} style={mono} />
            </Field>
            <Field label="Difficulty (successes, optional)"><input value={poolDiff} onChange={(e) => setPoolDiff(e.target.value)} placeholder="e.g. 3" style={mono} /></Field>
            <p style={hint}>Roll a pool of d10s. Each 6 or higher is a success; a pair of 10s adds a critical bonus. Set a difficulty to read it as success or failure.</p>
          </div>
        )}

        <div style={notationPreview}>{invalid ?? `rolling ${finalNotation}`}</div>

        <button type="button" onClick={doRoll} disabled={!!invalid} style={rollBtn}>Roll</button>
      </div>

      {log.length > 0 && (
        <div style={panel}>
          <div style={smallLabel}>Rolls (this session only)</div>
          <div>
            {log.map((e) => (
              <div key={e.id} style={logRow}>
                <div style={{ minWidth: 0 }}>
                  {e.band && <div style={{ ...bandText, color: TONE_COLOR[e.tone] }}>{e.band}</div>}
                  <div style={detailText}>{e.detail}</div>
                </div>
                <div style={{ ...headlineText, color: e.band ? TONE_COLOR[e.tone] : STONE.ink }}>{e.headline}</div>
              </div>
            ))}
          </div>
          <p style={hint}>Dice in brackets were rolled and dropped by a keep rule. Nothing here is saved; refresh clears it.</p>
        </div>
      )}

      <p style={foot}>
        The randomness is crypto-grade with modulo bias rejected, the same roller Six Axes uses at the table.
        In the app, every roll is logged against the session so your encounter maths calibrates to real play.
      </p>
    </div>
  );
}

function mergeDie(text: string, sides: number): string {
  const { counts, mod } = notationToCounts(text);
  counts[sides] = (counts[sides] ?? 0) + 1;
  return countsToNotation(counts, mod) || `1d${sides}`;
}
function bumpMod(text: string, delta: number): string {
  const { counts, mod } = notationToCounts(text);
  const nm = mod + delta;
  return countsToNotation(counts, nm) || (nm ? `${nm}` : "");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={smallLabel}>{label}</span>
      {children}
    </label>
  );
}

const TONE_COLOR: Record<Tone, string> = {
  good: "#9aa880", bad: "#d97d6d", warn: "#e2b878", neutral: STONE.ink,
};

// ---- styles (carved dark forge register) ----

const panel: React.CSSProperties = { ...surfaces.panel, padding: "16px 18px", marginBottom: 16 };
const fieldLabel: React.CSSProperties = {
  display: "block", fontFamily: SAX.mono, fontSize: 11,
  letterSpacing: "0.14em", textTransform: "uppercase", color: SAX.brass, marginBottom: 8,
};
const smallLabel: React.CSSProperties = {
  display: "block", fontFamily: SAX.mono, fontSize: 10.5,
  letterSpacing: "0.12em", textTransform: "uppercase", color: STONE.inkDim, marginBottom: 8,
};
const sel: React.CSSProperties = { ...stoneField(), fontSize: 15.5, boxSizing: "border-box" };
const inp: React.CSSProperties = { ...stoneField(), fontSize: 14.5, boxSizing: "border-box" };
const mono: React.CSSProperties = { ...inp, cursor: "text", fontFamily: SAX.mono };
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };
const diceRow: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" };
const diceBtn: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 13, color: STONE.ink,
  border: `1px solid ${STONE.hi}`, borderRadius: 4, padding: "8px 12px", background: "rgba(0,0,0,0.24)", cursor: "pointer",
};
const chip: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 12, color: STONE.inkDim,
  border: `1px solid ${STONE.hi}`, borderRadius: 3, padding: "6px 11px", background: "rgba(0,0,0,0.24)", cursor: "pointer",
};
const chipOn: React.CSSProperties = { background: `linear-gradient(180deg, ${STONE.brassHi}, ${SAX.brass})`, color: "#241a0d", borderColor: SAX.brass };
const hint: React.CSSProperties = { fontSize: 13, lineHeight: 1.55, color: STONE.inkFaint, margin: "10px 0 0", fontFamily: SAX.serif };
const hintInline: React.CSSProperties = { fontSize: 12.5, color: STONE.inkFaint, alignSelf: "center", fontFamily: SAX.serif };
const notationPreview: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 13, color: STONE.inkDim,
  background: "rgba(0,0,0,0.24)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4)", borderRadius: 4, padding: "8px 11px", margin: "14px 0 12px",
};
const rollBtn: React.CSSProperties = {
  background: `linear-gradient(180deg, ${STONE.brassHi}, ${SAX.brass})`, color: "#241a0d", border: "none", borderRadius: 4, padding: "11px 26px",
  fontFamily: SAX.mono, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
};
const logRow: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
  padding: "10px 0", borderTop: "1px solid rgba(255,235,200,0.08)",
};
const bandText: React.CSSProperties = { fontSize: 14.5, fontWeight: 600 };
const detailText: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 12, color: STONE.inkFaint, marginTop: 2 };
const headlineText: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 24, fontWeight: 700, flex: "0 0 auto" };
const foot: React.CSSProperties = { fontSize: 13, lineHeight: 1.6, color: STONE.inkFaint, margin: "4px 0 0", fontFamily: SAX.serif };
