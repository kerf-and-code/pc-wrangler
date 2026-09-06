// lib/worldmap/snapshot.ts
//
// Renders the whole world to a PNG for publishing to the wiki: terrain art (with flat-colour
// fallback), placed images, and POI markers, fit to the full grid, with NO hex grid lines. A flat
// picture, not the interactive map. Client-side (needs a real canvas + toBlob); cross-origin images
// are loaded with crossOrigin so toBlob does not taint. Regions are intentionally out of v1.

import { type Terrain, index, BIOME_UNSET, axialToOffset } from "./hex";
import { hexToPixel, hexCorners, gridPixelSize, gridOrigin, BASE_SIZE } from "./layout";

const SQRT3 = Math.sqrt(3);

type SnapImage = { url: string; x: number; y: number; scale: number; z: number };
type SnapPoi = { x: number; y: number; iconSrc: string };
type SnapFeature = { kind: "river" | "road"; klass: number; path: [number, number][]; name?: string | null };
// A custom tile the GM painted onto hexes: its cropped image URL and average colour, plus the sparse
// map of hex index -> tile id. Shared by the snapshot renderer and the AI-stamp compositor below.
type SnapCustomTile = { id: string; url: string; color: string };
export type CustomHexMap = Record<string, string>;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = url;
  });
}

