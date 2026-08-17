// Building floor-plan model + geometry + renderer. A plan is an editable BSP tree over a footprint;
// rooms are DERIVED from the tree on render, so dragging a wall only changes one `pos`. The GM drags
// walls, doors and the entrance; flip/rotate reorient the whole plan. renderControlImage draws the
// current (edited) plan as a control image for the imagine route (mode: "building") to paint.

export type BuildingTypeDef = { key: string; label: string; group: string; rooms: number; aspect: number; compact?: boolean };

export const BUILDING_TYPES: BuildingTypeDef[] = [
  { key: "cottage", label: "Cottage", group: "Dwellings", rooms: 3, aspect: 1.2 },
  { key: "house", label: "House", group: "Dwellings", rooms: 5, aspect: 1.15 },
  { key: "townhouse", label: "Townhouse", group: "Dwellings", rooms: 5, aspect: 0.6 },
  { key: "manor", label: "Manor", group: "Dwellings", rooms: 9, aspect: 1.3 },
  { key: "shop", label: "Shop", group: "Trade", rooms: 4, aspect: 1 },
  { key: "tavern", label: "Tavern / inn", group: "Trade", rooms: 7, aspect: 1.15 },
  { key: "smithy", label: "Smithy", group: "Trade", rooms: 3, aspect: 1.1 },
  { key: "warehouse", label: "Warehouse", group: "Trade", rooms: 3, aspect: 1.4 },
  { key: "temple", label: "Temple / chapel", group: "Civic & sacred", rooms: 4, aspect: 0.8 },
  { key: "guildhall", label: "Guildhall", group: "Civic & sacred", rooms: 6, aspect: 1.2 },
  { key: "library", label: "Library", group: "Civic & sacred", rooms: 5, aspect: 1.1 },
  { key: "tower", label: "Wizard's tower", group: "Martial", rooms: 2, aspect: 1, compact: true },
  { key: "keep", label: "Keep", group: "Martial", rooms: 6, aspect: 1 },
  { key: "barracks", label: "Barracks", group: "Martial", rooms: 6, aspect: 1.5 },
  { key: "barn", label: "Barn / stable", group: "Rural", rooms: 3, aspect: 1.3 },
  { key: "mill", label: "Mill", group: "Rural", rooms: 3, aspect: 0.9 },
  { key: "cabin", label: "Ship's cabin", group: "Other-genre", rooms: 3, aspect: 1.3, compact: true },
  { key: "pod", label: "Spaceship pod", group: "Other-genre", rooms: 3, aspect: 1, compact: true },
];

export function buildingDef(key: string): BuildingTypeDef {
  return BUILDING_TYPES.find((b) => b.key === key) ?? BUILDING_TYPES[1];
}

export type Side = "N" | "E" | "S" | "W";
export type Entrance = { side: Side; off: number };
export type BuildingNode = { kind: "leaf" } | { kind: "split"; axis: "v" | "h"; pos: number; door: number; a: BuildingNode; b: BuildingNode };
export type BuildingPlan = { type: string; aspect: number; rooms: number; seed: number; tree: BuildingNode; entrance: Entrance };
export type Rect = { x: number; y: number; w: number; h: number };

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTree(rng: () => number, w: number, h: number, target: number): BuildingNode {
  if (target <= 1) return { kind: "leaf" };
  const la = Math.max(1, Math.round(target * (0.35 + rng() * 0.3)));
  const lb = Math.max(1, target - la);
  if (lb < 1) return { kind: "leaf" };
  const axis: "v" | "h" = w >= h ? "v" : "h";
  const pos = 0.4 + rng() * 0.2;
  const aw = axis === "v" ? w * pos : w, ah = axis === "v" ? h : h * pos;
  const bw = axis === "v" ? w * (1 - pos) : w, bh = axis === "v" ? h : h * (1 - pos);
  return { kind: "split", axis, pos, door: 0.35 + rng() * 0.3, a: buildTree(rng, aw, ah, la), b: buildTree(rng, bw, bh, lb) };
}

