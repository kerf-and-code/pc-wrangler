import { walledAt, type MapShape } from "@/lib/tabletop/fog";

// lib/tabletop/sight.ts (2026-11-07)
//
// Line of sight for the tabletop, phase 3b. Pure: no React, no network. Everything is in squares.
//
// Walls come straight from the battle map, the same rule the renderer draws them by: an edge between a
// walled square and an open one (indoors every painted square is walled; outdoors buildings, caves and
// decks). A door edge blocks while the door is closed and passes once it is open; an archway always
// passes. The map's border closes everything in.
//
// Sight walls (Phase 5j): the GM can also draw invisible straight walls at any angle over the map
// (battle_maps.meta.sightWalls), for an uploaded image whose painted walls the grid knows nothing about.
// They come in as `more` and block exactly like a grid wall.
//
// Sight is a visibility polygon per token: rays cast at every wall end point (and a hair either side),
// each stopped by the nearest wall. No range limit and no light yet: dim light, darkness and darkvision
// come later.

// kind (phase 5v): 0 or absent a wall, 1 a window (stops feet, not eyes), 2 a screen (stops eyes, not
// feet), 3 one-way (stops feet; stops eyes only from behind, see forSight). Grid walls and doors are 0.
export type Seg = { ax: number; ay: number; bx: number; by: number; kind?: number };
export type Pt = { x: number; y: number };

// A level's sight walls ([ax, ay, bx, by] and an optional kind, in squares, as lib/dungeon/battle
// normSightWalls keeps them) as segments.
export function sightWallSegs(walls: (readonly [number, number, number, number, number?])[]): Seg[] {
  return walls.map(([ax, ay, bx, by, k]) => (k === 1 || k === 2 || k === 3 ? { ax, ay, bx, by, kind: k } : { ax, ay, bx, by }));
}

/**
 * The walls that block sight (and light) for a viewer at p (phase 5v): every kind but windows, and a
 * one-way wall only when p is behind it. Its front is the side of the normal (-dy, dx) of a to b, where
 * the map editor draws its ticks; from there it is seen through.
 */
export function forSight(segs: Seg[], p: Pt): Seg[] {
  return segs.filter((s) => {
    if (s.kind === 1) return false;
    if (s.kind !== 3) return true;
    const front = (s.bx - s.ax) * (p.y - s.ay) - (s.by - s.ay) * (p.x - s.ax);
    return front <= 0;
  });
}

/** The walls that block movement (phase 5v): every kind but screens. */
export function forMove(segs: Seg[]): Seg[] {
  return segs.filter((s) => s.kind !== 2);
}

export function wallSegments(m: MapShape, open: Record<string, unknown>, more: Seg[] = []): Seg[] {
  const { n } = m, extra = new Set(m.walls ?? []);
  const blocks = (key: string, walledA: boolean, walledB: boolean) => {
    if (extra.has(key)) return true;
    const kind = m.doors[key];
    if (kind) return kind !== "arch" && !open[key];
    return walledA !== walledB;
  };
  // horizontal edges: the top edge of square (r, c), r = 0..n; vertical: the left edge of (r, c), c = 0..n
  const hRuns: Map<number, [number, number][]> = new Map(), vRuns: Map<number, [number, number][]> = new Map();
  const push = (map: Map<number, [number, number][]>, line: number, a: number) => {
    const runs = map.get(line) ?? [];
    const last = runs[runs.length - 1];
    if (last && last[1] === a) last[1] = a + 1; else runs.push([a, a + 1]);
    map.set(line, runs);
  };
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) {
    const below = walledAt(m, c, r), above = walledAt(m, c, r - 1);
    if (blocks(`${r * n + c}h`, below, above)) push(hRuns, r, c);
  }
  for (let c = 0; c <= n; c++) for (let r = 0; r < n; r++) {
    const right = walledAt(m, c, r), left = walledAt(m, c - 1, r);
    // a door on the far right border would be owned by a square one past the row; there are none in practice
    const key = c < n ? `${r * n + c}v` : "";
    if (key ? blocks(key, right, left) : right !== left) push(vRuns, c, r);
  }
  const out: Seg[] = [];
  for (const [r, runs] of hRuns) for (const [a, b] of runs) out.push({ ax: a, ay: r, bx: b, by: r });
  for (const [c, runs] of vRuns) for (const [a, b] of runs) out.push({ ax: c, ay: a, bx: c, by: b });
  // the border of the map, so every ray ends somewhere
  out.push({ ax: 0, ay: 0, bx: n, by: 0 }, { ax: n, ay: 0, bx: n, by: n }, { ax: n, ay: n, bx: 0, by: n }, { ax: 0, ay: n, bx: 0, by: 0 });
  for (const s of more) out.push(s);
  return out;
}

