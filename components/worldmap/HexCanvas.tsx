"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { type Terrain, index, setBiome, BIOME_UNSET, offsetToAxial, axialToOffset, AXIAL_DIRS, inBounds } from "@/lib/worldmap/hex";
import { hexToPixel, hexCorners, pixelToHex, gridPixelSize, gridOrigin, BASE_SIZE, type PlacedImage } from "@/lib/worldmap/layout";

// The flat-top grid on a canvas. Two backings for the same grid:
//   - no images: draws coloured biome tiles (the painted terrain).
//   - placed images: draws each image at its own position and scale under the grid and turns biome
//     FILL OFF, painted hexes showing only as a faint tint so designations stay visible over the map.
// It pans on drag and zooms on wheel; with a biome selected it paints (Erase paints "unset"); with
// positionImageId set it instead MOVES that image on drag and SCALES it on wheel, so a GM can line a
// map up and place several. Terrain is mutated in place (onPaint persists); image moves/scales are
// reported via onImageMove / onImageScale for the page to persist.

const UNSET_FILL = "#1c1712";
const GRID_LINE = "rgba(255,255,255,0.06)";
const IMAGE_TINT_ALPHA = 0.3;
const SQRT3 = Math.sqrt(3);

// Average of two #rrggbb colours, memoised. The seam midpoint between two biomes uses this, so both
// hexes reach the same colour at the shared edge and the blend is continuous.
const MIX_CACHE = new Map<string, string>();
function mix(a: string, b: string): string {
  const key = a < b ? a + b : b + a;
  const hit = MIX_CACHE.get(key);
  if (hit) return hit;
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = (((pa >> 16) & 255) + ((pb >> 16) & 255)) >> 1;
  const g = (((pa >> 8) & 255) + ((pb >> 8) & 255)) >> 1;
  const bl = ((pa & 255) + (pb & 255)) >> 1;
  const out = `rgb(${r},${g},${bl})`;
  MIX_CACHE.set(key, out);
  return out;
}

type View = { scale: number; tx: number; ty: number };

