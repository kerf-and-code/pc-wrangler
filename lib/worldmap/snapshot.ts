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
}): Promise<Blob> {
  const { terrain, colors, biomeArt = [], images = [], pois = [], features = [], maxPx = 2048 } = opts;
  const W = terrain.meta.width, H = terrain.meta.height;

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

  // Placed images first (bottom).
  const order = images.map((im, i) => ({ im, el: imgEls[i] })).sort((a, b) => a.im.z - b.im.z);
  for (const { im, el } of order) {
    if (el) ctx.drawImage(el, im.x, im.y, el.naturalWidth * im.scale, el.naturalHeight * im.scale);
  }

  // Terrain: art tile per painted hex, or a flat-filled hex. No grid lines.
  const bw = SQRT3 * BASE_SIZE, bh = 2 * BASE_SIZE;
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
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

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Snapshot toBlob failed."))), "image/png");
  });
}
