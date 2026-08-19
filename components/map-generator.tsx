"use client";

// components/map-generator.tsx
//
// The free, no-login hex world map generator. Reuses the product's real generator verbatim: generateTerrain
// runs the twelve passes (continents, plates, hydrology, climate, biomes, settlements, roads, POIs) into a
// Fields, bakeWorld converts it, and renderWorldSnapshot draws it with the same biome tile art the app uses.
// Everything runs in the browser: no account, no save, no server call, no cost. Deterministic by seed.
//
// POI pins (settlements, dungeons) are deferred to a follow-up (their icons are raw SVG needing a colour +
// data-URI step); v1 renders terrain, rivers and roads, which is the map people search for. The AI-painted
// render is the product upsell (Part B), teased below and gated to the pilot.

import { useEffect, useRef, useState } from "react";
import { generateTerrain } from "@/lib/worldmap/gen/pipeline";
import { defaultConfig } from "@/lib/worldmap/gen/types";
import { bakeWorld } from "@/lib/worldmap/gen/bake";
import { decodeTerrain, base64ToBytes } from "@/lib/worldmap/hex";
import { renderWorldSnapshot } from "@/lib/worldmap/snapshot";
import { BIOME_COLORS, BIOME_ART } from "@/lib/tools/worldgen-biomes";

const SIZES: Record<string, [number, number, string]> = {
  s: [64, 44, "Small"],
  m: [96, 66, "Medium"],
  l: [128, 88, "Large"],
};

// windDir is the DOWNWIND (toward) direction, AXIAL_DIRS index. Label by where the wind comes FROM.
const WINDS: [number, string][] = [
  [0, "West"], [3, "East"], [1, "Southwest"], [2, "Southeast"], [4, "Northeast"], [5, "Northwest"],
];

type Status = "idle" | "working" | "done" | "error";

