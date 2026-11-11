// lib/tabletop/hex.ts (2026-11-11, push 33, audit P16: a hex battle grid)
//
// A scene can be played on hexes instead of squares (vtt_scenes.settings.grid), for Lancer, PF2e hex
// maps and anyone who likes them. The hexes sit over the same square map: one hex is one square
// across (flat side to flat side), so token sizes, the map's feet per square and the ruler's feet all
// keep their meaning, and settings.hexOffset slides the whole lattice to line up with hexes printed
// on an uploaded image.
//
// What hexes change: where tokens and the ruler snap (hex centres) and how distance counts (hexes
// along the shortest path, each worth the map's feet per square). The ruler's rule is stored as
// settings.diagonal "hexp" or "hexf" so the server counts a move the same way (tabletop_feet, p157).
// What they do not change: fog, walls, sight, difficult terrain and area templates stay on the
// square map underneath.
//
// Coordinates are in squares from the grid's top-left corner, as in lib/tabletop/geometry.ts.

export type GridKind = "square" | "hex-pointy" | "hex-flat";
export type Pt = { x: number; y: number };

export const GRID_KINDS: { key: GridKind; label: string }[] = [
  { key: "square", label: "Squares" },
  { key: "hex-pointy", label: "Hexes, pointed top" },
  { key: "hex-flat", label: "Hexes, flat top" },
];

const H = Math.sqrt(3) / 2;   // row spacing of a hex lattice whose flat-to-flat width is 1

export function gridOf(settings: { grid?: unknown } | null | undefined): GridKind {
  const g = settings?.grid;
  return g === "hex-pointy" || g === "hex-flat" ? g : "square";
}
export const isHex = (g: GridKind) => g !== "square";

/** The ruler rule a grid stores in settings.diagonal (the server reads it for moves in a fight). */
export const ruleForGrid = (g: GridKind): "hexp" | "hexf" | null => (g === "hex-pointy" ? "hexp" : g === "hex-flat" ? "hexf" : null);

export function offsetOf(settings: { hexOffset?: unknown } | null | undefined): Pt {
  const o = settings?.hexOffset as { x?: unknown; y?: unknown } | undefined;
  const v = (n: unknown) => { const x = Number(n); return Number.isFinite(x) ? Math.max(-2, Math.min(2, x)) : 0; };
  return { x: v(o?.x), y: v(o?.y) };
}

// fractional axial coordinates of a point, and back
function toAxial(p: Pt, g: GridKind, off: Pt): { q: number; r: number } {
  const x = p.x - off.x, y = p.y - off.y;
  if (g === "hex-flat") { const q = x / H; return { q, r: y - q / 2 }; }
  const r = y / H; return { q: x - r / 2, r };
}
function fromAxial(q: number, r: number, g: GridKind, off: Pt): Pt {
  if (g === "hex-flat") return { x: off.x + q * H, y: off.y + r + q / 2 };
  return { x: off.x + q + r / 2, y: off.y + r * H };
}
function cubeRound(q: number, r: number): { q: number; r: number } {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 };
}

/** The centre of the hex a point is in. */
export function snapHex(p: Pt, g: GridKind, off: Pt): Pt {
  const a = toAxial(p, g, off), c = cubeRound(a.q, a.r);
  return fromAxial(c.q, c.r, g, off);
}

/** Hexes along the shortest path for a move of (dx, dy) squares. Exact when both ends are hex centres
 *  (the move is then a whole number of lattice steps, wherever the lattice is slid to); the same
 *  sum the server makes in tabletop_feet (p157). */
export function hexDeltaSteps(dx: number, dy: number, g: GridKind): number {
  const a = toAxial({ x: dx, y: dy }, g === "square" ? "hex-pointy" : g, { x: 0, y: 0 }), c = cubeRound(a.q, a.r);
  return (Math.abs(c.q) + Math.abs(c.r) + Math.abs(c.q + c.r)) / 2;
}
export const hexSteps = (a: Pt, b: Pt, g: GridKind): number => hexDeltaSteps(b.x - a.x, b.y - a.y, g);

/** The six corners of the hex around a centre. */
export function hexCorners(c: Pt, g: GridKind): Pt[] {
  const R = 1 / Math.sqrt(3);   // centre to corner, for a flat-to-flat width of 1
  const start = g === "hex-flat" ? 0 : Math.PI / 6;
  return Array.from({ length: 6 }, (_, i) => {
    const a = start + (i * Math.PI) / 3;
    return { x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) };
  });
}

/** Every hex centre that falls on an n x n square map, for drawing the grid. */
export function hexCentres(n: number, g: GridKind, off: Pt): Pt[] {
  const out: Pt[] = [];
  const span = Math.ceil(n / H) + 3;
  for (let a = -3; a <= span; a++) {
    for (let b = -span; b <= span; b++) {
      const p = g === "hex-flat" ? fromAxial(a, b, g, off) : fromAxial(b, a, g, off);
      if (p.x >= -0.6 && p.y >= -0.6 && p.x <= n + 0.6 && p.y <= n + 0.6) out.push(p);
    }
  }
  return out;
}
