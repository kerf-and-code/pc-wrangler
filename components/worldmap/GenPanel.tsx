"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { C } from "@/lib/forge-theme";
import { defaultConfig, type GenConfig, type Fields } from "@/lib/worldmap/gen/types";
import { bakeWorld } from "@/lib/worldmap/gen/bake";
import { renderFields } from "@/lib/worldmap/gen/debug-render";

// The Generate panel: worker-driven world generation with a progress bar, a preview, validation
// stats, and a wholesale-replace Accept that bakes and posts to the accept route. Overlay on /gm/world.

const BIOME_LABELS = ["Plains", "Savanna", "Prairie", "Forest", "Taiga", "Rainforest", "Jungle", "Medit.", "Sand desert", "Rock desert", "Tundra", "Alpine", "Highland", "Swamp", "Bog", "River", "Lake", "Sea", "Coast", "Reef", "Mountains", "Volcanic", "Canyon", "Cave", "Blighted", "Enchanted", "Crystal", "Feywild"];
const WINDS = [["E", 0], ["NE", 1], ["NW", 2], ["W", 3], ["SW", 4], ["SE", 5]] as const;
const VILLAGE_PRESETS: Record<string, [number, number]> = { sparse: [2, 5], normal: [1, 4], dense: [0, 3] };
const POI_PRESETS: Record<string, { resource: number; cave: number; dungeonPer: number }> = {
  sparse: { resource: 0.025, cave: 0.02, dungeonPer: 260 },
  normal: { resource: 0.05, cave: 0.03, dungeonPer: 175 },
  dense: { resource: 0.09, cave: 0.055, dungeonPer: 120 },
};

type Stats = { land: number; sea: number; river: number; cities: number; towns: number; villages: number; largest: number; fantasy: number; census: [string, number][] };

function computeStats(f: Fields): Stats {
  const N = f.width * f.height;
  let land = 0, river = 0, fant = 0;
  const counts = new Array(28).fill(0);
  const lmSize = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    counts[f.biome[i]]++;
    if (f.land[i]) { land++; if (f.river[i]) river++; if (f.biome[i] >= 24) fant++; const lm = f.landmassId[i]; if (lm >= 0) lmSize.set(lm, (lmSize.get(lm) ?? 0) + 1); }
  }
  let largest = 0;
  for (const v of lmSize.values()) if (v > largest) largest = v;
  const cities = f.settlements.filter((s) => s.tier === 0).length;
  const towns = f.settlements.filter((s) => s.tier === 1).length;
  const villages = f.settlements.filter((s) => s.tier === 2).length;
  const census = counts.map((c, i) => [BIOME_LABELS[i], c / N] as [string, number]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return {
    land: land / N, sea: (N - land) / N, river: land ? river / land : 0,
    cities, towns, villages, largest: land ? largest / land : 0, fantasy: land ? fant / land : 0, census,
  };
}

