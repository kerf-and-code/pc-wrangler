"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import { CELL_TYPES, SIZES, LEVELS, DEFAULT_N, feetPerSquare, emptyLevels, normalizeLevels, gridSizeOf, resizeLevels } from "@/lib/dungeon/render";
import {
  DOOR_KINDS, FEATURES, type DoorKind, type FeatureKind, type LevelMarks, type DungeonMeta,
  emptyMarks, defaultMeta, normalizeMarks, normalizeMeta, remapMarks, edgeKey,
  renderClassic, layoutFor, contentBounds, drawDoor, drawFeature,
} from "@/lib/dungeon/classic";
import TileLibrary from "./TileLibrary";
import type { CustomTile } from "@/lib/tiles/custom";
import { notReady } from "@/lib/friendly-error";
import { askConfirm } from "@/lib/confirm";

// The Dungeon tab (rebuilt 2026-11-06). Paint floors on a square grid across three stacked levels, then
// add what makes a map read like one from a printed adventure: doors set into the walls, furniture,
// stairs, traps, and room labels. The page beside the editor is the finished map, drawn by
// lib/dungeon/classic in the adventure-book style (parchment, hatched rock, ink walls, numbered rooms,
// title, compass and scale bar). No AI is involved: what you see is exactly what saves.
//
// Tools: Floors (drag to paint terrain or a custom tile), Doors (click near a wall line; click the same
// door again to remove it), Furniture (click a square; click the same piece again to turn it, or to
// remove it if it does not turn), Labels (type a label, click a square; click a label to remove it).
// Ctrl+Z undoes.
//
// Saved to dungeon_maps: levels and custom_cells as before, plus marks and meta (p103).

const BRUSHES = [1, 2, 3, 5];
const UNDO_DEPTH = 60;
type Tool = "floors" | "doors" | "furniture" | "labels";
type Brush = { kind: "builtin"; idx: number } | { kind: "custom"; tileId: string };
type Snapshot = { levels: number[][]; custom: Record<string, string>[]; marks: LevelMarks[] };

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
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dungeon";

