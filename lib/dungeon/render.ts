// Dungeon model + control-image renderer. A dungeon is 3 stacked square levels of side N (25/50/75/100);
// each cell is 0 (empty) or an index into CELL_TYPES. Grid size doubles as scale: feet per square = N/5
// (25 -> 5ft, 50 -> 10ft, 75 -> 15ft, 100 -> 20ft). renderDungeonLevel draws one level as a clean
// control image - cells coloured by type, dark walls ONLY where painted space meets empty (so any block
// of touching cells is one cohesive room), corridors open. Editor chrome lives in the component.

export const LEVELS = 3;
export const SIZES = [25, 50, 75, 100];
export const DEFAULT_N = 25;

export function feetPerSquare(n: number): number { return n / 5; }

export const CELL_TYPES: { key: string; label: string; color: string | null }[] = [
  { key: "erase", label: "Erase", color: null },
  { key: "corridor", label: "Corridor", color: "#c0b498" },
  { key: "room", label: "Room", color: "#d8cdb5" },
  { key: "dungeon", label: "Dungeon", color: "#9a938a" },
  { key: "cave", label: "Cave", color: "#a68a6a" },
  { key: "water", label: "Water", color: "#5a86a8" },
  { key: "castle", label: "Castle", color: "#c8b48a" },
  { key: "crypt", label: "Crypt", color: "#7a7266" },
  { key: "mine", label: "Mine", color: "#b08a4a" },
  { key: "sewer", label: "Sewer", color: "#6a7a5a" },
  { key: "lava", label: "Lava", color: "#c0603a" },
  { key: "ice", label: "Ice", color: "#b8d0d8" },
  { key: "temple", label: "Temple", color: "#cbb6d0" },
  { key: "ship", label: "Ship", color: "#8a6a4a" },
  { key: "spaceship", label: "Spaceship", color: "#8a9aa8" },
];

export function emptyLevels(n: number): number[][] {
  return Array.from({ length: LEVELS }, () => new Array<number>(n * n).fill(0));
}

// Infer the side length from stored data (levels are n*n), so we don't need a separate column.
export function gridSizeOf(raw: unknown, fallback = DEFAULT_N): number {
  if (Array.isArray(raw) && Array.isArray(raw[0]) && raw[0].length > 0) {
    const n = Math.round(Math.sqrt(raw[0].length));
    if (n > 0) return n;
  }
  return fallback;
}

export function normalizeLevels(raw: unknown, n: number): number[][] {
  const base = emptyLevels(n);
  if (!Array.isArray(raw)) return base;
  for (let l = 0; l < LEVELS; l++) {
    const lvl = raw[l];
    if (Array.isArray(lvl)) for (let i = 0; i < n * n; i++) { const v = lvl[i]; if (typeof v === "number" && v >= 0 && v < CELL_TYPES.length) base[l][i] = v; }
  }
  return base;
}

// Resize keeping the top-left overlap: existing cells stay put, new space is empty, trimmed space is dropped.
export function resizeLevels(levels: number[][], oldN: number, newN: number): number[][] {
  const out = emptyLevels(newN);
  const k = Math.min(oldN, newN);
  for (let l = 0; l < LEVELS; l++) for (let r = 0; r < k; r++) for (let c = 0; c < k; c++) out[l][r * newN + c] = levels[l][r * oldN + c] ?? 0;
  return out;
}

export function renderDungeonLevel(grid: number[], n: number, size = 1024): string {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const CELL = size / n;

  ctx.fillStyle = "#0e0b08";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < n * n; i++) {
    const t = grid[i]; if (!t) continue;
    const col = CELL_TYPES[t]?.color; if (!col) continue;
    const x = (i % n) * CELL, y = ((i / n) | 0) * CELL;
    ctx.fillStyle = col; ctx.fillRect(x, y, CELL, CELL);
    if (CELL_TYPES[t].key === "corridor") { ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect(x + CELL * 0.18, y + CELL * 0.18, CELL * 0.64, CELL * 0.64); }
  }

  // Walls only where painted space meets EMPTY space, so touching cells of any types read as one room.
  ctx.strokeStyle = "#2a2620"; ctx.lineWidth = Math.max(1.5, CELL * 0.14); ctx.lineCap = "round";
  const isWall = (rr: number, cc: number) => (rr < 0 || cc < 0 || rr >= n || cc >= n) ? true : grid[rr * n + cc] === 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const t = grid[r * n + c]; if (!t) continue;
    const x = c * CELL, y = r * CELL;
    ctx.beginPath();
    if (isWall(r - 1, c)) { ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); }
    if (isWall(r + 1, c)) { ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); }
    if (isWall(r, c - 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); }
    if (isWall(r, c + 1)) { ctx.moveTo(x + CELL, y); ctx.lineTo(x + CELL, y + CELL); }
    ctx.stroke();
  }

  return canvas.toDataURL("image/png");
}
