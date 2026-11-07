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
// Sight is a visibility polygon per token: rays cast at every wall end point (and a hair either side),
// each stopped by the nearest wall. No range limit and no light yet: dim light, darkness and darkvision
// come later.

export type Seg = { ax: number; ay: number; bx: number; by: number };
export type Pt = { x: number; y: number };

export function wallSegments(m: MapShape, open: Record<string, unknown>): Seg[] {
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

// Trees whose canopy hangs over tokens: drawn above them, and faded while a token stands beneath.
export const CANOPY_KINDS = new Set(["tree", "pine", "deadtree"]);
