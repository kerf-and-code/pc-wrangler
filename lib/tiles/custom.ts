// Custom-tile library shared code. A custom tile is a cropped image the GM frames out of an uploaded
// picture: a hexagon for the world map, a square for the dungeon. It carries an average colour (used as
// the flat control-image swatch when a map is AI-painted, and as the live-editor fill) and a label, and
// is stored GLOBALLY per GM (see p87-custom-tiles.sql). This module holds the shared types, the crop +
// average-colour math (browser canvas), the hexagon/square geometry reused by the painters when they
// stamp a tile into a cell, and the thin fetch client for /api/custom-tiles. No React, no server code.

export type TileScope = "dungeon" | "world";

export interface CustomTile {
  id: string;
  scope: TileScope;
  label: string;
  color: string;      // average colour, "#rrggbb"
  imageUrl: string;   // public URL of the cropped PNG
  createdAt?: string;
}

export interface CustomTileRow {
  id: string;
  scope: string;
  label: string | null;
  color: string | null;
  image_url: string;
  created_at?: string;
}

export function rowToTile(r: CustomTileRow): CustomTile {
  return {
    id: r.id,
    scope: r.scope === "world" ? "world" : "dungeon",
    label: r.label || "Custom tile",
    color: r.color || "#888888",
    imageUrl: r.image_url,
    createdAt: r.created_at,
  };
}

// World hexes on this map are pointy-top (a vertex points up). The dungeon uses squares. Keeping the
// orientation here means the crop mask and the in-map stamp always agree.
export const HEX_POINTY = true;

// Trace a hexagon path centred at (cx, cy) with circumradius r. Pointy-top puts a vertex straight up.
export function pathHex(ctx: CanvasRenderingContext2D | Path2D, cx: number, cy: number, r: number, pointy = HEX_POINTY): void {
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i + (pointy ? -90 : 0));
    const x = cx + r * Math.cos(ang), y = cy + r * Math.sin(ang);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Average colour of the opaque pixels of a canvas, as "#rrggbb". Ignores fully transparent pixels so a
// hex crop's corners don't drag the average toward black.
export function averageColorOf(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext("2d");
  if (!ctx) return "#888888";
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  // Sample on a stride for speed on large tiles.
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4096)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 8) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  if (!n) return "#888888";
  const hx = (v: number) => Math.max(0, Math.min(255, Math.round(v / n))).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

// How the uploaded image is framed inside the square viewport: drawn at (ox, oy) in viewport pixels,
// scaled by `scale` relative to its natural size. The painter's viewport and this share the model.
export interface CropView { scale: number; ox: number; oy: number }

export interface CropResult { dataUrl: string; color: string }

// Render the framed region of `img` to an `out`x`out` PNG, masked to the tile shape (hex for world,
// square for dungeon), and report its average colour. `viewport` is the on-screen framing box side.
export function cropTile(
  img: HTMLImageElement,
  view: CropView,
  opts: { viewport: number; out?: number; scope: TileScope; pointy?: boolean },
): CropResult {
  const out = opts.out ?? 256;
  const k = out / opts.viewport;
  const canvas = document.createElement("canvas");
  canvas.width = out; canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataUrl: "", color: "#888888" };
  ctx.save();
  ctx.beginPath();
  if (opts.scope === "world") pathHex(ctx, out / 2, out / 2, out / 2, opts.pointy ?? HEX_POINTY);
  else ctx.rect(0, 0, out, out);
  ctx.clip();
  ctx.drawImage(img, view.ox * k, view.oy * k, img.naturalWidth * view.scale * k, img.naturalHeight * view.scale * k);
  ctx.restore();
  return { dataUrl: canvas.toDataURL("image/png"), color: averageColorOf(canvas) };
}

// Load an image URL to an HTMLImageElement (crossOrigin set so stamped tiles from the public bucket can
// be drawn onto a canvas that is later exported without tainting it).
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// ---- fetch client for /api/custom-tiles -------------------------------------------------------------

export async function listCustomTiles(scope?: TileScope): Promise<CustomTile[]> {
  const res = await fetch(`/api/custom-tiles${scope ? `?scope=${scope}` : ""}`, { method: "GET" });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const rows: CustomTileRow[] = Array.isArray(data?.tiles) ? data.tiles : [];
  return rows.map(rowToTile);
}

export async function createCustomTile(input: { scope: TileScope; label: string; dataUrl: string; color: string }): Promise<CustomTile | null> {
  const res = await fetch("/api/custom-tiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.tile ? rowToTile(data.tile as CustomTileRow) : null;
}

export async function deleteCustomTile(id: string): Promise<boolean> {
  const res = await fetch(`/api/custom-tiles?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  return res.ok;
}
