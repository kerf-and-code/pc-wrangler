// lib/dungeon/classic.ts
//
// The adventure-book dungeon renderer (2026-11-06). Draws one dungeon level the way maps look in printed
// adventures: parchment page, hatched rock around every wall, pale stone floors on a fine grid, heavy ink
// walls, doors set into the wall line, furniture drawn in ink, numbered rooms, and a title, compass and
// scale bar. It is pure drawing code: no AI, no network, no React. The editor calls it for the live
// preview and again at a larger size for the exported image, so what the GM sees is what they get.
//
// Determinism: every random choice (hatch angles, stone sizes, cave wobble) comes from a hash of its grid
// position, not from a running random stream, so painting one square never reshuffles the strokes
// elsewhere on the map.

import { CELL_TYPES } from "./render";
import { drawGroundDetail, drawOutdoorElement, isOutdoorKind, OUTDOOR_ELEMENTS, GROUND_KINDS, type GroundKind } from "./outdoor";

// ---- the annotation model (stored in dungeon_maps.marks, one entry per level) ----

export type DoorKind = "door" | "double" | "locked" | "secret" | "portcullis" | "arch";
export type FeatureKind =
  | "stairs" | "ladder" | "pillar" | "statue" | "altar" | "throne" | "chest" | "table" | "bed"
  | "bookshelf" | "barrels" | "crates" | "rubble" | "pit" | "trapdoor" | "trap" | "fountain"
  | "well" | "coffin" | "brazier" | "web" | "bones";

export type Feature = { k: FeatureKind; r?: number };          // r: quarter turns, 0 to 3
export type LevelMarks = {
  features: Record<string, Feature>;                             // cell index -> feature
  doors: Record<string, DoorKind>;                               // edge key -> door (see edgeKey)
  labels: Record<string, string>;                                // cell index -> label text
};
export type DungeonMeta = { title: string; levelNames: string[]; autoNumber: boolean; grid: boolean };

// A freely placed piece on a battle map (p104): x and y are its centre in squares from the grid's
// top-left corner, rot is degrees clockwise, s a size multiplier. k is a FEATURES key, an
// OUTDOOR_ELEMENTS key, or "label" (then text is what it says).
export type MapElement = { id: string; k: string; x: number; y: number; rot: number; s: number; text?: string };

// How the grid lines look. cover "floor" keeps them on painted floor (the book look); "all" runs them
// across the rock too. Outdoor maps always cover everything.
export type GridLook = { color: "ink" | "black" | "white" | "red"; opacity: number; weight: "thin" | "medium" | "bold"; cover: "floor" | "all" };
export const DEFAULT_GRID_LOOK: GridLook = { color: "ink", opacity: 0.32, weight: "thin", cover: "floor" };
const GRID_RGB: Record<GridLook["color"], string> = { ink: "90,70,45", black: "20,16,12", white: "255,255,255", red: "122,31,20" };
const GRID_WEIGHT: Record<GridLook["weight"], number> = { thin: 0.02, medium: 0.035, bold: 0.055 };

export const DOOR_KINDS: { key: DoorKind; label: string }[] = [
  { key: "door", label: "Door" },
  { key: "double", label: "Double door" },
  { key: "locked", label: "Locked door" },
  { key: "secret", label: "Secret door" },
  { key: "portcullis", label: "Portcullis" },
  { key: "arch", label: "Open archway" },
];

export const FEATURES: { key: FeatureKind; label: string; rotates?: boolean }[] = [
  { key: "stairs", label: "Stairs", rotates: true },
  { key: "ladder", label: "Ladder", rotates: true },
  { key: "pillar", label: "Pillar" },
  { key: "statue", label: "Statue" },
  { key: "altar", label: "Altar", rotates: true },
  { key: "throne", label: "Throne", rotates: true },
  { key: "chest", label: "Chest", rotates: true },
  { key: "table", label: "Table", rotates: true },
  { key: "bed", label: "Bed", rotates: true },
  { key: "bookshelf", label: "Bookshelf", rotates: true },
  { key: "barrels", label: "Barrels" },
  { key: "crates", label: "Crates" },
  { key: "rubble", label: "Rubble" },
  { key: "pit", label: "Pit" },
  { key: "trapdoor", label: "Trapdoor" },
  { key: "trap", label: "Trap (T)" },
  { key: "fountain", label: "Fountain" },
  { key: "well", label: "Well" },
  { key: "coffin", label: "Sarcophagus", rotates: true },
  { key: "brazier", label: "Brazier" },
  { key: "web", label: "Webs" },
  { key: "bones", label: "Bones" },
];

export const emptyMarks = (levels: number): LevelMarks[] =>
  Array.from({ length: levels }, () => ({ features: {}, doors: {}, labels: {} }));

export const defaultMeta = (levels: number): DungeonMeta => ({
  title: "", levelNames: Array.from({ length: levels }, (_, i) => `Level ${i + 1}`), autoNumber: true, grid: true,
});

// An edge is owned by the cell below it ("h": the top edge of cell i) or to its right ("v": the left
// edge of cell i). Edges on the far bottom or right border use a cell index one past the grid, which is
// fine: they only ever hold a door into nothing, and the renderer handles them.
export function edgeKey(i: number, side: "h" | "v"): string { return `${i}${side}`; }
export function parseEdge(key: string): { i: number; side: "h" | "v" } | null {
  const m = /^(\d+)([hv])$/.exec(key); return m ? { i: Number(m[1]), side: m[2] as "h" | "v" } : null;
}

const FEATURE_KEYS = new Set<string>(FEATURES.map((f) => f.key));
const DOOR_KEYS = new Set<string>(DOOR_KINDS.map((d) => d.key));

// Tolerant readers for jsonb that may be missing, partial or from an older version.
export function normalizeMarks(raw: unknown, levels: number, n: number): LevelMarks[] {
  const out = emptyMarks(levels);
  if (!Array.isArray(raw)) return out;
  for (let l = 0; l < levels; l++) {
    const src = raw[l] as Partial<Record<keyof LevelMarks, unknown>> | undefined;
    if (!src || typeof src !== "object") continue;
    const f = src.features, d = src.doors, lb = src.labels;
    if (f && typeof f === "object") for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
      const i = Number(k), fv = v as Feature;
      if (Number.isInteger(i) && i >= 0 && i < n * n && fv && FEATURE_KEYS.has(fv.k)) out[l].features[k] = { k: fv.k, r: ((Number(fv.r) || 0) % 4 + 4) % 4 };
    }
    if (d && typeof d === "object") for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      const e = parseEdge(k);
      if (e && e.i >= 0 && e.i <= n * n + n && typeof v === "string" && DOOR_KEYS.has(v)) out[l].doors[k] = v as DoorKind;
    }
    if (lb && typeof lb === "object") for (const [k, v] of Object.entries(lb as Record<string, unknown>)) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < n * n && typeof v === "string" && v.trim()) out[l].labels[k] = v.trim().slice(0, 40);
    }
  }
  return out;
}

export function normalizeMeta(raw: unknown, levels: number): DungeonMeta {
  const base = defaultMeta(levels);
  if (!raw || typeof raw !== "object") return base;
  const m = raw as Partial<DungeonMeta>;
  return {
    title: typeof m.title === "string" ? m.title.slice(0, 80) : "",
    levelNames: base.levelNames.map((d, i) => (Array.isArray(m.levelNames) && typeof m.levelNames[i] === "string" && m.levelNames[i].trim() ? m.levelNames[i].slice(0, 60) : d)),
    autoNumber: m.autoNumber !== false,
    grid: m.grid !== false,
  };
}