function footprintDims(aspect: number, compact: boolean, size: number): Rect {
  let w = compact ? size * 0.5 : size * 0.78, h = w / aspect;
  if (h > size * 0.82) { h = size * 0.82; w = h * aspect; }
  return { x: (size - w) / 2, y: (size - h) / 2, w, h };
}
export function footprintOf(plan: BuildingPlan, size: number): Rect {
  return footprintDims(plan.aspect, !!buildingDef(plan.type).compact, size);
}

export function makePlan(type: string, rooms: number, seed: number): BuildingPlan {
  const def = buildingDef(type);
  const f = footprintDims(def.aspect, !!def.compact, 1024);
  const r = Math.max(1, Math.round(rooms));
  return { type, aspect: def.aspect, rooms: r, seed, tree: buildTree(mulberry32(seed), f.w, f.h, r), entrance: { side: "S", off: 0.5 } };
}

export function childRects(node: Extract<BuildingNode, { kind: "split" }>, r: Rect): [Rect, Rect] {
  const p = node.pos;
  return node.axis === "v"
    ? [{ x: r.x, y: r.y, w: r.w * p, h: r.h }, { x: r.x + r.w * p, y: r.y, w: r.w * (1 - p), h: r.h }]
    : [{ x: r.x, y: r.y, w: r.w, h: r.h * p }, { x: r.x, y: r.y + r.h * p, w: r.w, h: r.h * (1 - p) }];
}
export function walkLeaves(node: BuildingNode, r: Rect, out: Rect[]): void {
  if (node.kind === "leaf") { out.push(r); return; }
  const [ra, rb] = childRects(node, r); walkLeaves(node.a, ra, out); walkLeaves(node.b, rb, out);
}
export type SplitHit = { node: Extract<BuildingNode, { kind: "split" }>; r: Rect };
export function walkSplits(node: BuildingNode, r: Rect, out: SplitHit[]): void {
  if (node.kind !== "split") return;
  out.push({ node, r });
  const [ra, rb] = childRects(node, r); walkSplits(node.a, ra, out); walkSplits(node.b, rb, out);
}
export function splitLine(node: Extract<BuildingNode, { kind: "split" }>, r: Rect) {
  return node.axis === "v"
    ? { x1: r.x + r.w * node.pos, y1: r.y, x2: r.x + r.w * node.pos, y2: r.y + r.h }
    : { x1: r.x, y1: r.y + r.h * node.pos, x2: r.x + r.w, y2: r.y + r.h * node.pos };
}
export function doorPt(node: Extract<BuildingNode, { kind: "split" }>, r: Rect) {
  const l = splitLine(node, r);
  return node.axis === "v" ? { x: l.x1, y: l.y1 + (l.y2 - l.y1) * node.door } : { x: l.x1 + (l.x2 - l.x1) * node.door, y: l.y1 };
}
export function entPt(ent: Entrance, f: Rect) {
  if (ent.side === "N") return { x: f.x + f.w * ent.off, y: f.y };
  if (ent.side === "S") return { x: f.x + f.w * ent.off, y: f.y + f.h };
  if (ent.side === "W") return { x: f.x, y: f.y + f.h * ent.off };
  return { x: f.x + f.w, y: f.y + f.h * ent.off };
}

