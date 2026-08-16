"use client";

import React, { useMemo, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { generateRadialCity, type Centerpiece } from "@/lib/city/radial";

// The City map tab. Tune a radial city plan, paint it in a genre through the same imagine route the
// world map uses (mode: "city"), and save the result. The AI render is not attached to the world map
// row - a city is its own asset - so save it locally and reuse it wherever you like.

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

export default function CityCreator({ campaignId }: { campaignId: string }) {
  const [rings, setRings] = useState(5);
  const [spokes, setSpokes] = useState(8);
  const [jitter, setJitter] = useState(18);
  const [centerpiece, setCenterpiece] = useState<Centerpiece>("castle");
  const [wall, setWall] = useState(true);
  const [river, setRiver] = useState(false);
  const [seed, setSeed] = useState<number>(() => (Math.random() * 1e9) | 0);
  const [style, setStyle] = useState("fantasy");
  const [rendered, setRendered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // The control image (the city's bones) regenerates whenever a parameter changes.
  const control = useMemo(
    () => generateRadialCity({ rings, spokes, jitter: jitter / 100, centerpiece, wall, river, seed, size: 1024 }),
    [rings, spokes, jitter, centerpiece, wall, river, seed],
  );

  const render = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/world-map/imagine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, controlImage: control, style, mode: "city", centerpiece }),
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
      a.download = `city-${style}-${seed}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(obj);
    } catch {
      setMsg("Could not save automatically. Right-click the image and Save image as.");
    }
  };

  const label: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, margin: "14px 0 5px" };
  const select: React.CSSProperties = { width: "100%", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontFamily: "inherit", fontSize: 14 };
  const btn = (bg: string, fg: string): React.CSSProperties => ({ padding: "9px 14px", background: bg, color: fg, border: bg === "transparent" ? `1px solid ${C.line}` : "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 });

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
        <label style={label}>Ring roads: {rings}</label>
        <input type="range" min={3} max={9} value={rings} onChange={(e) => { setRings(+e.target.value); setRendered(null); }} style={{ width: "100%", accentColor: C.sun }} />
        <label style={label}>Radial roads: {spokes}</label>
        <input type="range" min={4} max={16} value={spokes} onChange={(e) => { setSpokes(+e.target.value); setRendered(null); }} style={{ width: "100%", accentColor: C.sun }} />
        <label style={label}>Irregularity: {jitter}%</label>
        <input type="range" min={0} max={60} value={jitter} onChange={(e) => { setJitter(+e.target.value); setRendered(null); }} style={{ width: "100%", accentColor: C.sun }} />

        <label style={label}>Centerpiece</label>
        <select value={centerpiece} onChange={(e) => { setCenterpiece(e.target.value as Centerpiece); setRendered(null); }} style={select}>
          {CENTERPIECES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>

        <label style={label}>Style</label>
        <select value={style} onChange={(e) => setStyle(e.target.value)} style={select}>
          {STYLES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.text }}>
            <input type="checkbox" checked={wall} onChange={(e) => { setWall(e.target.checked); setRendered(null); }} style={{ accentColor: C.sun }} /> Wall
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.text }}>
            <input type="checkbox" checked={river} onChange={(e) => { setRiver(e.target.checked); setRendered(null); }} style={{ accentColor: C.sun }} /> River
          </label>
        </div>

        <button type="button" onClick={() => { setSeed((Math.random() * 1e9) | 0); setRendered(null); }} style={{ ...btn("transparent", C.text), width: "100%", marginTop: 16 }}>
          New layout
        </button>
        <button type="button" onClick={render} disabled={busy} style={{ ...btn(C.sun, "#1b1712"), width: "100%", marginTop: 8 }}>
          {busy ? "Painting\u2026" : "Paint city"}
        </button>
        <button type="button" onClick={saveLocally} style={{ ...btn("transparent", C.text), width: "100%", marginTop: 8 }}>
          Save image
        </button>

        {msg && <p style={{ color: "#c98a7a", fontSize: 12, marginTop: 12 }}>{msg}</p>}
      </div>
    </div>
  );
}
