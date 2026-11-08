"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import { CELL_TYPES, SIZES } from "@/lib/dungeon/render";
import {
  DOOR_KINDS, type DoorKind, type MapElement, type GridLook,
  renderClassic, layoutFor, layoutBare, contentBounds, edgeKey, isStructure, drawElement, elementBox, hitElement, snapElement, drawTopGrid,
  type Layout, type RenderInput,
} from "@/lib/dungeon/classic";
import {
  PIECES, MAX_ELEMENTS, MAX_SIGHT_WALLS, PAINT_STYLES, blankMap, fromRow, toRow, fromDungeonRow, resizeMap, newId, levelSig, piecesOverImage,
  type BattleMap, type BattleMapSummary, type MapKind, type PaintOverlay, type SightWall,
} from "@/lib/dungeon/battle";
import TileLibrary from "./TileLibrary";
import MapUpload, { type UploadDest } from "@/components/map-upload";
import type { CustomTile } from "@/lib/tiles/custom";
import { openTabletop, tabletopUrl } from "@/lib/tabletop/open";

// The Battle maps tab (2026-11-06). Many named maps per campaign, indoor or outdoor, drawn in the
// adventure-book style by lib/dungeon/classic. The GM edits the finished map directly: what is on the
// canvas is what saves and what exports.
//
// Tools:
//   Select   click a piece to select it, drag to move (snaps to the grid; hold Alt to place freely).
//            The panel turns it, resizes it, renames a label, duplicates, deletes and restacks it.
//   Place    pick a piece (trees, rocks, tents, furniture, stairs, text labels...) and click to drop it.
//   Terrain  brush, rectangle or fill, with any terrain or custom tile. Erase returns a square to rock
//            (indoor) or to the map's ground (outdoor).
//   Doors    click near a wall line to set the chosen door. Click a door to select it: change its kind,
//            move it to another side of its square (or press R to turn it round the square), or remove it.
//   Sight walls (Phase 5j)  invisible straight walls at any angle, drawn over the map (usually an
//            uploaded image, whose painted walls the grid knows nothing about). Click to start, click to
//            add each corner, double-click, Enter or Esc to finish. Points snap to a quarter square and to
//            the ends of walls already drawn (hold Alt for free). Erase removes the wall clicked. They block
//            line of sight on the tabletop and are never drawn there or in the saved image.
// Images (Phase 5j): "Upload a map image" makes a new map from a picture (components/map-upload, the
// same dialog the tabletop uses); "Use my own image" lays a picture over the level being edited, lined
// up with its grid.
// Keys: Ctrl+Z undo, Delete removes, Ctrl+D duplicates, arrows nudge (Alt: a tenth of a square),
// R turns 90 degrees (Shift+R back), [ and ] turn 15 degrees, + and - resize, Esc lets go. With a door
// selected: R moves it to the next side clockwise (Shift+R the other way), Delete removes it.
// Grid: the book grid (under the walls, any colour) and a separate black battle grid over everything.
//
// Painted overlay (Gemini): "Paint this level" sends a plan of the level (the whole grid, no title,
// numbers, labels or grid) to /api/battle-map/paint and lays the painting back over the same square. By
// default the real walls, doors, numbers and grids stay drawn on top, so the structure is always exactly
// what the GM designed even where the painting drifts; the pieces are left to the painting. Any change to
// the level after painting marks the painting out of date.
//
// Saved to battle_maps (p104), one row per map. The first time a campaign with no maps opens the tab, its
// old dungeon_maps row (if anything is painted on it) is copied into a first map; the old row is left as
// it was.

type Tool = "select" | "place" | "terrain" | "doors" | "walls";
type Pt = { x: number; y: number };
const WALL_COLOR = "#d24bd8";
const WALL_NEAR = 0.3;                     // squares: how close a click must be to a wall end or a wall
// Distance from point p to the wall w, in squares.
function wallDist(w: SightWall, p: Pt): number {
  const [ax, ay, bx, by] = w, dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len)) : 0;
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
}
type Side = "top" | "right" | "bottom" | "left";
type DoorSel = { r: number; c: number; side: Side };         // a door, named by the square it belongs to
const SIDES: Side[] = ["top", "right", "bottom", "left"];
const SIDE_LABEL: Record<Side, string> = { top: "Top", right: "Right", bottom: "Bottom", left: "Left" };
// The edge key for one side of square (r, c), or null on the outside edge of the grid's bottom or right.
function doorKey(n: number, r: number, c: number, side: Side): string | null {
  if (r < 0 || c < 0 || r >= n || c >= n) return null;
  if (side === "top") return edgeKey(r * n + c, "h");
  if (side === "left") return edgeKey(r * n + c, "v");
  if (side === "bottom") return r + 1 < n ? edgeKey((r + 1) * n + c, "h") : null;
  return c + 1 < n ? edgeKey(r * n + c + 1, "v") : null;
}
type PaintMode = "brush" | "rect" | "fill";
type Brush = { kind: "builtin"; idx: number } | { kind: "custom"; tileId: string };
type Status = "loading" | "ready" | "empty" | "migration" | "error";

const BRUSHES = [1, 2, 3, 5, 9];
const UNDO_DEPTH = 60;
const ZOOMS = [1, 1.5, 2, 3];
const editCell = (n: number) => Math.max(12, Math.min(48, Math.round(1200 / n)));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "map";
const SELECT_COLOR = "#d9a43a";

function cloneMap(m: BattleMap): BattleMap {
  return {
    ...m,
    levels: m.levels.map((a) => a.slice()),
    custom: m.custom.map((o) => ({ ...o })),
    doors: m.doors.map((o) => ({ ...o })),
    elements: m.elements.map((a) => a.map((e) => ({ ...e }))),
    meta: { ...m.meta, levelNames: [...m.meta.levelNames], grid: { ...m.meta.grid }, topGrid: { ...m.meta.topGrid }, overlays: m.meta.overlays.map((o) => (o ? { ...o } : null)),
      sightWalls: m.meta.sightWalls.map((a) => a.map((w) => [...w] as SightWall)) },
  };
}

const missingTable = (msg: string | undefined) => !!msg && /battle_maps/.test(msg) && /(does not exist|not find|schema cache)/i.test(msg);

