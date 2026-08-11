"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { type Terrain, index, setBiome, BIOME_UNSET } from "@/lib/worldmap/hex";
import { hexToPixel, hexCorners, pixelToHex, gridPixelSize } from "@/lib/worldmap/layout";

// The flat-top grid on a canvas: renders coloured biome tiles, pans on drag, zooms toward the
// cursor, and (when a biome is selected) paints into the shared Terrain. Terrain is mutated in place
// for instant feedback and onPaint notifies the parent to persist; the parent holds the same object.
// Colours-first: real per-biome art and the edge blend are a later Phase 1 step.

const BASE_SIZE = 14;         // hex radius in px before zoom
const UNSET_FILL = "#1c1712"; // an unpainted hex
const GRID_LINE = "rgba(255,255,255,0.06)";

type View = { scale: number; tx: number; ty: number };

export default function HexCanvas({
  terrain,
  colors,
  selectedBiome,
  onPaint,
  className,
}: {
  terrain: Terrain;
  colors: readonly string[];
  selectedBiome: number | null;
  onPaint?: (col: number, row: number, biome: number) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View>({ scale: 1, tx: 0, ty: 0 });
  const sizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });
  const rafRef = useRef<number | null>(null);
  const fittedRef = useRef<boolean>(false);

  // Latest props in refs so the pointer handlers, attached once, always see current values.
  const terrainRef = useRef(terrain);
  const colorsRef = useRef(colors);
  const selRef = useRef(selectedBiome);
  const onPaintRef = useRef(onPaint);
  terrainRef.current = terrain;
  colorsRef.current = colors;
  selRef.current = selectedBiome;
  onPaintRef.current = onPaint;

  const draw = useCallback(() => {
    rafRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    const view = viewRef.current;
    const t = terrainRef.current;
    const cols = colorsRef.current;
    const { width, height } = t.meta;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);

    // Cull to the visible rectangle: convert the four screen corners to hexes, pad, clamp.
    const s = view.scale;
    const cornersWorld = [
      pixelToHex((0 - view.tx) / s, (0 - view.ty) / s, BASE_SIZE),
      pixelToHex((w - view.tx) / s, (0 - view.ty) / s, BASE_SIZE),
      pixelToHex((0 - view.tx) / s, (h - view.ty) / s, BASE_SIZE),
      pixelToHex((w - view.tx) / s, (h - view.ty) / s, BASE_SIZE),
    ];
    let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
    for (const c of cornersWorld) {
      if (c.col < minCol) minCol = c.col;
      if (c.col > maxCol) maxCol = c.col;
      if (c.row < minRow) minRow = c.row;
      if (c.row > maxRow) maxRow = c.row;
    }
    minCol = Math.max(0, minCol - 2); maxCol = Math.min(width - 1, maxCol + 2);
    minRow = Math.max(0, minRow - 2); maxRow = Math.min(height - 1, maxRow + 2);

    ctx.lineWidth = 1 / s;
    ctx.strokeStyle = GRID_LINE;
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const center = hexToPixel(col, row, BASE_SIZE);
        const pts = hexCorners(center, BASE_SIZE);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        const b = t.biome[index(col, row, width)];
        ctx.fillStyle = b !== BIOME_UNSET && b < cols.length ? cols[b] : UNSET_FILL;
        ctx.fill();
        ctx.stroke();
      }
    }
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Size the backing store to the element and devicePixelRatio; fit the grid the first time.
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    sizeRef.current = { w: rect.width, h: rect.height, dpr };
    if (!fittedRef.current && rect.width > 0 && rect.height > 0) {
      const g = gridPixelSize(terrainRef.current.meta.width, terrainRef.current.meta.height, BASE_SIZE);
      const scale = Math.min(rect.width / g.w, rect.height / g.h);
      viewRef.current = { scale, tx: (rect.width - g.w * scale) / 2 + BASE_SIZE * scale, ty: (rect.height - g.h * scale) / 2 + BASE_SIZE * scale };
      fittedRef.current = true;
    }
    scheduleDraw();
  }, [scheduleDraw]);

  useEffect(() => {
    resize();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [resize]);

  // Redraw when the terrain object identity changes (parent reassigns after load/expand).
  useEffect(() => { scheduleDraw(); }, [terrain, colors, scheduleDraw]);

  // ---- interaction ----
  const paintAt = useCallback((clientX: number, clientY: number, last: { col: number; row: number } | null) => {
    const canvas = canvasRef.current;
    const sel = selRef.current;
    if (!canvas || sel == null) return last;
    const rect = canvas.getBoundingClientRect();
    const view = viewRef.current;
    const wx = (clientX - rect.left - view.tx) / view.scale;
    const wy = (clientY - rect.top - view.ty) / view.scale;
    const { col, row } = pixelToHex(wx, wy, BASE_SIZE);
    const t = terrainRef.current;
    if (col < 0 || row < 0 || col >= t.meta.width || row >= t.meta.height) return last;
    if (last && last.col === col && last.row === row) return last;
    setBiome(t, col, row, sel);
    onPaintRef.current?.(col, row, sel);
    scheduleDraw();
    return { col, row };
  }, [scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let mode: "none" | "pan" | "paint" = "none";
    let lastX = 0, lastY = 0;
    let lastHex: { col: number; row: number } | null = null;

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      lastX = e.clientX; lastY = e.clientY;
      if (selRef.current != null && e.button === 0) {
        mode = "paint";
        lastHex = paintAt(e.clientX, e.clientY, null);
      } else {
        mode = "pan";
      }
    };
    const onMove = (e: PointerEvent) => {
      if (mode === "paint") {
        lastHex = paintAt(e.clientX, e.clientY, lastHex);
      } else if (mode === "pan") {
        viewRef.current.tx += e.clientX - lastX;
        viewRef.current.ty += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        scheduleDraw();
      }
    };
    const onUp = (e: PointerEvent) => {
      mode = "none"; lastHex = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newScale = Math.min(8, Math.max(0.05, view.scale * factor));
      // Keep the world point under the cursor fixed while zooming.
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      view.tx = cx - (cx - view.tx) * (newScale / view.scale);
      view.ty = cy - (cy - view.ty) * (newScale / view.scale);
      view.scale = newScale;
      scheduleDraw();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [paintAt, scheduleDraw]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: selectedBiome != null ? "crosshair" : "grab" }}
    />
  );
}
