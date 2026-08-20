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
import { SAX, STONE, surfaces } from "@/lib/theme";
import { stoneField } from "@/lib/forge-theme";
import { generateTerrain } from "@/lib/worldmap/gen/pipeline";
import { defaultConfig } from "@/lib/worldmap/gen/types";
import { bakeWorld } from "@/lib/worldmap/gen/bake";
import { decodeTerrain, base64ToBytes } from "@/lib/worldmap/hex";
import { renderWorldSnapshot } from "@/lib/worldmap/snapshot";
import { BIOME_COLORS, BIOME_ART, WORLD_BIOMES } from "@/lib/tools/worldgen-biomes";

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

  // The last generated terrain + features, kept so the AI paint can build a control image from them.
  const terrainRef = useRef<import("@/lib/worldmap/hex").Terrain | null>(null);
  const featuresRef = useRef<import("@/lib/worldmap/gen/bake").BakedFeature[]>([]);

  // Part B: AI render.
  const [style, setStyle] = useState("fantasy");
  const [aiStatus, setAiStatus] = useState<Status>("idle");
  const [aiUrl, setAiUrl] = useState<string | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);

  async function run() {
    setStatus("working");
    setErr(null);
    // A new map invalidates the previous AI painting.
    setAiUrl(null); setAiErr(null); setAiStatus("idle");
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
      terrainRef.current = terrain;
      featuresRef.current = baked.features;
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

  // Part B: paint the current map with AI. Builds the smooth control image (same as the product) from
  // the last terrain, posts it to the free-tier render route, and shows the returned image.
  async function paintAi() {
    const terrain = terrainRef.current;
    if (!terrain || aiStatus === "working") return;
    setAiStatus("working");
    setAiErr(null);
    await new Promise((r) => setTimeout(r, 20));
    try {
      const blob = await renderWorldSnapshot({
        terrain,
        colors: BIOME_COLORS,
        biomeArt: BIOME_ART,
        features: featuresRef.current,
        pois: [],
        images: [],
        maxPx: 1280,
        mime: "image/jpeg",
        quality: 0.8,
        smooth: true,
      });
      const controlImage = await blobToDataURL(blob);
      const res = await fetch("/api/tools/map-render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          controlImage,
          style,
          biomes: style === "fantasy" ? undefined : WORLD_BIOMES.map((b) => ({ label: b.label, color: b.color })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setAiErr(json?.error || "The render failed. Please try again.");
        setAiStatus("error");
        return;
      }
      setAiUrl(json.image as string);
      setAiStatus("done");
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : "Could not render the map.");
      setAiStatus("error");
    }
  }

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
          <div style={{ padding: "60px 0", textAlign: "center", color: STONE.inkFaint }}>{busy ? "Generating your world…" : "Your map will appear here."}</div>
        )}
      </div>

      {/* Part B: AI render */}
      <div style={teaser}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ color: STONE.ink }}>Paint it with AI</strong>
          <select value={style} onChange={(e) => setStyle(e.target.value)} style={{ ...input, maxWidth: 170 }} disabled={aiStatus === "working"}>
            <option value="fantasy">Fantasy</option>
            <option value="scifi">Sci-fi</option>
            <option value="grimdark">Grimdark</option>
            <option value="urban">Modern</option>
          </select>
          <button onClick={() => void paintAi()} disabled={aiStatus === "working" || !url} style={{ ...cta, opacity: aiStatus === "working" || !url ? 0.6 : 1 }}>
            {aiStatus === "working" ? "Painting…" : "Paint this map"}
          </button>
          <span style={hint}>Dissolves the hexes into a cohesive illustrated world, keeping every coast, river and road in place.</span>
        </div>
        {aiStatus === "working" && <p style={{ ...hint, marginTop: 8 }}>This can take up to a minute.</p>}
        {aiErr && <p style={errStyle}>{aiErr}</p>}
        {aiUrl && aiStatus === "done" && (
          <div style={{ marginTop: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={aiUrl} alt="AI-painted world map" style={{ width: "100%", height: "auto", display: "block", borderRadius: 4 }} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <a href={aiUrl} download={`six-axes-world-${slug}-${style}.png`} style={dl}>Download PNG</a>
              <span style={hint}>Standard resolution. High-def renders are in the full version.</span>
            </div>
          </div>
        )}
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
          The same seed always makes the same world, so you can share a seed and get the exact map back. This
          free tool generates one world at a time and hands you the PNG.
        </p>

        <h2 style={{ ...h2, marginTop: 22 }}>Inside Six Axes, the map does much more</h2>
        <p style={body}>
          The full version runs the same engine far further. Worlds scale up to 250 by 250 hexes, and you are
          not stuck with what the generator rolls: paint or repaint any hex by hand, drop your own images onto
          the map and drag them into place, and tune every knob, land and ocean level, continents and plate
          activity, latitude and prevailing wind and the rain shadows they throw, river and road density, how
          much of the world is fantasy terrain, and how thickly settlements, roads and points of interest are
          seeded. Each world is tied to your campaign, shareable, and annotated with the places your party
          discovers.
        </p>
        <p style={body}>
          And the world map is only one of four generators. Six Axes also builds city maps, top-down dungeon
          battle maps, and building and room floor plans, each hand-editable and each renderable by AI in the
          same four styles, so one tool draws your continent, the capital on it, the dungeon beneath the
          capital, and the very room where the fight breaks out.
        </p>
      </div>
    </div>
  );
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the map image."));
    r.readAsDataURL(blob);
  });
}

// styles (carved dark forge register)
const panel: React.CSSProperties = { ...surfaces.panel, padding: "18px 20px" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const label: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.03em", color: STONE.inkDim, textTransform: "uppercase" };
const input: React.CSSProperties = { ...stoneField(), fontSize: 15, boxSizing: "border-box", colorScheme: "dark" };
const ghost: React.CSSProperties = { background: "rgba(0,0,0,0.24)", color: STONE.brassHi, border: `1px solid ${STONE.hi}`, borderRadius: 3, padding: "0 12px", fontSize: 13, cursor: "pointer", fontFamily: SAX.serif };
const cta: React.CSSProperties = { background: `linear-gradient(180deg, ${STONE.brassHi}, ${SAX.brass})`, color: "#241a0d", border: "none", borderRadius: 3, padding: "12px 24px", fontFamily: SAX.mono, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" };
const dl: React.CSSProperties = { background: "rgba(0,0,0,0.24)", color: STONE.brassHi, border: `1px solid ${STONE.hi}`, borderRadius: 3, padding: "12px 22px", fontFamily: SAX.mono, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none" };
const hint: React.CSSProperties = { fontSize: 12.5, color: STONE.inkFaint, fontFamily: SAX.serif };
const errStyle: React.CSSProperties = { color: "#d97d6d", fontSize: 14, margin: "12px 0 0", fontFamily: SAX.serif };
const preview: React.CSSProperties = { marginTop: 14, background: "rgba(0,0,0,0.34)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4)", borderRadius: 6, padding: 8, overflow: "hidden" };
const teaser: React.CSSProperties = { ...surfaces.panel, marginTop: 14, padding: "14px 18px", fontSize: 15, lineHeight: 1.6, color: STONE.inkDim };
const h2: React.CSSProperties = { fontSize: 22, fontWeight: 600, color: STONE.ink, margin: "0 0 8px", fontFamily: "var(--forge-display, 'Cinzel', serif)" };
const body: React.CSSProperties = { fontSize: 16, lineHeight: 1.7, color: STONE.ink, margin: "0 0 12px", fontFamily: SAX.serif };
