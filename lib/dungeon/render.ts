// Dungeon model + control-image renderer. A dungeon is 3 stacked 20x20 levels; each cell is 0 (empty)
// or an index into CELL_TYPES. renderDungeonLevel draws one level as a clean control image (cells
// coloured by type, dark walls around rooms, corridors left open) for the imagine route to paint into
// a top-down battle map. Editor chrome (grid lines, the ghost of the level below) lives in the
// component, not here - this output is what the AI sees.

export const N = 20;
export const LEVELS = 3;

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

export function emptyLevels(): number[][] {
  return Array.from({ length: LEVELS }, () => new Array<number>(N * N).fill(0));
}

// Coerce whatever came back from the DB (jsonb) into a valid 3 x 400 grid.
export function normalizeLevels(raw: unknown): number[][] {
  const base = emptyLevels();
  if (!Array.isArray(raw)) return base;
  for (let l = 0; l < LEVELS; l++) {
    const lvl = raw[l];
    if (Array.isArray(lvl)) for (let i = 0; i < N * N; i++) { const v = lvl[i]; if (typeof v === "number" && v >= 0 && v < CELL_TYPES.length) base[l][i] = v; }
  }
  return base;
}

export function renderDungeonLevel(grid: number[], size = 1024): string {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const CELL = size / N;

  ctx.fillStyle = "#0e0b08";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < N * N; i++) {
    const t = grid[i]; if (!t) continue;
    const col = CELL_TYPES[t]?.color; if (!col) continue;
    const x = (i % N) * CELL, y = ((i / N) | 0) * CELL;
    ctx.fillStyle = col; ctx.fillRect(x, y, CELL, CELL);
    if (CELL_TYPES[t].key === "corridor") { ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect(x + CELL * 0.18, y + CELL * 0.18, CELL * 0.64, CELL * 0.64); }
  }

  // Walls only where painted space meets EMPTY space, so any block of touching cells - whatever their
  // types - reads as ONE cohesive room (a cave with lava, a flooded sewer), not separate rooms.
  ctx.strokeStyle = "#2a2620"; ctx.lineWidth = CELL * 0.14; ctx.lineCap = "round";
  const isWall = (rr: number, cc: number) => (rr < 0 || cc < 0 || rr >= N || cc >= N) ? true : grid[rr * N + cc] === 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const t = grid[r * N + c]; if (!t) continue;
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