export default function DungeonCreator({ campaignId }: { campaignId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [n, setN] = useState<number>(DEFAULT_N);
  const [fps, setFps] = useState<number>(feetPerSquare(DEFAULT_N));
  const [levels, setLevels] = useState<number[][]>(() => emptyLevels(DEFAULT_N));
  const [custom, setCustom] = useState<Record<string, string>[]>(() => emptyCustom());
  const [marks, setMarks] = useState<LevelMarks[]>(() => emptyMarks(LEVELS));
  const [meta, setMeta] = useState<DungeonMeta>(() => defaultMeta(LEVELS));
  const [level, setLevel] = useState(0);
  const [tool, setTool] = useState<Tool>("floors");
  const [brush, setBrush] = useState<Brush>({ kind: "builtin", idx: 2 });
  const [brushSize, setBrushSize] = useState(1);
  const [door, setDoor] = useState<DoorKind>("door");
  const [feature, setFeature] = useState<FeatureKind | "remove">("pillar");
  const [labelText, setLabelText] = useState("A");
  const [tiles, setTiles] = useState<CustomTile[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loaded, setLoaded] = useState(false);
  const [imgTick, setImgTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const painting = useRef(false);
  const tileImgs = useRef<Map<string, HTMLImageElement>>(new Map());
  const undo = useRef<Snapshot[]>([]);

  const tileById = useMemo(() => { const m = new Map<string, CustomTile>(); for (const t of tiles) m.set(t.id, t); return m; }, [tiles]);
  const tileColors = useMemo(() => new Map(tiles.map((t) => [t.id, t.color])), [tiles]);

  // Preload custom-tile images as untainted blobs so they can be drawn onto a canvas that is exported.
  useEffect(() => {
    let off = false;
    for (const t of tiles) {
      if (tileImgs.current.has(t.id)) continue;
      (async () => {
        try {
          const blob = await (await fetch(t.imageUrl)).blob();
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => { if (!off) { tileImgs.current.set(t.id, img); setImgTick((v) => v + 1); } URL.revokeObjectURL(url); };
          img.src = url;
        } catch { /* falls back to the tile's average colour */ }
      })();
    }
    return () => { off = true; };
  }, [tiles]);

  // Load. marks and meta (p103) are read separately so a database without that migration still loads
  // the floor plan rather than failing the whole read.
  useEffect(() => {
    let off = false;
    (async () => {
      if (!campaignId) { setLoaded(true); return; }
      const { data } = await supabase.from("dungeon_maps").select("levels, feet_per_square, custom_cells").eq("campaign_id", campaignId).maybeSingle();
      if (off) return;
      const row = data as { levels?: unknown; feet_per_square?: number | null; custom_cells?: unknown } | null;
      let size = DEFAULT_N;
      if (row?.levels) {
        size = gridSizeOf(row.levels); setN(size); setLevels(normalizeLevels(row.levels, size));
        setFps(row.feet_per_square && row.feet_per_square > 0 ? row.feet_per_square : feetPerSquare(size));
        setCustom(normCustom(row.custom_cells, size));
      }
      const { data: extra, error } = await supabase.from("dungeon_maps").select("marks, meta").eq("campaign_id", campaignId).maybeSingle();
      if (off) return;
      if (error && /marks|meta/.test(error.message)) setMsg(notReady("Saving doors, furniture and the title", "p103"));
      const ex = extra as { marks?: unknown; meta?: unknown } | null;
      setMarks(normalizeMarks(ex?.marks, LEVELS, size));
      setMeta(normalizeMeta(ex?.meta, LEVELS));
      setLoaded(true);
    })();
    return () => { off = true; };
  }, [supabase, campaignId]);

  // Autosave, with the result shown rather than swallowed.
  useEffect(() => {
    if (!loaded || !campaignId) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      const { error } = await supabase.from("dungeon_maps").upsert(
        { campaign_id: campaignId, levels, custom_cells: custom, feet_per_square: fps, marks, meta, updated_at: new Date().toISOString() },
        { onConflict: "campaign_id" },
      );
      if (!error) { setSaveState("saved"); return; }
      if (/marks|meta/.test(error.message)) {
        // Older database: keep the floor plan safe and say what is missing.
        const { error: e2 } = await supabase.from("dungeon_maps").upsert(
          { campaign_id: campaignId, levels, custom_cells: custom, feet_per_square: fps, updated_at: new Date().toISOString() },
          { onConflict: "campaign_id" },
        );
        setSaveState(e2 ? "error" : "saved");
        setMsg("Floors saved. " + notReady("Saving doors, furniture and the title", "p103"));
      } else { setSaveState("error"); setMsg(`Not saved: ${error.message}`); }
    }, 900);
    return () => clearTimeout(t);
  }, [levels, custom, fps, marks, meta, loaded, campaignId, supabase]);

  const occ = useCallback((lv: number, i: number) => levels[lv][i] > 0 || !!custom[lv][String(i)], [levels, custom]);

  // ---- undo ----
  const snapshot = useCallback(() => {
    undo.current.push({ levels: levels.map((a) => a.slice()), custom: custom.map((o) => ({ ...o })), marks: marks.map((m) => ({ features: { ...m.features }, doors: { ...m.doors }, labels: { ...m.labels } })) });
    if (undo.current.length > UNDO_DEPTH) undo.current.shift();
  }, [levels, custom, marks]);
  const doUndo = useCallback(() => {
    const s = undo.current.pop(); if (!s) return;
    setLevels(s.levels); setCustom(s.custom); setMarks(s.marks);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo]);

  // ---- the editing canvas: a fast schematic with the real door and furniture symbols on top ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const W = canvas.width, CELL = W / n, g = levels[level], cu = custom[level], mk = marks[level];
    ctx.fillStyle = "#141019"; ctx.fillRect(0, 0, W, W);
    if (level > 0) for (let i = 0; i < n * n; i++) if (occ(level - 1, i)) { ctx.fillStyle = "rgba(201,162,75,0.06)"; ctx.fillRect((i % n) * CELL, ((i / n) | 0) * CELL, CELL, CELL); }
    for (let i = 0; i < n * n; i++) {
      const x = (i % n) * CELL, y = ((i / n) | 0) * CELL, tid = cu[String(i)];
      if (tid) {
        const img = tileImgs.current.get(tid);
        if (img) ctx.drawImage(img, x, y, CELL, CELL); else { ctx.fillStyle = tileById.get(tid)?.color || "#8a7f68"; ctx.fillRect(x, y, CELL, CELL); }
        continue;
      }
      const t = g[i]; if (!t) continue; const col = CELL_TYPES[t].color; if (!col) continue;
      ctx.fillStyle = col; ctx.fillRect(x, y, CELL, CELL);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
    for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, W); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke(); }
    ctx.strokeStyle = "#2a2620"; ctx.lineWidth = Math.max(1.5, CELL * 0.12); ctx.lineCap = "round";
    const wall = (rr: number, cc: number) => (rr < 0 || cc < 0 || rr >= n || cc >= n) ? true : !occ(level, rr * n + cc);
    ctx.beginPath();
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!occ(level, r * n + c)) continue; const x = c * CELL, y = r * CELL;
      if (wall(r - 1, c)) { ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); }
      if (wall(r + 1, c)) { ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); }
      if (wall(r, c - 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); }
      if (wall(r, c + 1)) { ctx.moveTo(x + CELL, y); ctx.lineTo(x + CELL, y + CELL); }
    }
    ctx.stroke();
    for (const [k, f] of Object.entries(mk.features)) { const i = Number(k); drawFeature(ctx, f, (i % n) * CELL, ((i / n) | 0) * CELL, CELL, (i / n) | 0, i % n); }
    for (const [k, kind] of Object.entries(mk.doors)) {
      const m = /^(\d+)([hv])$/.exec(k); if (!m) continue;
      const i = Number(m[1]); drawDoor(ctx, kind, (i % n) * CELL, ((i / n) | 0) * CELL, CELL, m[2] === "h");
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `bold ${Math.max(9, CELL * 0.55)}px Georgia, serif`;
    for (const [k, text] of Object.entries(mk.labels)) {
      const i = Number(k), x = (i % n) * CELL + CELL / 2, y = ((i / n) | 0) * CELL + CELL / 2;
      ctx.lineWidth = 3; ctx.strokeStyle = "#efe2c2"; ctx.strokeText(text, x, y); ctx.fillStyle = "#7a1f14"; ctx.fillText(text, x, y);
    }
  }, [levels, custom, marks, level, n, occ, tileById]);
  useEffect(() => { draw(); }, [draw, imgTick]);

  // ---- the finished map (preview), redrawn shortly after edits stop ----
  const renderTo = useCallback((canvas: HTMLCanvasElement, cellPx: number) => {
    const bounds = contentBounds(n, levels[level], custom[level]);
    const L = layoutFor(cellPx, bounds);
    canvas.width = L.width; canvas.height = L.height;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    renderClassic(ctx, { n, grid: levels[level], custom: custom[level], tileImages: tileImgs.current, tileColors, marks: marks[level], meta, level, feetPerSquare: fps }, L);
  }, [n, levels, custom, marks, meta, level, fps, tileColors]);

  useEffect(() => {
    const t = setTimeout(() => {
      const cv = previewRef.current; if (!cv) return;
      const b = contentBounds(n, levels[level], custom[level]);
      renderTo(cv, Math.max(8, Math.min(30, Math.floor(1100 / Math.max(b.cols, b.rows)))));
    }, 250);
    return () => clearTimeout(t);
  }, [renderTo, n, levels, custom, level, imgTick]);

  // ---- pointer handling ----
  const locate = (e: React.PointerEvent) => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const rect = canvas.getBoundingClientRect(), CELL = canvas.width / n;
    const px = ((e.clientX - rect.left) * canvas.width) / rect.width, py = ((e.clientY - rect.top) * canvas.height) / rect.height;
    const col = Math.floor(px / CELL), row = Math.floor(py / CELL);
    if (col < 0 || row < 0 || col >= n || row >= n) return null;
    return { row, col, fx: px / CELL - col, fy: py / CELL - row };
  };

  const paintAt = (row: number, col: number) => {
    const half = Math.floor(brushSize / 2), cells: number[] = [];
    for (let dr = 0; dr < brushSize; dr++) for (let dc = 0; dc < brushSize; dc++) { const r2 = row - half + dr, c2 = col - half + dc; if (r2 >= 0 && c2 >= 0 && r2 < n && c2 < n) cells.push(r2 * n + c2); }
    setLevels((prev) => { const next = prev.map((a) => a.slice()); for (const i of cells) next[level][i] = brush.kind === "builtin" ? brush.idx : 0; return next; });
    setCustom((prev) => { const next = prev.map((o) => ({ ...o })); for (const i of cells) { if (brush.kind === "custom") next[level][String(i)] = brush.tileId; else delete next[level][String(i)]; } return next; });
  };

  const updateMarks = (fn: (m: LevelMarks) => LevelMarks) =>
    setMarks((prev) => prev.map((m, l) => (l === level ? fn({ features: { ...m.features }, doors: { ...m.doors }, labels: { ...m.labels } }) : m)));

  const clickDoor = (row: number, col: number, fx: number, fy: number) => {
    // nearest of the square's four edges; right and bottom edges belong to the neighbour
    const d = [{ side: "top", v: fy }, { side: "bottom", v: 1 - fy }, { side: "left", v: fx }, { side: "right", v: 1 - fx }].sort((a, b) => a.v - b.v)[0].side;
    let key: string, a: [number, number], b: [number, number];
    if (d === "top") { key = edgeKey(row * n + col, "h"); a = [row, col]; b = [row - 1, col]; }
    else if (d === "bottom") { if (row + 1 >= n) return; key = edgeKey((row + 1) * n + col, "h"); a = [row, col]; b = [row + 1, col]; }
    else if (d === "left") { key = edgeKey(row * n + col, "v"); a = [row, col]; b = [row, col - 1]; }
    else { if (col + 1 >= n) return; key = edgeKey(row * n + col + 1, "v"); a = [row, col]; b = [row, col + 1]; }
    const isFloor = ([r, c]: [number, number]) => r >= 0 && c >= 0 && r < n && c < n && occ(level, r * n + c);
    if (!isFloor(a) && !isFloor(b)) { setMsg("Doors go on a wall or doorway next to a floor square."); return; }
    setMsg(null);
    updateMarks((m) => { if (m.doors[key] === door) delete m.doors[key]; else m.doors[key] = door; return m; });
  };

  const clickFeature = (row: number, col: number) => {
    const k = String(row * n + col);
    if (!occ(level, row * n + col) && feature !== "remove") { setMsg("Furniture goes on a floor square. Paint the floor first."); return; }
    setMsg(null);
    updateMarks((m) => {
      if (feature === "remove") { delete m.features[k]; delete m.labels[k]; return m; }
      const cur = m.features[k];
      const rotates = FEATURES.find((f) => f.key === feature)?.rotates;
      if (cur && cur.k === feature) { if (rotates) m.features[k] = { k: feature, r: ((cur.r || 0) + 1) % 4 }; else delete m.features[k]; }
      else m.features[k] = { k: feature, r: 0 };
      return m;
    });
  };

  const clickLabel = (row: number, col: number) => {
    const k = String(row * n + col);
    updateMarks((m) => { if (m.labels[k]) delete m.labels[k]; else if (labelText.trim()) m.labels[k] = labelText.trim().slice(0, 40); return m; });
  };

  const onDown = (e: React.PointerEvent) => {
    const p = locate(e); if (!p) return;
    snapshot();
    if (tool === "floors") { painting.current = true; canvasRef.current?.setPointerCapture(e.pointerId); paintAt(p.row, p.col); }
    else if (tool === "doors") clickDoor(p.row, p.col, p.fx, p.fy);
    else if (tool === "furniture") clickFeature(p.row, p.col);
    else clickLabel(p.row, p.col);
  };
  const onMove = (e: React.PointerEvent) => { if (!painting.current || tool !== "floors") return; const p = locate(e); if (p) paintAt(p.row, p.col); };

  const changeSize = (newN: number) => {
    snapshot();
    setLevels((prev) => resizeLevels(prev, n, newN)); setCustom((prev) => remapCustom(prev, n, newN)); setMarks((prev) => remapMarks(prev, n, newN)); setN(newN);
  };

  const clearLevel = async () => {
    if (!await askConfirm(`Clear everything on ${meta.levelNames[level] || `level ${level + 1}`}? Ctrl+Z brings it back while this page stays open.`)) return;
    snapshot();
    setLevels((prev) => { const next = prev.map((a) => a.slice()); next[level] = next[level].map(() => 0); return next; });
    setCustom((prev) => { const next = prev.map((o) => ({ ...o })); next[level] = {}; return next; });
    setMarks((prev) => prev.map((m, l) => (l === level ? { features: {}, doors: {}, labels: {} } : m)));
  };

  // Export at print size: about 2400px across, never smaller than 28px a square.
  const saveImage = async () => {
    const b = contentBounds(n, levels[level], custom[level]);
    const cv = document.createElement("canvas");
    renderTo(cv, Math.max(28, Math.min(96, Math.round(2400 / Math.max(b.cols, b.rows)))));
    cv.toBlob((blob) => {
      if (!blob) { setMsg("Could not create the image."); return; }
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = `${slug(meta.title || "dungeon")}-${slug(meta.levelNames[level] || `level-${level + 1}`)}.png`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }, "image/png");
  };

  // ---- styles ----
  const label: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, margin: "14px 0 6px" };
  const seg = (on: boolean): React.CSSProperties => ({ flex: 1, padding: "7px 0", background: on ? C.surface2 : "transparent", color: on ? C.sun : C.muted, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer" });
  const chip = (on: boolean): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", background: on ? C.surface2 : "transparent", color: C.text, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer", textAlign: "left" });
  const btn = (bg: string, fg: string): React.CSSProperties => ({ padding: "9px 14px", background: bg, color: fg, border: bg === "transparent" ? `1px solid ${C.line}` : "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", width: "100%" });
  const field: React.CSSProperties = { width: "100%", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 13 };

  const hint: Record<Tool, string> = {
    floors: "Drag to paint floors. Touching squares join into one room; walls appear where floor meets rock.",
    doors: "Click near a wall line or doorway to place the chosen door. Click it again to remove it.",
    furniture: "Click a floor square to place. Click the same piece again to turn it (or remove it if it doesn't turn).",
    labels: "Type a label, then click a square. Click a label to remove it. A labelled room is not auto-numbered.",
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 12 }}>
          <canvas
            ref={canvasRef} width={1000} height={1000}
            onPointerDown={onDown} onPointerMove={onMove}
            onPointerUp={() => { painting.current = false; }} onPointerLeave={() => { painting.current = false; }}
            style={{ display: "block", width: "min(560px, 86vw)", height: "auto", aspectRatio: "1 / 1", borderRadius: 8, background: "#0e0b08", cursor: "crosshair", touchAction: "none" }}
          />
          <p style={{ color: C.muted, fontSize: 12, margin: "8px 2px 0", maxWidth: 560 }}>{hint[tool]}</p>
          <p style={{ color: C.muted, fontSize: 12, margin: "4px 2px 0" }}>
            {n}&times;{n} grid, 1 square = {fps} ft &middot; {n * fps}&times;{n * fps} ft across &middot;{" "}
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved" : ""}
          </p>
        </div>

        <div style={{ width: 290, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 16 }}>
          <label style={{ ...label, marginTop: 0 }}>Level</label>
          <div style={{ display: "flex", gap: 6 }}>{Array.from({ length: LEVELS }, (_, l) => <button key={l} type="button" onClick={() => setLevel(l)} style={seg(level === l)}>{l + 1}</button>)}</div>

          <label style={label}>Tool</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {(["floors", "doors", "furniture", "labels"] as Tool[]).map((t) => (
              <button key={t} type="button" onClick={() => setTool(t)} style={seg(tool === t)}>{t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>

          {tool === "floors" && (
            <>
              <label style={label}>Floor</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {CELL_TYPES.map((t, i) => (
                  <button key={t.key} type="button" onClick={() => setBrush({ kind: "builtin", idx: i })} style={chip(brush.kind === "builtin" && brush.idx === i)}>
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
                      <button key={t.id} type="button" onClick={() => setBrush({ kind: "custom", tileId: t.id })} style={chip(brush.kind === "custom" && brush.tileId === t.id)}>
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
            </>
          )}

          {tool === "doors" && (
            <>
              <label style={label}>Door</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {DOOR_KINDS.map((d) => <button key={d.key} type="button" onClick={() => setDoor(d.key)} style={chip(door === d.key)}>{d.label}</button>)}
              </div>
            </>
          )}

          {tool === "furniture" && (
            <>
              <label style={label}>Piece</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 340, overflowY: "auto" }}>
                {FEATURES.map((f) => <button key={f.key} type="button" onClick={() => setFeature(f.key)} style={chip(feature === f.key)}>{f.label}</button>)}
                <button type="button" onClick={() => setFeature("remove")} style={{ ...chip(feature === "remove"), color: C.muted }}>Remove</button>
              </div>
            </>
          )}

          {tool === "labels" && (
            <>
              <label style={label}>Label text</label>
              <input value={labelText} onChange={(e) => setLabelText(e.target.value.slice(0, 40))} placeholder="A, 12, Throne room" style={field} />
            </>
          )}

          <label style={label}>Map title</label>
          <input value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value.slice(0, 80) }))} placeholder="The Sunken Chapel" style={field} />
          <label style={label}>This level&apos;s name</label>
          <input value={meta.levelNames[level] || ""} onChange={(e) => setMeta((m) => ({ ...m, levelNames: m.levelNames.map((x, i) => (i === level ? e.target.value.slice(0, 60) : x)) }))} placeholder={`Level ${level + 1}`} style={field} />
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, color: C.text, fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={meta.autoNumber} onChange={(e) => setMeta((m) => ({ ...m, autoNumber: e.target.checked }))} style={{ accentColor: C.sun }} />
            Number the rooms automatically
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, color: C.text, fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={meta.grid} onChange={(e) => setMeta((m) => ({ ...m, grid: e.target.checked }))} style={{ accentColor: C.sun }} />
            Show the grid on the floor
          </label>

          <label style={label}>Grid size</label>
          <div style={{ display: "flex", gap: 6 }}>{SIZES.map((s) => <button key={s} type="button" onClick={() => changeSize(s)} style={seg(n === s)}>{s}</button>)}</div>
          <label style={label}>Feet per square</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="number" min={1} max={100} step={1} value={fps}
              onChange={(e) => setFps(Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))))}
              style={{ ...field, width: 80 }} />
            <span style={{ color: C.muted, fontSize: 12 }}>ft / square</span>
            <button type="button" onClick={() => setFps(feetPerSquare(n))} style={{ marginLeft: "auto", padding: "6px 9px", background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12, cursor: "pointer" }}>Default ({feetPerSquare(n)})</button>
          </div>

          <div style={{ marginTop: 16 }}><button type="button" onClick={saveImage} style={btn(C.sun, "#1b1712")}>Save map image</button></div>
          <div style={{ marginTop: 8 }}><button type="button" onClick={doUndo} style={btn("transparent", C.text)}>Undo (Ctrl+Z)</button></div>
          <div style={{ marginTop: 8 }}><button type="button" onClick={clearLevel} style={btn("transparent", C.muted)}>Clear this level</button></div>
          {msg && <p role="status" style={{ color: C.warn, fontSize: 12, marginTop: 12 }}>{msg}</p>}
        </div>
      </div>

      <div style={{ marginTop: 20, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 12 }}>
        <div style={{ fontSize: 13, color: C.muted, margin: "0 2px 8px" }}>The finished map. This is exactly what Save map image produces, at a larger size.</div>
        <canvas ref={previewRef} style={{ display: "block", width: "100%", maxWidth: 1100, height: "auto", borderRadius: 6 }} />
      </div>

      <div style={{ marginTop: 20 }}>
        <TileLibrary scope="dungeon" onChange={setTiles} />
      </div>
    </div>
  );
}
