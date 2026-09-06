"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import { CELL_TYPES, SIZES, LEVELS, DEFAULT_N, feetPerSquare, emptyLevels, normalizeLevels, gridSizeOf, resizeLevels, renderDungeonLevel } from "@/lib/dungeon/render";
import TileLibrary from "./TileLibrary";
import type { CustomTile } from "@/lib/tiles/custom";

// The Dungeon tab. Paint a square grid (25/50/75/100, where side N sets scale: N/5 ft per square) across
// three stacked levels, autosave the layout to dungeon_maps, and paint each level into a top-down battle
// map through the imagine route (mode: "dungeon"). Brush size + drag paint broad or fine.
//
// Custom tiles (p87/p88): the GM's global square tiles show up as extra brushes. Their cells live in a
// parallel sparse map (custom_cells) keyed by cell index -> tile id, and render three ways: AI only
// (the tile's average colour seeds the AI, with a legend note), AI + the tile images stamped on top, or
// a pure stamped grid with no AI.

const BRUSHES = [1, 2, 3, 5];
type Brush = { kind: "builtin"; idx: number } | { kind: "custom"; tileId: string };
const emptyCustom = (): Record<string, string>[] => Array.from({ length: LEVELS }, () => ({}));

function normCustom(raw: unknown, n: number): Record<string, string>[] {
  const out = emptyCustom();
  if (Array.isArray(raw)) for (let l = 0; l < LEVELS; l++) {
    const o = raw[l];
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < n * n && typeof v === "string") out[l][k] = v;
    }
  }
  return out;
}
function remapCustom(custom: Record<string, string>[], oldN: number, newN: number): Record<string, string>[] {
  return custom.map((o) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) { const i = Number(k), r = Math.floor(i / oldN), c = i % oldN; if (r < newN && c < newN) next[String(r * newN + c)] = v; }
    return next;
  });
}