// Remap annotations when the grid is resized (top-left overlap kept, like resizeLevels).
export function remapMarks(marks: LevelMarks[], oldN: number, newN: number): LevelMarks[] {
  const cell = (i: number) => { const r = Math.floor(i / oldN), c = i % oldN; return r < newN && c < newN ? r * newN + c : -1; };
  return marks.map((m) => {
    const next: LevelMarks = { features: {}, doors: {}, labels: {} };
    for (const [k, v] of Object.entries(m.features)) { const j = cell(Number(k)); if (j >= 0) next.features[String(j)] = v; }
    for (const [k, v] of Object.entries(m.labels)) { const j = cell(Number(k)); if (j >= 0) next.labels[String(j)] = v; }
    for (const [k, v] of Object.entries(m.doors)) { const e = parseEdge(k); if (!e) continue; const j = cell(e.i); if (j >= 0) next.doors[edgeKey(j, e.side)] = v; }
    return next;
  });
}

// ---- the palette ----

const INK = "#2b2018";
const PAGE = "#efe2c2";
const ROCK = "#ddcca6";
const HATCH = "#5b4630";
const NUM = "#7a1f14";
const WOOD = "#b98b52";
const STONE_LIGHT = "#d3c7ab";

type Terrain = { fill: string; kind: "floor" | "cave" | "water" | "lava" | "ice" | "planks" | "panels" | "sewer" | GroundKind };
const TERRAIN: Record<string, Terrain> = {
  corridor: { fill: "#e9ddc1", kind: "floor" },
  room: { fill: "#ebdfc3", kind: "floor" },
  dungeon: { fill: "#ddd7ca", kind: "floor" },
  castle: { fill: "#e8d9b6", kind: "floor" },
  crypt: { fill: "#d9d3c7", kind: "floor" },
  temple: { fill: "#ece0cc", kind: "floor" },
  mine: { fill: "#e3cfa8", kind: "cave" },
  cave: { fill: "#e4d3ae", kind: "cave" },
  water: { fill: "#93b6c6", kind: "water" },
  sewer: { fill: "#a7b394", kind: "sewer" },
  lava: { fill: "#dd7a43", kind: "lava" },
  ice: { fill: "#dbe9ee", kind: "ice" },
  ship: { fill: "#d8bd8f", kind: "planks" },
  spaceship: { fill: "#d6dadc", kind: "panels" },
  grass: { fill: "#cdd29f", kind: "grass" },
  meadow: { fill: "#dad6a0", kind: "meadow" },
  forest: { fill: "#b6bf8b", kind: "forest" },
  dirt: { fill: "#d8bf96", kind: "dirt" },
  road: { fill: "#e4d4ad", kind: "road" },
  sand: { fill: "#ecdeb0", kind: "sand" },
  snow: { fill: "#f4f3ee", kind: "snow" },
  swamp: { fill: "#b1b996", kind: "swamp" },
  deepwater: { fill: "#7fa6ba", kind: "deep" },
  stone: { fill: "#d6cfbd", kind: "stone" },
  cliff: { fill: "#bfae8c", kind: "cliff" },
};
const terrainOf = (t: number): Terrain => TERRAIN[CELL_TYPES[t]?.key ?? "room"] ?? TERRAIN.room;
// On an outdoor map only these get walls: buildings, ruins, caves, decks. Water, lava, ice and the open
// ground terrains are open.
const STRUCTURE = new Set<Terrain["kind"]>(["floor", "cave", "planks", "panels"]);
export const isStructure = (t: number): boolean => t > 0 && STRUCTURE.has(terrainOf(t).kind);
// Edges between different terrains that get an ink line, with a relative weight.
const OUTLINE: Partial<Record<Terrain["kind"], number>> = { water: 1, deep: 1, sewer: 0.8, lava: 1, road: 0.7, swamp: 0.6, cliff: 1.9, ice: 0.6 };

// ---- hashing (deterministic noise) ----

function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- the render call ----

export type RenderInput = {
  n: number;
  grid: number[];                       // cell types for this level
  custom?: Record<string, string>;      // cell index -> custom tile id
  tileImages?: Map<string, CanvasImageSource>;
  tileColors?: Map<string, string>;
  marks: LevelMarks;
  meta: DungeonMeta;
  level: number;
  feetPerSquare: number;
  outdoor?: boolean;                    // unpainted squares are open ground, not rock
  ground?: number;                      // outdoor: the CELL_TYPES index of that ground
  gridLook?: GridLook;
  elements?: MapElement[];              // free pieces; also keep room numbers off them
  drawElements?: boolean;               // false: lay out around the elements but leave them to the caller
  topGrid?: number | null;              // opacity of a black battle grid drawn over everything; null = off
  // A painted image of the whole n x n grid (the Gemini overlay), laid exactly over the grid square.
  // inkOnTop: walls, doors, numbers and grids stay drawn over it; otherwise it covers all but the numbers,
  // labels and the black grid. Pieces are the caller's choice (drawElements / piecesHidden).
  overlay?: { img: CanvasImageSource; opacity: number; inkOnTop: boolean } | null;
  piecesHidden?: boolean;               // draw only text labels among the free pieces (they are in the painting)
  bare?: boolean;                       // no frame, title, scale bar or compass (the plan sent to the painter)
};

// The squares a page shows: the painted area plus a two-square border for the hatching. Printed maps
// crop to the dungeon instead of showing an empty grid, so the page does too. An empty level shows the
// whole grid.
export type Bounds = { r0: number; c0: number; rows: number; cols: number };
export function contentBounds(n: number, grid: number[], custom: Record<string, string> = {}, pad = 2): Bounds {
  let r0 = n, c0 = n, r1 = -1, c1 = -1;
  for (let i = 0; i < n * n; i++) {
    if (!(grid[i] > 0 || custom[String(i)])) continue;
    const r = (i / n) | 0, c = i % n;
    if (r < r0) r0 = r; if (c < c0) c0 = c; if (r > r1) r1 = r; if (c > c1) c1 = c;
  }
  if (r1 < 0) return { r0: 0, c0: 0, rows: n, cols: n };
  r0 = Math.max(0, r0 - pad); c0 = Math.max(0, c0 - pad); r1 = Math.min(n - 1, r1 + pad); c1 = Math.min(n - 1, c1 + pad);
  return { r0, c0, rows: r1 - r0 + 1, cols: c1 - c0 + 1 };
}

export type Layout = {
  cell: number; bounds: Bounds;
  ox: number; oy: number;          // canvas position of the top-left corner of square (bounds.r0, bounds.c0)
  titlePx: number; width: number; height: number;
};

// Size the page for a given square size: a title band on top, a margin for the hatching on each side,
// and a band underneath for the scale bar and compass.
export function layoutFor(cellPx: number, bounds: Bounds): Layout {
  const titlePx = Math.round(Math.max(18, Math.min(cellPx * 0.95, 64)));
  const side = Math.round(cellPx * 1.4);
  const oy = Math.round(cellPx * 1.25 + titlePx + 18);
  const footer = Math.round(cellPx * 0.9 + Math.max(cellPx * 1.6, 44) + 16);
  const width = side * 2 + bounds.cols * cellPx;
  const height = oy + bounds.rows * cellPx + footer;
  return { cell: cellPx, bounds, ox: side, oy, titlePx, width, height };
}

