"use client";

import React, { useMemo, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { generateCity, type CityLayout, type Centerpiece } from "@/lib/city/generate";

// The City map tab. Pick a layout, tune its plan, paint it in a genre through the imagine route
// (mode: "city"), and save. The AI render is a standalone asset - not attached to the world map - so
// save it locally and reuse it wherever you like.

const STYLES = [
  { v: "fantasy", label: "Fantasy" },
  { v: "scifi", label: "Sci-fi" },
  { v: "grimdark", label: "Grimdark" },
  { v: "urban", label: "Urban" },
];
const CENTERPIECES: { v: Centerpiece; label: string }[] = [
  { v: "castle", label: "Castle keep" },
  { v: "library", label: "Great library" },
  { v: "temple", label: "Temple" },
  { v: "plaza", label: "Grand plaza" },
];

// Per-layout: [label, min, max, default] for each of the two shape sliders.
const LAYOUTS: Record<CityLayout, { name: string; d1: [string, number, number, number]; d2: [string, number, number, number] }> = {
  radial: { name: "Radial", d1: ["Ring roads", 3, 9, 5], d2: ["Radial roads", 4, 16, 8] },
  grid: { name: "Grid", d1: ["Blocks", 5, 14, 9], d2: ["Avenues", 0, 6, 3] },
  nuclei: { name: "Merging", d1: ["Districts", 2, 6, 4], d2: ["Spread", 4, 14, 9] },
};

export default function CityCreator({ campaignId }: { campaignId: string }) {
  const [layout, setLayout] = useState<CityLayout>("radial");
  const [density, setDensity] = useState(5);
  const [detail, setDetail] = useState(8);
  const [jitter, setJitter] = useState(18);
  const [centerpiece, setCenterpiece] = useState<Centerpiece>("castle");
  const [wall, setWall] = useState(true);
  const [river, setRiver] = useState(false);
  const [seed, setSeed] = useState<number>(() => (Math.random() * 1e9) | 0);
  const [style, setStyle] = useState("fantasy");
  const [modifier, setModifier] = useState("");
  const [rendered, setRendered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const cfg = LAYOUTS[layout];
  const control = useMemo(
    () => generateCity({ layout, density, detail, jitter: jitter / 100, centerpiece, wall, river, seed, size: 1024 }),
    [layout, density, detail, jitter, centerpiece, wall, river, seed],
  );

  const clear = () => setRendered(null);
  const changeLayout = (l: CityLayout) => {
    setLayout(l);
    setDensity(LAYOUTS[l].d1[3]);
    setDetail(LAYOUTS[l].d2[3]);
    clear();
  };

  const render = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/world-map/imagine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, controlImage: control, style, mode: "city", centerpiece, promptModifier: modifier }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) setRendered(data.url);
      else setMsg(data.error || "The render failed. Try again.");
    } catch {
      setMsg("Something went wrong reaching the image service.");
    } finally {
      setBusy(false);
    }
  };

  const saveLocally = async () => {
    const url = rendered || control;
    try {
      const blob = await (await fetch(url)).blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = `city-${layout}-${style}-${seed}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(obj);
    } catch {
      setMsg("Could not save automatically. Right-click the image and Save image as.");
    }
  };

  const label: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, margin: "14px 0 5px" };
  const select: React.CSSProperties = { width: "100%", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontFamily: "inherit", fontSize: 14 };
  const range: React.CSSProperties = { width: "100%", accentColor: C.sun };
  const btn = (bg: string, fg: string): React.CSSProperties => ({ padding: "9px 14px", background: bg, color: fg, border: bg === "transparent" ? `1px solid ${C.line}` : "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, width: "100%" });

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={rendered || control} alt="City" style={{ display: "block", width: 560, maxWidth: "86vw", borderRadius: 8, background: "#0e0b08" }} />
        <p style={{ color: C.muted, fontSize: 12, margin: "10px 2px 0" }}>
          {rendered ? "Painted city. Save it, then reuse it anywhere." : "City plan (the bones). Pick a style and Paint city to render it."}
        </p>
      </div>

      <div style={{ width: 260, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 16 }}>
        <label style={label}>Layout</label>
        <select value={layout} onChange={(e) => changeLayout(e.target.value as CityLayout)} style={select}>
          {(Object.keys(LAYOUTS) as CityLayout[]).map((k) => <option key={k} value={k}>{LAYOUTS[k].name}</option>)}
        </select>

        <label style={label}>{cfg.d1[0]}: {density}</label>
        <input type="range" min={cfg.d1[1]} max={cfg.d1[2]} value={density} onChange={(e) => { setDensity(+e.target.value); clear(); }} style={range} />
        <label style={label}>{cfg.d2[0]}: {detail}</label>
        <input type="range" min={cfg.d2[1]} max={cfg.d2[2]} value={detail} onChange={(e) => { setDetail(+e.target.value); clear(); }} style={range} />
        <label style={label}>Irregularity: {jitter}%</label>
        <input type="range" min={0} max={60} value={jitter} onChange={(e) => { setJitter(+e.target.value); clear(); }} style={range} />

        <label style={label}>Centerpiece</label>
        <select value={centerpiece} onChange={(e) => { setCenterpiece(e.target.value as Centerpiece); clear(); }} style={select}>
          {CENTERPIECES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>

        <label style={label}>Style</label>
        <select value={style} onChange={(e) => setStyle(e.target.value)} style={select}>
          {STYLES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>

        <label style={label}>Flavour</label>
        <textarea value={modifier} onChange={(e) => setModifier(e.target.value)} rows={2}
          placeholder="e.g. besieged, snow-dusted, lantern-lit at dusk"
          style={{ width: "100%", padding: "8px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontFamily: "inherit", fontSize: 13, resize: "vertical" }} />

        <div style={{ display: "flex", gap: 14, marginTop: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.text }}>
            <input type="checkbox" checked={wall} onChange={(e) => { setWall(e.target.checked); clear(); }} style={{ accentColor: C.sun }} /> Wall
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.text }}>
            <input type="checkbox" checked={river} onChange={(e) => { setRiver(e.target.checked); clear(); }} style={{ accentColor: C.sun }} /> River
          </label>
        </div>

        <div style={{ marginTop: 16 }}><button type="button" onClick={() => { setSeed((Math.random() * 1e9) | 0); clear(); }} style={btn("transparent", C.text)}>New layout</button></div>
        <div style={{ marginTop: 8 }}><button type="button" onClick={render} disabled={busy} style={btn(C.sun, "#1b1712")}>{busy ? "Painting\u2026" : "Paint city"}</button></div>
        <div style={{ marginTop: 8 }}><button type="button" onClick={saveLocally} style={btn("transparent", C.text)}>Save image</button></div>

        {msg && <p style={{ color: "#c98a7a", fontSize: 12, marginTop: 12 }}>{msg}</p>}
      </div>
    </div>
  );
}