export default function BattleMapCreator({ campaignId }: { campaignId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<Status>("loading");
  const [maps, setMaps] = useState<BattleMapSummary[]>([]);
  const [doc, setDoc] = useState<BattleMap | null>(null);
  const [level, setLevel] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [paintMode, setPaintMode] = useState<PaintMode>("brush");
  const [brush, setBrush] = useState<Brush>({ kind: "builtin", idx: 2 });
  const [brushSize, setBrushSize] = useState(1);
  const [door, setDoor] = useState<DoorKind>("door");
  const [piece, setPiece] = useState<string>("tree");
  const [labelText, setLabelText] = useState("A");
  const [selId, setSelId] = useState<string | null>(null);
  const [selDoor, setSelDoor] = useState<DoorSel | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tiles, setTiles] = useState<CustomTile[]>([]);
  const [imgTick, setImgTick] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<MapKind>("outdoor");
  const [wallMode, setWallMode] = useState<"draw" | "erase">("draw");
  const [wallStart, setWallStart] = useState<Pt | null>(null);   // the open end of the wall being drawn
  const [upload, setUpload] = useState<UploadDest | null>(null);
  const hoverAlt = useRef(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const work = useRef<BattleMap | null>(null);             // in-progress terrain stroke, committed on pointer up
  const drag = useRef<{ id: string; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null);
  const stroke = useRef<{ r0: number; c0: number; r1: number; c1: number } | null>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const undo = useRef<BattleMap[]>([]);
  const dirty = useRef(false);
  const docRef = useRef<BattleMap | null>(null);
  const tileImgs = useRef<Map<string, HTMLImageElement>>(new Map());
  const paintImgs = useRef<Map<string, HTMLImageElement | "loading" | "failed">>(new Map());
  const [painting, setPainting] = useState(false);
  const [paintStyle, setPaintStyle] = useState("fantasy");
  const [paintNote, setPaintNote] = useState("");
  const raf = useRef<{ base: boolean; id: number | null }>({ base: false, id: null });
  docRef.current = doc;

  const tileColors = useMemo(() => new Map(tiles.map((t) => [t.id, t.color])), [tiles]);
  const outdoor = doc?.kind === "outdoor";

  // ---- painted overlays: fetched as blobs so the canvas stays exportable ----
  const overlayUrls = useMemo(() => (doc ? doc.meta.overlays.map((o) => o?.url).filter((u): u is string => !!u) : []), [doc]);
  useEffect(() => {
    for (const url of overlayUrls) {
      if (paintImgs.current.has(url)) continue;
      paintImgs.current.set(url, "loading");
      (async () => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(String(resp.status));
          const obj = URL.createObjectURL(await resp.blob());
          const img = new Image();
          img.onload = () => { paintImgs.current.set(url, img); setImgTick((v) => v + 1); };
          img.onerror = () => { paintImgs.current.set(url, "failed"); setImgTick((v) => v + 1); };
          img.src = obj;
        } catch { paintImgs.current.set(url, "failed"); setImgTick((v) => v + 1); }
      })();
    }
  }, [overlayUrls]);
  const overlayFor = useCallback((m: BattleMap, lv: number): { o: PaintOverlay; img: HTMLImageElement } | null => {
    const o = m.meta.overlays[lv]; if (!o || !o.show) return null;
    const img = paintImgs.current.get(o.url);
    return img && typeof img !== "string" ? { o, img } : null;
  }, []);

  // ---- custom tile images (untainted blobs so the canvas can export) ----
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

  // ---- loading ----
  const listMaps = useCallback(async (): Promise<BattleMapSummary[] | null> => {
    const { data, error } = await supabase.from("battle_maps").select("id, name, kind, updated_at").eq("campaign_id", campaignId).order("created_at", { ascending: true });
    if (error) {
      if (missingTable(error.message)) setStatus("migration");
      else { setStatus("error"); setMsg(`Could not load maps: ${error.message}`); }
      return null;
    }
    return (data ?? []).map((r) => ({ id: r.id as string, name: (r.name as string) || "Untitled map", kind: r.kind === "outdoor" ? "outdoor" : "indoor", updated_at: (r.updated_at as string) ?? null }));
  }, [supabase, campaignId]);

  const openMap = useCallback(async (id: string) => {
    const { data, error } = await supabase.from("battle_maps").select("id, name, kind, n, feet_per_square, levels, custom_cells, doors, elements, meta").eq("id", id).maybeSingle();
    if (error || !data) { setMsg(`Could not open that map: ${error?.message ?? "not found"}`); return; }
    undo.current = []; dirty.current = false; work.current = null; drag.current = null; setSelDoor(null);
    setSelId(null); setLevel(0); setDoc(fromRow(data as Parameters<typeof fromRow>[0])); setStatus("ready"); setSaveState("idle");
    try { localStorage.setItem(`battlemap:${campaignId}`, id); } catch { /* per-viewer convenience only */ }
  }, [supabase, campaignId]);

  // Copy the campaign's old dungeon_maps row into a first map, once.
  const carryOver = useCallback(async (): Promise<boolean> => {
    const { data } = await supabase.from("dungeon_maps").select("levels, feet_per_square, custom_cells").eq("campaign_id", campaignId).maybeSingle();
    if (!data) return false;
    const { data: extra } = await supabase.from("dungeon_maps").select("marks, meta").eq("campaign_id", campaignId).maybeSingle();
    const m = fromDungeonRow({ ...(data as object), ...((extra as object | null) ?? {}) });
    if (!m) return false;
    const { error } = await supabase.from("battle_maps").insert({ campaign_id: campaignId, ...toRow({ ...m, id: "" }) });
    if (error) { setMsg(`Your old dungeon map could not be copied over: ${error.message}`); return false; }
    return true;
  }, [supabase, campaignId]);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!campaignId) { setStatus("empty"); return; }
      let list = await listMaps(); if (off || !list) return;
      if (list.length === 0 && (await carryOver())) { list = await listMaps(); if (off || !list) return; }
      setMaps(list);
      if (list.length === 0) { setStatus("empty"); setCreating(true); return; }
      let pick = list[0].id;
      try { const last = localStorage.getItem(`battlemap:${campaignId}`); if (last && list.some((m) => m.id === last)) pick = last; } catch { /* ignore */ }
      await openMap(pick);
    })();
    return () => { off = true; };
  }, [campaignId, listMaps, carryOver, openMap]);

  // ---- saving ----
  const saveNow = useCallback(async (m: BattleMap) => {
    setSaveState("saving");
    const { error } = await supabase.from("battle_maps").update(toRow(m)).eq("id", m.id);
    if (error) { setSaveState("error"); setMsg(`Not saved: ${error.message}`); return false; }
    dirty.current = false; setSaveState("saved");
    setMaps((prev) => prev.map((x) => (x.id === m.id ? { ...x, name: m.name, kind: m.kind, updated_at: new Date().toISOString() } : x)));
    return true;
  }, [supabase]);

  useEffect(() => {
    if (!doc || !dirty.current) return;
    setSaveState("saving");
    const t = setTimeout(() => { void saveNow(doc); }, 800);
    return () => clearTimeout(t);
  }, [doc, saveNow]);

  const flush = useCallback(async () => { const m = docRef.current; if (m && dirty.current) await saveNow(m); }, [saveNow]);

  // ---- editing ----
  const pushUndo = useCallback(() => {
    const m = docRef.current; if (!m) return;
    undo.current.push(cloneMap(m)); if (undo.current.length > UNDO_DEPTH) undo.current.shift();
  }, []);
  const mutate = useCallback((fn: (m: BattleMap) => void, withUndo = true) => {
    const m = docRef.current; if (!m) return;
    if (withUndo) pushUndo();
    const next = cloneMap(m); fn(next); dirty.current = true; setDoc(next);
  }, [pushUndo]);
  const doUndo = useCallback(() => {
    const s = undo.current.pop(); if (!s) return;
    dirty.current = true; setDoc(s);
    if (selId && !s.elements[level].some((e) => e.id === selId)) setSelId(null);
  }, [selId, level]);

  const selected = useMemo(() => (doc && selId ? doc.elements[level].find((e) => e.id === selId) ?? null : null), [doc, selId, level]);
  const updateSel = useCallback((patch: Partial<MapElement>, withUndo = true) => {
    if (!selId) return;
    mutate((m) => { m.elements[level] = m.elements[level].map((e) => (e.id === selId ? { ...e, ...patch } : e)); }, withUndo);
  }, [selId, level, mutate]);

  // ---- drawing ----
  const inputFor = useCallback((m: BattleMap, lv: number, drawEls: boolean): RenderInput => {
    const ov = overlayFor(m, lv);
    return {
      n: m.n, grid: m.levels[lv], custom: m.custom[lv], tileImages: tileImgs.current, tileColors,
      marks: { features: {}, doors: m.doors[lv], labels: {} },
      meta: { title: m.meta.title, levelNames: m.meta.levelNames, autoNumber: m.meta.autoNumber, grid: m.meta.showGrid },
      level: lv, feetPerSquare: m.feetPerSquare, outdoor: m.kind === "outdoor", ground: m.meta.ground, gridLook: m.meta.grid,
      elements: m.elements[lv], drawElements: drawEls, topGrid: m.meta.topGrid.show ? m.meta.topGrid.opacity : null,
      overlay: ov ? { img: ov.img, opacity: ov.o.opacity, inkOnTop: ov.o.inkOnTop } : null,
      piecesHidden: !!ov && !piecesOverImage(ov.o),
    };
  }, [tileColors, overlayFor]);

  const paint = useCallback(() => {
    const cv = canvasRef.current, base = baseRef.current, L = layoutRef.current, m = work.current ?? docRef.current;
    if (!cv || !base || !L || !m) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    if (cv.width !== base.width || cv.height !== base.height) { cv.width = base.width; cv.height = base.height; }
    ctx.drawImage(base, 0, 0);
    const S = L.cell, gx = L.ox, gy = L.oy;
    const d = drag.current;
    const ovNow = overlayFor(m, level), hidePieces = !!ovNow && !piecesOverImage(ovNow.o);
    for (const el of m.elements[level]) {
      if (hidePieces && el.k !== "label") continue;      // the painting shows them
      drawElement(ctx, d && d.id === el.id ? { ...el, x: d.x, y: d.y } : el, gx, gy, S);
    }
    if (m.meta.topGrid.show) drawTopGrid(ctx, gx, gy, S, { r0: 0, c0: 0, rows: m.n, cols: m.n }, m.meta.topGrid.opacity);
    const dk = selDoor ? doorKey(m.n, selDoor.r, selDoor.c, selDoor.side) : null;
    if (tool === "doors" && selDoor && dk && m.doors[level][dk]) {
      const { r, c, side } = selDoor;
      const x0 = gx + (side === "right" ? c + 1 : c) * S, y0 = gy + (side === "bottom" ? r + 1 : r) * S;
      const horiz = side === "top" || side === "bottom", pad = Math.max(5, S * 0.18);
      ctx.save(); ctx.setLineDash([6, 4]);
      const rect = horiz ? [x0 - 3, y0 - pad, S + 6, pad * 2] : [x0 - pad, y0 - 3, pad * 2, S + 6];
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.strokeRect(rect[0], rect[1], rect[2], rect[3]);
      ctx.lineWidth = 2; ctx.strokeStyle = SELECT_COLOR; ctx.strokeRect(rect[0], rect[1], rect[2], rect[3]);
      // a dot in the square the door belongs to, so it is clear which way it will turn
      ctx.setLineDash([]); ctx.fillStyle = SELECT_COLOR; ctx.beginPath(); ctx.arc(gx + (c + 0.5) * S, gy + (r + 0.5) * S, Math.max(3, S * 0.08), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    const sel = selId ? m.elements[level].find((e) => e.id === selId) : null;
    if (sel) {
      const e = d && d.id === sel.id ? { ...sel, x: d.x, y: d.y } : sel, { w, h } = elementBox(e.k, e.text);
      const bw = Math.max(0.6, w * e.s) * S, bh = Math.max(0.6, h * e.s) * S;
      ctx.save(); ctx.translate(gx + e.x * S, gy + e.y * S); ctx.rotate((e.rot * Math.PI) / 180);
      ctx.setLineDash([6, 4]); ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.strokeRect(-bw / 2 - 3, -bh / 2 - 3, bw + 6, bh + 6);
      ctx.lineWidth = 2; ctx.strokeStyle = SELECT_COLOR; ctx.strokeRect(-bw / 2 - 3, -bh / 2 - 3, bw + 6, bh + 6);
      ctx.restore();
    }
    const hv = hover.current;
    // sight walls: bold while the tool is on, a faint dashed line otherwise (never in the saved image)
    const walls = m.meta.sightWalls[level];
    if (walls.length || (tool === "walls" && wallStart)) {
      const on = tool === "walls";
      const gone = on && wallMode === "erase" && hv ? walls.find((w) => wallDist(w, hv) <= WALL_NEAR) ?? null : null;
      ctx.save(); ctx.lineCap = "round";
      const line = (w: SightWall) => { ctx.beginPath(); ctx.moveTo(gx + w[0] * S, gy + w[1] * S); ctx.lineTo(gx + w[2] * S, gy + w[3] * S); ctx.stroke(); };
      if (on) {
        ctx.lineWidth = 5; ctx.strokeStyle = "rgba(255,255,255,0.75)"; for (const w of walls) line(w);
        ctx.lineWidth = 3; ctx.strokeStyle = WALL_COLOR; for (const w of walls) line(w);
        ctx.fillStyle = WALL_COLOR;
        for (const w of walls) for (const [x, y] of [[w[0], w[1]], [w[2], w[3]]]) { ctx.beginPath(); ctx.arc(gx + x * S, gy + y * S, 3, 0, Math.PI * 2); ctx.fill(); }
        if (gone) { ctx.lineWidth = 5; ctx.strokeStyle = "#e0463c"; line(gone); }
      } else {
        ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(210,75,216,0.7)"; for (const w of walls) line(w);
      }
      if (on && wallMode === "draw" && wallStart) {
        const to = hv ? snapWall(m, hv, hoverAlt.current) : null;
        ctx.setLineDash([6, 4]); ctx.lineWidth = 2.5; ctx.strokeStyle = WALL_COLOR;
        if (to) line([wallStart.x, wallStart.y, to.x, to.y]);
        ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(gx + wallStart.x * S, gy + wallStart.y * S, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (tool === "walls" && wallMode === "draw" && hv && !wallStart) {
      const to = snapWall(m, hv, hoverAlt.current);
      ctx.save(); ctx.fillStyle = WALL_COLOR; ctx.beginPath(); ctx.arc(gx + to.x * S, gy + to.y * S, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (tool === "place" && hv && !drag.current) {
      const def = PIECES.find((p) => p.key === piece);
      const ghost: MapElement = { id: "ghost", k: piece, x: hv.x, y: hv.y, rot: 0, s: def?.s ?? 1, text: piece === "label" ? labelText.trim() || "?" : undefined };
      const p = snapElement(ghost, hv.x, hv.y);
      ctx.save(); ctx.globalAlpha = 0.5; drawElement(ctx, { ...ghost, ...p }, gx, gy, S); ctx.restore();
    }
    const st = stroke.current;
    if (st) {
      const r0 = Math.min(st.r0, st.r1), r1 = Math.max(st.r0, st.r1), c0 = Math.min(st.c0, st.c1), c1 = Math.max(st.c0, st.c1);
      ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = SELECT_COLOR;
      ctx.strokeRect(gx + c0 * S, gy + r0 * S, (c1 - c0 + 1) * S, (r1 - r0 + 1) * S); ctx.restore();
    }
    if (tool === "terrain" && paintMode === "brush" && hv && !st) {
      const half = Math.floor(brushSize / 2), r = Math.floor(hv.y) - half, c = Math.floor(hv.x) - half;
      ctx.save(); ctx.lineWidth = 1.5; ctx.strokeStyle = SELECT_COLOR; ctx.strokeRect(gx + c * S, gy + r * S, brushSize * S, brushSize * S); ctx.restore();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, selId, selDoor, tool, piece, labelText, paintMode, brushSize, wallMode, wallStart]);

  const renderBase = useCallback(() => {
    const m = work.current ?? docRef.current; if (!m) return;
    const L = layoutFor(editCell(m.n), { r0: 0, c0: 0, rows: m.n, cols: m.n });
    const base = baseRef.current ?? (baseRef.current = document.createElement("canvas"));
    if (base.width !== L.width || base.height !== L.height) { base.width = L.width; base.height = L.height; }
    const ctx = base.getContext("2d"); if (!ctx) return;
    renderClassic(ctx, inputFor(m, level, false), L);
    layoutRef.current = L;
  }, [inputFor, level]);

  // At most one redraw per animation frame. withBase: the map underneath changed too (slow on big
  // grids), otherwise only the pieces and highlights are drawn again over the cached map.
  const paintRef = useRef(paint), renderBaseRef = useRef(renderBase);
  paintRef.current = paint; renderBaseRef.current = renderBase;
  const request = useCallback((withBase: boolean) => {
    raf.current.base = raf.current.base || withBase;
    if (raf.current.id !== null) return;
    raf.current.id = requestAnimationFrame(() => {
      const b = raf.current.base; raf.current = { base: false, id: null };
      if (b) renderBaseRef.current();
      paintRef.current();
    });
  }, []);

  useEffect(() => { request(true); }, [doc, level, imgTick, tileColors, creating, request]);
  useEffect(() => { request(false); }, [selId, selDoor, tool, piece, labelText, paintMode, brushSize, wallMode, wallStart, request]);
  useEffect(() => () => { if (raf.current.id !== null) cancelAnimationFrame(raf.current.id); }, []);

  // ---- pointer ----
  const toSquares = (e: React.PointerEvent) => {
    const cv = canvasRef.current, L = layoutRef.current; if (!cv || !L) return null;
    const rect = cv.getBoundingClientRect();
    const px = ((e.clientX - rect.left) * cv.width) / rect.width, py = ((e.clientY - rect.top) * cv.height) / rect.height;
    return { x: (px - L.ox) / L.cell, y: (py - L.oy) / L.cell };
  };

  const structureAt = (m: BattleMap, r: number, c: number) => {
    if (r < 0 || c < 0 || r >= m.n || c >= m.n) return false;
    const i = r * m.n + c;
    return m.kind === "outdoor" ? isStructure(m.levels[level][i]) : m.levels[level][i] > 0 || !!m.custom[level][String(i)];
  };

  const brushCells = (n: number, row: number, col: number): number[] => {
    const half = Math.floor(brushSize / 2), out: number[] = [];
    for (let dr = 0; dr < brushSize; dr++) for (let dc = 0; dc < brushSize; dc++) { const r = row - half + dr, c = col - half + dc; if (r >= 0 && c >= 0 && r < n && c < n) out.push(r * n + c); }
    return out;
  };
  const applyBrush = (m: BattleMap, cells: number[]) => {
    const g = m.levels[level], cu = m.custom[level];
    for (const i of cells) {
      if (brush.kind === "builtin") { g[i] = brush.idx; delete cu[String(i)]; }
      else { g[i] = 0; cu[String(i)] = brush.tileId; }
    }
  };
  const floodFill = (m: BattleMap, row: number, col: number) => {
    const n = m.n, g = m.levels[level], cu = m.custom[level];
    const keyOf = (i: number) => cu[String(i)] ?? `#${g[i]}`;
    const target = keyOf(row * n + col);
    const want = brush.kind === "builtin" ? `#${brush.idx}` : brush.tileId;
    if (target === want) return 0;
    const seen = new Uint8Array(n * n), st = [row * n + col], cells: number[] = []; seen[row * n + col] = 1;
    while (st.length) {
      const i = st.pop() as number; cells.push(i);
      const r = (i / n) | 0, c = i % n;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r2 = r + dr, c2 = c + dc; if (r2 < 0 || c2 < 0 || r2 >= n || c2 >= n) continue;
        const j = r2 * n + c2; if (!seen[j] && keyOf(j) === target) { seen[j] = 1; st.push(j); }
      }
    }
    applyBrush(m, cells);
    return cells.length;
  };

  const clickDoor = (m: BattleMap, x: number, y: number) => {
    const row = Math.floor(y), col = Math.floor(x), fx = x - col, fy = y - row, n = m.n;
    if (row < 0 || col < 0 || row >= n || col >= n) return;
    const near: { s: Side; v: number }[] = [{ s: "top", v: fy }, { s: "bottom", v: 1 - fy }, { s: "left", v: fx }, { s: "right", v: 1 - fx }];
    const side = near.sort((a, b) => a.v - b.v)[0].s;
    const key = doorKey(n, row, col, side);
    if (!key) return;
    const OPP: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
    const other: [number, number] = side === "top" ? [row - 1, col] : side === "bottom" ? [row + 1, col] : side === "left" ? [row, col - 1] : [row, col + 1];
    // the door belongs to the floor square on its side of the wall (the clicked one when both are floor)
    const anchor: DoorSel | null = structureAt(m, row, col) ? { r: row, c: col, side }
      : structureAt(m, other[0], other[1]) ? { r: other[0], c: other[1], side: OPP[side] } : null;
    const existing = m.doors[level][key];
    if (existing) { setSelDoor(anchor ?? { r: row, c: col, side }); setDoor(existing); setMsg(null); return; }
    if (!anchor) {
      setMsg(m.kind === "outdoor" ? "Doors go in the walls of a building, ruin or cave. Paint one with an indoor terrain first." : "Doors go on a wall or doorway next to a floor square.");
      setSelDoor(null); return;
    }
    setMsg(null);
    mutate((d) => { d.doors[level][key] = door; });
    setSelDoor(anchor);
  };

  // ---- the selected door ----
  const selDoorKey = doc && selDoor ? doorKey(doc.n, selDoor.r, selDoor.c, selDoor.side) : null;
  const selDoorKind = doc && selDoorKey ? doc.doors[level][selDoorKey] ?? null : null;
  const moveDoor = useCallback((to: Side) => {
    const m = docRef.current; if (!m || !selDoor) return;
    const from = doorKey(m.n, selDoor.r, selDoor.c, selDoor.side), dest = doorKey(m.n, selDoor.r, selDoor.c, to);
    if (!from || !dest || from === dest) return;
    const kind = m.doors[level][from]; if (!kind) return;
    if (m.doors[level][dest]) { setMsg(`That side already has a door. Remove it first.`); return; }
    setMsg(null);
    mutate((d) => { delete d.doors[level][from]; d.doors[level][dest] = kind; });
    setSelDoor({ ...selDoor, side: to });
  }, [selDoor, level, mutate]);
  const turnDoor = useCallback((clockwise: boolean) => {
    const m = docRef.current; if (!m || !selDoor) return;
    const at = SIDES.indexOf(selDoor.side);
    for (let k = 1; k < 4; k++) {
      const side = SIDES[(at + (clockwise ? k : 4 - k)) % 4], key = doorKey(m.n, selDoor.r, selDoor.c, side);
      if (key && !m.doors[level][key]) { moveDoor(side); return; }
    }
    setMsg("Every other side of this square already has a door.");
  }, [selDoor, level, moveDoor]);
  const removeDoor = useCallback(() => {
    const m = docRef.current; if (!m || !selDoor) return;
    const key = doorKey(m.n, selDoor.r, selDoor.c, selDoor.side); if (!key || !m.doors[level][key]) return;
    mutate((d) => { delete d.doors[level][key]; }); setSelDoor(null);
  }, [selDoor, level, mutate]);
  const setDoorKind = (k: DoorKind) => {
    setDoor(k);
    if (selDoorKey && selDoorKind && selDoorKind !== k) mutate((d) => { d.doors[level][selDoorKey] = k; });
  };

  const topHit = (m: BattleMap, x: number, y: number): MapElement | null => {
    const arr = m.elements[level];
    for (let k = arr.length - 1; k >= 0; k--) if (hitElement(arr[k], x, y)) return arr[k];
    return null;
  };

  // ---- sight walls ----
  // A wall point: inside the grid, on the end of a wall already drawn when one is close (so walls join),
  // else on a quarter square; free (a twentieth) with Alt.
  function snapWall(m: BattleMap, p: Pt, free: boolean): Pt {
    const x = Math.max(0, Math.min(m.n, p.x)), y = Math.max(0, Math.min(m.n, p.y));
    let best: Pt | null = null, bd = WALL_NEAR;
    for (const w of m.meta.sightWalls[level]) for (const q of [{ x: w[0], y: w[1] }, { x: w[2], y: w[3] }]) {
      const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; }
    }
    if (best) return best;
    const k = free ? 20 : 4;
    return { x: Math.round(x * k) / k, y: Math.round(y * k) / k };
  }
  const finishWall = () => setWallStart(null);
  const clearWalls = () => {
    const m = docRef.current; if (!m || !m.meta.sightWalls[level].length) return;
    if (!window.confirm(`Remove all ${m.meta.sightWalls[level].length} sight walls on ${m.meta.levelNames[level] || `level ${level + 1}`}? Ctrl+Z brings them back while this page stays open.`)) return;
    mutate((d) => { d.meta.sightWalls[level] = []; }); setWallStart(null);
  };
  const clickWall = (m: BattleMap, p: Pt, free: boolean) => {
    if (wallMode === "erase") {
      const arr = m.meta.sightWalls[level];
      let at = -1, bd = WALL_NEAR;
      arr.forEach((w, i) => { const d = wallDist(w, p); if (d <= bd) { bd = d; at = i; } });
      if (at < 0) { setMsg("Click on a sight wall to remove it."); return; }
      setMsg(null); mutate((d) => { d.meta.sightWalls[level].splice(at, 1); });
      return;
    }
    const q = snapWall(m, p, free);
    if (!wallStart) { setMsg(null); setWallStart(q); return; }
    if (Math.hypot(q.x - wallStart.x, q.y - wallStart.y) < 0.01) { setWallStart(null); return; }   // the same point again ends it
    if (m.meta.sightWalls[level].length >= MAX_SIGHT_WALLS) { setMsg(`A level holds up to ${MAX_SIGHT_WALLS} sight walls. Join long straight runs into one wall.`); setWallStart(null); return; }
    setMsg(null);
    mutate((d) => { d.meta.sightWalls[level].push([wallStart.x, wallStart.y, q.x, q.y]); });
    setWallStart(q);
  };

  const onDown = (e: React.PointerEvent) => {
    const m = docRef.current, p = toSquares(e); if (!m || !p) return;
    if (tool === "walls") {
      if (e.button !== 0) return;
      // the double-click that ends a wall arrives as a second press first: let onDoubleClick handle it
      if (e.detail >= 2 && wallMode === "draw") return;
      clickWall(m, p, e.altKey); return;
    }
    const inside = p.x >= 0 && p.y >= 0 && p.x < m.n && p.y < m.n;
    const row = Math.floor(p.y), col = Math.floor(p.x);
    if (tool === "select") {
      const hit = topHit(m, p.x, p.y);
      setSelId(hit ? hit.id : null);
      if (hit) { drag.current = { id: hit.id, dx: p.x - hit.x, dy: p.y - hit.y, x: hit.x, y: hit.y, moved: false }; canvasRef.current?.setPointerCapture(e.pointerId); }
      request(false); return;
    }
    if (!inside) return;
    if (tool === "place") {
      if (m.elements[level].length >= MAX_ELEMENTS) { setMsg(`A level holds up to ${MAX_ELEMENTS} pieces.`); return; }
      if (piece === "label" && !labelText.trim()) { setMsg("Type the label text first."); return; }
      const def = PIECES.find((q) => q.key === piece);
      const el: MapElement = { id: newId(), k: piece, x: p.x, y: p.y, rot: 0, s: def?.s ?? 1 };
      if (piece === "label") el.text = labelText.trim().slice(0, 60);
      const at = e.altKey ? { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } : snapElement(el, p.x, p.y);
      setMsg(null);
      mutate((d) => { d.elements[level].push({ ...el, ...at }); });
      setSelId(el.id);
      return;
    }
    if (tool === "doors") { clickDoor(m, p.x, p.y); return; }
    // terrain
    pushUndo();
    if (paintMode === "fill") {
      const next = cloneMap(m); const count = floodFill(next, row, col);
      if (count) { dirty.current = true; setDoc(next); } else undo.current.pop();
      return;
    }
    work.current = cloneMap(m);
    canvasRef.current?.setPointerCapture(e.pointerId);
    if (paintMode === "rect") { stroke.current = { r0: row, c0: col, r1: row, c1: col }; request(false); return; }
    applyBrush(work.current, brushCells(m.n, row, col)); request(true);
  };

  const onMove = (e: React.PointerEvent) => {
    const m = docRef.current, p = toSquares(e); if (!m || !p) return;
    hover.current = p.x >= 0 && p.y >= 0 && p.x < m.n && p.y < m.n ? p : null;
    hoverAlt.current = e.altKey;
    if (tool === "walls") { if (p.x >= -0.5 && p.y >= -0.5 && p.x <= m.n + 0.5 && p.y <= m.n + 0.5) hover.current = p; request(false); return; }
    const d = drag.current;
    if (d) {
      const raw = { x: p.x - d.dx, y: p.y - d.dy };
      const el = m.elements[level].find((x) => x.id === d.id);
      const at = !el || e.altKey ? { x: Math.round(raw.x * 20) / 20, y: Math.round(raw.y * 20) / 20 } : snapElement(el, raw.x, raw.y);
      if (at.x !== d.x || at.y !== d.y) { d.x = Math.max(-1, Math.min(m.n + 1, at.x)); d.y = Math.max(-1, Math.min(m.n + 1, at.y)); d.moved = true; }
      request(false); return;
    }
    if (work.current && tool === "terrain") {
      const row = Math.max(0, Math.min(m.n - 1, Math.floor(p.y))), col = Math.max(0, Math.min(m.n - 1, Math.floor(p.x)));
      if (stroke.current) { stroke.current.r1 = row; stroke.current.c1 = col; request(false); }
      else { applyBrush(work.current, brushCells(m.n, row, col)); request(true); }
      return;
    }
    if (tool === "place" || tool === "terrain") request(false);
  };

  const onUp = () => {
    const d = drag.current;
    if (d) {
      drag.current = null;
      if (d.moved) mutate((m) => { m.elements[level] = m.elements[level].map((x) => (x.id === d.id ? { ...x, x: d.x, y: d.y } : x)); });
      else request(false);
      return;
    }
    const w = work.current;
    if (w) {
      const st = stroke.current;
      if (st) {
        const cells: number[] = [];
        for (let r = Math.min(st.r0, st.r1); r <= Math.max(st.r0, st.r1); r++) for (let c = Math.min(st.c0, st.c1); c <= Math.max(st.c0, st.c1); c++) cells.push(r * w.n + c);
        applyBrush(w, cells); stroke.current = null;
      }
      work.current = null; dirty.current = true; setDoc(w);
    }
  };
  const onLeave = () => { hover.current = null; if (!drag.current && !work.current) request(false); };

  // ---- selection actions ----
  const duplicateSel = useCallback(() => {
    if (!selected) return;
    const copy: MapElement = { ...selected, id: newId(), x: selected.x + 1, y: selected.y + 1 };
    mutate((m) => { m.elements[level].push(copy); }); setSelId(copy.id);
  }, [selected, level, mutate]);
  const deleteSel = useCallback(() => {
    if (!selId) return;
    mutate((m) => { m.elements[level] = m.elements[level].filter((e) => e.id !== selId); }); setSelId(null);
  }, [selId, level, mutate]);
  const restack = (front: boolean) => {
    if (!selected) return;
    mutate((m) => { const rest = m.elements[level].filter((e) => e.id !== selected.id); m.elements[level] = front ? [...rest, { ...selected }] : [{ ...selected }, ...rest]; });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (!docRef.current) return;
      const k = e.key, mod = e.ctrlKey || e.metaKey;
      if (mod && k.toLowerCase() === "z") { e.preventDefault(); doUndo(); return; }
      if (k === "Escape") { setSelId(null); setSelDoor(null); setWallStart(null); if (tool === "place") setTool("select"); return; }
      if (tool === "walls") { if (k === "Enter") setWallStart(null); return; }
      if (tool === "doors" && selDoor) {
        if (k === "Delete" || k === "Backspace") { e.preventDefault(); removeDoor(); return; }
        if (k.toLowerCase() === "r") { turnDoor(!e.shiftKey); return; }
        return;
      }
      if (!selected) return;
      if (mod && k.toLowerCase() === "d") { e.preventDefault(); duplicateSel(); return; }
      if (k === "Delete" || k === "Backspace") { e.preventDefault(); deleteSel(); return; }
      const step = e.altKey ? 0.1 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[k]) { e.preventDefault(); const [dx, dy] = moves[k]; updateSel({ x: Math.round((selected.x + dx) * 100) / 100, y: Math.round((selected.y + dy) * 100) / 100 }); return; }
      if (k.toLowerCase() === "r") { updateSel({ rot: (((selected.rot + (e.shiftKey ? -90 : 90)) % 360) + 360) % 360 }); return; }
      if (k === "[" || k === "]") { updateSel({ rot: (((selected.rot + (k === "]" ? 15 : -15)) % 360) + 360) % 360 }); return; }
      if (k === "+" || k === "=" || k === "-") { updateSel({ s: Math.max(0.25, Math.min(8, selected.s + (k === "-" ? -0.25 : 0.25))) }); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, selected, duplicateSel, deleteSel, updateSel, tool, selDoor, removeDoor, turnDoor]);

  // ---- map list actions ----
  const createMap = async (base?: BattleMap) => {
    const name = (base ? `${base.name} copy` : newName.trim()).slice(0, 80);
    if (!name) { setMsg("Give the map a name."); return; }
    await flush();
    const m = base ? { ...cloneMap(base), name } : blankMap("", name, newKind);
    if (!base) { m.meta.title = name; }
    const { data, error } = await supabase.from("battle_maps").insert({ campaign_id: campaignId, ...toRow(m) }).select("id").single();
    if (error || !data) { setMsg(`Could not create the map: ${error?.message ?? "no row returned"}`); return; }
    const id = (data as { id: string }).id;
    setMaps((prev) => [...prev, { id, name, kind: m.kind, updated_at: new Date().toISOString() }]);
    setCreating(false); setNewName(""); setMsg(null);
    await openMap(id);
  };

  const switchMap = async (id: string) => { if (id === doc?.id) return; await flush(); await openMap(id); };

  const deleteMap = async () => {
    if (!doc) return;
    if (!window.confirm(`Delete the map "${doc.name}" and everything on it? This cannot be undone.`)) return;
    const { error } = await supabase.from("battle_maps").delete().eq("id", doc.id);
    if (error) { setMsg(`Could not delete: ${error.message}`); return; }
    dirty.current = false;
    const rest = maps.filter((m) => m.id !== doc.id);
    setMaps(rest); setDoc(null);
    if (rest.length) await openMap(rest[0].id); else { setStatus("empty"); setCreating(true); }
  };

  const clearLevel = () => {
    if (!doc) return;
    if (!window.confirm(`Clear everything on ${doc.meta.levelNames[level] || `level ${level + 1}`}? Ctrl+Z brings it back while this page stays open.`)) return;
    mutate((m) => { m.levels[level] = m.levels[level].map(() => 0); m.custom[level] = {}; m.doors[level] = {}; m.elements[level] = []; m.meta.sightWalls[level] = []; });
    setSelId(null); setWallStart(null);
  };

  const changeSize = (newN: number) => {
    if (!doc || newN === doc.n) return;
    if (newN < doc.n && !window.confirm(`Shrink to ${newN} by ${newN}? Anything beyond square ${newN} is cut off (Ctrl+Z brings it back).`)) return;
    pushUndo(); dirty.current = true; setDoc(resizeMap(doc, newN));
  };

  // ---- export ----
  // ---- paint with Gemini ----
  const paintLevel = async () => {
    const m = docRef.current; if (!m || painting) return;
    const lv = level;
    if (!m.levels[lv].some((v) => v > 0) && !Object.keys(m.custom[lv]).length && !m.elements[lv].length && m.kind === "indoor") {
      setMsg("Draw something on this level first."); return;
    }
    // The plan: the whole grid, exact edges, no frame, title, numbers, labels, grids or painting.
    const cell = Math.max(8, Math.round(1536 / m.n));
    const L = layoutBare(cell, { r0: 0, c0: 0, rows: m.n, cols: m.n });
    const cv = document.createElement("canvas"); cv.width = L.width; cv.height = L.height;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    renderClassic(ctx, {
      ...inputFor(m, lv, true),
      meta: { title: "", levelNames: m.meta.levelNames, autoNumber: false, grid: false },
      elements: m.elements[lv].filter((e) => e.k !== "label"),
      topGrid: null, overlay: null, piecesHidden: false, bare: true,
    }, L);
    const sig = levelSig(m, lv), style = paintStyle;
    setPainting(true); setMsg(null);
    try {
      const resp = await fetch("/api/battle-map/paint", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, controlImage: cv.toDataURL("image/jpeg", 0.9), kind: m.kind, style, flavour: paintNote, feetPerSquare: m.feetPerSquare }),
      });
      const j = (await resp.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!resp.ok || !j.url) { setMsg(j.error || `Painting failed (${resp.status}).`); return; }
      const url = j.url;
      const cur = docRef.current;
      if (!cur || cur.id !== m.id) return;            // the GM switched maps while it painted
      const prev = cur.meta.overlays[lv];
      mutate((d) => {
        d.meta.overlays[lv] = { url, at: new Date().toISOString(), sig, style, show: true, opacity: prev?.opacity ?? 1, inkOnTop: prev?.inkOnTop ?? true, piecesOnTop: prev?.piecesOnTop ?? false };
      });
    } catch (e) {
      setMsg(`Painting failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPainting(false);
    }
  };
  const setOverlay = (patch: Partial<PaintOverlay>, withUndo = true) =>
    mutate((d) => { const o = d.meta.overlays[level]; if (o) d.meta.overlays[level] = { ...o, ...patch }; }, withUndo);

  const saveImage = () => {
    if (!doc) return;
    const n = doc.n, lv = level;
    let bounds = { r0: 0, c0: 0, rows: n, cols: n };
    if (doc.kind === "indoor") {
      const g = doc.levels[lv].slice();
      for (const el of doc.elements[lv]) { const r = Math.floor(el.y), c = Math.floor(el.x); if (r >= 0 && c >= 0 && r < n && c < n && !g[r * n + c]) g[r * n + c] = 1; }
      bounds = contentBounds(n, g, doc.custom[lv]);
    }
    const cell = Math.max(28, Math.min(96, Math.round(2400 / Math.max(bounds.cols, bounds.rows))));
    const L = layoutFor(cell, bounds), cv = document.createElement("canvas");
    cv.width = L.width; cv.height = L.height;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    renderClassic(ctx, inputFor(doc, lv, true), L);
    cv.toBlob((blob) => {
      if (!blob) { setMsg("Could not create the image."); return; }
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = `${slug(doc.name)}-${slug(doc.meta.levelNames[lv] || `level-${lv + 1}`)}.png`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }, "image/png");
  };

  // ---- styles ----
  const label: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, margin: "14px 0 6px" };
  const seg = (on: boolean): React.CSSProperties => ({ flex: 1, padding: "7px 0", background: on ? C.surface2 : "transparent", color: on ? C.sun : C.muted, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer" });
  const chip = (on: boolean): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", background: on ? C.surface2 : "transparent", color: C.text, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer", textAlign: "left" });
  const btn = (bg: string, fg: string): React.CSSProperties => ({ padding: "9px 14px", background: bg, color: fg, border: bg === "transparent" ? `1px solid ${C.line}` : "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" });
  const small: React.CSSProperties = { padding: "6px 10px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" };
  const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 13 };
  const panel: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 16 };
  const check = (on: boolean, set: (v: boolean) => void, text: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, color: C.text, fontSize: 12.5, cursor: "pointer" }}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} style={{ accentColor: C.sun }} />{text}
    </label>
  );

  const terrainOrder = useMemo(() => {
    const idx = CELL_TYPES.map((t, i) => ({ t, i })).filter(({ i }) => i > 0);
    const out = idx.filter(({ t }) => !!t.outdoor), ind = idx.filter(({ t }) => !t.outdoor);
    return outdoor ? [...out, ...ind] : [...ind, ...out];
  }, [outdoor]);
  const pieceGroups = useMemo(() => {
    const g = (k: "indoor" | "outdoor" | "text") => PIECES.filter((p) => p.group === k);
    return outdoor ? [["Outdoors", g("outdoor")], ["Indoors and furniture", g("indoor")], ["Text", g("text")]] as const
      : [["Indoors and furniture", g("indoor")], ["Outdoors", g("outdoor")], ["Text", g("text")]] as const;
  }, [outdoor]);

  const hint: Record<Tool, string> = {
    select: "Click a piece to select it, drag to move. It snaps to the grid; hold Alt to place it freely. Arrows nudge, R turns, Delete removes.",
    place: "Pick a piece, then click the map to drop it. It snaps to the grid (Alt: free). The new piece is selected so you can turn or resize it right away.",
    terrain: paintMode === "brush" ? "Drag to paint." : paintMode === "rect" ? "Drag a rectangle to fill it." : "Click to fill every touching square of the same terrain.",
    doors: "Click near a wall line to add a door. Click a door to select it, then change its kind, move it to another side of its square (R turns it clockwise) or remove it.",
    walls: wallMode === "erase" ? "Click a sight wall to remove it." : wallStart ? "Click to add the next corner. Double-click, Enter or Esc finishes this wall." : "Click to start a sight wall along a wall in the picture. Points snap to a quarter square and to wall ends; hold Alt to place freely.",
  };

  // ---- render ----
  if (status === "loading") return <p style={{ color: C.muted }}>Loading maps…</p>;
  if (status === "migration") return (
    <div style={panel}>
      <p style={{ color: C.text, margin: 0 }}>Battle maps need one database update before they can be saved.</p>
      <p style={{ color: C.muted, fontSize: 13 }}>Run supabase/migrations/p104-battle-maps.sql in the Supabase SQL editor, then reload this page. Your existing dungeon map is copied over automatically the first time.</p>
    </div>
  );
  if (status === "error") return <div style={panel}><p role="alert" style={{ color: "#c98a7a", margin: 0 }}>{msg}</p></div>;

  const newForm = (
    <div style={{ ...panel, maxWidth: 520 }}>
      <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>{maps.length ? "New map" : "Make your first map"}</div>
      <label style={{ ...label, marginTop: 8 }} htmlFor="bm-new-name">Name</label>
      <input id="bm-new-name" value={newName} onChange={(e) => setNewName(e.target.value.slice(0, 80))} placeholder="Forest road ambush" style={field}
        onKeyDown={(e) => { if (e.key === "Enter") void createMap(); }} />
      <label style={label}>Kind</label>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => setNewKind("outdoor")} style={seg(newKind === "outdoor")}>Outdoor</button>
        <button type="button" onClick={() => setNewKind("indoor")} style={seg(newKind === "indoor")}>Indoor</button>
      </div>
      <p style={{ color: C.muted, fontSize: 12, margin: "8px 0 0" }}>
        {newKind === "outdoor" ? "Starts as open grass. Paint roads, water, forest and cliffs; add buildings with the indoor terrains." : "Starts as solid rock. Paint rooms and corridors; walls and hatching follow."}
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button type="button" onClick={() => void createMap()} style={btn(C.sun, "#1b1712")}>Create map</button>
        {maps.length > 0 && <button type="button" onClick={() => setCreating(false)} style={btn("transparent", C.text)}>Cancel</button>}
      </div>
      {msg && <p role="status" style={{ color: "#c98a7a", fontSize: 12, marginTop: 10 }}>{msg}</p>}
    </div>
  );

  return (
    <div>
      {/* map bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <label htmlFor="bm-pick" style={{ color: C.muted, fontSize: 12 }}>Map</label>
        <select id="bm-pick" value={doc?.id ?? ""} onChange={(e) => void switchMap(e.target.value)} style={{ ...field, width: 260 }} disabled={!maps.length}>
          {maps.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.kind})</option>)}
        </select>
        <button type="button" onClick={() => { setCreating(true); setMsg(null); }} style={small}>New map</button>
        <button type="button" onClick={() => { setMsg(null); setUpload({ kind: "map" }); }} title="Make a new map from a picture: a module's battle map, lined up with the grid" style={small}>Upload a map image</button>
        {doc && <button type="button" onClick={() => void createMap(doc)} style={small}>Duplicate</button>}
        {doc && <button type="button" onClick={() => void deleteMap()} style={{ ...small, color: "#c98a7a" }}>Delete map</button>}
        <a href={tabletopUrl(campaignId)} onClick={(e) => { e.preventDefault(); openTabletop(campaignId); }} title="The shared table, in its own window: put a map on it from its Scenes tab, add tokens, and invite the players" style={{ ...small, textDecoration: "none", color: C.sun, borderColor: C.sun }}>Open the tabletop</a>
        <span role="status" style={{ marginLeft: "auto", color: saveState === "error" ? "#c98a7a" : C.muted, fontSize: 12 }}>
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved" : ""}
        </span>
      </div>

      {(creating || !doc) ? newForm : (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 560px", minWidth: 0, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 12 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              {doc.meta.levelNames.map((nm, l) => (
                <button key={l} type="button" onClick={() => { setLevel(l); setSelId(null); setSelDoor(null); setWallStart(null); }} style={{ ...seg(level === l), flex: "0 0 auto", padding: "6px 10px" }}>{nm || `Level ${l + 1}`}</button>
              ))}
              <span style={{ marginLeft: "auto", color: C.muted, fontSize: 12 }}>Zoom</span>
              {ZOOMS.map((z) => <button key={z} type="button" onClick={() => setZoom(z)} style={{ ...seg(zoom === z), flex: "0 0 auto", padding: "5px 9px" }}>{z === 1 ? "Fit" : `${z}x`}</button>)}
            </div>
            <div style={{ overflow: "auto", maxHeight: "78vh", borderRadius: 6 }}>
              <canvas
                ref={canvasRef}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave}
                onDoubleClick={() => { if (tool === "walls") finishWall(); }}
                style={{ display: "block", width: `${zoom * 100}%`, height: "auto", touchAction: "none", cursor: tool === "select" ? "default" : "crosshair" }}
                aria-label={`Map editor: ${doc.name}`}
              />
            </div>
            <p style={{ color: C.muted, fontSize: 12, margin: "8px 2px 0" }}>{hint[tool]}</p>
            <p style={{ color: C.muted, fontSize: 12, margin: "4px 2px 0" }}>
              {doc.n}&times;{doc.n} squares, 1 square = {doc.feetPerSquare} ft &middot; {doc.elements[level].length} pieces on this level
              {doc.meta.sightWalls[level].length > 0 && <> &middot; {doc.meta.sightWalls[level].length} sight walls</>}
            </p>
          </div>

          <div style={{ ...panel, width: 300 }}>
            <label style={{ ...label, marginTop: 0 }}>Tool</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {([["select", "Select"], ["place", "Place"], ["terrain", "Terrain"], ["doors", "Doors"], ["walls", "Sight walls"]] as const).map(([t, nm]) => (
                <button key={t} type="button" onClick={() => { setTool(t); setWallStart(null); }} style={{ ...seg(tool === t), gridColumn: t === "walls" ? "1 / -1" : undefined }}>{nm}</button>
              ))}
            </div>

            {tool === "walls" && (
              <div style={{ marginTop: 14 }}>
                <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
                  Invisible walls that block line of sight on the tabletop. Trace the walls of an uploaded map so tokens cannot see through them. Players never see these lines. Doors still go on the grid with the Doors tool.
                </p>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button type="button" onClick={() => { setWallMode("draw"); }} style={seg(wallMode === "draw")}>Draw</button>
                  <button type="button" onClick={() => { setWallMode("erase"); setWallStart(null); }} style={seg(wallMode === "erase")}>Erase</button>
                </div>
                {wallStart && <button type="button" onClick={finishWall} style={{ ...small, width: "100%", marginTop: 8 }}>Finish this wall (Enter)</button>}
                <p style={{ color: C.text, fontSize: 12.5, margin: "10px 0 0" }}>{doc.meta.sightWalls[level].length} on this level{doc.meta.sightWalls[level].length >= MAX_SIGHT_WALLS ? " (the most a level holds)" : ""}</p>
                {doc.meta.sightWalls[level].length > 0 && <button type="button" onClick={clearWalls} style={{ ...small, color: "#c98a7a", width: "100%", marginTop: 8 }}>Remove all sight walls on this level</button>}
                <p style={{ color: C.muted, fontSize: 11.5, margin: "8px 0 0" }}>On the tabletop, turn on line of sight for the scene (Scenes tab) to use them.</p>
              </div>
            )}

            {selected && (
              <div style={{ marginTop: 14, padding: 10, border: `1px solid ${C.sun}`, borderRadius: 8 }}>
                <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{PIECES.find((p) => p.key === selected.k)?.label ?? selected.k}</div>
                {selected.k === "label" && (
                  <input aria-label="Label text" value={selected.text ?? ""} onFocus={pushUndo}
                    onChange={(e) => updateSel({ text: e.target.value.slice(0, 60) }, false)} style={{ ...field, marginTop: 8 }} />
                )}
                <label style={label} htmlFor="bm-rot">Turn: {Math.round(selected.rot)}&deg;</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button type="button" onClick={() => updateSel({ rot: (selected.rot + 270) % 360 })} style={small} aria-label="Turn 90 degrees left">&#8634; 90</button>
                  <input id="bm-rot" type="range" min={0} max={359} step={1} value={Math.round(selected.rot)} onPointerDown={pushUndo}
                    onChange={(e) => updateSel({ rot: Number(e.target.value) }, false)} style={{ flex: 1, accentColor: C.sun }} />
                  <button type="button" onClick={() => updateSel({ rot: (selected.rot + 90) % 360 })} style={small} aria-label="Turn 90 degrees right">90 &#8635;</button>
                </div>
                <label style={label} htmlFor="bm-size">Size: {selected.s.toFixed(2).replace(/\.?0+$/, "")}&times;</label>
                <input id="bm-size" type="range" min={0.25} max={6} step={0.25} value={selected.s} onPointerDown={pushUndo}
                  onChange={(e) => updateSel({ s: Number(e.target.value) }, false)} style={{ width: "100%", accentColor: C.sun }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
                  <button type="button" onClick={duplicateSel} style={small}>Duplicate</button>
                  <button type="button" onClick={deleteSel} style={{ ...small, color: "#c98a7a" }}>Delete</button>
                  <button type="button" onClick={() => restack(true)} style={small}>Bring to front</button>
                  <button type="button" onClick={() => restack(false)} style={small}>Send to back</button>
                </div>
              </div>
            )}

            {tool === "place" && (
              <>
                {pieceGroups.map(([title, list]) => (
                  <div key={title}>
                    <label style={label}>{title}</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {list.map((p) => <button key={p.key} type="button" onClick={() => setPiece(p.key)} style={chip(piece === p.key)}>{p.label}</button>)}
                    </div>
                  </div>
                ))}
                {piece === "label" && (
                  <>
                    <label style={label} htmlFor="bm-label">Label text</label>
                    <input id="bm-label" value={labelText} onChange={(e) => setLabelText(e.target.value.slice(0, 60))} placeholder="A, 12, Old Mill Road" style={field} />
                  </>
                )}
              </>
            )}

            {tool === "terrain" && (
              <>
                <label style={label}>Paint with</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {([["brush", "Brush"], ["rect", "Rectangle"], ["fill", "Fill"]] as const).map(([m, nm]) => <button key={m} type="button" onClick={() => setPaintMode(m)} style={seg(paintMode === m)}>{nm}</button>)}
                </div>
                {paintMode === "brush" && (
                  <>
                    <label style={label}>Brush size</label>
                    <div style={{ display: "flex", gap: 6 }}>{BRUSHES.map((b) => <button key={b} type="button" onClick={() => setBrushSize(b)} style={seg(brushSize === b)}>{b}</button>)}</div>
                  </>
                )}
                <label style={label}>Terrain</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 330, overflowY: "auto" }}>
                  <button type="button" onClick={() => setBrush({ kind: "builtin", idx: 0 })} style={chip(brush.kind === "builtin" && brush.idx === 0)}>
                    <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, border: "1px solid rgba(0,0,0,.4)", background: "repeating-linear-gradient(45deg,#333,#333 3px,#222 3px,#222 6px)" }} />
                    {outdoor ? "Erase to ground" : "Erase to rock"}
                  </button>
                  {terrainOrder.map(({ t, i }) => (
                    <button key={t.key} type="button" onClick={() => setBrush({ kind: "builtin", idx: i })} style={chip(brush.kind === "builtin" && brush.idx === i)}>
                      <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, border: "1px solid rgba(0,0,0,.4)", background: t.color ?? "transparent" }} />
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
                          <img src={t.imageUrl} alt="" style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0, objectFit: "cover", background: t.color }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {tool === "doors" && (
              <>
                <label style={label}>Door</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {DOOR_KINDS.map((d) => <button key={d.key} type="button" onClick={() => setDoorKind(d.key)} style={chip(door === d.key)}>{d.label}</button>)}
                </div>
                {selDoor && selDoorKind ? (
                  <div style={{ marginTop: 14, padding: 10, border: `1px solid ${C.sun}`, borderRadius: 8 }}>
                    <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{DOOR_KINDS.find((d) => d.key === selDoorKind)?.label ?? "Door"} selected</div>
                    <p style={{ color: C.muted, fontSize: 12, margin: "4px 0 0" }}>Picking a kind above changes this door. The dot marks the square it belongs to.</p>
                    <label style={label}>Side of the square</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {SIDES.map((sd) => {
                        const key = doorKey(doc.n, selDoor.r, selDoor.c, sd), taken = !!key && sd !== selDoor.side && !!doc.doors[level][key];
                        return <button key={sd} type="button" disabled={!key || taken} onClick={() => moveDoor(sd)}
                          title={!key ? "That side is the edge of the map" : taken ? "That side already has a door" : undefined}
                          style={{ ...seg(selDoor.side === sd), opacity: !key || taken ? 0.45 : 1 }}>{SIDE_LABEL[sd]}</button>;
                      })}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                      <button type="button" onClick={() => turnDoor(false)} style={small}>&#8634; Turn left</button>
                      <button type="button" onClick={() => turnDoor(true)} style={small}>Turn right &#8635;</button>
                      <button type="button" onClick={removeDoor} style={{ ...small, color: "#c98a7a", gridColumn: "1 / -1" }}>Remove door</button>
                    </div>
                  </div>
                ) : <p style={{ color: C.muted, fontSize: 12, margin: "10px 0 0" }}>No door selected. Click a door on the map to select it.</p>}
              </>
            )}

            <div style={{ marginTop: 16, padding: 10, border: `1px solid ${C.line}`, borderRadius: 8 }}>
              <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>Map image</div>
              {(() => {
                const o = doc.meta.overlays[level];
                const img = o ? paintImgs.current.get(o.url) : undefined;
                const own = o?.style === "upload";
                const stale = !!o && !own && o.sig !== levelSig(doc, level);
                return (
                  <>
                    {o && (
                      <>
                        <p style={{ color: C.muted, fontSize: 12, margin: "6px 0 0" }}>{own ? "Your uploaded image is on this level." : "A Gemini painting is on this level."}</p>
                        {img === "failed" && <p role="status" style={{ color: "#c98a7a", fontSize: 12, margin: "6px 0 0" }}>The image could not be loaded. Upload or paint it again, or remove it.</p>}
                        {img === "loading" && <p style={{ color: C.muted, fontSize: 12, margin: "6px 0 0" }}>Loading the image…</p>}
                        {stale && <p role="status" style={{ color: "#d9a43a", fontSize: 12, margin: "6px 0 0" }}>This level has changed since it was painted. Repaint to match.</p>}
                        {check(o.show, (v) => setOverlay({ show: v }), own ? "Show the image" : "Show the painting")}
                        {o.show && (
                          <>
                            <label style={{ ...label, marginTop: 10 }} htmlFor="bm-ovop">Opacity: {Math.round(o.opacity * 100)}%</label>
                            <input id="bm-ovop" type="range" min={0} max={1} step={0.05} value={o.opacity} onPointerDown={pushUndo}
                              onChange={(e) => setOverlay({ opacity: Number(e.target.value) }, false)} style={{ width: "100%", accentColor: C.sun }} />
                            {check(o.inkOnTop, (v) => setOverlay({ inkOnTop: v }), "Keep my walls, doors and grid on top")}
                            {own ? <p style={{ color: C.muted, fontSize: 12, margin: "8px 0 0" }}>Pieces and doors you add are drawn over your image.</p>
                              : check(o.piecesOnTop, (v) => setOverlay({ piecesOnTop: v }), "Draw my pieces on top too")}
                          </>
                        )}
                      </>
                    )}
                    <label style={label} htmlFor="bm-pstyle">Style</label>
                    <select id="bm-pstyle" value={paintStyle} onChange={(e) => setPaintStyle(e.target.value)} style={field}>
                      {PAINT_STYLES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                    <label style={label} htmlFor="bm-pnote">Extra direction (optional)</label>
                    <input id="bm-pnote" value={paintNote} onChange={(e) => setPaintNote(e.target.value.slice(0, 300))} placeholder="Autumn leaves, mossy stone, torchlight" style={field} />
                    <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                      <button type="button" onClick={() => setUpload({ kind: "level", n: doc.n, levelName: doc.meta.levelNames[level] || `level ${level + 1}` })} style={btn("transparent", C.text)}>
                        {own ? "Replace with another image" : "Use my own image"}
                      </button>
                      <button type="button" disabled={painting} onClick={() => void paintLevel()} style={{ ...btn(C.sun, "#1b1712"), opacity: painting ? 0.6 : 1 }}>
                        {painting ? "Painting… (up to a minute)" : !o ? "Paint this level with Gemini" : own ? "Paint with Gemini instead" : "Repaint this level"}
                      </button>
                      {o && <button type="button" onClick={() => mutate((d) => { d.meta.overlays[level] = null; })} style={{ ...small, color: "#c98a7a" }}>{own ? "Remove image" : "Remove painting"}</button>}
                    </div>
                    <p style={{ color: C.muted, fontSize: 11.5, margin: "8px 0 0" }}>
                      Your own image stays in your campaign&apos;s storage; after uploading, trace its walls with the Sight walls tool. Painting sends a picture of this level&apos;s layout (no names, notes or labels) to Google Gemini; the painting can drift from the plan, so your walls, doors and grid stay drawn over it unless you turn that off.
                    </p>
                  </>
                );
              })()}
            </div>

            <label style={label} htmlFor="bm-name">Map name</label>
            <input id="bm-name" value={doc.name} onFocus={pushUndo} onChange={(e) => mutate((m) => { m.name = e.target.value.slice(0, 80); }, false)} style={field} />
            <label style={label} htmlFor="bm-title">Title on the map</label>
            <input id="bm-title" value={doc.meta.title} onFocus={pushUndo} onChange={(e) => mutate((m) => { m.meta.title = e.target.value.slice(0, 80); }, false)} placeholder="Leave empty for just the level name" style={field} />
            <label style={label} htmlFor="bm-level">This level&apos;s name</label>
            <input id="bm-level" value={doc.meta.levelNames[level] || ""} onFocus={pushUndo}
              onChange={(e) => mutate((m) => { m.meta.levelNames[level] = e.target.value.slice(0, 60); }, false)} placeholder={`Level ${level + 1}`} style={field} />

            <label style={label}>Kind</label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["outdoor", "indoor"] as const).map((k) => <button key={k} type="button" onClick={() => mutate((m) => { m.kind = k; })} style={seg(doc.kind === k)}>{k === "outdoor" ? "Outdoor" : "Indoor"}</button>)}
            </div>
            {outdoor && (
              <>
                <label style={label} htmlFor="bm-ground">Ground</label>
                <select id="bm-ground" value={doc.meta.ground} onChange={(e) => mutate((m) => { m.meta.ground = Number(e.target.value); })} style={field}>
                  {CELL_TYPES.map((t, i) => (t.outdoor ? <option key={t.key} value={i}>{t.label}</option> : null))}
                </select>
              </>
            )}
            {check(doc.meta.autoNumber, (v) => mutate((m) => { m.meta.autoNumber = v; }), outdoor ? "Number the buildings automatically" : "Number the rooms automatically")}

            <label style={label}>Book grid</label>
            {check(doc.meta.showGrid, (v) => mutate((m) => { m.meta.showGrid = v; }), "Show the book grid (under the walls and pieces)")}
            {doc.meta.showGrid && (
              <>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {(["ink", "black", "white", "red"] as GridLook["color"][]).map((c) => (
                    <button key={c} type="button" onClick={() => mutate((m) => { m.meta.grid.color = c; })} style={seg(doc.meta.grid.color === c)}>{c[0].toUpperCase() + c.slice(1)}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {(["thin", "medium", "bold"] as GridLook["weight"][]).map((w) => (
                    <button key={w} type="button" onClick={() => mutate((m) => { m.meta.grid.weight = w; })} style={seg(doc.meta.grid.weight === w)}>{w[0].toUpperCase() + w.slice(1)}</button>
                  ))}
                </div>
                <label style={{ ...label, marginTop: 10 }} htmlFor="bm-gop">Strength: {Math.round(doc.meta.grid.opacity * 100)}%</label>
                <input id="bm-gop" type="range" min={0.05} max={1} step={0.05} value={doc.meta.grid.opacity} onPointerDown={pushUndo}
                  onChange={(e) => mutate((m) => { m.meta.grid.opacity = Number(e.target.value); }, false)} style={{ width: "100%", accentColor: C.sun }} />
                {!outdoor && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button type="button" onClick={() => mutate((m) => { m.meta.grid.cover = "floor"; })} style={seg(doc.meta.grid.cover === "floor")}>Floors only</button>
                    <button type="button" onClick={() => mutate((m) => { m.meta.grid.cover = "all"; })} style={seg(doc.meta.grid.cover === "all")}>Whole map</button>
                  </div>
                )}
              </>
            )}

            <label style={label}>Black battle grid</label>
            {check(doc.meta.topGrid.show, (v) => mutate((m) => { m.meta.topGrid.show = v; }), "Show a black grid over everything")}
            {doc.meta.topGrid.show && (
              <>
                <label style={{ ...label, marginTop: 10 }} htmlFor="bm-tgop">Opacity: {Math.round(doc.meta.topGrid.opacity * 100)}%</label>
                <input id="bm-tgop" type="range" min={0.05} max={1} step={0.05} value={doc.meta.topGrid.opacity} onPointerDown={pushUndo}
                  onChange={(e) => mutate((m) => { m.meta.topGrid.opacity = Number(e.target.value); }, false)} style={{ width: "100%", accentColor: C.sun }} />
              </>
            )}

            <label style={label}>Grid size</label>
            <div style={{ display: "flex", gap: 6 }}>{SIZES.map((s) => <button key={s} type="button" onClick={() => changeSize(s)} style={seg(doc.n === s)}>{s}</button>)}</div>
            <label style={label} htmlFor="bm-fps">Feet per square</label>
            <input id="bm-fps" type="number" min={1} max={1000} step={1} value={doc.feetPerSquare} onFocus={pushUndo}
              onChange={(e) => mutate((m) => { m.feetPerSquare = Math.max(1, Math.min(1000, Math.round(Number(e.target.value) || 1))); }, false)} style={{ ...field, width: 100 }} />

            <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
              <button type="button" onClick={saveImage} style={btn(C.sun, "#1b1712")}>Save map image</button>
              <button type="button" onClick={doUndo} style={btn("transparent", C.text)}>Undo (Ctrl+Z)</button>
              <button type="button" onClick={clearLevel} style={btn("transparent", C.muted)}>Clear this level</button>
            </div>
            {msg && <p role="status" style={{ color: "#c98a7a", fontSize: 12, marginTop: 12 }}>{msg}</p>}
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <TileLibrary scope="dungeon" onChange={setTiles} />
      </div>

      {upload && (
        <MapUpload campaignId={campaignId} dest={upload} onClose={() => setUpload(null)}
          onDone={(result) => {
            const kind = upload.kind; setUpload(null);
            if (kind === "map") {
              void (async () => {
                await flush();
                const list = await listMaps(); if (list) setMaps(list);
                setCreating(false);
                await openMap(result);
                setTool("walls"); setWallMode("draw");
                setMsg(null);
              })();
              return;
            }
            const cur = docRef.current; if (!cur) return;
            mutate((d) => { d.meta.overlays[level] = { url: result, at: new Date().toISOString(), sig: levelSig(d, level), style: "upload", show: true, opacity: 1, inkOnTop: false, piecesOnTop: false }; });
          }} />
      )}
    </div>
  );
}
