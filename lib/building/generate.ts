// Building floor-plan generator. Picks a building type and lays out rooms automatically by recursive
// binary splitting (BSP), then draws a control image - light rooms, dark walls, pale door gaps at each
// split, a gold entrance notch - for the imagine route to paint into a furnished top-down building.
// Fully described by (type, rooms, floor, seed), so it regenerates identically; nothing is stored.

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

export type BuildingOpts = { type: string; rooms: number; floor: number; seed: number; size?: number };

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rect = { x: number; y: number; w: number; h: number };
type Door = { x: number; y: number; horiz: boolean };

// Split the footprint until there are EXACTLY `target` rooms: repeatedly split the largest room that
// still fits two, along its longer axis, and drop a door on the wall that split just created (so every
// interior wall gets one doorway on a real shared edge).
function splitToRooms(rng: () => number, footprint: Rect, target: number, min: number, rooms: Rect[], doors: Door[]): void {
  rooms.push({ ...footprint });
  while (rooms.length < target) {
    let idx = -1, best = -1;
    for (let i = 0; i < rooms.length; i++) { const l = rooms[i]; if (l.w >= min * 2 || l.h >= min * 2) { const a = l.w * l.h; if (a > best) { best = a; idx = i; } } }
    if (idx < 0) break; // nothing left large enough to split
    const l = rooms[idx];
    const canV = l.w >= min * 2, canH = l.h >= min * 2;
    const vert = canV && (!canH || l.w >= l.h);
    if (vert) {
      const sx = l.x + l.w * (0.4 + rng() * 0.2);
      doors.push({ x: sx, y: l.y + l.h * (0.35 + rng() * 0.3), horiz: false });
      rooms.splice(idx, 1, { x: l.x, y: l.y, w: sx - l.x, h: l.h }, { x: sx, y: l.y, w: l.x + l.w - sx, h: l.h });
    } else {
      const sy = l.y + l.h * (0.4 + rng() * 0.2);
      doors.push({ x: l.x + l.w * (0.35 + rng() * 0.3), y: sy, horiz: true });
      rooms.splice(idx, 1, { x: l.x, y: l.y, w: l.w, h: sy - l.y }, { x: l.x, y: sy, w: l.w, h: l.y + l.h - sy });
    }
  }
}

export function generateBuilding(opts: BuildingOpts): string {
  const size = opts.size ?? 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const W = size, def = buildingDef(opts.type), rng = mulberry32(opts.seed + opts.floor * 7919);

  ctx.fillStyle = "#e7dfce"; ctx.fillRect(0, 0, W, W);
  let fw = def.compact ? W * 0.5 : W * 0.78, fh = fw / def.aspect;
  if (fh > W * 0.82) { fh = W * 0.82; fw = fh * def.aspect; }
  const fx = (W - fw) / 2, fy = (W - fh) / 2;
  const target = Math.max(1, Math.round(opts.rooms));
  const rooms: Rect[] = [], doors: Door[] = [];
  splitToRooms(rng, { x: fx, y: fy, w: fw, h: fh }, target, W * 0.09, rooms, doors);

  rooms.forEach((rm, i) => {
    const v = 196 - ((i * 37) % 40);
    ctx.fillStyle = `rgb(${v},${v - 8},${v - 22})`; ctx.fillRect(rm.x, rm.y, rm.w, rm.h);
    for (let k = 0; k < 12; k++) {
      const s = W * 0.012 + rng() * W * 0.018;
      ctx.fillStyle = "rgba(120,105,85,0.35)";
      ctx.fillRect(rm.x + 6 + rng() * Math.max(0, rm.w - s - 12), rm.y + 6 + rng() * Math.max(0, rm.h - s - 12), s, s * (0.6 + rng() * 0.8));
    }
  });

  ctx.strokeStyle = "#3a332a"; ctx.lineWidth = W * 0.006;
  rooms.forEach((rm) => ctx.strokeRect(rm.x, rm.y, rm.w, rm.h));
  ctx.lineWidth = W * 0.012; ctx.strokeRect(fx, fy, fw, fh);

  const dw = W * 0.05;
  ctx.fillStyle = "#cfc6b0";
  doors.forEach((d) => { if (d.horiz) ctx.fillRect(d.x - dw / 2, d.y - W * 0.008, dw, W * 0.016); else ctx.fillRect(d.x - W * 0.008, d.y - dw / 2, W * 0.016, dw); });
  ctx.fillStyle = "#c9a24b"; ctx.fillRect(fx + fw / 2 - dw / 2, fy + fh - W * 0.01, dw, W * 0.02);

  return canvas.toDataURL("image/png");
}
