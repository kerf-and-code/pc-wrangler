// lib/tabletop/uvtt.ts (2026-11-08)
//
// Universal VTT import (phase 5t, gap 4 in the tabletop audit doc): the map files Dungeondraft (.dd2vtt),
// DungeonFog (.df2vtt), Arkenforge and others export (.uvtt). One JSON file holds the map picture and
// what a tabletop needs to know about it. Pure: no React, no network.
//
// What the file holds (as Universal VTT importers read it, e.g. FVTT-DD-Import): every position is in
// grid squares, measured from resolution.map_origin; resolution.map_size is the map's size in squares
// and resolution.pixels_per_grid the picture's square size; line_of_sight is a list of polylines (the
// walls); objects_line_of_sight the same for pillars and furniture; portals are doors (closed: true) and
// windows (closed: false), each a straight line between its two bounds points; lights have a position,
// a range in squares, an intensity and an ARGB colour; image is the picture, base64.
//
// What Six Axes makes of it:
//   * walls become the map's sight walls (battle_maps.meta.sightWalls, which block sight and, for
//     players, movement), straightened first: a cave wall arrives as hundreds of tiny pieces, and the
//     table keeps at most MAX_SIGHT_WALLS a level. Straightening keeps every point within TOLERANCE of
//     the drawn wall;
//   * doors that sit on the grid's lines become real doors on those square edges, so they open and close
//     at the table like any other door. A door at an angle or between grid lines cannot be a grid door;
//     it is left as a gap in the wall and counted, so the GM can see it;
//   * windows become window walls (phase 5v wall types: they stop feet, not eyes), and the outlines of
//     pillars and furniture become window walls too (what Roll20 does with them), or plain walls when
//     the GM says they block sight; lights are counted only (lights belong to tokens at the table).
// Everything left out is reported, never dropped silently.

import { MAX_SIGHT_WALLS, type SightWall, type WallKind } from "@/lib/dungeon/battle";

export const UVTT_EXT = /\.(dd2vtt|df2vtt|uvtt)$/i;
export const MAX_UVTT_BYTES = 150 * 1024 * 1024;
const TOLERANCE = 0.05;          // squares: how far a straightened wall may stray from the drawn one
const ON_LINE = 0.2;             // squares: how close to a grid line a door must sit to become a grid door

export type Pt = { x: number; y: number };
export type Portal = { a: Pt; b: Pt; closed: boolean };
export type Uvtt = {
  ppg: number;                    // the picture's pixels per square
  cols: number; rows: number;     // the map's size in squares
  image: string | null;           // base64 picture, as in the file (no data: prefix)
  walls: Pt[][];                  // polylines, in squares from the map's top-left corner
  objects: Pt[][];
  portals: Portal[];
  lights: number;
};
export type UvttResult = { ok: true; map: Uvtt } | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pt = (v: unknown, ox: number, oy: number): Pt | null => {
  const o = v as { x?: unknown; y?: unknown } | null;
  return o && isNum(o.x) && isNum(o.y) ? { x: o.x - ox, y: o.y - oy } : null;
};
const lines = (raw: unknown, ox: number, oy: number): Pt[][] =>
  (Array.isArray(raw) ? raw : []).map((l) => (Array.isArray(l) ? l.map((p) => pt(p, ox, oy)).filter((p): p is Pt => !!p) : [])).filter((l) => l.length >= 2);

/** Reads a Universal VTT file's JSON (already parsed). */
export function readUvtt(json: unknown): UvttResult {
  if (!json || typeof json !== "object") return { ok: false, error: "That is not a Universal VTT file." };
  const o = json as Record<string, unknown>;
  const res = o.resolution as { map_origin?: unknown; map_size?: unknown; pixels_per_grid?: unknown } | undefined;
  const size = res?.map_size as { x?: unknown; y?: unknown } | undefined;
  if (!res || !size || !isNum(size.x) || !isNum(size.y)) return { ok: false, error: "That file has no map size (resolution.map_size), so it is not a Universal VTT map." };
  const origin = (res.map_origin ?? { x: 0, y: 0 }) as { x?: unknown; y?: unknown };
  const ox = isNum(origin.x) ? origin.x : 0, oy = isNum(origin.y) ? origin.y : 0;
  const ppg = isNum(res.pixels_per_grid) && res.pixels_per_grid > 0 ? res.pixels_per_grid : 0;
  if (!ppg) return { ok: false, error: "That file does not say how big a square is (resolution.pixels_per_grid)." };
  const portals: Portal[] = (Array.isArray(o.portals) ? o.portals : []).flatMap((p) => {
    const q = p as { bounds?: unknown; closed?: unknown };
    const bounds = Array.isArray(q?.bounds) ? q.bounds : [];
    const a = pt(bounds[0], ox, oy), b = pt(bounds[1], ox, oy);
    return a && b ? [{ a, b, closed: q.closed !== false }] : [];
  });
  return {
    ok: true,
    map: {
      ppg, cols: Math.round(size.x), rows: Math.round(size.y),
      image: typeof o.image === "string" && o.image.length > 100 ? o.image.replace(/^data:image\/[a-z]+;base64,/, "") : null,
      walls: lines(o.line_of_sight, ox, oy),
      objects: lines(o.objects_line_of_sight, ox, oy),
      portals,
      lights: Array.isArray(o.lights) ? o.lights.length : 0,
    },
  };
}