export async function renderWorldSnapshot(opts: {
  terrain: Terrain;
  colors: readonly string[];
  biomeArt?: readonly (string | null)[];
  images?: SnapImage[];
  pois?: SnapPoi[];
  features?: SnapFeature[];
  maxPx?: number;
  smooth?: boolean;
  mime?: "image/png" | "image/jpeg";
  quality?: number;
  customHexes?: CustomHexMap;         // hex index -> custom tile id
  customTiles?: SnapCustomTile[];     // the tiles referenced by customHexes
  customAsColor?: boolean;            // true: draw custom hexes as flat avg colour (AI control); false: draw the tile image
}): Promise<Blob> {
  const { terrain, colors, biomeArt = [], images = [], pois = [], features = [], maxPx = 2048, mime = "image/png", quality = 0.92, smooth = false, customHexes = {}, customTiles = [], customAsColor = false } = opts;
  const W = terrain.meta.width, H = terrain.meta.height;
  const customUrl = new Map<string, string>(), customCol = new Map<string, string>();
  for (const t of customTiles) { customUrl.set(t.id, t.url); customCol.set(t.id, t.color); }
  const hasCustom = Object.keys(customHexes).length > 0;

  const g = gridPixelSize(W, H, BASE_SIZE);
  const o = gridOrigin();
  const scale = Math.min(maxPx / g.w, maxPx / g.h, 12);
  const cw = Math.max(1, Math.round(g.w * scale));
  const ch = Math.max(1, Math.round(g.h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D context for the snapshot.");
  ctx.setTransform(scale, 0, 0, scale, -o.x * scale, -o.y * scale);

  // Preload everything, then draw synchronously.
  const usedBiomes = new Set<number>();
  for (let i = 0; i < terrain.biome.length; i++) {
    const b = terrain.biome[i];
    if (b !== BIOME_UNSET && b < colors.length) usedBiomes.add(b);
  }
  const tiles = new Map<number, HTMLImageElement | null>();
  await Promise.all([...usedBiomes].map(async (b) => {
    const url = biomeArt[b];
    tiles.set(b, url ? await loadImage(url) : null);
  }));
  const imgEls = await Promise.all(images.map((im) => loadImage(im.url)));
  const poiEls = await Promise.all(pois.map((p) => loadImage(p.iconSrc)));

  // Preload the custom-tile images actually used (skipped when drawing them as flat colour).
  const customImg = new Map<string, HTMLImageElement | null>();
  if (hasCustom && !customAsColor) {
    const usedTiles = new Set(Object.values(customHexes));
    await Promise.all([...usedTiles].map(async (id) => { const u = customUrl.get(id); customImg.set(id, u ? await loadImage(u) : null); }));
  }

  // Placed images first (bottom).
  const order = images.map((im, i) => ({ im, el: imgEls[i] })).sort((a, b) => a.im.z - b.im.z);
  for (const { im, el } of order) {
    if (el) ctx.drawImage(el, im.x, im.y, el.naturalWidth * im.scale, el.naturalHeight * im.scale);
  }

  // Terrain: art tile per painted hex, or a flat-filled hex. No grid lines.
  const bw = SQRT3 * BASE_SIZE, bh = 2 * BASE_SIZE;
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      // Custom tile first: it draws regardless of the underlying biome. As colour for the AI control,
      // as the cropped image (into a bh x bh box, so the pointy-top hex aligns) for a stamped map.
      const cTid = hasCustom ? customHexes[String(index(col, row, W))] : undefined;
      if (cTid) {
        const center = hexToPixel(col, row, BASE_SIZE);
        const cimg = customAsColor ? null : customImg.get(cTid) ?? null;
        if (cimg) { ctx.drawImage(cimg, center.x - bh / 2, center.y - bh / 2, bh, bh); }
        else {
          const pts = hexCorners(center, BASE_SIZE);
          ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath();
          ctx.fillStyle = customCol.get(cTid) || "#8a7f68"; ctx.fill();
        }
        continue;
      }
      const b = terrain.biome[index(col, row, W)];
      if (b === BIOME_UNSET || b >= colors.length) continue;
      const center = hexToPixel(col, row, BASE_SIZE);
      const tile = tiles.get(b);
      if (tile) {
        ctx.drawImage(tile, center.x - bw / 2, center.y - bh / 2, bw, bh);
      } else {
        const pts = hexCorners(center, BASE_SIZE);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fillStyle = colors[b];
        ctx.fill();
      }
    }
  }

  // Beach fringe (fantasy control only): paint a sandy, or rocky for mountainous coasts, band on land
  // hexes that touch open ocean, so the smoothing blur turns it into a beach and Gemini renders shores.
  if (smooth) {
    const AX: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const isOcean = (bb: number) => bb === 17 || bb === 19;
    const isLand = (bb: number) => !(bb === BIOME_UNSET || bb === 16 || bb === 17 || bb === 19);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const b = terrain.biome[index(col, row, W)];
        if (!isLand(b)) continue;
        const q = col - (row - (row & 1)) / 2, r = row;
        let coastal = false;
        for (const [dq, dr] of AX) {
          const nr = r + dr, nc = (q + dq) + (nr - (nr & 1)) / 2;
          if (nc < 0 || nc >= W || nr < 0 || nr >= H) continue;
          if (isOcean(terrain.biome[nr * W + nc])) { coastal = true; break; }
        }
        if (!coastal) continue;
        const rocky = b === 20 || b === 11 || b === 22 || b === 21 || b === 24; // mountains/alpine/canyon/volcanic/blighted
        const center = hexToPixel(col, row, BASE_SIZE);
        const pts = hexCorners(center, BASE_SIZE);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let k = 1; k < 6; k++) ctx.lineTo(pts[k].x, pts[k].y);
        ctx.closePath();
        ctx.fillStyle = rocky ? "#8f8674" : "#e6d5a8";
        ctx.fill();
      }
    }
  }

  // Feature overlays (rivers, roads) over terrain, then river labels, under POIs.
  if (features.length) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const drawKind = (kind: "river" | "road") => {
      for (const ft of features) {
        if (ft.kind !== kind || ft.path.length < 2) continue;
        ctx.beginPath();
        for (let k = 0; k < ft.path.length; k++) {
          const off = axialToOffset(ft.path[k][0], ft.path[k][1]);
          const c = hexToPixel(off.col, off.row, BASE_SIZE);
          if (k === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
        }
        if (kind === "river") { ctx.strokeStyle = "#3f7fb0"; ctx.lineWidth = (ft.klass >= 2 ? 0.42 : 0.24) * BASE_SIZE; }
        else { ctx.strokeStyle = "#caa25e"; ctx.lineWidth = (ft.klass === 0 ? 0.3 : 0.18) * BASE_SIZE; }
        ctx.stroke();
      }
    };
    drawKind("river");
    drawKind("road");
    ctx.font = `italic ${1.2 * BASE_SIZE}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 0.22 * BASE_SIZE;
    ctx.strokeStyle = "rgba(247,244,239,0.85)";
    ctx.fillStyle = "#2e5a80";
    for (const ft of features) {
      if (ft.kind !== "river" || !ft.name || ft.path.length < 3) continue;
      const mid = ft.path[Math.floor(ft.path.length / 2)];
      const off = axialToOffset(mid[0], mid[1]);
      const c = hexToPixel(off.col, off.row, BASE_SIZE);
      ctx.strokeText(ft.name, c.x, c.y);
      ctx.fillText(ft.name, c.x, c.y);
    }
  }

  // POIs, sized to about one hex.
  const poiSize = 2 * BASE_SIZE;
  pois.forEach((p, i) => {
    const el = poiEls[i];
    if (el) ctx.drawImage(el, p.x - poiSize / 2, p.y - poiSize / 2, poiSize, poiSize);
  });

  // Smoothing pass (used for the AI fantasy control): blur away the hard hex edges so the model sees
  // soft organic regions, not a grid of tiles. Blur auto-scales to the on-screen hex width.
  let outCanvas: HTMLCanvasElement = canvas;
  if (smooth) {
    const hexPx = Math.sqrt(3) * BASE_SIZE * scale;
    const blur = Math.max(2, Math.round(hexPx * 0.55));
    const tmp = document.createElement("canvas");
    tmp.width = cw; tmp.height = ch;
    const tctx = tmp.getContext("2d");
    if (tctx) { tctx.filter = `blur(${blur}px)`; tctx.drawImage(canvas, 0, 0); outCanvas = tmp; }
  }

  return await new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Snapshot toBlob failed."))), mime, quality);
  });
}

// Draw the GM's custom hex tiles (crisp) over an already-rendered map image (typically the AI fantasy
// view), aligning them to the same hex geometry. Returns a PNG data URL. Used for the "AI + stamp"
// render mode: the AI paints the base, the GM's actual cropped images sit on their painted hexes.
export async function stampCustomHexesOverImage(
  baseUrl: string,
  terrain: Terrain,
  customHexes: CustomHexMap,
  customTiles: SnapCustomTile[],
): Promise<string> {
  const W = terrain.meta.width, H = terrain.meta.height;
  const base = await loadImage(baseUrl);
  if (!base) return baseUrl;
  const g = gridPixelSize(W, H, BASE_SIZE);
  const o = gridOrigin();
  const cw = base.naturalWidth || Math.round(g.w), ch = base.naturalHeight || Math.round(g.h);
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return baseUrl;
  ctx.drawImage(base, 0, 0, cw, ch);

  const urlById = new Map<string, string>();
  for (const t of customTiles) urlById.set(t.id, t.url);
  const used = new Set(Object.values(customHexes));
  const imgs = new Map<string, HTMLImageElement | null>();
  await Promise.all([...used].map(async (id) => { const u = urlById.get(id); imgs.set(id, u ? await loadImage(u) : null); }));

  // Map grid pixel space to the base image: same box (g), scaled to the image, origin at o.
  const sx = cw / g.w, sy = ch / g.h;
  ctx.setTransform(sx, 0, 0, sy, -o.x * sx, -o.y * sy);
  const bh = 2 * BASE_SIZE;
  for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
    const id = customHexes[String(index(col, row, W))]; if (!id) continue;
    const im = imgs.get(id); if (!im) continue;
    const center = hexToPixel(col, row, BASE_SIZE);
    ctx.drawImage(im, center.x - bh / 2, center.y - bh / 2, bh, bh);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas.toDataURL("image/png");
}