// A layout with no margins: the canvas is exactly the bounds. For the plan sent to the painter.
export function layoutBare(cellPx: number, bounds: Bounds): Layout {
  return { cell: cellPx, bounds, ox: 0, oy: 0, titlePx: 0, width: bounds.cols * cellPx, height: bounds.rows * cellPx };
}

export function renderClassic(ctx: CanvasRenderingContext2D, input: RenderInput, L: Layout): void {
  const { n, grid, custom = {}, marks, meta } = input;
  const CELL = L.cell, B = L.bounds;
  const ox = L.ox - B.c0 * CELL, oy = L.oy - B.r0 * CELL;   // so X(B.c0) = L.ox, Y(B.r0) = L.oy
  const X = (c: number) => ox + c * CELL, Y = (r: number) => oy + r * CELL;
  const outdoor = !!input.outdoor;
  const groundT = input.ground && input.ground > 0 && input.ground < CELL_TYPES.length ? input.ground : CELL_TYPES.findIndex((t) => t.key === "grass");
  const inGrid = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n;
  // occ: squares with walls around them. Indoors that is every painted square; outdoors only structures.
  const occ = outdoor
    ? (r: number, c: number) => inGrid(r, c) && isStructure(grid[r * n + c])
    : (r: number, c: number) => inGrid(r, c) && (grid[r * n + c] > 0 || !!custom[String(r * n + c)]);
  const typeAt = (r: number, c: number) => (r >= 0 && c >= 0 && r < n && c < n ? grid[r * n + c] : 0);
  const isCave = (r: number, c: number) => { const t = typeAt(r, c); return t > 0 && terrainOf(t).kind === "cave"; };

  ctx.save();
  ctx.lineJoin = "round";

  // 1. page with a little paper grain
  ctx.fillStyle = PAGE; ctx.fillRect(0, 0, L.width, L.height);
  const grains = Math.round((L.width * L.height) / 900);
  for (let k = 0; k < grains; k++) {
    const gx = hash(k, 11) * L.width, gy = hash(k, 23) * L.height, a = 0.02 + hash(k, 37) * 0.05;
    ctx.fillStyle = `rgba(110,80,40,${a.toFixed(3)})`; ctx.fillRect(gx, gy, 1 + hash(k, 41) * 2.5, 1 + hash(k, 53) * 2.5);
  }

  const wobble = (ax: number, ay: number, bx: number, by: number, seed: number, amount = 0.22) => {
    const pts: [number, number][] = [[ax, ay]];
    const segs = 4, nx = -(by - ay), ny = bx - ax, nl = Math.hypot(nx, ny) || 1;
    for (let s = 1; s < segs; s++) {
      const t = s / segs, amp = (hash(seed, s, 9) - 0.5) * CELL * amount;
      pts.push([ax + (bx - ax) * t + (nx / nl) * amp, ay + (by - ay) * t + (ny / nl) * amp]);
    }
    pts.push([bx, by]);
    return pts;
  };

  if (!outdoor) {
  // Distance (in squares, capped) from every square to the nearest floor square: used to keep the rock
  // tone and hatching to a band around the dungeon instead of the whole page.
  const FAR = 4;
  const dist = new Array<number>(n * n).fill(FAR);
  const q: number[] = [];
  for (let i = 0; i < n * n; i++) if (grid[i] > 0 || custom[String(i)]) { dist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], r = (i / n) | 0, c = i % n, d = dist[i] + 1;
    if (d >= FAR) continue;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const r2 = r + dr, c2 = c + dc; if (r2 < 0 || c2 < 0 || r2 >= n || c2 >= n) continue;
      const j = r2 * n + c2; if (dist[j] > d) { dist[j] = d; q.push(j); }
    }
  }
  // Exact distance from a point to the nearest floor square, in squares (0 inside floor).
  const pointDist = (x: number, y: number): number => {
    const cr = Math.floor((y - oy) / CELL), cc = Math.floor((x - ox) / CELL);
    let best = 99;
    for (let r = cr - 2; r <= cr + 2; r++) for (let c = cc - 2; c <= cc + 2; c++) {
      if (!occ(r, c)) continue;
      const dx = Math.max(X(c) - x, 0, x - X(c + 1)), dy = Math.max(Y(r) - y, 0, y - Y(r + 1));
      best = Math.min(best, Math.hypot(dx, dy) / CELL);
    }
    return best;
  };
  const nearFloor = (x: number, y: number): boolean => {
    const cr = Math.floor((y - oy) / CELL), cc = Math.floor((x - ox) / CELL);
    if (cr < -2 || cc < -2 || cr > n + 1 || cc > n + 1) return false;
    const r = Math.min(n - 1, Math.max(0, cr)), c = Math.min(n - 1, Math.max(0, cc));
    return dist[r * n + c] <= 2;
  };

  // 2. rock band: a soft darker tone hugging the walls
  const BAND = 0.95;
  ctx.fillStyle = ROCK;
  for (let r = B.r0 - 1; r <= B.r0 + B.rows; r++) for (let c = B.c0 - 1; c <= B.c0 + B.cols; c++) {
    let near = false;
    for (let dr = -1; dr <= 1 && !near; dr++) for (let dc = -1; dc <= 1 && !near; dc++) if (occ(r + dr, c + dc)) near = true;
    if (!near || occ(r, c)) continue;
    const steps = 3;
    for (let a = 0; a < steps; a++) for (let b = 0; b < steps; b++) {
      const px = X(c) + (a + 0.5) * CELL / steps, py = Y(r) + (b + 0.5) * CELL / steps;
      const d = pointDist(px, py);
      if (d > 0 && d < BAND) { ctx.beginPath(); ctx.arc(px, py, CELL / steps * 0.85, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // 3. hatching: clusters of short parallel strokes, Dyson style, densest near the wall
  ctx.strokeStyle = HATCH; ctx.lineCap = "round";
  const step = CELL * 0.36;
  const hw = Math.max(0.8, CELL * 0.03);
  const x0 = X(B.c0) - CELL * 1.2, y0 = Y(B.r0) - CELL * 1.2, x1 = X(B.c0 + B.cols) + CELL * 1.2, y1 = Y(B.r0 + B.rows) + CELL * 1.2;
  // index the hatch lattice from the grid origin, not the page, so cropping never reshuffles strokes
  const gi0 = Math.floor((y0 - oy) / step), gj0 = Math.floor((x0 - ox) / step);
  for (let gi = gi0; oy + gi * step < y1; gi++) {
    const y = oy + gi * step;
    for (let gj = gj0; ox + gj * step < x1; gj++) {
      const x = ox + gj * step;
      const jx = x + (hash(gi, gj, 1) - 0.5) * step * 0.9, jy = y + (hash(gi, gj, 2) - 0.5) * step * 0.9;
      if (!nearFloor(jx, jy)) continue;
      const d = pointDist(jx, jy);
      if (d <= 0.04 || d > 1.05) continue;
      if (d > 0.7 && hash(gi, gj, 3) < (d - 0.7) / 0.35) continue;           // feather the outer edge
      const ang = hash(gi, gj, 4) * Math.PI, len = CELL * (0.3 + hash(gi, gj, 5) * 0.18);
      const k = 3 + Math.floor(hash(gi, gj, 6) * 2), gap = CELL * 0.075;
      ctx.lineWidth = hw;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let s = 0; s < k; s++) {
        const off = (s - (k - 1) / 2) * gap, px = jx - sa * off, py = jy + ca * off;
        const ax = px - ca * len / 2, ay = py - sa * len / 2, bx = px + ca * len / 2, by = py + sa * len / 2;
        if (pointDist(ax, ay) < 0.06 || pointDist(bx, by) < 0.06) continue;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }
  }
  } // indoor only

  // 4. floors (outdoors, every unpainted square is the map's ground)
  const rA = Math.max(0, B.r0 - 1), rB = Math.min(n, B.r0 + B.rows + 1), cA = Math.max(0, B.c0 - 1), cB = Math.min(n, B.c0 + B.cols + 1);
  for (let r = rA; r < rB; r++) for (let c = cA; c < cB; c++) {
    const i = r * n + c, tid = custom[String(i)], t = grid[i] || (outdoor && !tid ? groundT : 0);
    if (!tid && !t) continue;
    const x = X(c), y = Y(r);
    if (tid) {
      const img = input.tileImages?.get(tid);
      if (img) ctx.drawImage(img, x, y, CELL, CELL);
      else { ctx.fillStyle = input.tileColors?.get(tid) || STONE_LIGHT; ctx.fillRect(x, y, CELL, CELL); }
      continue;
    }
    const tr = terrainOf(t);
    ctx.fillStyle = tr.fill; ctx.fillRect(x - 0.5, y - 0.5, CELL + 1, CELL + 1);
    // a faint per-square tone so floors read as stone, not flat paint
    const v = hash(r, c, 7);
    if (tr.kind === "floor" || tr.kind === "cave") { ctx.fillStyle = v < 0.5 ? `rgba(255,250,235,${(0.5 - v) * 0.18})` : `rgba(80,60,30,${(v - 0.5) * 0.08})`; ctx.fillRect(x, y, CELL, CELL); }
    drawTerrainDetail(ctx, tr.kind, x, y, CELL, r, c);
  }

  // 4b. ink lines where water, lava, roads, swamp or cliffs meet other ground
  const kindAt = (r: number, c: number): string | null => {
    if (!inGrid(r, c)) return null;
    const i = r * n + c;
    if (custom[String(i)]) return "custom";
    const t = grid[i] || (outdoor ? groundT : 0);
    return t ? terrainOf(t).kind : null;
  };
  for (let r = rA; r < rB; r++) for (let c = cA; c < cB; c++) {
    const ka = kindAt(r, c); if (!ka) continue;
    for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
      const kb = kindAt(r + dr, c + dc);
      if (!kb || kb === ka || occ(r, c) !== occ(r + dr, c + dc)) continue;      // walls cover the rest
      const w = Math.max(OUTLINE[ka as Terrain["kind"]] ?? 0, OUTLINE[kb as Terrain["kind"]] ?? 0);
      if (!w) continue;
      const ax = dc ? X(c + 1) : X(c), ay = dc ? Y(r) : Y(r + 1), bx = X(c + 1), by = Y(r + 1);
      const pts = wobble(ax, ay, bx, by, (r + dr) * 1000 + (c + dc) * 4 + (dc ? 1 : 0) + 7, ka === "road" || kb === "road" ? 0.08 : 0.18);
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, CELL * 0.045 * w); ctx.lineCap = "round"; ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke();
    }
  }

  // 4c. the painted overlay, under the book grid and the ink
  const ov = input.overlay;
  const drawOverlay = () => {
    if (!ov) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(X(B.c0), Y(B.r0), B.cols * CELL, B.rows * CELL); ctx.clip();
    ctx.globalAlpha = Math.max(0, Math.min(1, ov.opacity));
    ctx.drawImage(ov.img, X(0), Y(0), n * CELL, n * CELL);
    ctx.restore();
  };
  if (ov && ov.inkOnTop) drawOverlay();

  // 5. grid
  if (meta.grid) {
    const look = input.gridLook ?? DEFAULT_GRID_LOOK;
    const alpha = Math.max(0.05, Math.min(1, Number(look.opacity) || DEFAULT_GRID_LOOK.opacity));
    ctx.strokeStyle = `rgba(${GRID_RGB[look.color] ?? GRID_RGB.ink},${alpha.toFixed(3)})`;
    ctx.lineWidth = Math.max(0.6, CELL * (GRID_WEIGHT[look.weight] ?? GRID_WEIGHT.thin));
    ctx.beginPath();
    if (outdoor || look.cover === "all") {
      for (let r = B.r0; r <= B.r0 + B.rows; r++) { ctx.moveTo(X(B.c0), Y(r)); ctx.lineTo(X(B.c0 + B.cols), Y(r)); }
      for (let c = B.c0; c <= B.c0 + B.cols; c++) { ctx.moveTo(X(c), Y(B.r0)); ctx.lineTo(X(c), Y(B.r0 + B.rows)); }
    } else {
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (!occ(r, c)) continue;
        const x = X(c), y = Y(r);
        if (occ(r - 1, c)) { ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); }
        if (occ(r, c - 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); }
      }
    }
    ctx.stroke();
  }

  // 6. walls: a soft shadow just inside, then heavy ink. Cave edges wobble.
  const edges: { a: [number, number]; b: [number, number]; cave: boolean; seed: number }[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!occ(r, c)) continue;
    const cave = isCave(r, c);
    if (!occ(r - 1, c)) edges.push({ a: [X(c), Y(r)], b: [X(c + 1), Y(r)], cave, seed: r * 1000 + c * 4 });
    if (!occ(r + 1, c)) edges.push({ a: [X(c), Y(r + 1)], b: [X(c + 1), Y(r + 1)], cave, seed: (r + 1) * 1000 + c * 4 });
    if (!occ(r, c - 1)) edges.push({ a: [X(c), Y(r)], b: [X(c), Y(r + 1)], cave, seed: r * 1000 + c * 4 + 1 });
    if (!occ(r, c + 1)) edges.push({ a: [X(c + 1), Y(r)], b: [X(c + 1), Y(r + 1)], cave, seed: r * 1000 + (c + 1) * 4 + 1 });
  }
  const strokeEdges = (width: number, color: string) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.beginPath();
    for (const e of edges) {
      const pts = e.cave ? wobble(e.a[0], e.a[1], e.b[0], e.b[1], e.seed) : [e.a, e.b];
      ctx.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    }
    ctx.stroke();
  };
  strokeEdges(Math.max(3, CELL * 0.32), "rgba(70,50,25,0.13)");
  strokeEdges(Math.max(2, CELL * 0.11), INK);

  // 7. features
  for (const [k, f] of Object.entries(marks.features)) {
    const i = Number(k), r = (i / n) | 0, c = i % n;
    if (r >= n || !occ(r, c)) continue;
    drawFeature(ctx, f, X(c), Y(r), CELL, r, c);
  }
  // 7b. free pieces, in their stacking order
  const els = input.elements ?? [];
  if (input.drawElements !== false) for (const el of els) if (!input.piecesHidden || el.k === "label") drawElement(ctx, el, X(0), Y(0), CELL);

  // 8. doors, set into the edge between two squares
  for (const [k, kind] of Object.entries(marks.doors)) {
    const e = parseEdge(k); if (!e) continue;
    const r = Math.floor(e.i / n), c = e.i % n;
    if (!(occ(r, c) || (e.side === "h" ? occ(r - 1, c) : occ(r, c - 1)))) continue;
    if (e.side === "h") drawDoor(ctx, kind, X(c), Y(r), CELL, true);
    else drawDoor(ctx, kind, X(c), Y(r), CELL, false);
  }

  // 8b. the painted overlay over everything drawn so far, then the text labels again on top of it
  if (ov && !ov.inkOnTop) {
    drawOverlay();
    if (input.drawElements !== false) for (const el of els) if (el.k === "label") drawElement(ctx, el, X(0), Y(0), CELL);
  }

  // 9. room numbers and labels
  const labelled = new Set<number>();
  const regionOf = new Array<number>(n * n).fill(-1);
  const regions: number[][] = [];
  for (let i = 0; i < n * n; i++) {
    const t = grid[i];
    if (regionOf[i] >= 0 || !occ((i / n) | 0, i % n) || CELL_TYPES[t]?.key === "corridor") continue;
    const id = regions.length, cells: number[] = [], st = [i]; regionOf[i] = id;
    while (st.length) {
      const j = st.pop() as number; cells.push(j);
      const r = (j / n) | 0, c = j % n;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r2 = r + dr, c2 = c + dc; if (r2 < 0 || c2 < 0 || r2 >= n || c2 >= n) continue;
        const m = r2 * n + c2, tm = grid[m];
        if (regionOf[m] < 0 && occ(r2, c2) && CELL_TYPES[tm]?.key !== "corridor") { regionOf[m] = id; st.push(m); }
      }
    }
    regions.push(cells);
  }
  for (const k of Object.keys(marks.labels)) { const reg = regionOf[Number(k)]; if (reg >= 0) labelled.add(reg); }
  const covered = new Set<number>();          // squares under a free piece: no number goes there
  for (const el of els) {
    const r = Math.floor(el.y), c = Math.floor(el.x); if (!inGrid(r, c)) continue;
    if (el.k === "label") { const reg = regionOf[r * n + c]; if (reg >= 0) labelled.add(reg); }
    const rad = Math.max(0, Math.floor((el.s || 1) / 2));
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) if (inGrid(r + dr, c + dc)) covered.add((r + dr) * n + c + dc);
  }
  const numFont = (px: number) => `bold ${px}px Georgia, "Times New Roman", serif`;
  const writeLabel = (text: string, x: number, y: number, px: number) => {
    ctx.font = numFont(px); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, px * 0.22); ctx.strokeStyle = PAGE; ctx.strokeText(text, x, y);
    ctx.fillStyle = NUM; ctx.fillText(text, x, y);
  };
  if (meta.autoNumber) {
    let num = 0;
    regions
      .map((cells, id) => ({ cells, id, first: Math.min(...cells) }))
      .filter((g) => g.cells.length >= 4)
      .sort((a, b) => a.first - b.first)
      .forEach((g) => {
        if (labelled.has(g.id)) return;          // a GM label replaces the number, and does not use one up
        num += 1;
        let sr = 0, sc = 0; for (const j of g.cells) { sr += (j / n) | 0; sc += j % n; }
        sr /= g.cells.length; sc /= g.cells.length;
        let best = g.cells[0], bd = Infinity;
        for (const j of g.cells) {
          if (marks.features[String(j)] || covered.has(j)) continue;
          const tk = terrainOf(grid[j]).kind; if (tk === "water" || tk === "lava") continue;
          const d = (((j / n) | 0) - sr) ** 2 + ((j % n) - sc) ** 2; if (d < bd) { bd = d; best = j; }
        }
        writeLabel(String(num), X(best % n) + CELL / 2, Y((best / n) | 0) + CELL / 2, Math.max(12, CELL * 0.8));
      });
  }
  for (const [k, text] of Object.entries(marks.labels)) {
    const i = Number(k); const r = (i / n) | 0, c = i % n;
    writeLabel(text, X(c) + CELL / 2, Y(r) + CELL / 2, Math.max(11, CELL * (text.length > 3 ? 0.55 : 0.8)));
  }

  // 9b. the black battle grid goes over everything (the editor draws its own over its pieces)
  if (input.topGrid && input.drawElements !== false) drawTopGrid(ctx, X(0), Y(0), CELL, B, input.topGrid);

  if (input.bare) return;

  // 10. map furniture: frame, title, scale bar, compass
  const fx0 = L.ox - CELL * 0.9, fy0 = L.oy - CELL * 0.9, fw = B.cols * CELL + CELL * 1.8, fh = B.rows * CELL + CELL * 1.8;
  ctx.strokeStyle = HATCH; ctx.lineWidth = Math.max(1.5, CELL * 0.05); ctx.strokeRect(fx0, fy0, fw, fh);
  ctx.lineWidth = Math.max(0.8, CELL * 0.02); ctx.strokeRect(fx0 - CELL * 0.12, fy0 - CELL * 0.12, fw + CELL * 0.24, fh + CELL * 0.24);
  const titlePx = L.titlePx;
  const levelName = meta.levelNames[input.level] || `Level ${input.level + 1}`;
  const title = meta.title.trim() ? `${meta.title.trim()}: ${levelName}` : levelName;
  ctx.fillStyle = INK; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.font = `bold ${titlePx}px Georgia, "Times New Roman", serif`;
  ctx.fillText(title, fx0, fy0 - CELL * 0.35);

  const sbY = fy0 + fh + CELL * 0.75, sbX = fx0, seg = CELL, segs = 4, sbH = Math.max(6, CELL * 0.18);
  ctx.lineWidth = Math.max(1, CELL * 0.03); ctx.strokeStyle = INK;
  for (let s = 0; s < segs; s++) { ctx.fillStyle = s % 2 ? PAGE : INK; ctx.fillRect(sbX + s * seg, sbY, seg, sbH); ctx.strokeRect(sbX + s * seg, sbY, seg, sbH); }
  ctx.fillStyle = INK; ctx.font = `${Math.max(11, CELL * 0.42)}px Georgia, "Times New Roman", serif`; ctx.textBaseline = "middle";
  ctx.fillText(`1 square = ${input.feetPerSquare} feet`, sbX + segs * seg + CELL * 0.4, sbY + sbH / 2);

  const cr = Math.max(14, CELL * 0.55), cx = fx0 + fw - cr * 1.2, cy = sbY + sbH / 2 + cr * 0.45;
  ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, CELL * 0.03);
  ctx.beginPath(); ctx.arc(cx, cy, cr * 0.62, 0, Math.PI * 2); ctx.stroke();
  for (let a = 0; a < 4; a++) {
    const ang = a * Math.PI / 2 - Math.PI / 2, tipX = cx + Math.cos(ang) * cr, tipY = cy + Math.sin(ang) * cr;
    const lx = cx + Math.cos(ang + Math.PI / 2) * cr * 0.2, ly = cy + Math.sin(ang + Math.PI / 2) * cr * 0.2;
    const rx = cx + Math.cos(ang - Math.PI / 2) * cr * 0.2, ry = cy + Math.sin(ang - Math.PI / 2) * cr * 0.2;
    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(lx, ly); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(rx, ry); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fillStyle = PAGE; ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = INK; ctx.font = `bold ${Math.max(11, cr * 0.7)}px Georgia, "Times New Roman", serif`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillText("N", cx, cy - cr - 4);

  ctx.restore();
}

