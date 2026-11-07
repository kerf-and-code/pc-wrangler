import { CELL_TYPES } from "@/lib/dungeon/render";
import { isStructure, parseEdge, type DoorKind } from "@/lib/dungeon/classic";

// lib/tabletop/fog.ts (2026-11-07)
//
// Fog of war and doors for the tabletop, phase 3a. Pure: no React, no network.
//
// The revealed bitmap matches p109 exactly: square i = row * n + col lives at byte i >> 3, bit i & 7
// counted from the low bit (Postgres get_bit order), sent as lowercase hex.
//
// Rooms. A room is what the GM reveals with one click: the walled squares (every painted square
// indoors; buildings, caves and decks outdoors) joined side to side, never across a door, and never
// across the line between corridor and room, so a corridor reveals on its own. Revealing a room also
// reveals the rock squares around it, so its walls are drawn whole rather than cut in half by the fog.

export function emptyFog(n: number): Uint8Array { return new Uint8Array(Math.ceil((n * n) / 8)); }

export function decodeFog(hex: string | null | undefined, n: number): Uint8Array {
  const out = emptyFog(n);
  const h = (hex ?? "").replace(/^\\x/, "");
  for (let b = 0; b < out.length && b * 2 + 1 < h.length; b++) {
    const v = parseInt(h.slice(b * 2, b * 2 + 2), 16);
    out[b] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

export function encodeFog(bits: Uint8Array): string {
  let s = "";
  for (const v of bits) s += v.toString(16).padStart(2, "0");
  return s;
}

export function isRevealed(bits: Uint8Array, n: number, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= n || r >= n) return false;
  const i = r * n + c;
  return ((bits[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;
}

export function setSquares(bits: Uint8Array, n: number, cells: Iterable<number>, on: boolean): Uint8Array {
  const out = new Uint8Array(bits);
  for (const i of cells) {
    if (i < 0 || i >= n * n) continue;
    if (on) out[i >> 3] |= 1 << (i & 7); else out[i >> 3] &= ~(1 << (i & 7));
  }
  return out;
}

export function fillFog(n: number, on: boolean): Uint8Array {
  const out = emptyFog(n);
  if (on) { out.fill(255); const extra = out.length * 8 - n * n; if (extra > 0) out[out.length - 1] = 255 >> extra; }
  return out;
}

// The squares a brush of size k (1, 3, 5: odd) centred on the square under the pointer covers.
export function brushCells(n: number, c: number, r: number, k: number): number[] {
  const out: number[] = [], h = Math.floor(k / 2);
  for (let dr = -h; dr <= h; dr++) for (let dc = -h; dc <= h; dc++) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && cc >= 0 && rr < n && cc < n) out.push(rr * n + cc);
  }
  return out;
}

// walls: edges that are plain wall to this viewer though both sides are floor (a closed secret door,
// as p109 sends it to players).
export type MapShape = { n: number; grid: number[]; custom: Record<string, string>; doors: Record<string, DoorKind>; outdoor: boolean; walls?: string[] };

const CORRIDOR = CELL_TYPES.findIndex((t) => t.key === "corridor");

export function walledAt(m: MapShape, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= m.n || r >= m.n) return false;
  const i = r * m.n + c, t = m.grid[i] ?? 0;
  return m.outdoor ? isStructure(t) : t > 0 || !!m.custom[String(i)];
}

// Room id for every square (-1 where there is no walled square).
export function roomsOf(m: MapShape): Int32Array {
  const { n } = m, id = new Int32Array(n * n).fill(-1);
  const doorBetween = (a: number, b: number): boolean => {
    // a and b are side neighbours; the door sits on the edge owned by the lower or righter square
    const ra = (a / n) | 0, rb = (b / n) | 0;
    if (ra === rb) return !!m.doors[`${Math.max(a, b)}v`];
    return !!m.doors[`${Math.max(a, b)}h`];
  };
  const isCorr = (i: number) => (m.grid[i] ?? 0) === CORRIDOR && !m.custom[String(i)];
  let next = 0;
  for (let s = 0; s < n * n; s++) {
    if (id[s] >= 0 || !walledAt(m, s % n, (s / n) | 0)) continue;
    const room = next++, corr = isCorr(s), st = [s];
    id[s] = room;
    while (st.length) {
      const i = st.pop() as number, r = (i / n) | 0, c = i % n;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const r2 = r + dr, c2 = c + dc;
        if (!walledAt(m, c2, r2)) continue;
        const j = r2 * n + c2;
        if (id[j] >= 0 || isCorr(j) !== corr || doorBetween(i, j)) continue;
        id[j] = room; st.push(j);
      }
    }
  }
  return id;
}

// The squares one click reveals or hides: the room under the pointer and the rock ring around it.
// Null when the pointer is not on a walled square (open ground outdoors: use the brush).
export function roomCells(m: MapShape, rooms: Int32Array, c: number, r: number): number[] | null {
  const { n } = m;
  if (c < 0 || r < 0 || c >= n || r >= n) return null;
  const room = rooms[r * n + c];
  if (room < 0) return null;
  const out = new Set<number>();
  for (let i = 0; i < n * n; i++) {
    if (rooms[i] !== room) continue;
    out.add(i);
    const rr = (i / n) | 0, cc = i % n;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const r2 = rr + dr, c2 = cc + dc;
      if (r2 < 0 || c2 < 0 || r2 >= n || c2 >= n) continue;
      if (!walledAt(m, c2, r2)) out.add(r2 * n + c2);
    }
  }
  return [...out];
}

// ---- doors ----

// The two end points of a door edge, in squares.
export function edgeSegment(key: string, n: number): { a: { x: number; y: number }; b: { x: number; y: number } } | null {
  const e = parseEdge(key); if (!e) return null;
  const r = Math.floor(e.i / n), c = e.i % n;
  return e.side === "h" ? { a: { x: c, y: r }, b: { x: c + 1, y: r } } : { a: { x: c, y: r }, b: { x: c, y: r + 1 } };
}

// The door under a point (in squares), if the point is within a quarter square of a door's line.
export function doorAt(doors: Record<string, DoorKind>, n: number, x: number, y: number): string | null {
  let best: string | null = null, bd = 0.26;
  const c = Math.floor(x), r = Math.floor(y);
  const cand = [
    `${Math.round(y) * n + c}h`,
    `${r * n + Math.round(x)}v`,
  ];
  for (const k of cand) {
    if (!doors[k]) continue;
    const s = edgeSegment(k, n); if (!s) continue;
    const horiz = s.a.y === s.b.y;
    const along = horiz ? x - s.a.x : y - s.a.y;
    if (along < 0.08 || along > 0.92) continue;
    const d = horiz ? Math.abs(y - s.a.y) : Math.abs(x - s.a.x);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

// Doors a player may open or close themselves (p109 holds the same rule on the server).
export const PLAYER_DOORS = new Set<DoorKind>(["door", "double"]);

// Doors drawn for the table: an open door is drawn as an open archway.
export function doorsAsDrawn(doors: Record<string, DoorKind>, open: Record<string, unknown>): Record<string, DoorKind> {
  const out: Record<string, DoorKind> = {};
  for (const [k, v] of Object.entries(doors)) out[k] = open[k] ? "arch" : v;
  return out;
}

// Does a closed door, of any kind but an archway, block sight and movement? (Phase 3b reads this.)
export function doorBlocks(kind: DoorKind | undefined, open: boolean): boolean {
  return !!kind && kind !== "arch" && !open;
}
