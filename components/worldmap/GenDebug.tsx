"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { generateTerrain } from "@/lib/worldmap/gen/pipeline";
import { defaultConfig, type GenConfig } from "@/lib/worldmap/gen/types";
import { renderFields, type DebugMode } from "@/lib/worldmap/gen/debug-render";
import { C } from "@/lib/forge-theme";

// Phase 6a debug preview: generates on the main thread (the Web Worker + progress + accept flow are
// 6d) and draws raw fields, so the terrain passes can be eyeballed against fixed seeds before 6b.

const MODES: DebugMode[] = ["terrain", "elevation", "temperature", "moisture", "rivers", "landmass"];

export default function GenDebug() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [seed, setSeed] = useState("dragonspire");
  const [size, setSize] = useState(100);
  const [ocean, setOcean] = useState(0.62);
  const [continents, setContinents] = useState(1);
  const [landConc, setLandConc] = useState(0.5);
  const [archipelago, setArchipelago] = useState(false);
  const [mode, setMode] = useState<DebugMode>("terrain");
  const [status, setStatus] = useState("");

  const run = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const t0 = performance.now();
    const cfg: GenConfig = { ...defaultConfig(size, size, seed), oceanCoverage: ocean, continentCount: continents, landConcentration: landConc, archipelago };
    const f = generateTerrain(cfg);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderFields(f, ctx, canvas.width, canvas.height, mode);
    let land = 0;
    for (const v of f.land) land += v;
    setStatus(`${size}x${size} in ${Math.round(performance.now() - t0)} ms  |  land ${(100 * land / (size * size)).toFixed(0)}%`);
  }, [seed, size, ocean, continents, landConc, archipelago, mode]);

  useEffect(() => { run(); }, [run]);

  const label: React.CSSProperties = { fontSize: 12, color: C.muted, display: "block", marginBottom: 3 };
  const field: React.CSSProperties = { background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 6, padding: "5px 7px", fontSize: 12.5, outline: "none", width: "100%", boxSizing: "border-box" };
  const chip = (on: boolean): React.CSSProperties => ({ fontSize: 12, padding: "5px 10px", borderRadius: 7, cursor: "pointer", border: `1px solid ${on ? C.sun : C.line}`, background: on ? "rgba(200,162,75,0.14)" : C.surface2, color: C.text, fontWeight: 600 });

  return (
    <div style={{ display: "flex", gap: 16, padding: 20, background: "#171310", minHeight: "100vh", color: C.text, flexWrap: "wrap" }}>
      <div style={{ width: 240, flex: "0 0 240px", display: "grid", gap: 12, alignContent: "start" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>World gen (6a debug)</div>
        <div><span style={label}>Seed</span><input value={seed} onChange={(e) => setSeed(e.target.value)} style={field} /></div>
        <div><span style={label}>Size {size}x{size}</span>
          <div style={{ display: "flex", gap: 6 }}>{[60, 100, 150].map((s) => <button key={s} type="button" onClick={() => setSize(s)} style={{ ...chip(size === s), flex: 1 }}>{s}</button>)}</div>
        </div>
        <div><span style={label}>Ocean coverage {ocean.toFixed(2)}</span><input type="range" min={0.4} max={0.8} step={0.01} value={ocean} onChange={(e) => setOcean(Number(e.target.value))} style={{ width: "100%" }} /></div>
        <div><span style={label}>Continents {continents}</span><input type="range" min={1} max={4} step={1} value={continents} onChange={(e) => setContinents(Number(e.target.value))} style={{ width: "100%" }} disabled={archipelago} /></div>
        <div><span style={label}>Land concentration {landConc.toFixed(2)}</span><input type="range" min={0} max={1} step={0.05} value={landConc} onChange={(e) => setLandConc(Number(e.target.value))} style={{ width: "100%" }} disabled={archipelago} /></div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={archipelago} onChange={(e) => setArchipelago(e.target.checked)} /> Archipelago mode</label>
        <div>
          <span style={label}>View</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{MODES.map((m) => <button key={m} type="button" onClick={() => setMode(m)} style={chip(mode === m)}>{m}</button>)}</div>
        </div>
        <button type="button" onClick={run} style={{ ...chip(false), padding: "8px 10px", background: C.sun, color: "#1a1206", border: "none" }}>Generate</button>
        <div style={{ fontSize: 11.5, color: C.muted, fontFamily: "ui-monospace, monospace" }}>{status}</div>
      </div>
      <div style={{ flex: "1 1 640px", minWidth: 320 }}>
        <canvas ref={canvasRef} width={720} height={720} style={{ width: "100%", maxWidth: 720, aspectRatio: "1 / 1", border: `1px solid ${C.line}`, borderRadius: 8, background: "#0f1b28" }} />
      </div>
    </div>
  );
}