// ---- terrain detail ----

function drawTerrainDetail(ctx: CanvasRenderingContext2D, kind: Terrain["kind"], x: number, y: number, S: number, r: number, c: number) {
  if (GROUND_KINDS.has(kind)) { drawGroundDetail(ctx, kind as GroundKind, x, y, S, r, c); return; }
  ctx.save();
  if (kind === "water" || kind === "sewer") {
    ctx.strokeStyle = kind === "water" ? "rgba(40,80,105,0.55)" : "rgba(60,75,40,0.55)"; ctx.lineWidth = Math.max(0.8, S * 0.035);
    for (let k = 0; k < 2; k++) {
      const yy = y + S * (0.32 + k * 0.38), xx = x + S * (0.12 + hash(r, c, 20 + k) * 0.25), w = S * 0.5;
      ctx.beginPath(); ctx.moveTo(xx, yy);
      ctx.quadraticCurveTo(xx + w * 0.25, yy - S * 0.08, xx + w * 0.5, yy);
      ctx.quadraticCurveTo(xx + w * 0.75, yy + S * 0.08, xx + w, yy); ctx.stroke();
    }
  } else if (kind === "lava") {
    ctx.strokeStyle = "rgba(90,25,10,0.7)"; ctx.lineWidth = Math.max(0.8, S * 0.04);
    ctx.beginPath(); let px = x + S * hash(r, c, 30), py = y;
    ctx.moveTo(px, py);
    for (let k = 1; k <= 3; k++) { px = x + S * hash(r, c, 30 + k); py = y + S * k / 3; ctx.lineTo(px, py); }
    ctx.stroke();
    ctx.fillStyle = "rgba(255,210,120,0.45)"; ctx.beginPath(); ctx.arc(x + S * hash(r, c, 35), y + S * hash(r, c, 36), S * 0.1, 0, Math.PI * 2); ctx.fill();
  } else if (kind === "ice") {
    ctx.strokeStyle = "rgba(90,130,150,0.55)"; ctx.lineWidth = Math.max(0.6, S * 0.025);
    ctx.beginPath(); ctx.moveTo(x + S * hash(r, c, 40), y + S * hash(r, c, 41)); ctx.lineTo(x + S * hash(r, c, 42), y + S * hash(r, c, 43)); ctx.lineTo(x + S * hash(r, c, 44), y + S * hash(r, c, 45)); ctx.stroke();
  } else if (kind === "cave") {
    ctx.fillStyle = "rgba(90,70,45,0.4)";
    for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(x + S * hash(r, c, 50 + k), y + S * hash(r, c, 60 + k), Math.max(0.6, S * 0.025), 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === "planks") {
    ctx.strokeStyle = "rgba(90,60,30,0.45)"; ctx.lineWidth = Math.max(0.6, S * 0.025);
    for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(x, y + S * k / 4); ctx.lineTo(x + S, y + S * k / 4); ctx.stroke(); }
  } else if (kind === "panels") {
    ctx.strokeStyle = "rgba(60,70,80,0.4)"; ctx.lineWidth = Math.max(0.6, S * 0.025);
    ctx.strokeRect(x + S * 0.12, y + S * 0.12, S * 0.76, S * 0.76);
  }
  ctx.restore();
}