/** Ramer-Douglas-Peucker: the fewest points that keep every original point within tol of the line. */
export function simplify(line: Pt[], tol = TOLERANCE): Pt[] {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length); keep[0] = 1; keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = line[i], b = line[j], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    let far = -1, worst = tol;
    for (let k = i + 1; k < j; k++) {
      const p = line[k];
      const d = len < 1e-9 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len;
      if (d > worst) { worst = d; far = k; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return line.filter((_, k) => keep[k]);
}

/**
 * The grid edges a door covers, when it lies along a grid line: keys as lib/dungeon/classic parseEdge
 * reads them ("<i>h" for the top edge of square i, "<i>v" for its left edge). Null when it does not.
 */
export function doorEdges(p: Portal, n: number): string[] | null {
  const { a, b } = p;
  const horiz = Math.abs(a.y - b.y) < ON_LINE, vert = Math.abs(a.x - b.x) < ON_LINE;
  if (horiz === vert) return null;                 // at an angle (or a dot)
  const line = Math.round(horiz ? (a.y + b.y) / 2 : (a.x + b.x) / 2);
  if (Math.abs((horiz ? (a.y + b.y) / 2 : (a.x + b.x) / 2) - line) > ON_LINE || line < 0 || line > n) return null;
  const lo = Math.min(horiz ? a.x : a.y, horiz ? b.x : b.y), hi = Math.max(horiz ? a.x : a.y, horiz ? b.x : b.y);
  const keys: string[] = [];
  for (let s = Math.floor(lo); s < Math.ceil(hi); s++) {
    if (s < 0 || s >= n) continue;
    if (Math.min(hi, s + 1) - Math.max(lo, s) < 0.5) continue;     // the door covers at least half this edge
    keys.push(horiz ? `${line * n + s}h` : `${s * n + line}v`);
  }
  return keys.length ? keys : null;
}

export type UvttImport = {
  sightWalls: SightWall[];
  doors: Record<string, "door">;
  report: { walls: number; doors: number; doorsLeftOpen: number; windows: number; objects: number; objectsBlockSight: boolean; lights: number; cut: number };
};

/** What goes on the battle map (n squares a side), and what was left out. */
/** opts.objects: pillars and furniture block sight too (plain walls) rather than only feet (windows). */
export function buildImport(m: Uvtt, n: number, opts: { objects?: boolean } = {}): UvttImport {
  const clamp = (v: number) => Math.max(0, Math.min(n, Math.round(v * 100) / 100));
  const walls: SightWall[] = [];
  let cut = 0;
  const add = (line: Pt[], kind: WallKind = 0) => {
    const s = simplify(line);
    for (let k = 0; k + 1 < s.length; k++) {
      const a = clamp(s[k].x), b = clamp(s[k].y), c = clamp(s[k + 1].x), d = clamp(s[k + 1].y);
      if (Math.hypot(c - a, d - b) < 0.01) continue;
      if (walls.length >= MAX_SIGHT_WALLS) { cut++; continue; }
      walls.push(kind ? [a, b, c, d, kind] : [a, b, c, d]);
    }
  };
  m.walls.forEach((l) => add(l));
  const doors: Record<string, "door"> = {};
  let placed = 0, open = 0, windows = 0;
  for (const p of m.portals) {
    if (!p.closed) { add([p.a, p.b], 1); windows++; continue; }
    const keys = doorEdges(p, n);
    if (!keys) { open++; continue; }
    for (const k of keys) doors[k] = "door";
    placed++;
  }
  m.objects.forEach((l) => add(l, opts.objects ? 0 : 1));
  return {
    sightWalls: walls, doors,
    report: { walls: walls.length, doors: placed, doorsLeftOpen: open, windows, objects: m.objects.length, objectsBlockSight: !!opts.objects, lights: m.lights, cut },
  };
}

/** One line for the GM: what came in and what did not. */
export function describeImport(r: UvttImport["report"]): string {
  const parts = [`${r.walls} wall piece${r.walls === 1 ? "" : "s"}`, `${r.doors} door${r.doors === 1 ? "" : "s"}`];
  if (r.windows) parts.push(`${r.windows} window${r.windows === 1 ? "" : "s"}`);
  if (r.objects) parts.push(`${r.objects} object outline${r.objects === 1 ? "" : "s"} that ${r.objectsBlockSight ? "block sight and movement" : "stop movement but not sight"}`);
  const left: string[] = [];
  if (r.cut) left.push(`${r.cut} wall pieces past the table's limit of ${MAX_SIGHT_WALLS}`);
  if (r.doorsLeftOpen) left.push(`${r.doorsLeftOpen} door${r.doorsLeftOpen === 1 ? "" : "s"} off the grid lines (left as open gaps)`);
  if (r.lights) left.push(`${r.lights} light${r.lights === 1 ? "" : "s"} (give a token a light at the table instead)`);
  return `From the file: ${parts.join(", ")}.${left.length ? ` Not brought in: ${left.join("; ")}.` : ""}`;
}

/** The picture as a Blob, from the file's base64 (PNG unless its first bytes say otherwise). */
export function imageBlob(b64: string): Blob {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const type = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : bytes[0] === 0x52 && bytes[1] === 0x49 ? "image/webp" : "image/png";
  return new Blob([bytes], { type });
}