// Distance along a ray from o in direction (dx, dy) to segment s, or Infinity.
function hit(o: Pt, dx: number, dy: number, s: Seg): number {
  const ex = s.bx - s.ax, ey = s.by - s.ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const t = ((s.ax - o.x) * ey - (s.ay - o.y) * ex) / den;
  const u = ((s.ax - o.x) * dy - (s.ay - o.y) * dx) / den;
  if (t <= 1e-9 || u < -1e-9 || u > 1 + 1e-9) return Infinity;
  return t;
}

/**
 * Phase 5o: where a token's centre stops when moved in a straight line from a toward b, if a wall is in
 * the way (map walls, closed doors, sight walls): `pad` squares short of the first wall it meets.
 * Returns b itself when the way is clear. Only the centre line is checked, so a token passes any gap its
 * centre fits through, as in most virtual tabletops.
 */
export function moveStop(a: Pt, b: Pt, segs: Seg[], pad = 0.2): { x: number; y: number; blocked: boolean } {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: b.x, y: b.y, blocked: false };
  let t = Infinity;
  for (const s of segs) { const h = hit(a, dx, dy, s); if (h < t) t = h; }
  if (t > 1) return { x: b.x, y: b.y, blocked: false };
  const k = Math.max(0, t - pad / len);
  return { x: a.x + dx * k, y: a.y + dy * k, blocked: true };
}

// The area a viewer at o can see, as a polygon (points in angle order).
export function visibility(o: Pt, segs: Seg[]): Pt[] {
  const angles: number[] = [];
  const seen = new Set<string>();
  for (const s of segs) for (const [x, y] of [[s.ax, s.ay], [s.bx, s.by]]) {
    const key = `${x},${y}`; if (seen.has(key)) continue; seen.add(key);
    const a = Math.atan2(y - o.y, x - o.x);
    angles.push(a - 1e-5, a, a + 1e-5);
  }
  const pts: { a: number; p: Pt }[] = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = Infinity;
    for (const s of segs) { const t = hit(o, dx, dy, s); if (t < best) best = t; }
    if (best < Infinity) pts.push({ a, p: { x: o.x + dx * best, y: o.y + dy * best } });
  }
  pts.sort((p, q) => p.a - q.a);
  return pts.map((x) => x.p);
}

export function insidePoly(poly: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Squares a polygon shows: those whose centre is inside it, plus, indoors, the rock squares beside
// them, so remembered rooms keep their walls and hatching.
export function seenSquares(m: MapShape, poly: Pt[]): number[] {
  const { n } = m;
  if (poly.length < 3) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const out = new Set<number>();
  for (let r = Math.max(0, Math.floor(y0)); r <= Math.min(n - 1, Math.floor(y1)); r++) {
    for (let c = Math.max(0, Math.floor(x0)); c <= Math.min(n - 1, Math.floor(x1)); c++) {
      if (!insidePoly(poly, c + 0.5, r + 0.5)) continue;
      out.add(r * n + c);
      if (m.outdoor) continue;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 >= 0 && c2 >= 0 && r2 < n && c2 < n && !walledAt(m, c2, r2)) out.add(r2 * n + c2);
      }
    }
  }
  return [...out];
}

// Can a viewer with these polygons see a token? Its centre, or any of four points around its rim.
export function canSee(polys: Pt[][], x: number, y: number, radius: number): boolean {
  const k = radius * 0.6;
  const probes: [number, number][] = [[x, y], [x + k, y], [x - k, y], [x, y + k], [x, y - k]];
  return polys.some((poly) => probes.some(([px, py]) => insidePoly(poly, px, py)));
}