export default function HexCanvas({
  terrain,
  colors,
  selectedBiome,
  onPaint,
  images,
  positionImageId,
  onImageMove,
  onImageScale,
  paintRegionId,
  regionCells,
  regionErase,
  regionTint,
  onRegionPaint,
  regionRender,
  className,
}: {
  terrain: Terrain;
  colors: readonly string[];
  selectedBiome: number | null;
  onPaint?: (col: number, row: number, biome: number) => void;
  images?: PlacedImage[];
  positionImageId?: string | null;
  onImageMove?: (id: string, x: number, y: number) => void;
  onImageScale?: (id: string, scale: number) => void;
  paintRegionId?: string | null;
  regionCells?: Set<string>;
  regionErase?: boolean;
  regionTint?: string | null;
  onRegionPaint?: (col: number, row: number) => void;
  regionRender?: { id: string; name: string; tint: string; cells: Set<string> }[];
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View>({ scale: 1, tx: 0, ty: 0 });
  const sizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });
  const rafRef = useRef<number | null>(null);
  const fittedRef = useRef<boolean>(false);
  const cacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const readyRef = useRef<Set<string>>(new Set());
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const terrainRef = useRef(terrain);
  const colorsRef = useRef(colors);
  const selRef = useRef(selectedBiome);
  const onPaintRef = useRef(onPaint);
  const imagesRef = useRef<PlacedImage[]>(images ?? []);
  const posRef = useRef<string | null>(positionImageId ?? null);
  const onMoveRef = useRef(onImageMove);
  const onScaleRef = useRef(onImageScale);
  const paintRegionRef = useRef<string | null>(paintRegionId ?? null);
  const regionCellsRef = useRef<Set<string> | undefined>(regionCells);
  const regionEraseRef = useRef<boolean>(regionErase ?? false);
  const regionTintRef = useRef<string | null>(regionTint ?? null);
  const onRegionPaintRef = useRef(onRegionPaint);
  const regionRenderRef = useRef(regionRender);
  terrainRef.current = terrain;
  colorsRef.current = colors;
  selRef.current = selectedBiome;
  onPaintRef.current = onPaint;
  imagesRef.current = images ?? [];
  posRef.current = positionImageId ?? null;
  onMoveRef.current = onImageMove;
  onScaleRef.current = onImageScale;
  paintRegionRef.current = paintRegionId ?? null;
  regionCellsRef.current = regionCells;
  regionEraseRef.current = regionErase ?? false;
  regionTintRef.current = regionTint ?? null;
  onRegionPaintRef.current = onRegionPaint;
  regionRenderRef.current = regionRender;

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
    const imgs = imagesRef.current;
    const { width, height } = t.meta;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);

    const hasImages = imgs.length > 0;
    if (hasImages) {
      const drag = dragRef.current;
      const ordered = [...imgs].sort((a, b) => a.z - b.z);
      for (const im of ordered) {
        const el = cacheRef.current.get(im.url);
        if (!el || !readyRef.current.has(im.url)) continue;
        const ox = drag && drag.id === im.id ? drag.dx : 0;
        const oy = drag && drag.id === im.id ? drag.dy : 0;
        ctx.drawImage(el, im.x + ox, im.y + oy, el.naturalWidth * im.scale, el.naturalHeight * im.scale);
      }
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
        let blended = false;
        if (hasImages) {
          if (painted) {
            ctx.globalAlpha = IMAGE_TINT_ALPHA;
            ctx.fillStyle = cols[b];
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        } else {
          ctx.fillStyle = painted ? cols[b] : UNSET_FILL;
          ctx.fill();
          // Blend each edge that borders a different painted biome. Skipped when zoomed far out,
          // where per-hex seams are sub-pixel and the gradients are not worth the redraw cost.
          if (painted && s > 0.15) {
            const a = offsetToAxial(col, row);
            for (let d = 0; d < 6; d++) {
              const dir = AXIAL_DIRS[d];
              const no = axialToOffset(a.q + dir.q, a.r + dir.r);
              if (!inBounds(no.col, no.row, width, height)) continue;
              const nb = t.biome[index(no.col, no.row, width)];
              if (nb === BIOME_UNSET || nb >= cols.length || nb === b) continue;
              const c0 = pts[(6 - d) % 6];
              const c1 = pts[(7 - d) % 6];
              const grad = ctx.createLinearGradient(center.x, center.y, (c0.x + c1.x) / 2, (c0.y + c1.y) / 2);
              grad.addColorStop(0, cols[b]);
              grad.addColorStop(1, mix(cols[b], cols[nb]));
              ctx.beginPath();
              ctx.moveTo(center.x, center.y);
              ctx.lineTo(c0.x, c0.y);
              ctx.lineTo(c1.x, c1.y);
              ctx.closePath();
              ctx.fillStyle = grad;
              ctx.fill();
              blended = true;
            }
          }
        }
        if (blended) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
        }
        ctx.stroke();
      }
    }

    // Highlight the active paint region's assigned hexes (2c). Full multi-region drawing is 2d.
    const rc = regionCellsRef.current;
    if (rc && rc.size) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = regionTintRef.current || "#c8a24b";
      for (const key of rc) {
        const ci = key.indexOf(",");
        const cc = parseInt(key.slice(0, ci), 10);
        const rr = parseInt(key.slice(ci + 1), 10);
        if (cc < minCol || cc > maxCol || rr < minRow || rr > maxRow) continue;
        const center = hexToPixel(cc, rr, BASE_SIZE);
        const pts = hexCorners(center, BASE_SIZE);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Regions at the selected tier (2d): a translucent fill plus a boundary outline per region.
    const rr = regionRenderRef.current;
    if (rr && rr.length) {
      for (const reg of rr) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = reg.tint;
        for (const key of reg.cells) {
          const ci = key.indexOf(",");
          const cc = parseInt(key.slice(0, ci), 10);
          const rw = parseInt(key.slice(ci + 1), 10);
          if (cc < minCol || cc > maxCol || rw < minRow || rw > maxRow) continue;
          const center = hexToPixel(cc, rw, BASE_SIZE);
          const pts = hexCorners(center, BASE_SIZE);
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = reg.tint;
        ctx.lineWidth = 2 / s;
        for (const key of reg.cells) {
          const ci = key.indexOf(",");
          const cc = parseInt(key.slice(0, ci), 10);
          const rw = parseInt(key.slice(ci + 1), 10);
          if (cc < minCol - 1 || cc > maxCol + 1 || rw < minRow - 1 || rw > maxRow + 1) continue;
          const center = hexToPixel(cc, rw, BASE_SIZE);
          const pts = hexCorners(center, BASE_SIZE);
          const a = offsetToAxial(cc, rw);
          for (let d = 0; d < 6; d++) {
            const dir = AXIAL_DIRS[d];
            const no = axialToOffset(a.q + dir.q, a.r + dir.r);
            if (reg.cells.has(`${no.col},${no.row}`)) continue;
            const c0 = pts[(6 - d) % 6];
            const c1 = pts[(7 - d) % 6];
            ctx.beginPath();
            ctx.moveTo(c0.x, c0.y);
            ctx.lineTo(c1.x, c1.y);
            ctx.stroke();
          }
        }
      }
      ctx.lineWidth = 1 / s;

      // Region name labels, drawn in SCREEN space so they stay legible at any zoom.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = "600 13px 'Iowan Old Style', Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      for (const reg of rr) {
        if (!reg.name || reg.cells.size === 0) continue;
        let cx = 0, cy = 0, n = 0;
        for (const key of reg.cells) {
          const ci = key.indexOf(",");
          const cc = parseInt(key.slice(0, ci), 10);
          const rw = parseInt(key.slice(ci + 1), 10);
          const c = hexToPixel(cc, rw, BASE_SIZE);
          cx += c.x; cy += c.y; n++;
        }
        cx /= n; cy /= n;
        const sx = cx * view.scale + view.tx;
        const sy = cy * view.scale + view.ty;
        if (sx < -60 || sx > w + 60 || sy < -20 || sy > h + 20) continue;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(20,16,12,0.85)";
        ctx.strokeText(reg.name, sx, sy);
        ctx.fillStyle = "#f2e9d6";
        ctx.fillText(reg.name, sx, sy);
      }
    }
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Load any image urls not yet cached; redraw as each settles. Old urls are left in the cache.
  useEffect(() => {
    const imgs = images ?? [];
    for (const im of imgs) {
      if (cacheRef.current.has(im.url)) continue;
      const el = new Image();
      cacheRef.current.set(im.url, el);
      el.onload = () => { readyRef.current.add(im.url); scheduleDraw(); };
      el.onerror = () => { readyRef.current.delete(im.url); };
      el.src = im.url;
    }
    scheduleDraw();
  }, [images, scheduleDraw]);

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
      const o = gridOrigin();
      const scale = Math.min(rect.width / g.w, rect.height / g.h);
      viewRef.current = { scale, tx: (rect.width - g.w * scale) / 2 - o.x * scale, ty: (rect.height - g.h * scale) / 2 - o.y * scale };
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

  useEffect(() => { fittedRef.current = false; resize(); }, [terrain, resize]);
  useEffect(() => { scheduleDraw(); }, [colors, positionImageId, regionCells, paintRegionId, regionRender, scheduleDraw]);

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

  const paintRegionAt = useCallback((clientX: number, clientY: number, last: { col: number; row: number } | null) => {
    const canvas = canvasRef.current;
    const rid = paintRegionRef.current;
    const rc = regionCellsRef.current;
    if (!canvas || !rid || !rc) return last;
    const rect = canvas.getBoundingClientRect();
    const view = viewRef.current;
    const wx = (clientX - rect.left - view.tx) / view.scale;
    const wy = (clientY - rect.top - view.ty) / view.scale;
    const { col, row } = pixelToHex(wx, wy, BASE_SIZE);
    const t = terrainRef.current;
    if (col < 0 || row < 0 || col >= t.meta.width || row >= t.meta.height) return last;
    if (last && last.col === col && last.row === row) return last;
    const key = `${col},${row}`;
    if (regionEraseRef.current) rc.delete(key); else rc.add(key);
    onRegionPaintRef.current?.(col, row);
    scheduleDraw();
    return { col, row };
  }, [scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let mode: "none" | "pan" | "paint" | "move" | "region" = "none";
    let lastX = 0, lastY = 0;
    let lastHex: { col: number; row: number } | null = null;

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      lastX = e.clientX; lastY = e.clientY;
      const posId = posRef.current;
      if (posId && e.button === 0) {
        mode = "move";
        dragRef.current = { id: posId, dx: 0, dy: 0 };
      } else if (paintRegionRef.current && e.button === 0) {
        mode = "region";
        lastHex = paintRegionAt(e.clientX, e.clientY, null);
      } else if (selRef.current != null && e.button === 0) {
        mode = "paint";
        lastHex = paintAt(e.clientX, e.clientY, null);
      } else {
        mode = "pan";
      }
    };
    const onMove = (e: PointerEvent) => {
      if (mode === "paint") {
        lastHex = paintAt(e.clientX, e.clientY, lastHex);
      } else if (mode === "region") {
        lastHex = paintRegionAt(e.clientX, e.clientY, lastHex);
      } else if (mode === "move") {
        const drag = dragRef.current;
        if (drag) {
          drag.dx += (e.clientX - lastX) / viewRef.current.scale;
          drag.dy += (e.clientY - lastY) / viewRef.current.scale;
          lastX = e.clientX; lastY = e.clientY;
          scheduleDraw();
        }
      } else if (mode === "pan") {
        viewRef.current.tx += e.clientX - lastX;
        viewRef.current.ty += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        scheduleDraw();
      }
    };
    const onUp = (e: PointerEvent) => {
      if (mode === "move") {
        const drag = dragRef.current;
        if (drag) {
          const im = imagesRef.current.find((x) => x.id === drag.id);
          if (im && (drag.dx !== 0 || drag.dy !== 0)) onMoveRef.current?.(im.id, im.x + drag.dx, im.y + drag.dy);
        }
        dragRef.current = null;
        scheduleDraw();
      }
      mode = "none"; lastHex = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const posId = posRef.current;
      if (posId) {
        // Scale the image being positioned, not the view.
        const im = imagesRef.current.find((x) => x.id === posId);
        if (im) onScaleRef.current?.(im.id, Math.max(0.02, im.scale * factor));
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
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
  }, [paintAt, paintRegionAt, scheduleDraw]);

  const cursor = positionImageId != null ? "move" : (paintRegionId != null || selectedBiome != null) ? "crosshair" : "grab";

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor }}
    />
  );
}