export default function DungeonCreator({ campaignId }: { campaignId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [n, setN] = useState<number>(DEFAULT_N);
  const [fps, setFps] = useState<number>(feetPerSquare(DEFAULT_N));
  const [levels, setLevels] = useState<number[][]>(() => emptyLevels(DEFAULT_N));
  const [custom, setCustom] = useState<Record<string, string>[]>(() => emptyCustom());
  const [level, setLevel] = useState(0);
  const [brush, setBrush] = useState<Brush>({ kind: "builtin", idx: 2 });
  const [brushSize, setBrushSize] = useState(1);
  const [tiles, setTiles] = useState<CustomTile[]>([]);
  const [stampOnAi, setStampOnAi] = useState(true);
  const [modifier, setModifier] = useState("");
  const [rendered, setRendered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [, setTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const painting = useRef(false);
  const tileImgs = useRef<Map<string, HTMLImageElement>>(new Map());

  const tileById = useMemo(() => { const m = new Map<string, CustomTile>(); for (const t of tiles) m.set(t.id, t); return m; }, [tiles]);

  // Preload custom-tile images as untainted blobs so we can stamp them onto a canvas and export it.
  useEffect(() => {
    let off = false;
    for (const t of tiles) {
      if (tileImgs.current.has(t.id)) continue;
      (async () => {
        try {
          const blob = await (await fetch(t.imageUrl)).blob();
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => { if (!off) { tileImgs.current.set(t.id, img); setTick((v) => v + 1); } URL.revokeObjectURL(url); };
          img.src = url;
        } catch { /* fall back to flat colour */ }
      })();
    }
    return () => { off = true; };
  }, [tiles]);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!campaignId) { setLoaded(true); return; }
      const { data } = await supabase.from("dungeon_maps").select("levels, feet_per_square, custom_cells").eq("campaign_id", campaignId).maybeSingle();
      if (off) return;
      const row = data as { levels?: unknown; feet_per_square?: number | null; custom_cells?: unknown } | null;
      const raw = row?.levels;
      if (raw) {
        const size = gridSizeOf(raw); setN(size); setLevels(normalizeLevels(raw, size));
        setFps(row?.feet_per_square && row.feet_per_square > 0 ? row.feet_per_square : feetPerSquare(size));
        setCustom(normCustom(row?.custom_cells, size));
      }
      setLoaded(true);
    })();
    return () => { off = true; };
  }, [supabase, campaignId]);

  useEffect(() => {
    if (!loaded || !campaignId) return;
    const t = setTimeout(() => {
      void supabase.from("dungeon_maps").upsert(
        { campaign_id: campaignId, levels, custom_cells: custom, feet_per_square: fps, updated_at: new Date().toISOString() },
        { onConflict: "campaign_id" },
      );
    }, 900);
    return () => clearTimeout(t);
  }, [levels, custom, fps, loaded, campaignId, supabase]);

  const occ = useCallback((lv: number, i: number) => levels[lv][i] > 0 || !!custom[lv][String(i)], [levels, custom]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const W = canvas.width, CELL = W / n, g = levels[level], cu = custom[level];
    ctx.fillStyle = "#141019"; ctx.fillRect(0, 0, W, W);
    if (level > 0) { for (let i = 0; i < n * n; i++) if (occ(level - 1, i)) { const x = (i % n) * CELL, y = ((i / n) | 0) * CELL; ctx.fillStyle = "rgba(201,162,75,0.06)"; ctx.fillRect(x, y, CELL, CELL); } }
    for (let i = 0; i < n * n; i++) {
      const x = (i % n) * CELL, y = ((i / n) | 0) * CELL;
      const tid = cu[String(i)];
      if (tid) {
        const img = tileImgs.current.get(tid);
        if (img) ctx.drawImage(img, x, y, CELL, CELL);
        else { ctx.fillStyle = tileById.get(tid)?.color || "#8a7f68"; ctx.fillRect(x, y, CELL, CELL); }
        continue;
      }
      const t = g[i]; if (!t) continue; const col = CELL_TYPES[t].color; if (!col) continue;
      ctx.fillStyle = col; ctx.fillRect(x, y, CELL, CELL);
      if (CELL_TYPES[t].key === "corridor") { ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect(x + CELL * 0.18, y + CELL * 0.18, CELL * 0.64, CELL * 0.64); }
    }
    ctx.strokeStyle = "#2a2620"; ctx.lineWidth = Math.max(1.5, CELL * 0.14); ctx.lineCap = "round";
    const wall = (rr: number, cc: number) => (rr < 0 || cc < 0 || rr >= n || cc >= n) ? true : !occ(level, rr * n + cc);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { if (!occ(level, r * n + c)) continue; const x = c * CELL, y = r * CELL; ctx.beginPath();
      if (wall(r - 1, c)) { ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); }
      if (wall(r + 1, c)) { ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); }
      if (wall(r, c - 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); }
      if (wall(r, c + 1)) { ctx.moveTo(x + CELL, y); ctx.lineTo(x + CELL, y + CELL); }
      ctx.stroke(); }
    ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
    for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, W); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke(); }
  }, [levels, custom, level, n, occ, tileById]);
  useEffect(() => { draw(); }, [draw]);

  const cellAt = (e: React.PointerEvent) => {
    const canvas = canvasRef.current; if (!canvas) return -1;
    const r = canvas.getBoundingClientRect(), sx = canvas.width / r.width, sy = canvas.height / r.height, CELL = canvas.width / n;
    const col = (((e.clientX - r.left) * sx) / CELL) | 0, row = (((e.clientY - r.top) * sy) / CELL) | 0;
    if (col < 0 || row < 0 || col >= n || row >= n) return -1;
    return row * n + col;
  };
  const paintAt = (e: React.PointerEvent) => {
    const base = cellAt(e); if (base < 0) return;
    const row = (base / n) | 0, col = base % n, half = Math.floor(brushSize / 2);
    const cells: number[] = [];
    for (let dr = 0; dr < brushSize; dr++) for (let dc = 0; dc < brushSize; dc++) { const r2 = row - half + dr, c2 = col - half + dc; if (r2 >= 0 && c2 >= 0 && r2 < n && c2 < n) cells.push(r2 * n + c2); }
    setLevels((prev) => { const next = prev.map((a) => a.slice()); for (const i of cells) next[level][i] = brush.kind === "builtin" ? brush.idx : 0; return next; });
    setCustom((prev) => { const next = prev.map((o) => ({ ...o })); for (const i of cells) { if (brush.kind === "custom") next[level][String(i)] = brush.tileId; else delete next[level][String(i)]; } return next; });
  };

  const changeSize = (newN: number) => { setLevels((prev) => resizeLevels(prev, n, newN)); setCustom((prev) => remapCustom(prev, n, newN)); setN(newN); setRendered(null); };

  // Flat control image (custom cells = tile average colour), for the AI paint + the AI-legend seed.
  const buildControl = (lv: number): string => {
    const grid = levels[lv], cu = custom[lv], size = 1024, CELL = size / n;
    const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d"); if (!ctx) return renderDungeonLevel(grid, n, size);
    ctx.fillStyle = "#0e0b08"; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < n * n; i++) {
      const x = (i % n) * CELL, y = ((i / n) | 0) * CELL, tid = cu[String(i)];
      if (tid) { ctx.fillStyle = tileById.get(tid)?.color || "#8a7f68"; ctx.fillRect(x, y, CELL, CELL); continue; }
      const t = grid[i]; if (!t) continue; const col = CELL_TYPES[t].color; if (!col) continue;
      ctx.fillStyle = col; ctx.fillRect(x, y, CELL, CELL);
      if (CELL_TYPES[t].key === "corridor") { ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect(x + CELL * 0.18, y + CELL * 0.18, CELL * 0.64, CELL * 0.64); }
    }
    ctx.strokeStyle = "#2a2620"; ctx.lineWidth = Math.max(1.5, CELL * 0.14); ctx.lineCap = "round";
    const isWall = (rr: number, cc: number) => (rr < 0 || cc < 0 || rr >= n || cc >= n) ? true : !(grid[rr * n + cc] > 0 || !!cu[String(rr * n + cc)]);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { if (!(grid[r * n + c] > 0 || !!cu[String(r * n + c)])) continue; const x = c * CELL, y = r * CELL; ctx.beginPath();
      if (isWall(r - 1, c)) { ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); }
      if (isWall(r + 1, c)) { ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); }
      if (isWall(r, c - 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); }
      if (isWall(r, c + 1)) { ctx.moveTo(x + CELL, y); ctx.lineTo(x + CELL, y + CELL); }
      ctx.stroke(); }
    return canvas.toDataURL("image/png");
  };

  // Pure stamped output: built-in cells flat, custom cells their actual image. No AI.
  const buildStamped = (lv: number): string => {
    const grid = levels[lv], cu = custom[lv], size = 1024, CELL = size / n;
    const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d"); if (!ctx) return "";
    ctx.fillStyle = "#0e0b08"; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < n * n; i++) {
      const x = (i % n) * CELL, y = ((i / n) | 0) * CELL, tid = cu[String(i)];
      if (tid) { const img = tileImgs.current.get(tid); if (img) ctx.drawImage(img, x, y, CELL, CELL); else { ctx.fillStyle = tileById.get(tid)?.color || "#8a7f68"; ctx.fillRect(x, y, CELL, CELL); } continue; }
      const t = grid[i]; if (!t) continue; const col = CELL_TYPES[t].color; if (!col) continue;
      ctx.fillStyle = col; ctx.fillRect(x, y, CELL, CELL);
    }
    ctx.strokeStyle = "#2a2620"; ctx.lineWidth = Math.max(1.5, CELL * 0.14); ctx.lineCap = "round";
    const isWall = (rr: number, cc: number) => (rr < 0 || cc < 0 || rr >= n || cc >= n) ? true : !(grid[rr * n + cc] > 0 || !!cu[String(rr * n + cc)]);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { if (!(grid[r * n + c] > 0 || !!cu[String(r * n + c)])) continue; const x = c * CELL, y = r * CELL; ctx.beginPath();
      if (isWall(r - 1, c)) { ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); }
      if (isWall(r + 1, c)) { ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); }
      if (isWall(r, c - 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); }
      if (isWall(r, c + 1)) { ctx.moveTo(x + CELL, y); ctx.lineTo(x + CELL, y + CELL); }
      ctx.stroke(); }
    return canvas.toDataURL("image/png");
  };

  // Draw the custom tiles over an AI-rendered image (loaded as an untainted blob so export works).
  const compositeOnAi = async (aiUrl: string, lv: number): Promise<string> => {
    const cu = custom[lv];
    const blob = await (await fetch(aiUrl)).blob();
    const url = URL.createObjectURL(blob);
    try {
      const base = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      const size = base.naturalWidth || 1024, CELL = size / n;
      const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d"); if (!ctx) return aiUrl;
      ctx.drawImage(base, 0, 0, size, size);
      for (let i = 0; i < n * n; i++) { const tid = cu[String(i)]; if (!tid) continue; const img = tileImgs.current.get(tid); if (!img) continue; const x = (i % n) * CELL, y = ((i / n) | 0) * CELL; ctx.drawImage(img, x, y, CELL, CELL); }
      return canvas.toDataURL("image/png");
    } finally { URL.revokeObjectURL(url); }
  };

  const customOnLevel = useMemo(() => { const ids = new Set(Object.values(custom[level] ?? {})); return tiles.filter((t) => ids.has(t.id)); }, [custom, level, tiles]);

  const render = async (mode: "ai" | "stamp") => {
    setBusy(true); setMsg(null);
    try {
      if (mode === "stamp") { setRendered(buildStamped(level)); return; }
      const control = buildControl(level);
      const extraLegend = customOnLevel.map((t) => ({ label: t.label, color: t.color }));
      const res = await fetch("/api/world-map/imagine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, controlImage: control, mode: "dungeon", promptModifier: modifier, scaleHint: `${fps} ft per grid square`, extraLegend }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) { setMsg(data.error || "The render failed. Try again."); return; }
      if (stampOnAi && customOnLevel.length) setRendered(await compositeOnAi(data.url, level));
      else setRendered(data.url);
    } catch { setMsg("Something went wrong reaching the image service."); }
    finally { setBusy(false); }
  };

  const saveLocally = async () => {
    if (!rendered) return;
    try { const blob = await (await fetch(rendered)).blob(); const obj = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = obj; a.download = `dungeon-level${level + 1}.png`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(obj); }
    catch { setMsg("Could not save automatically. Right-click the image and Save image as."); }
  };

  const isBuiltin = (i: number) => brush.kind === "builtin" && brush.idx === i;
  const isCustomBrush = (id: string) => brush.kind === "custom" && brush.tileId === id;
  const label: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, margin: "14px 0 6px" };
  const seg = (on: boolean): React.CSSProperties => ({ flex: 1, padding: "7px 0", background: on ? C.surface2 : "transparent", color: on ? C.sun : C.muted, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer" });
  const btn = (bg: string, fg: string): React.CSSProperties => ({ padding: "9px 14px", background: bg, color: fg, border: bg === "transparent" ? `1px solid ${C.line}` : "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, width: "100%" });

  return (
    <div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 12 }}>
          <canvas
            ref={canvasRef}
            width={1000}
            height={1000}
            onPointerDown={(e) => { painting.current = true; canvasRef.current?.setPointerCapture(e.pointerId); paintAt(e); }}
            onPointerMove={(e) => { if (painting.current) paintAt(e); }}
            onPointerUp={() => { painting.current = false; }}
            style={{ display: "block", width: "min(560px, 86vw)", height: "auto", aspectRatio: "1 / 1", borderRadius: 8, background: "#0e0b08", cursor: "crosshair", touchAction: "none" }}
          />
          <p style={{ color: C.muted, fontSize: 12, margin: "8px 2px 0" }}>{n}&times;{n} grid, 1 square = {fps} ft &middot; {n * fps}&times;{n * fps} ft across.</p>
          {rendered && (
            <div style={{ marginTop: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={rendered} alt="Rendered level" style={{ display: "block", width: "min(560px, 86vw)", borderRadius: 8 }} />
              <p style={{ color: C.muted, fontSize: 12, margin: "8px 2px 0" }}>Painted level {level + 1}. Save it, then reuse it anywhere.</p>
            </div>
          )}
        </div>

        <div style={{ width: 270, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 16 }}>
          <label style={label}>Level</label>
          <div style={{ display: "flex", gap: 6 }}>{[0, 1, 2].map((l) => <button key={l} type="button" onClick={() => setLevel(l)} style={seg(level === l)}>Level {l + 1}</button>)}</div>

          <label style={label}>Grid size</label>
          <div style={{ display: "flex", gap: 6 }}>{SIZES.map((s) => <button key={s} type="button" onClick={() => changeSize(s)} style={seg(n === s)}>{s}</button>)}</div>

          <label style={label}>Feet per square</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="number" min={1} max={100} step={1} value={fps}
              onChange={(e) => { const v = Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))); setFps(v); setRendered(null); }}
              style={{ width: 80, padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 13 }} />
            <span style={{ color: C.muted, fontSize: 12 }}>ft / square</span>
            <button type="button" onClick={() => { setFps(feetPerSquare(n)); setRendered(null); }}
              style={{ marginLeft: "auto", padding: "6px 9px", background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
              Default ({feetPerSquare(n)})
            </button>
          </div>

          <label style={label}>Brush</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {CELL_TYPES.map((t, i) => (
              <button key={t.key} type="button" onClick={() => setBrush({ kind: "builtin", idx: i })}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", background: isBuiltin(i) ? C.surface2 : "transparent", color: C.text, border: `1px solid ${isBuiltin(i) ? C.sun : C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, border: "1px solid rgba(0,0,0,.4)", background: t.color || "repeating-linear-gradient(45deg,#333,#333 3px,#222 3px,#222 6px)" }} />
                {t.label}
              </button>
            ))}
          </div>

          {tiles.length > 0 && (
            <>
              <label style={label}>Custom tiles</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {tiles.map((t) => (
                  <button key={t.id} type="button" onClick={() => setBrush({ kind: "custom", tileId: t.id })}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", background: isCustomBrush(t.id) ? C.surface2 : "transparent", color: C.text, border: `1px solid ${isCustomBrush(t.id) ? C.sun : C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer", textAlign: "left" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.imageUrl} alt={t.label} style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0, objectFit: "cover", background: t.color }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <label style={label}>Brush size</label>
          <div style={{ display: "flex", gap: 6 }}>{BRUSHES.map((b) => <button key={b} type="button" onClick={() => setBrushSize(b)} style={seg(brushSize === b)}>{b}&times;{b}</button>)}</div>

          <label style={label}>Flavour</label>
          <textarea value={modifier} onChange={(e) => setModifier(e.target.value)} rows={2}
            placeholder="e.g. overgrown and abandoned, torch-lit"
            style={{ width: "100%", padding: "8px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontFamily: "inherit", fontSize: 13, resize: "vertical" }} />

          {customOnLevel.length > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, color: C.text, fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={stampOnAi} onChange={(e) => setStampOnAi(e.target.checked)} style={{ accentColor: C.sun }} />
              Stamp my custom tiles on the AI result
            </label>
          )}

          <div style={{ marginTop: 14 }}><button type="button" onClick={() => render("ai")} disabled={busy} style={btn(C.sun, "#1b1712")}>{busy ? "Painting…" : `Paint level ${level + 1}`}</button></div>
          {customOnLevel.length > 0 && <div style={{ marginTop: 8 }}><button type="button" onClick={() => render("stamp")} disabled={busy} style={btn("transparent", C.text)}>Stamp only (no AI)</button></div>}
          <div style={{ marginTop: 8 }}><button type="button" onClick={saveLocally} style={btn("transparent", C.text)}>Save image</button></div>
          <div style={{ marginTop: 8 }}><button type="button" onClick={() => { setLevels((prev) => { const next = prev.map((a) => a.slice()); next[level] = next[level].map(() => 0); return next; }); setCustom((prev) => { const next = prev.map((o) => ({ ...o })); next[level] = {}; return next; }); }} style={btn("transparent", C.muted)}>Clear level {level + 1}</button></div>

          {msg && <p style={{ color: "#c98a7a", fontSize: 12, marginTop: 12 }}>{msg}</p>}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <TileLibrary scope="dungeon" onChange={setTiles} />
      </div>
    </div>
  );
}
