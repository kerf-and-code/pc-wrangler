"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { type Terrain, index, setBiome, BIOME_UNSET, offsetToAxial, axialToOffset, AXIAL_DIRS, inBounds } from "@/lib/worldmap/hex";
import { hexToPixel, hexCorners, pixelToHex, gridPixelSize, gridOrigin, BASE_SIZE, type PlacedImage } from "@/lib/worldmap/layout";
import { buildFeatureEdges, selectTile, type FeatureEdges, type MapFeatureLike } from "@/lib/worldmap/feature-tiles";

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
export type MapFeature = { kind: "river" | "road"; klass: number; path: [number, number][]; name?: string | null };

export default function HexCanvas({
  terrain,
  colors,
  biomeArt,
  artEnabled,
  features,
  baseImage,
  showBaseImage,
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
  pois,
  poiPlaceActive,
  onPlacePoi,
  onPoiClick,
  onPoiHover,
  onMovePoi,
  className,
}: {
  terrain: Terrain;
  colors: readonly string[];
  biomeArt?: readonly (string | null)[];
  artEnabled?: boolean;
  features?: readonly MapFeature[];
  baseImage?: string | null;
  showBaseImage?: boolean;
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
  pois?: { id: string; x: number; y: number; name: string; iconId: string; iconSrc: string }[];
  poiPlaceActive?: boolean;
  onPlacePoi?: (x: number, y: number) => void;
  onPoiClick?: (id: string, sx: number, sy: number) => void;
  onPoiHover?: (h: { names: string[]; sx: number; sy: number } | null) => void;
  onMovePoi?: (id: string, x: number, y: number) => void;
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
  const poisRef = useRef(pois);
  const placeActiveRef = useRef<boolean>(poiPlaceActive ?? false);
  const onPlacePoiRef = useRef(onPlacePoi);
  const onPoiClickRef = useRef(onPoiClick);
  const onPoiHoverRef = useRef(onPoiHover);
  const iconCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const iconReadyRef = useRef<Set<string>>(new Set());
  const poiHitRef = useRef<{ kind: "poi" | "cluster"; sx: number; sy: number; r: number; id?: string; names: string[]; wx: number; wy: number }[]>([]);
  const onMovePoiRef = useRef(onMovePoi);
  const poiDragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const biomeArtRef = useRef(biomeArt);
  const featuresRef = useRef(features);
  const artEnabledRef = useRef<boolean>(artEnabled ?? false);
  const biomeArtCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const biomeArtReadyRef = useRef<Set<number>>(new Set());
  const featTileCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const featTileReadyRef = useRef<Set<string>>(new Set());
  const featEdgesRef = useRef<{ key: unknown; w: number; h: number; edges: FeatureEdges } | null>(null);
  const baseImgRef = useRef<HTMLImageElement | null>(null);
  const baseImgReadyRef = useRef(false);
  const showBaseImageRef = useRef(showBaseImage);
  showBaseImageRef.current = showBaseImage;
  const redrawRef = useRef<() => void>(() => {});
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
  poisRef.current = pois;
  placeActiveRef.current = poiPlaceActive ?? false;
  onPlacePoiRef.current = onPlacePoi;
  onPoiClickRef.current = onPoiClick;
  onPoiHoverRef.current = onPoiHover;
  onMovePoiRef.current = onMovePoi;
  biomeArtRef.current = biomeArt;
  featuresRef.current = features;
  artEnabledRef.current = artEnabled ?? false;

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

    // Connected-tile support: per-cell feature-edge bitmasks (cached per features array + size),
    // lazily loaded tile images, and coverage sets so the v1 polylines skip fully tiled segments.
    const featsForTiles = featuresRef.current ?? [];
    const ec = featEdgesRef.current;
    if (!ec || ec.key !== featsForTiles || ec.w !== width || ec.h !== height) {
      featEdgesRef.current = { key: featsForTiles, w: width, h: height, edges: buildFeatureEdges(width, height, featsForTiles as readonly MapFeatureLike[]) };
    }
    const tileEnv = { width, height, biome: t.biome, flags: t.flags, edges: (featEdgesRef.current as { edges: FeatureEdges }).edges };
    const coveredRiver = new Set<number>();
    const coveredRoad = new Set<number>();
    const featTile = (name: string): HTMLImageElement | null => {
      let img = featTileCacheRef.current.get(name);
      if (!img) {
        img = new Image();
        img.onload = () => { featTileReadyRef.current.add(name); redrawRef.current(); };
        img.src = `/worldmap/features/${name}.png`;
        featTileCacheRef.current.set(name, img);
      }
      return featTileReadyRef.current.has(name) ? img : null;
    };

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

    // Fantasy view: an AI-painted image as the base layer, with the grid/regions/pins still on top.
    const baseOn = !!showBaseImageRef.current && baseImgReadyRef.current && !!baseImgRef.current;
    if (baseOn && baseImgRef.current) {
      const gp = gridPixelSize(width, height, BASE_SIZE);
      const go = gridOrigin();
      ctx.drawImage(baseImgRef.current, go.x, go.y, gp.w, gp.h);
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
        if (baseOn) { ctx.stroke(); continue; }
        const b = t.biome[index(col, row, width)];
        const painted = b !== BIOME_UNSET && b < cols.length;
        let blended = false;
        let tiled = false;
        let overlayDraw: { timg: HTMLImageElement; rot: number; flip: boolean } | null = null;
        if (artEnabledRef.current) {
          const choice = selectTile(col, row, tileEnv);
          if (choice) {
            const timg = featTile(choice.name);
            if (timg) {
              const ci = index(col, row, width);
              if (choice.coversRiver) coveredRiver.add(ci);
              if (choice.coversRoad) coveredRoad.add(ci);
              if (choice.overlay) {
                // Transparent overlay: let the biome draw underneath, then paint this on top.
                overlayDraw = { timg, rot: choice.rot, flip: choice.flip };
              } else {
                // Opaque full-fill tile: replace the biome for this cell.
                const bw = SQRT3 * BASE_SIZE, bh = 2 * BASE_SIZE;
                ctx.save();
                ctx.translate(center.x, center.y);
                ctx.rotate(-choice.rot * Math.PI / 3);
                if (choice.flip) ctx.scale(-1, 1);
                ctx.drawImage(timg, -bw / 2, -bh / 2, bw, bh);
                ctx.restore();
                tiled = true;
              }
            }
          }
        }
        const artImg = !tiled && artEnabledRef.current && painted ? biomeArtCacheRef.current.get(b) : undefined;
        if (tiled) {
          // tile drawn; the grid stroke below still applies
        } else if (artImg && biomeArtReadyRef.current.has(b)) {
          const bw = SQRT3 * BASE_SIZE, bh = 2 * BASE_SIZE;
          ctx.drawImage(artImg, center.x - bw / 2, center.y - bh / 2, bw, bh);
        } else if (hasImages) {
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
        if (overlayDraw) {
          const bw = SQRT3 * BASE_SIZE, bh = 2 * BASE_SIZE;
          ctx.save();
          ctx.translate(center.x, center.y);
          ctx.rotate(-overlayDraw.rot * Math.PI / 3);
          if (overlayDraw.flip) ctx.scale(-1, 1);
          ctx.drawImage(overlayDraw.timg, -bw / 2, -bh / 2, bw, bh);
          ctx.restore();
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

    // Feature overlays (rivers, roads) in world space, over terrain + regions, under POIs.
    const feats = featuresRef.current;
    if (feats && feats.length) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(view.tx, view.ty);
      ctx.scale(view.scale, view.scale);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const covered = (kind: "river" | "road", q: number, r: number): boolean => {
        const o = axialToOffset(q, r);
        if (o.col < 0 || o.col >= width || o.row < 0 || o.row >= height) return false;
        const ci = index(o.col, o.row, width);
        return kind === "river" ? coveredRiver.has(ci) : coveredRoad.has(ci);
      };
      const drawFeat = (kind: "river" | "road") => {
        for (const ft of feats) {
          if (ft.kind !== kind || !ft.path || ft.path.length < 2) continue;
          ctx.beginPath();
          let pen = false;
          for (let k = 0; k + 1 < ft.path.length; k++) {
            const [aq, ar] = ft.path[k], [bq, br] = ft.path[k + 1];
            // A segment whose both cells carry an exact tile is already painted by the art.
            if (covered(kind, aq, ar) && covered(kind, bq, br)) { pen = false; continue; }
            const oa = axialToOffset(aq, ar), ob = axialToOffset(bq, br);
            const ca = hexToPixel(oa.col, oa.row, BASE_SIZE), cb = hexToPixel(ob.col, ob.row, BASE_SIZE);
            if (!pen) ctx.moveTo(ca.x, ca.y);
            ctx.lineTo(cb.x, cb.y);
            pen = true;
          }
          if (kind === "river") { ctx.strokeStyle = "#3f7fb0"; ctx.lineWidth = (ft.klass >= 2 ? 0.42 : 0.24) * BASE_SIZE; }
          else { ctx.strokeStyle = "#caa25e"; ctx.lineWidth = (ft.klass === 0 ? 0.3 : 0.18) * BASE_SIZE; }
          ctx.stroke();
        }
      };
      drawFeat("river");
      drawFeat("road");
      // River name labels: constant screen size, drawn at the named segment's midpoint.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = "italic 12px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(247,244,239,0.85)";
      ctx.fillStyle = "#2e5a80";
      for (const ft of feats) {
        if (ft.kind !== "river" || !ft.name || ft.path.length < 3) continue;
        const mid = ft.path[Math.floor(ft.path.length / 2)];
        const o = axialToOffset(mid[0], mid[1]);
        const wc = hexToPixel(o.col, o.row, BASE_SIZE);
        const sx = view.scale * wc.x + view.tx;
        const sy = view.scale * wc.y + view.ty;
        ctx.strokeText(ft.name, sx, sy);
        ctx.fillText(ft.name, sx, sy);
      }
    }

    // POIs (Phase 4b): constant screen-size icons with screen-distance clustering, drawn last.
    const ps = poisRef.current;
    const hits: { kind: "poi" | "cluster"; sx: number; sy: number; r: number; id?: string; names: string[]; wx: number; wy: number }[] = [];
    if (ps && ps.length) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const S = 26, CLUSTER = 30;
      const mk: { sx: number; sy: number; p: { id: string; x: number; y: number; name: string; iconId: string } }[] = [];
      const pd = poiDragRef.current;
      for (const p of ps) {
        const ox = pd && pd.id === p.id ? pd.dx : 0;
        const oy = pd && pd.id === p.id ? pd.dy : 0;
        const sx = (p.x + ox) * view.scale + view.tx;
        const sy = (p.y + oy) * view.scale + view.ty;
        if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;
        mk.push({ sx, sy, p });
      }
      const used = new Set<number>();
      for (let i = 0; i < mk.length; i++) {
        if (used.has(i)) continue;
        const grp = [mk[i]];
        used.add(i);
        for (let j = i + 1; j < mk.length; j++) {
          if (used.has(j)) continue;
          const dx = mk[j].sx - mk[i].sx, dy = mk[j].sy - mk[i].sy;
          if (dx * dx + dy * dy < CLUSTER * CLUSTER) { grp.push(mk[j]); used.add(j); }
        }
        let cx = 0, cy = 0, wx = 0, wy = 0;
        for (const g of grp) { cx += g.sx; cy += g.sy; wx += g.p.x; wy += g.p.y; }
        cx /= grp.length; cy /= grp.length; wx /= grp.length; wy /= grp.length;
        if (grp.length === 1) {
          const p = grp[0].p;
          const img = iconCacheRef.current.get(p.iconId);
          if (img && iconReadyRef.current.has(p.iconId)) {
            ctx.drawImage(img, cx - S / 2, cy - S / 2, S, S);
          } else {
            ctx.fillStyle = "#c8a24b";
            ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
          }
          hits.push({ kind: "poi", sx: cx, sy: cy, r: S / 2 + 4, id: p.id, names: [p.name], wx, wy });
        } else {
          ctx.fillStyle = "#2a2118";
          ctx.strokeStyle = "#c8a24b";
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#f2e9d6";
          ctx.font = "600 12px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(grp.length), cx, cy);
          hits.push({ kind: "cluster", sx: cx, sy: cy, r: 15, names: grp.map((g) => g.p.name), wx, wy });
        }
      }
    }
    poiHitRef.current = hits;
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

  useEffect(() => {
    const ps = pois ?? [];
    for (const p of ps) {
      if (!p.iconId || iconCacheRef.current.has(p.iconId)) continue;
      const el = new Image();
      iconCacheRef.current.set(p.iconId, el);
      el.onload = () => { iconReadyRef.current.add(p.iconId); scheduleDraw(); };
      el.onerror = () => { iconReadyRef.current.delete(p.iconId); };
      el.src = p.iconSrc;
    }
    scheduleDraw();
  }, [pois, scheduleDraw]);

  useEffect(() => {
    const arr = biomeArt ?? [];
    for (let id = 0; id < arr.length; id++) {
      const url = arr[id];
      if (!url || biomeArtCacheRef.current.has(id)) continue;
      const el = new Image();
      biomeArtCacheRef.current.set(id, el);
      el.onload = () => { biomeArtReadyRef.current.add(id); scheduleDraw(); };
      el.onerror = () => { biomeArtReadyRef.current.delete(id); };
      el.src = url;
    }
    scheduleDraw();
  }, [biomeArt, scheduleDraw]);

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
  useEffect(() => { redrawRef.current = scheduleDraw; }, [scheduleDraw]);
  useEffect(() => {
    if (!baseImage) { baseImgRef.current = null; baseImgReadyRef.current = false; scheduleDraw(); return; }
    const img = new Image();
    img.onload = () => { baseImgRef.current = img; baseImgReadyRef.current = true; scheduleDraw(); };
    img.src = baseImage;
    return () => { img.onload = null; };
  }, [baseImage, scheduleDraw]);
  useEffect(() => { scheduleDraw(); }, [colors, positionImageId, regionCells, paintRegionId, regionRender, pois, biomeArt, artEnabled, features, showBaseImage, scheduleDraw]);

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

    let mode: "none" | "pan" | "paint" | "move" | "region" | "poi-move" = "none";
    let lastX = 0, lastY = 0;
    let downClientX = 0, downClientY = 0;
    let lastHoverKey: string | null = null;
    let lastHex: { col: number; row: number } | null = null;

    const hitTestPoi = (mx: number, my: number) => {
      for (const h of poiHitRef.current) {
        const dx = mx - h.sx, dy = my - h.sy;
        if (dx * dx + dy * dy <= h.r * h.r) return h;
      }
      return null;
    };
    const onHover = (e: MouseEvent) => {
      if (mode !== "none") return;
      const rect = canvas.getBoundingClientRect();
      const hit = hitTestPoi(e.clientX - rect.left, e.clientY - rect.top);
      const key = hit ? (hit.id || `c:${Math.round(hit.sx)},${Math.round(hit.sy)}`) : null;
      if (key === lastHoverKey) return;
      lastHoverKey = key;
      onPoiHoverRef.current?.(hit ? { names: hit.names, sx: hit.sx, sy: hit.sy } : null);
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      lastX = e.clientX; lastY = e.clientY;
      downClientX = e.clientX; downClientY = e.clientY;
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
        const rect = canvas.getBoundingClientRect();
        const hit = hitTestPoi(e.clientX - rect.left, e.clientY - rect.top);
        if (hit && hit.kind === "poi" && hit.id) { mode = "poi-move"; poiDragRef.current = { id: hit.id, dx: 0, dy: 0 }; }
        else { mode = "pan"; }
      }
    };
    const onMove = (e: PointerEvent) => {
      if (mode === "paint") {
        lastHex = paintAt(e.clientX, e.clientY, lastHex);
      } else if (mode === "region") {
        lastHex = paintRegionAt(e.clientX, e.clientY, lastHex);
      } else if (mode === "poi-move") {
        const d = poiDragRef.current;
        if (d) {
          d.dx += (e.clientX - lastX) / viewRef.current.scale;
          d.dy += (e.clientY - lastY) / viewRef.current.scale;
          lastX = e.clientX; lastY = e.clientY;
          scheduleDraw();
        }
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
      if (mode === "poi-move") {
        const d = poiDragRef.current;
        if (d) {
          const moved = Math.abs(e.clientX - downClientX) >= 5 || Math.abs(e.clientY - downClientY) >= 5;
          const p = poisRef.current?.find((x) => x.id === d.id);
          if (moved && p) onMovePoiRef.current?.(d.id, p.x + d.dx, p.y + d.dy);
          else if (!moved && p) { const v = viewRef.current; onPoiClickRef.current?.(d.id, p.x * v.scale + v.tx, p.y * v.scale + v.ty); }
        }
        poiDragRef.current = null;
        scheduleDraw();
      }
      if ((mode === "pan" || mode === "none") && Math.abs(e.clientX - downClientX) < 5 && Math.abs(e.clientY - downClientY) < 5) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const hit = hitTestPoi(mx, my);
        if (hit) {
          if (hit.kind === "poi" && hit.id) {
            onPoiClickRef.current?.(hit.id, hit.sx, hit.sy);
          } else if (hit.kind === "cluster") {
            const v = viewRef.current;
            const ns = Math.min(8, v.scale * 2);
            v.tx = hit.sx - hit.wx * ns;
            v.ty = hit.sy - hit.wy * ns;
            v.scale = ns;
            scheduleDraw();
          }
        } else if (placeActiveRef.current) {
          const v = viewRef.current;
          onPlacePoiRef.current?.((mx - v.tx) / v.scale, (my - v.ty) / v.scale);
        }
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
    canvas.addEventListener("mousemove", onHover);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousemove", onHover);
    };
  }, [paintAt, paintRegionAt, scheduleDraw]);

  const cursor = positionImageId != null ? "move" : (paintRegionId != null || selectedBiome != null || poiPlaceActive) ? "crosshair" : "grab";

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor }}
    />
  );
}
