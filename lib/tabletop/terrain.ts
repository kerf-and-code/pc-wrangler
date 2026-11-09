// lib/tabletop/terrain.ts (2026-11-09)
//
// Difficult terrain (phase 5u, gap 5 in the tabletop audit doc). The GM paints squares of a scene as
// difficult (rubble, deep snow, undergrowth); they are kept in the scene's settings
// (vtt_scenes.settings.difficult, square numbers row * n + column), which every browser at the table
// already receives and follows live. Pure: no React, no network.
//
// The rule (5e): every foot moved through difficult terrain costs one extra foot. A token moves in a
// straight line, so the extra is the share of that line spent in difficult squares, times the move's
// cost, in whole squares: a 2-square move with one square of rubble costs 10 + 5 = 15 ft.
//
// The share is found by sampling the line every tenth of a square or less, at the middle of each
// step, and asking which square that point is in. The server (p125 tabletop_difficult_extra) does the
// same sums in the same order, so the ruler and the turn tracker always agree on the cost.

export const MAX_DIFFICULT = 5000;
const STEP = 0.1;

export type Pt = { x: number; y: number };

/** The difficult squares from stored settings: whole numbers inside an n by n grid, at most MAX_DIFFICULT. */
export function normDifficult(raw: unknown, n: number): Set<number> {
  const out = new Set<number>();
  if (!Array.isArray(raw)) return out;
  for (const v of raw) {
    if (out.size >= MAX_DIFFICULT) break;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < n * n) out.add(v);
  }
  return out;
}

/** For storing: sorted, capped. */
export function encodeDifficult(cells: Set<number>): number[] {
  return [...cells].sort((a, b) => a - b).slice(0, MAX_DIFFICULT);
}

/** The share (0..1) of the straight move from a to b spent in difficult squares. */
export function difficultShare(cells: Set<number>, n: number, a: Pt, b: Pt): number {
  if (!cells.size) return 0;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return 0;
  const k = Math.max(1, Math.ceil(len / STEP));
  let hit = 0;
  for (let i = 0; i < k; i++) {
    const t = (i + 0.5) / k, c = Math.floor(a.x + dx * t), r = Math.floor(a.y + dy * t);
    if (c >= 0 && r >= 0 && c < n && r < n && cells.has(r * n + c)) hit++;
  }
  return hit / k;
}

/** The extra feet a move costs: its share in difficult terrain, times its cost, in whole squares. */
export function difficultExtra(baseFeet: number, share: number, feetPerSquare: number): number {
  const fps = feetPerSquare > 0 ? feetPerSquare : 5;
  return Math.round((share * baseFeet) / fps) * fps;
}

/** Extra feet over a path of legs (a ruler with waypoints), each leg costed on its own. */
export function pathExtra(cells: Set<number>, n: number, points: Pt[], legFeet: (a: Pt, b: Pt) => number, feetPerSquare: number): number {
  let extra = 0;
  for (let i = 1; i < points.length; i++) {
    const share = difficultShare(cells, n, points[i - 1], points[i]);
    if (share > 0) extra += difficultExtra(legFeet(points[i - 1], points[i]), share, feetPerSquare);
  }
  return extra;
}

/** Toggle a set of squares on or off (the GM's brush). */
export function paintDifficult(cells: Set<number>, squares: number[], on: boolean): Set<number> {
  const out = new Set(cells);
  for (const s of squares) { if (on) { if (out.size < MAX_DIFFICULT) out.add(s); } else out.delete(s); }
  return out;
}
