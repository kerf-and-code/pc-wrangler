"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { type Terrain, index, setBiome, BIOME_UNSET } from "@/lib/worldmap/hex";
import { hexToPixel, hexCorners, pixelToHex, gridPixelSize } from "@/lib/worldmap/layout";

// The flat-top grid on a canvas. Two backings for the same grid:
//   - no image: draws coloured biome tiles (the painted terrain).
//   - a background image: draws the image covering the grid and turns the biome FILL OFF, leaving
//     the hex grid as an outline over it. Painted hexes still show as a faint translucent tint so a
//     GM can see which areas they have designated a biome for; the biome is metadata, not the art.
// Either way it pans on drag, zooms toward the cursor, and paints the selected biome into the
// shared Terrain in place (onPaint notifies the parent to persist).

const BASE_SIZE = 14;         // hex radius in px before zoom
const SQRT3 = Math.sqrt(3);
const UNSET_FILL = "#1c1712"; // an unpainted hex (no-image mode)
const GRID_LINE = "rgba(255,255,255,0.06)";
const IMAGE_TINT_ALPHA = 0.3; // painted-hex tint over a background image

type View = { scale: number; tx: number; ty: number };

export default function HexCanvas({
  terrain,
  colors,
  selectedBiome,
  onPaint,
  backgroundImageUrl,
  className,
}: {
  terrain: Terrain;
  colors: readonly string[];
  selectedBiome: number | null;
  onPaint?: (col: number, row: number, biome: number) => void;
  backgroundImageUrl?: string | null;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View>({ scale: 1, tx: 0, ty: 0 });
  const sizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });
  const rafRef = useRef<number | null>(null);
  const fittedRef = useRef<boolean>(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgReadyRef = useRef<boolean>(false);

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

    const img = imgRef.current;
    const hasImage = imgReadyRef.current && img !== null;
    if (hasImage && img) {
      const gb = gridPixelSize(width, height, BASE_SIZE);
      // Cover the grid's pixel bounds; origin is the top-left of the outermost hexes. The image is
      // stretched to the grid rectangle, so the GM sizes the grid to match their map's aspect.
      ctx.drawImage(img, -BASE_SIZE, -(SQRT3 * BASE_SIZE) / 2, gb.w, gb.h);
    }

    // Cull to the visible rectangle.
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
        const painted = b !== BIOME_UNSET && b < cols.length;
        if (hasImage) {
          if (painted) {
            ctx.globalAlpha = IMAGE_TINT_ALPHA;
            ctx.fillStyle = cols[b];
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        } else {
          ctx.fillStyle = painted ? cols[b] : UNSET_FILL;
          ctx.fill();
        }
        ctx.stroke();
      }
    }
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Load or clear the background image; redraw when it settles.
  useEffect(() => {
    imgReadyRef.current = false;
    if (!backgroundImageUrl) {
      imgRef.current = null;
      scheduleDraw();
      return;
    }
    const img = new Image();
    img.onload = () => { imgRef.current = img; imgReadyRef.current = true; scheduleDraw(); };
    img.onerror = () => { imgRef.current = null; imgReadyRef.current = false; scheduleDraw(); };
    img.src = backgroundImageUrl;
    return () => { img.onload = null; img.onerror = null; };
  }, [backgroundImageUrl, scheduleDraw]);

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

  // Re-fit the view whenever a NEW terrain object arrives (load, campaign switch, resize).
  // Painting mutates in place (same identity) so it does not re-fit. Colours only redraw.
  useEffect(() => { fittedRef.current = false; resize(); }, [terrain, resize]);
  useEffect(() => { scheduleDraw(); }, [colors, scheduleDraw]);

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