// --- transforms (pure) ---
function flipNode(node: BuildingNode, horiz: boolean): BuildingNode {
  if (node.kind !== "split") return node;
  const flAxis = horiz ? "v" : "h";
  if (node.axis === flAxis) return { kind: "split", axis: node.axis, pos: 1 - node.pos, door: node.door, a: flipNode(node.b, horiz), b: flipNode(node.a, horiz) };
  return { kind: "split", axis: node.axis, pos: node.pos, door: 1 - node.door, a: flipNode(node.a, horiz), b: flipNode(node.b, horiz) };
}
function flipEnt(e: Entrance, horiz: boolean): Entrance {
  if (horiz) { if (e.side === "E") return { side: "W", off: e.off }; if (e.side === "W") return { side: "E", off: e.off }; return { side: e.side, off: 1 - e.off }; }
  if (e.side === "N") return { side: "S", off: e.off }; if (e.side === "S") return { side: "N", off: e.off }; return { side: e.side, off: 1 - e.off };
}
export function flipPlan(plan: BuildingPlan, horiz: boolean): BuildingPlan {
  return { ...plan, tree: flipNode(plan.tree, horiz), entrance: flipEnt(plan.entrance, horiz) };
}
// 90 degrees clockwise.
function rotNode(node: BuildingNode): BuildingNode {
  if (node.kind !== "split") return node;
  if (node.axis === "v") return { kind: "split", axis: "h", pos: node.pos, door: 1 - node.door, a: rotNode(node.a), b: rotNode(node.b) };
  return { kind: "split", axis: "v", pos: 1 - node.pos, door: node.door, a: rotNode(node.b), b: rotNode(node.a) };
}
function rotEnt(e: Entrance): Entrance {
  const map: Record<Side, Side> = { N: "E", E: "S", S: "W", W: "N" };
  return { side: map[e.side], off: e.side === "E" || e.side === "W" ? 1 - e.off : e.off };
}
export function rotatePlan(plan: BuildingPlan): BuildingPlan {
  return { ...plan, aspect: 1 / plan.aspect, tree: rotNode(plan.tree), entrance: rotEnt(plan.entrance) };
}

// --- rendering ---
export function drawPlan(ctx: CanvasRenderingContext2D, plan: BuildingPlan, size: number): void {
  const f = footprintOf(plan, size);
  ctx.fillStyle = "#e7dfce"; ctx.fillRect(0, 0, size, size);
  const leaves: Rect[] = []; walkLeaves(plan.tree, f, leaves);
  leaves.forEach((rm, i) => {
    const v = 196 - ((i * 37) % 40);
    ctx.fillStyle = `rgb(${v},${v - 8},${v - 22})`; ctx.fillRect(rm.x, rm.y, rm.w, rm.h);
    const r2 = mulberry32(plan.seed + i * 131);
    for (let k = 0; k < 10; k++) { const s = size * 0.012 + r2() * size * 0.018; ctx.fillStyle = "rgba(120,105,85,0.3)"; ctx.fillRect(rm.x + 8 + r2() * Math.max(0, rm.w - s - 16), rm.y + 8 + r2() * Math.max(0, rm.h - s - 16), s, s * (0.6 + r2() * 0.8)); }
  });
  const splits: SplitHit[] = []; walkSplits(plan.tree, f, splits);
  ctx.strokeStyle = "#3a332a"; ctx.lineWidth = size * 0.007; ctx.lineCap = "round";
  splits.forEach(({ node, r }) => { const l = splitLine(node, r); ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); });
  ctx.lineWidth = size * 0.013; ctx.strokeRect(f.x, f.y, f.w, f.h);
  const dw = size * 0.055; ctx.fillStyle = "#cfc6b0";
  splits.forEach(({ node, r }) => { const d = doorPt(node, r); if (node.axis === "v") ctx.fillRect(d.x - size * 0.009, d.y - dw / 2, size * 0.018, dw); else ctx.fillRect(d.x - dw / 2, d.y - size * 0.009, dw, size * 0.018); });
  const e = entPt(plan.entrance, f); const vert = plan.entrance.side === "E" || plan.entrance.side === "W"; const ew = size * 0.06;
  ctx.fillStyle = "#c9a24b"; ctx.fillRect(e.x - (vert ? size * 0.012 : ew / 2), e.y - (vert ? ew / 2 : size * 0.012), vert ? size * 0.024 : ew, vert ? ew : size * 0.024);
}

export function renderControlImage(plan: BuildingPlan, size = 1024): string {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  drawPlan(ctx, plan, size);
  return canvas.toDataURL("image/png");
}