export default function MapGenerator() {
  const [seed, setSeed] = useState("aldemar");
  const [sizeKey, setSizeKey] = useState("m");
  const [ocean, setOcean] = useState(0.6);
  const [continents, setContinents] = useState(2);
  const [wind, setWind] = useState(0);
  const [archipelago, setArchipelago] = useState(false);

  const [status, setStatus] = useState<Status>("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);

  async function run() {
    setStatus("working");
    setErr(null);
    // Let the "Generating..." state paint before the synchronous pipeline blocks the thread.
    await new Promise((r) => setTimeout(r, 20));
    try {
      const [W, H] = SIZES[sizeKey];
      const cfg = {
        ...defaultConfig(W, H, seed.trim() || "six-axes"),
        oceanCoverage: ocean,
        continentCount: continents,
        windDir: wind,
        archipelago,
      };
      const fields = generateTerrain(cfg);
      const baked = bakeWorld(fields, cfg, 0, 0);
      const terrain = decodeTerrain(base64ToBytes(baked.terrain));
      const blob = await renderWorldSnapshot({
        terrain,
        colors: BIOME_COLORS,
        biomeArt: BIOME_ART,
        features: baked.features,
        pois: [],
        images: [],
        maxPx: 2000,
        mime: "image/png",
      });
      const next = URL.createObjectURL(blob);
      setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return next; });
      setStatus("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong generating the map.");
      setStatus("error");
    }
  }

  // Generate one map on first load so the page is never empty.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    return () => { if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const randomize = () => {
    const s = Math.random().toString(36).slice(2, 9);
    setSeed(s);
    // run() reads state; setState is async, so run after a tick with the new seed applied.
    setTimeout(() => void run(), 0);
  };

  const busy = status === "working";
  const slug = (seed.trim() || "world").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return (
    <div>
      {/* Controls */}
      <div style={panel}>
        <div style={grid}>
          <label style={field}>
            <span style={label}>Seed</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={seed} onChange={(e) => setSeed(e.target.value)} maxLength={40} style={{ ...input, flex: 1 }} />
              <button onClick={randomize} disabled={busy} style={ghost}>Random</button>
            </div>
          </label>

          <label style={field}>
            <span style={label}>Size</span>
            <select value={sizeKey} onChange={(e) => setSizeKey(e.target.value)} style={input}>
              {Object.entries(SIZES).map(([k, [w, h, name]]) => <option key={k} value={k}>{name} ({w}x{h})</option>)}
            </select>
          </label>

          <label style={field}>
            <span style={label}>Ocean coverage: {Math.round(ocean * 100)}%</span>
            <input type="range" min={0.4} max={0.8} step={0.02} value={ocean} onChange={(e) => setOcean(parseFloat(e.target.value))} style={{ width: "100%" }} />
          </label>

          <label style={field}>
            <span style={label}>Continents</span>
            <select value={continents} onChange={(e) => setContinents(parseInt(e.target.value, 10))} disabled={archipelago} style={{ ...input, opacity: archipelago ? 0.5 : 1 }}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>

          <label style={field}>
            <span style={label}>Prevailing wind from</span>
            <select value={wind} onChange={(e) => setWind(parseInt(e.target.value, 10))} style={input}>
              {WINDS.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
            </select>
          </label>

          <label style={{ ...field, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={archipelago} onChange={(e) => setArchipelago(e.target.checked)} />
            <span style={label}>Archipelago (scattered islands)</span>
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={() => void run()} disabled={busy} style={{ ...cta, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Generating…" : "Generate map"}
          </button>
          {url && !busy && (
            <a href={url} download={`six-axes-world-${slug}.png`} style={dl}>Download PNG</a>
          )}
          <span style={hint}>Runs entirely in your browser. Nothing is uploaded.</span>
        </div>
        {err && <p style={errStyle}>{err}</p>}
      </div>

      {/* Preview */}
      <div style={preview}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Generated hex world map" style={{ width: "100%", height: "auto", display: "block", borderRadius: 4 }} />
        ) : (
          <div style={{ padding: "60px 0", textAlign: "center", color: "#8a8069" }}>{busy ? "Generating your world…" : "Your map will appear here."}</div>
        )}
      </div>

      {/* AI upsell teaser (Part B) */}
      <div style={teaser}>
        <strong style={{ color: "#2a2620" }}>Want it hand-painted?</strong> This is the tile map. In the full
        version, Six Axes renders it into a cohesive illustrated world, fantasy, sci-fi, grimdark or modern,
        keeping every coastline, river and road exactly where the generator put them.
      </div>

      {/* SEO / explainer */}
      <div style={{ marginTop: 26 }}>
        <h2 style={h2}>About this generator</h2>
        <p style={body}>
          Every map is a whole world built from one seed: continents and plate uplift set the land, a
          priority-flood drainage model and prevailing winds decide where rain falls, and temperature crossed
          with moisture assigns twenty-eight biomes, from taiga and rainforest to salt flats, volcanic peaks
          and feywild groves. Flow accumulation carves rivers, settlements seat themselves by fresh water and
          harbours, and roads connect them across a cost surface that bridges rivers and skirts mountains.
        </p>
        <p style={body}>
          The same seed always makes the same world, so you can share a seed and a friend gets your exact map.
          It is the same generator that runs inside Six Axes, where a world is tied to your campaign, painted
          by AI, and marked up with the places your party discovers.
        </p>
      </div>
    </div>
  );
}

// styles
const panel: React.CSSProperties = { background: "#fffdf8", border: "1px solid #ddd4c2", borderRadius: 6, padding: "18px 20px" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const label: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, letterSpacing: "0.03em", color: "#6a6252", textTransform: "uppercase" };
const input: React.CSSProperties = { padding: "9px 11px", fontSize: 15, fontFamily: "'Iowan Old Style', Georgia, serif", color: "#2a2620", background: "#fffdf8", border: "1px solid #c9bfa8", borderRadius: 3, boxSizing: "border-box", colorScheme: "light" };
const ghost: React.CSSProperties = { background: "transparent", color: "#8a6a2f", border: "1px solid #c9bfa8", borderRadius: 3, padding: "0 12px", fontSize: 13, cursor: "pointer", fontFamily: "'Iowan Old Style', Georgia, serif" };
const cta: React.CSSProperties = { background: "#3a352c", color: "#f6f2e9", border: "none", borderRadius: 3, padding: "12px 24px", fontFamily: "ui-monospace, monospace", fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" };
const dl: React.CSSProperties = { background: "transparent", color: "#3a352c", border: "1px solid #c9bfa8", borderRadius: 3, padding: "12px 22px", fontFamily: "ui-monospace, monospace", fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none" };
const hint: React.CSSProperties = { fontSize: 12.5, color: "#8a8069" };
const errStyle: React.CSSProperties = { color: "#9a3b2e", fontSize: 14, margin: "12px 0 0" };
const preview: React.CSSProperties = { marginTop: 14, background: "#efe9db", border: "1px solid #ddd4c2", borderRadius: 6, padding: 8, overflow: "hidden" };
const teaser: React.CSSProperties = { marginTop: 14, background: "#fffdf8", border: "1px solid #e3dbc9", borderRadius: 6, padding: "14px 18px", fontSize: 15, lineHeight: 1.6, color: "#4a443a" };
const h2: React.CSSProperties = { fontSize: 22, fontWeight: 600, color: "#2a2620", margin: "0 0 8px" };
const body: React.CSSProperties = { fontSize: 16, lineHeight: 1.7, color: "#3a352c", margin: "0 0 12px" };