// ---- doors ----

export function drawDoor(ctx: CanvasRenderingContext2D, kind: DoorKind, x: number, y: number, S: number, horizontal: boolean) {
  // horizontal: the edge runs left-right along y (top edge of a square); otherwise it runs top-bottom at x.
  ctx.save();
  ctx.translate(x + (horizontal ? S / 2 : 0), y + (horizontal ? 0 : S / 2));
  if (!horizontal) ctx.rotate(Math.PI / 2);
  // now the edge runs along the local x axis from -S/2 to S/2
  const lw = Math.max(1.5, S * 0.06);
  ctx.lineWidth = lw; ctx.strokeStyle = INK;
  const leafW = S * 0.72, leafH = S * 0.24;
  if (kind === "door" || kind === "locked") {
    ctx.fillStyle = WOOD; ctx.fillRect(-leafW / 2, -leafH / 2, leafW, leafH); ctx.strokeRect(-leafW / 2, -leafH / 2, leafW, leafH);
    if (kind === "locked") { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(0, 0, S * 0.07, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === "double") {
    ctx.fillStyle = WOOD;
    ctx.fillRect(-leafW / 2, -leafH / 2, leafW / 2, leafH); ctx.strokeRect(-leafW / 2, -leafH / 2, leafW / 2, leafH);
    ctx.fillRect(0, -leafH / 2, leafW / 2, leafH); ctx.strokeRect(0, -leafH / 2, leafW / 2, leafH);
  } else if (kind === "secret") {
    ctx.lineWidth = Math.max(2, S * 0.11); ctx.beginPath(); ctx.moveTo(-S / 2, 0); ctx.lineTo(S / 2, 0); ctx.stroke();
    ctx.rotate(horizontal ? 0 : -Math.PI / 2);
    ctx.font = `bold ${Math.max(10, S * 0.55)}px Georgia, "Times New Roman", serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, S * 0.12); ctx.strokeStyle = PAGE; ctx.strokeText("S", 0, 0);
    ctx.fillStyle = INK; ctx.fillText("S", 0, 0);
  } else if (kind === "portcullis") {
    ctx.fillStyle = INK;
    for (let k = 0; k < 5; k++) { const px = -S * 0.36 + k * S * 0.18; ctx.beginPath(); ctx.arc(px, 0, S * 0.055, 0, Math.PI * 2); ctx.fill(); }
    ctx.lineWidth = Math.max(1, S * 0.03); ctx.beginPath(); ctx.moveTo(-S * 0.42, 0); ctx.lineTo(S * 0.42, 0); ctx.stroke();
  } else if (kind === "arch") {
    ctx.lineWidth = Math.max(2, S * 0.11); ctx.beginPath();
    ctx.moveTo(-S / 2, -S * 0.12); ctx.lineTo(-S / 2, S * 0.12); ctx.moveTo(S / 2, -S * 0.12); ctx.lineTo(S / 2, S * 0.12); ctx.stroke();
  }
  ctx.restore();
}

// ---- features ----

export function drawFeature(ctx: CanvasRenderingContext2D, f: Feature, x: number, y: number, S: number, r: number, c: number, inkS = S) {
  ctx.save();
  ctx.translate(x + S / 2, y + S / 2);
  ctx.rotate(((f.r || 0) % 4) * Math.PI / 2);
  const lw = Math.max(1, inkS * 0.045);
  ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.fillStyle = STONE_LIGHT;
  const h = S / 2;
  const box = (w: number, hh: number, fill = STONE_LIGHT) => { ctx.fillStyle = fill; ctx.fillRect(-w / 2, -hh / 2, w, hh); ctx.strokeRect(-w / 2, -hh / 2, w, hh); };
  const circle = (rad: number, fill = STONE_LIGHT, cx = 0, cy = 0) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
  switch (f.k) {
    case "stairs": {
      // steps get narrower toward the far end so the direction of descent reads at a glance
      ctx.fillStyle = "#e9ddc1"; ctx.fillRect(-h * 0.9, -h * 0.9, S * 0.9, S * 0.9);
      for (let k = 0; k < 6; k++) { const yy = -h * 0.9 + (k + 1) * S * 0.9 / 7, inset = k * S * 0.03; ctx.beginPath(); ctx.moveTo(-h * 0.9 + inset, yy); ctx.lineTo(h * 0.9 - inset, yy); ctx.stroke(); }
      ctx.strokeRect(-h * 0.9, -h * 0.9, S * 0.9, S * 0.9);
      break;
    }
    case "ladder": {
      ctx.beginPath(); ctx.moveTo(-S * 0.18, -h * 0.85); ctx.lineTo(-S * 0.18, h * 0.85); ctx.moveTo(S * 0.18, -h * 0.85); ctx.lineTo(S * 0.18, h * 0.85);
      for (let k = 0; k < 5; k++) { const yy = -h * 0.7 + k * S * 0.17; ctx.moveTo(-S * 0.18, yy); ctx.lineTo(S * 0.18, yy); }
      ctx.stroke(); break;
    }
    case "pillar": circle(S * 0.32); ctx.beginPath(); ctx.arc(0, 0, S * 0.2, 0, Math.PI * 2); ctx.stroke(); break;
    case "statue": {
      box(S * 0.7, S * 0.7);
      circle(S * 0.22, "#e9ddc1");
      ctx.beginPath(); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; ctx.lineTo(Math.cos(a) * S * 0.14, Math.sin(a) * S * 0.14); ctx.lineTo(Math.cos(a + Math.PI / 5) * S * 0.06, Math.sin(a + Math.PI / 5) * S * 0.06); } ctx.closePath(); ctx.fillStyle = INK; ctx.fill();
      break;
    }
    case "altar": box(S * 0.82, S * 0.5); ctx.beginPath(); ctx.moveTo(-S * 0.3, 0); ctx.lineTo(S * 0.3, 0); ctx.stroke(); ctx.fillStyle = "#7a1f14"; ctx.beginPath(); ctx.arc(0, 0, S * 0.06, 0, Math.PI * 2); ctx.fill(); break;
    case "throne": {
      box(S * 0.6, S * 0.5, "#a8763f"); ctx.fillStyle = "#7a1f14"; ctx.fillRect(-S * 0.22, -S * 0.12, S * 0.44, S * 0.3); ctx.strokeRect(-S * 0.22, -S * 0.12, S * 0.44, S * 0.3);
      ctx.fillStyle = "#a8763f"; ctx.fillRect(-S * 0.34, -S * 0.36, S * 0.68, S * 0.14); ctx.strokeRect(-S * 0.34, -S * 0.36, S * 0.68, S * 0.14);
      break;
    }
    case "chest": {
      box(S * 0.5, S * 0.36, "#8a5a2b");
      ctx.fillStyle = "#c9a24b";
      for (const bx of [-S * 0.17, S * 0.13]) { ctx.fillRect(bx, -S * 0.18, S * 0.04, S * 0.36); ctx.strokeRect(bx, -S * 0.18, S * 0.04, S * 0.36); }
      ctx.beginPath(); ctx.arc(0, S * 0.02, S * 0.05, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case "table": { ctx.fillStyle = "#c9a26b"; ctx.beginPath(); ctx.rect(-S * 0.4, -S * 0.28, S * 0.8, S * 0.56); ctx.fill(); ctx.stroke(); ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(-S * 0.4, 0); ctx.lineTo(S * 0.4, 0); ctx.stroke(); break; }
    case "bed": box(S * 0.56, S * 0.86, "#e9ddc1"); ctx.fillStyle = "#ffffff"; ctx.fillRect(-S * 0.2, -S * 0.36, S * 0.4, S * 0.16); ctx.strokeRect(-S * 0.2, -S * 0.36, S * 0.4, S * 0.16); ctx.fillStyle = "#9a6b4a"; ctx.fillRect(-S * 0.28, -S * 0.08, S * 0.56, S * 0.5); ctx.strokeRect(-S * 0.28, -S * 0.08, S * 0.56, S * 0.5); break;
    case "bookshelf": { box(S * 0.92, S * 0.3, WOOD); ctx.lineWidth = lw * 0.6; for (let k = 1; k < 6; k++) { const xx = -S * 0.46 + k * S * 0.92 / 6; ctx.beginPath(); ctx.moveTo(xx, -S * 0.15); ctx.lineTo(xx, S * 0.15); ctx.stroke(); } break; }
    case "barrels": circle(S * 0.17, WOOD, -S * 0.17, -S * 0.15); circle(S * 0.17, WOOD, S * 0.17, -S * 0.12); circle(S * 0.17, WOOD, 0, S * 0.18);
      ctx.beginPath(); ctx.arc(-S * 0.17, -S * 0.15, S * 0.08, 0, Math.PI * 2); ctx.arc(S * 0.17, -S * 0.12, S * 0.08, 0, Math.PI * 2); ctx.stroke(); break;
    case "crates": {
      for (const [cx, cy, s] of [[-S * 0.16, -S * 0.14, S * 0.34], [S * 0.18, S * 0.16, S * 0.3]] as const) {
        ctx.fillStyle = WOOD; ctx.fillRect(cx - s / 2, cy - s / 2, s, s); ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
        ctx.beginPath(); ctx.moveTo(cx - s / 2, cy - s / 2); ctx.lineTo(cx + s / 2, cy + s / 2); ctx.moveTo(cx + s / 2, cy - s / 2); ctx.lineTo(cx - s / 2, cy + s / 2); ctx.stroke();
      }
      break;
    }
    case "rubble": {
      for (let k = 0; k < 7; k++) {
        const rx = (hash(r, c, 70 + k) - 0.5) * S * 0.7, ry = (hash(r, c, 80 + k) - 0.5) * S * 0.7, rr = S * (0.05 + hash(r, c, 90 + k) * 0.08);
        ctx.fillStyle = "#b8aa8c"; ctx.beginPath();
        for (let v = 0; v < 6; v++) { const a = v * Math.PI / 3 + hash(r, c, 100 + k) * 2, rad = rr * (0.7 + hash(r, c, 110 + k * 6 + v) * 0.5); ctx.lineTo(rx + Math.cos(a) * rad, ry + Math.sin(a) * rad); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      break;
    }
    case "pit": {
      ctx.fillStyle = "#2b2018"; ctx.beginPath(); ctx.arc(0, 0, S * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#5b4630"; ctx.lineWidth = lw * 0.7;
      for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; ctx.beginPath(); ctx.moveTo(Math.cos(a) * S * 0.38, Math.sin(a) * S * 0.38); ctx.lineTo(Math.cos(a) * S * 0.22, Math.sin(a) * S * 0.22); ctx.stroke(); }
      break;
    }
    case "trapdoor": box(S * 0.7, S * 0.7, "#c9a26b"); ctx.beginPath(); ctx.moveTo(-S * 0.35, 0); ctx.lineTo(S * 0.35, 0); ctx.stroke(); ctx.fillStyle = INK; ctx.fillRect(-S * 0.3, -S * 0.36, S * 0.1, S * 0.06); ctx.fillRect(S * 0.2, -S * 0.36, S * 0.1, S * 0.06); break;
    case "trap": {
      ctx.fillStyle = "rgba(122,31,20,0.12)"; ctx.beginPath(); ctx.arc(0, 0, S * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#7a1f14"; ctx.stroke();
      ctx.fillStyle = "#7a1f14"; ctx.font = `bold ${Math.max(9, S * 0.48)}px Georgia, "Times New Roman", serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.rotate(-((f.r || 0) % 4) * Math.PI / 2); ctx.fillText("T", 0, S * 0.02);
      break;
    }
    case "fountain": circle(S * 0.42); circle(S * 0.3, "#93b6c6"); circle(S * 0.08, STONE_LIGHT); break;
    case "well": circle(S * 0.36); ctx.fillStyle = "#1f2a30"; ctx.beginPath(); ctx.arc(0, 0, S * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
    case "coffin": {
      ctx.fillStyle = STONE_LIGHT; ctx.beginPath();
      ctx.moveTo(0, -S * 0.44); ctx.lineTo(S * 0.22, -S * 0.26); ctx.lineTo(S * 0.16, S * 0.44); ctx.lineTo(-S * 0.16, S * 0.44); ctx.lineTo(-S * 0.22, -S * 0.26); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -S * 0.2); ctx.lineTo(0, S * 0.25); ctx.moveTo(-S * 0.1, -S * 0.05); ctx.lineTo(S * 0.1, -S * 0.05); ctx.stroke();
      break;
    }
    case "brazier": {
      circle(S * 0.3, "#5b4630");
      ctx.fillStyle = "#e8913c"; ctx.beginPath(); ctx.moveTo(0, -S * 0.22); ctx.quadraticCurveTo(S * 0.18, 0, 0, S * 0.18); ctx.quadraticCurveTo(-S * 0.18, 0, 0, -S * 0.22); ctx.fill();
      ctx.fillStyle = "#f6d27a"; ctx.beginPath(); ctx.arc(0, S * 0.04, S * 0.07, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "web": {
      ctx.strokeStyle = "rgba(43,32,24,0.7)"; ctx.lineWidth = lw * 0.5;
      const cx = -h, cy = -h;
      for (let k = 0; k <= 4; k++) { const a = k * Math.PI / 8; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * S * 1.05, cy + Math.sin(a) * S * 1.05); ctx.stroke(); }
      for (let ring = 1; ring <= 3; ring++) { ctx.beginPath(); for (let k = 0; k <= 4; k++) { const a = k * Math.PI / 8, rad = ring * S * 0.3; const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad; if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.stroke(); }
      break;
    }
    case "bones": {
      ctx.strokeStyle = INK; ctx.fillStyle = "#f3ead6";
      const bone = (bx: number, by: number, ang: number) => {
        ctx.save(); ctx.translate(bx, by); ctx.rotate(ang);
        ctx.lineWidth = Math.max(2, S * 0.07); ctx.beginPath(); ctx.moveTo(-S * 0.16, 0); ctx.lineTo(S * 0.16, 0); ctx.stroke();
        ctx.lineWidth = lw * 0.6; for (const ex of [-S * 0.16, S * 0.16]) { ctx.beginPath(); ctx.arc(ex, -S * 0.03, S * 0.035, 0, Math.PI * 2); ctx.arc(ex, S * 0.03, S * 0.035, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        ctx.restore();
      };
      bone(-S * 0.12, -S * 0.12, hash(r, c, 120) * Math.PI); bone(S * 0.14, S * 0.12, hash(r, c, 121) * Math.PI);
      ctx.beginPath(); ctx.arc(S * 0.12, -S * 0.18, S * 0.09, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// ---- free pieces (battle maps, p104) ----

const FEATURE_BOX = new Set<string>(FEATURES.map((f) => f.key));
const OUTDOOR_BOX = new Map(OUTDOOR_ELEMENTS.map((e) => [e.key as string, e]));

// The piece's box in squares at size 1, before turning. Labels grow with their text.
export function elementBox(k: string, text?: string): { w: number; h: number } {
  if (k === "label") return { w: Math.max(1, (text || "").length * 0.5), h: 0.8 };
  const o = OUTDOOR_BOX.get(k);
  return o ? { w: o.w, h: o.h } : { w: 1, h: 1 };
}

function seedOf(id: string): number {
  let h = 5381; for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) | 0;
  return Math.abs(h) % 100000;
}

// gx, gy: the canvas position of the grid's top-left corner. S: one square in pixels.
export function drawElement(ctx: CanvasRenderingContext2D, el: MapElement, gx: number, gy: number, S: number): void {
  const s = el.s > 0 ? el.s : 1, P = S * s, inkS = S * Math.sqrt(s), seed = seedOf(el.id);
  ctx.save();
  ctx.translate(gx + el.x * S, gy + el.y * S);
  ctx.rotate(((el.rot || 0) * Math.PI) / 180);
  if (el.k === "label") {
    const text = (el.text || "").trim();
    if (text) {
      const px = Math.max(10, S * (text.length > 3 ? 0.55 : 0.8) * s);
      ctx.font = `bold ${px}px Georgia, "Times New Roman", serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, px * 0.22); ctx.strokeStyle = PAGE; ctx.strokeText(text, 0, 0);
      ctx.fillStyle = NUM; ctx.fillText(text, 0, 0);
    }
  } else if (FEATURE_BOX.has(el.k)) {
    drawFeature(ctx, { k: el.k as FeatureKind, r: 0 }, -P / 2, -P / 2, P, seed % 997, (seed / 997) | 0, inkS);
  } else if (isOutdoorKind(el.k)) {
    drawOutdoorElement(ctx, el.k, P, seed, inkS);
  }
  ctx.restore();
}

// Is the point (px, py), in squares, on this piece?
export function hitElement(el: MapElement, px: number, py: number): boolean {
  const { w, h } = elementBox(el.k, el.text), s = el.s > 0 ? el.s : 1, a = (-(el.rot || 0) * Math.PI) / 180;
  const dx = px - el.x, dy = py - el.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= Math.max(0.3, (w * s) / 2) && Math.abs(ly) <= Math.max(0.3, (h * s) / 2);
}

// Snap a centre so the piece's edges land on grid lines: an odd number of squares across centres on a
// square, an even number (or a thin piece such as a fence) centres on a line. A piece at an odd angle
// snaps to the middle of a square.
export function snapElement(el: MapElement, x: number, y: number): { x: number; y: number } {
  const { w, h } = elementBox(el.k, el.text), s = el.s > 0 ? el.s : 1, rot = el.rot || 0;
  const quarter = Math.round(rot / 90), square = Math.abs(rot - quarter * 90) < 0.5;
  let fw = w * s, fh = h * s;
  if (!square) { fw = 1; fh = 1; } else if (((quarter % 2) + 2) % 2 === 1) { const t = fw; fw = fh; fh = t; }
  const snap = (v: number, f: number) => (Math.round(f) % 2 === 0 ? Math.round(v) : Math.floor(v) + 0.5);
  return { x: snap(x, fw), y: snap(y, fh) };
}

// A plain black square grid over the whole map area, for play on a table or a VTT: on top of the floor,
// walls, pieces and numbers. gx, gy: canvas position of the grid's top-left corner.
export function drawTopGrid(ctx: CanvasRenderingContext2D, gx: number, gy: number, S: number, B: Bounds, opacity: number): void {
  const a = Math.max(0.05, Math.min(1, opacity));
  ctx.save();
  ctx.strokeStyle = `rgba(0,0,0,${a.toFixed(3)})`; ctx.lineWidth = Math.max(1, S * 0.03); ctx.setLineDash([]);
  ctx.beginPath();
  for (let r = B.r0; r <= B.r0 + B.rows; r++) { ctx.moveTo(gx + B.c0 * S, gy + r * S); ctx.lineTo(gx + (B.c0 + B.cols) * S, gy + r * S); }
  for (let c = B.c0; c <= B.c0 + B.cols; c++) { ctx.moveTo(gx + c * S, gy + B.r0 * S); ctx.lineTo(gx + c * S, gy + (B.r0 + B.rows) * S); }
  ctx.stroke();
  ctx.restore();
}