export default function GenPanel({ campaignId, onAccepted, onClose }: { campaignId: string; onAccepted: () => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const fieldsRef = useRef<Fields | null>(null);

  const [seed, setSeed] = useState("dragonspire");
  const [size, setSize] = useState(100);
  const [ocean, setOcean] = useState(0.62);
  const [continents, setContinents] = useState(1);
  const [landConc, setLandConc] = useState(0.5);
  const [archipelago, setArchipelago] = useState(false);
  const [wind, setWind] = useState(0);
  const [villages, setVillages] = useState<"sparse" | "normal" | "dense">("normal");
  const [pois, setPois] = useState<"sparse" | "normal" | "dense">("normal");

  const [phase, setPhase] = useState<"idle" | "generating" | "preview" | "accepting">("idle");
  const [progress, setProgress] = useState<{ index: number; total: number; pass: string }>({ index: 0, total: 12, pass: "" });
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildConfig = useCallback((): GenConfig => {
    const [vFloor, vSpacing] = VILLAGE_PRESETS[villages];
    const p = POI_PRESETS[pois];
    return {
      ...defaultConfig(size, size, seed),
      oceanCoverage: ocean, continentCount: continents, landConcentration: landConc, archipelago, windDir: wind,
      villageScoreFloor: vFloor, villageSpacing: vSpacing,
      resourceDensity: p.resource, caveDensity: p.cave, dungeonPer: p.dungeonPer,
    };
  }, [size, seed, ocean, continents, landConc, archipelago, wind, villages, pois]);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);

  const generate = useCallback(() => {
    setError(null);
    setPhase("generating");
    setProgress({ index: 0, total: 12, pass: "starting" });
    workerRef.current?.terminate();
    const worker = new Worker(new URL("../../lib/worldmap/gen/worker.ts", import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; index?: number; total?: number; pass?: string; fields?: Fields; message?: string };
      if (msg.type === "progress") setProgress({ index: msg.index ?? 0, total: msg.total ?? 12, pass: msg.pass ?? "" });
      else if (msg.type === "done" && msg.fields) {
        fieldsRef.current = msg.fields;
        setStats(computeStats(msg.fields));
        setPhase("preview");
        worker.terminate();
        const canvas = canvasRef.current;
        if (canvas) { const ctx = canvas.getContext("2d"); if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); renderFields(msg.fields, ctx, canvas.width, canvas.height, "biomes"); } }
      } else if (msg.type === "error") { setError(msg.message ?? "Generation failed."); setPhase("idle"); worker.terminate(); }
    };
    worker.postMessage({ config: buildConfig() });
  }, [buildConfig]);

  const accept = useCallback(async () => {
    const f = fieldsRef.current;
    if (!f) return;
    if (!window.confirm("Replace this world map? The generated terrain, rivers, roads, and pins overwrite the current ones. Hand-placed pins and painted region hexes are cleared. Named regions are kept.")) return;
    setPhase("accepting");
    setError(null);
    const cfg = buildConfig();
    const originCol = -Math.floor(cfg.width / 2), originRow = -Math.floor(cfg.height / 2);
    try {
      const baked = bakeWorld(f, cfg, originCol, originRow);
      const res = await fetch("/api/world-map/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, terrain: baked.terrain, features: baked.features, pois: baked.pois, genConfig: baked.metadata.config, genSeed: String(cfg.seed), width: cfg.width, height: cfg.height, originCol, originRow }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Apply failed."); setPhase("preview"); return; }
      onAccepted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed."); setPhase("preview");
    }
  }, [buildConfig, campaignId, onAccepted]);

  const label: React.CSSProperties = { fontSize: 12, color: C.muted, display: "block", marginBottom: 3 };
  const field: React.CSSProperties = { background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 6, padding: "5px 7px", fontSize: 12.5, outline: "none", width: "100%", boxSizing: "border-box" };
  const chip = (on: boolean): React.CSSProperties => ({ fontSize: 12, padding: "5px 9px", borderRadius: 7, cursor: "pointer", border: `1px solid ${on ? C.sun : C.line}`, background: on ? "rgba(200,162,75,0.14)" : C.surface2, color: C.text, fontWeight: 600 });
  const busy = phase === "generating" || phase === "accepting";
  const pct = Math.round((progress.index / progress.total) * 100);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,8,6,0.72)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#1b1712", border: `1px solid ${C.line}`, borderRadius: 12, width: "min(940px, 96vw)", maxHeight: "92vh", overflow: "auto", display: "flex", gap: 18, padding: 20 }}>
        <div style={{ width: 250, flex: "0 0 250px", display: "grid", gap: 11, alignContent: "start" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Generate world</div>
          <div><span style={label}>Seed</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="word or number" style={{ ...field, flex: 1 }} disabled={busy} />
              <button type="button" onClick={() => setSeed(String(Math.floor(Math.random() * 1000000000)))} style={{ ...chip(false), padding: "5px 9px", whiteSpace: "nowrap" }} disabled={busy} title="Pick a random seed">Random</button>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>Same seed = same world. Type a number, a word, or hit Random.</div>
          </div>
          <div><span style={label}>Size {size}x{size}</span>
            <div style={{ display: "flex", gap: 5 }}>{[60, 100, 150, 200, 250].map((s) => <button key={s} type="button" onClick={() => setSize(s)} style={{ ...chip(size === s), flex: 1, padding: "5px 2px" }} disabled={busy}>{s}</button>)}</div>
          </div>
          <div><span style={label}>Ocean coverage {ocean.toFixed(2)}</span><input type="range" min={0.4} max={0.8} step={0.01} value={ocean} onChange={(e) => setOcean(Number(e.target.value))} style={{ width: "100%" }} disabled={busy} /></div>
          <div><span style={label}>Continents {continents}</span><input type="range" min={1} max={4} step={1} value={continents} onChange={(e) => setContinents(Number(e.target.value))} style={{ width: "100%" }} disabled={busy || archipelago} /></div>
          <div><span style={label}>Land concentration {landConc.toFixed(2)}</span><input type="range" min={0} max={1} step={0.05} value={landConc} onChange={(e) => setLandConc(Number(e.target.value))} style={{ width: "100%" }} disabled={busy || archipelago} /></div>
          <div><span style={label}>Prevailing wind</span>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{WINDS.map(([n, v]) => <button key={v} type="button" onClick={() => setWind(v)} style={chip(wind === v)} disabled={busy}>{n}</button>)}</div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: C.text }}><input type="checkbox" checked={archipelago} onChange={(e) => setArchipelago(e.target.checked)} disabled={busy} /> Archipelago mode</label>
          <div><span style={label}>Villages</span>
            <div style={{ display: "flex", gap: 5 }}>{(["sparse", "normal", "dense"] as const).map((v) => <button key={v} type="button" onClick={() => setVillages(v)} style={{ ...chip(villages === v), flex: 1, padding: "5px 2px", textTransform: "capitalize" }} disabled={busy}>{v}</button>)}</div>
          </div>
          <div><span style={label}>POIs (resources, caves, dungeons)</span>
            <div style={{ display: "flex", gap: 5 }}>{(["sparse", "normal", "dense"] as const).map((v) => <button key={v} type="button" onClick={() => setPois(v)} style={{ ...chip(pois === v), flex: 1, padding: "5px 2px", textTransform: "capitalize" }} disabled={busy}>{v}</button>)}</div>
          </div>
          <button type="button" onClick={generate} disabled={busy} style={{ ...chip(false), padding: "9px", background: C.sun, color: "#1a1206", border: "none", opacity: busy ? 0.6 : 1 }}>{phase === "generating" ? `Generating\u2026 ${pct}%` : "Generate"}</button>
          {phase === "generating" && (
            <div>
              <div style={{ height: 6, background: C.surface2, borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: C.sun, transition: "width 120ms" }} /></div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{progress.pass}</div>
            </div>
          )}
          {error && <div style={{ fontSize: 12, color: "#e08a6a" }}>{error}</div>}
        </div>

        <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 12, minWidth: 300 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: C.muted }}>Preview</div>
            <button type="button" onClick={onClose} style={{ ...chip(false), padding: "4px 10px" }} disabled={busy}>Close</button>
          </div>
          <canvas ref={canvasRef} width={560} height={560} style={{ width: "100%", maxWidth: 560, aspectRatio: "1 / 1", border: `1px solid ${C.line}`, borderRadius: 8, background: "#0f1b28" }} />
          {stats && phase !== "generating" && (
            <div style={{ fontSize: 12, color: C.text, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: C.muted }}>
                <span>land {(stats.land * 100).toFixed(0)}%</span>
                <span>rivers {(stats.river * 100).toFixed(1)}% of land</span>
                <span>largest landmass {(stats.largest * 100).toFixed(0)}%</span>
                <span>fantasy {(stats.fantasy * 100).toFixed(1)}%</span>
              </div>
              <div style={{ color: C.muted }}>{stats.cities} cities, {stats.towns} towns, {stats.villages} villages</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{stats.census.map(([name, frac]) => <span key={name} style={{ color: C.muted }}>{name} {(frac * 100).toFixed(0)}%</span>)}</div>
            </div>
          )}
          {phase === "preview" && (
            <button type="button" onClick={accept} style={{ ...chip(false), padding: "10px", background: "#8a4a3a", color: "#f4e8dc", border: "none", fontWeight: 700 }}>Accept and replace the map</button>
          )}
          {phase === "accepting" && <div style={{ fontSize: 13, color: C.muted }}>Applying\u2026</div>}
        </div>
      </div>
    </div>
  );
}