// ---------------------------------------------------------------------------------------------------
// Light (Phase 5k). A scene is bright (sight alone decides), dim (everything in sight is seen, shaded,
// and lights brighten their area) or dark (only what is lit, or within the viewer's darkvision, is seen).
// A light source sits on a token: bright light out to `bright`, dim light a further `dim` beyond, both
// measured from the token's edge as auras are, and stopped by walls exactly as sight is (its own
// visibility polygon). Darkvision is a radius around the viewer, inside the viewer's sight.
// Everything here is in squares; the table turns feet into squares.

export type LightMode = "bright" | "dim" | "dark";
export const LIGHT_MODES: { key: LightMode; label: string }[] = [
  { key: "bright", label: "Bright" }, { key: "dim", label: "Dim" }, { key: "dark", label: "Dark" },
];
export const lightModeOf = (v: unknown): LightMode => (v === "dim" || v === "dark" ? v : "bright");

// Bright and dim radii in feet, from the 2024 rules' light sources.
export const LIGHT_PRESETS: { key: string; label: string; bright: number; dim: number }[] = [
  { key: "candle", label: "Candle (5 + 5 ft)", bright: 5, dim: 5 },
  { key: "torch", label: "Torch (20 + 20 ft)", bright: 20, dim: 20 },
  { key: "lamp", label: "Lamp (15 + 30 ft)", bright: 15, dim: 30 },
  { key: "lantern", label: "Lantern (30 + 30 ft)", bright: 30, dim: 30 },
  { key: "light", label: "Light cantrip (20 + 20 ft)", bright: 20, dim: 20 },
  { key: "daylight", label: "Daylight (60 + 60 ft)", bright: 60, dim: 60 },
];
export const DARKVISION_FT = [60, 90, 120, 300];

// A token's light from its style ({ light: { bright, dim } }), or null.
export function lightOf(style: Record<string, unknown> | null | undefined): { bright: number; dim: number } | null {
  const l = style?.light as { bright?: unknown; dim?: unknown } | undefined;
  if (!l || typeof l !== "object") return null;
  const bright = Math.max(0, Math.min(600, Number(l.bright) || 0)), dim = Math.max(0, Math.min(600, Number(l.dim) || 0));
  return bright + dim > 0 ? { bright, dim } : null;
}
export function darkvisionOf(style: Record<string, unknown> | null | undefined): number {
  return Math.max(0, Math.min(600, Number(style?.darkvision) || 0));
}

export type Light = { x: number; y: number; bright: number; r: number; poly: Pt[] };   // r: bright + dim
export type Viewer = { x: number; y: number; dv: number; poly: Pt[] };

// Is this point lit by any light (bright or dim)?
export function litAt(lights: Light[], x: number, y: number): boolean {
  return lights.some((L) => Math.hypot(x - L.x, y - L.y) <= L.r && insidePoly(L.poly, x, y));
}

// Does this viewer see the point, given the scene's light?
export function seesPoint(v: Viewer, lights: Light[], mode: LightMode, x: number, y: number): boolean {
  if (!insidePoly(v.poly, x, y)) return false;
  if (mode !== "dark") return true;
  return Math.hypot(x - v.x, y - v.y) <= v.dv || litAt(lights, x, y);
}

// canSee with light: the token's centre or a point on its rim, seen by any viewer.
export function canSeeLit(viewers: Viewer[], lights: Light[], mode: LightMode, x: number, y: number, radius: number): boolean {
  const k = radius * 0.6;
  const probes: [number, number][] = [[x, y], [x + k, y], [x - k, y], [x, y + k], [x, y - k]];
  return viewers.some((v) => probes.some(([px, py]) => seesPoint(v, lights, mode, px, py)));
}

// Trees whose canopy hangs over tokens: drawn above them, and faded while a token stands beneath.
export const CANOPY_KINDS = new Set(["tree", "pine", "deadtree"]);
