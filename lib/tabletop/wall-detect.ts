// lib/tabletop/wall-detect.ts (2026-11-11, push 32, audit P8 phase 2: walls found in a map image)
//
// Proposes sight walls for an uploaded battle map image, for the GM to keep or discard in the battle
// map editor (app/gm/world/BattleMapCreator.tsx, Sight walls tool). Phase 1 (drawing walls by hand)
// shipped in Phase 5j; this finds the obvious ones so the GM only fixes the rest.
//
// It works on the grid the image was lined up with, because a bought or Dungeondraft-exported map
// draws its walls along grid lines. For every edge between two squares it compares three readings of
// the image's brightness: the middle of the square on each side, and a thin strip along the edge
// itself. An edge becomes a wall when either
//   * a dark line runs along it (the strip is clearly darker than both squares, and darker than the
//     map's own dividing line between dark and light), with open floor on at least one side; or
//   * it is the border between solid dark (rock, void, the black outside a room) and open floor.
// Neighbouring wall edges on one grid line are joined into one long wall. The map's own border needs
// no walls (sight already stops there). Doors are left to the GM.
//
// Assumes walls darker than floors, which is how nearly every battle map is drawn; on a map drawn the
// other way round it finds little, and the GM draws them as before. Pure: brightness in, walls out
// (in squares), so it is tested on made-up images (tests/wall-detect.test.ts).

export type Wall = [number, number, number, number];

/** Otsu's threshold for values in 0..1: the cut that best splits them into a dark and a light group,
 *  returned as the point halfway between the two groups' averages (so two clean groups split in the
 *  middle, not at the edge of the darker one). */
export function otsu(values: ArrayLike<number>): number {
  const bins = new Array<number>(64).fill(0);
  let total = 0;
  for (let i = 0; i < values.length; i++) { const v = Math.max(0, Math.min(0.9999, values[i])); bins[Math.floor(v * 64)]++; total++; }
  if (!total) return 0.5;
  let sumAll = 0;
  for (let i = 0; i < 64; i++) sumAll += i * bins[i];
  let wB = 0, sumB = 0, best = -1, mid = 0.5;
  for (let i = 0; i < 64; i++) {
    wB += bins[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * bins[i];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; mid = ((mB + mF) / 2 + 0.5) / 64; }
  }
  return mid;
}

/**
 * Walls from an image's brightness.
 * @param lum  brightness 0..1, row by row, (n * S) pixels square: the image drawn over the n x n grid
 * @param n    squares per side
 * @param S    pixels per square in `lum` (8 or more works best)
 * @param sensitivity 0..1: higher finds fainter walls, and more false ones
 */
export function detectWalls(lum: ArrayLike<number>, n: number, S: number, sensitivity = 0.5): Wall[] {
  const W = n * S;
  if (n < 2 || S < 4 || lum.length < W * W) return [];
  const sens = Math.max(0, Math.min(1, sensitivity));

  const mean = (x0: number, y0: number, x1: number, y1: number): number => {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(W, Math.ceil(y1));
    let s = 0, k = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += lum[y * W + x]; k++; }
    return k ? s / k : 1;
  };

  // the middle half of every square
  const m = Math.max(1, Math.floor(S * 0.25));
  const cell = new Float64Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cell[r * n + c] = mean(c * S + m, r * S + m, c * S + S - m, r * S + S - m);
  const b = Math.max(1, Math.round(S * 0.12));      // half the strip's width
  // the strip along every inner edge: vertical edges on the line x = c, horizontal on y = r
  const stripV = new Float64Array(n * n), stripH = new Float64Array(n * n);
  for (let c = 1; c < n; c++) for (let r = 0; r < n; r++) stripV[c * n + r] = mean(c * S - b, r * S + m, c * S + b, r * S + S - m);
  for (let r = 1; r < n; r++) for (let c = 0; c < n; c++) stripH[r * n + c] = mean(c * S + m, r * S - b, c * S + S - m, r * S + b);

  // the map's own dark and light, from the squares and the strips together (a map whose walls are
  // only thin lines has all its dark in the strips)
  const all: number[] = Array.from(cell);
  for (let c = 1; c < n; c++) for (let r = 0; r < n; r++) all.push(stripV[c * n + r], stripH[c * n + r]);
  const sorted = [...all].sort((x, y) => x - y);
  const lo = sorted[Math.floor(sorted.length * 0.05)], hi = sorted[Math.floor(sorted.length * 0.95)];
  const range = hi - lo;
  if (range < 0.1) return [];                       // an even image: no walls to see
  const T = otsu(all);
  // how much darker a line must be than the floor beside it, as a share of the map's own range
  const delta = Math.max(0.04, (0.3 - 0.2 * sens) * Math.max(range, 0.2));

  const isWall = (a: number, c2: number, strip: number): boolean => {
    const floorA = a >= T, floorB = c2 >= T;
    if (!floorA && !floorB) return false;           // inside solid dark: nothing to see through anyway
    // a line drawn along the edge: darker than the floor beside it, and dark for this map (fainter
    // lines count at higher sensitivity)
    const near = Math.min(a, c2);
    if (strip < near - delta && strip < T + sens * 0.5 * Math.max(0, near - T)) return true;
    const dark = Math.min(a, c2), light = Math.max(a, c2);
    return floorA !== floorB && dark <= T - delta / 2 && light >= T + delta / 2 && light - dark >= delta * 1.5;
  };

  const vert: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  for (let c = 1; c < n; c++) for (let r = 0; r < n; r++) vert[c][r] = isWall(cell[r * n + c - 1], cell[r * n + c], stripV[c * n + r]);
  const horiz: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  for (let r = 1; r < n; r++) for (let c = 0; c < n; c++) horiz[r][c] = isWall(cell[(r - 1) * n + c], cell[r * n + c], stripH[r * n + c]);

  // join runs along each grid line
  const out: Wall[] = [];
  for (let c = 1; c < n; c++) {
    let start = -1;
    for (let r = 0; r <= n; r++) {
      const on = r < n && vert[c][r];
      if (on && start < 0) start = r;
      if (!on && start >= 0) { out.push([c, start, c, r]); start = -1; }
    }
  }
  for (let r = 1; r < n; r++) {
    let start = -1;
    for (let c = 0; c <= n; c++) {
      const on = c < n && horiz[r][c];
      if (on && start < 0) start = c;
      if (!on && start >= 0) { out.push([start, r, c, r]); start = -1; }
    }
  }
  return out;
}

/** Leaves out proposals that repeat a wall already there (the same line, either way round). */
type Ends = { 0: number; 1: number; 2: number; 3: number };
export function withoutExisting(proposed: Wall[], existing: Ends[]): Wall[] {
  const key = (w: Ends) => {
    const a = `${w[0]},${w[1]}`, z = `${w[2]},${w[3]}`;
    return a < z ? `${a}|${z}` : `${z}|${a}`;
  };
  const have = new Set(Array.from(existing, key));
  return proposed.filter((w) => !have.has(key(w)));
}
