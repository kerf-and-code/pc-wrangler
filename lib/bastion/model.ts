// Bastion layout model + control-image renderer. A bastion is one or more stacked DECKS (traditional =
// 1; ship = 3, plus an optional 4th top deck), each a square grid of 5-ft cells. Each cell holds a
// placement index (which placed facility occupies it) or 0 for empty. Placements are the facilities the
// player has added, chosen from the rules-gated list (lib/bastion/rules.ts). Doors are placed on cell
// edges wherever the player wants, building-style. renderBastionDeck draws one deck as a clean control
// image for the imagine route (mode: "bastion"). Pure data + helpers here; editor chrome is in the
// component. Bastion facilities are always measured in 5-ft squares, so scale is fixed at 5 ft/square.

import {
  type FacilitySpace, type FacilitySource, type ClassCaps, type BastionOrder,
  SPACE_SQUARES, BASIC_ADD_COST, facilityById,
} from "./rules";

export const FT_PER_SQUARE = 5;                 // bastion facilities are defined in 5-ft squares
export const BASTION_GRID_SIZES = [20, 30, 40]; // squares per side (100 / 150 / 200 ft across)
export const DEFAULT_GRID_N = 30;
export const SHIP_DECKS = 3;                     // decks in a ship bastion (before the optional top deck)
export const SHIP_MAX_DECKS = 4;                 // ship + top deck

export type BastionKind = "traditional" | "ship";

// A facility the player has added to the bastion. Cells reference it by its 1-based index in the plan's
// `placements` array (0 = empty), the same compact scheme the dungeon uses.
export interface Placement {
  id: string;                 // stable instance id
  kind: "special" | "basic" | "custom";
  facilityId?: string;        // for kind "special": id from lib/bastion/rules.ts
  basicName?: string;         // for kind "basic": one of BASIC_FACILITIES
  label: string;              // display name
  space: FacilitySpace;       // Cramped / Roomy / Vast (the max squares this facility may occupy)
  order?: BastionOrder;       // for coloring/legend (special facilities)
  color: string;              // fill color on the map
  enlarged?: boolean;         // enlarged to Vast (facilities that allow it), for the cost summary
  planeOrType?: string;       // free note (Garden type, Manifest Zone plane, guild type, etc.)
}

export type DoorEdge = "N" | "E" | "S" | "W";
export type DoorKind = "door" | "locked" | "secret" | "portcullis" | "window";
export interface BastionDoor { deck: number; x: number; y: number; edge: DoorEdge; kind: DoorKind }

export interface BastionMeta {
  name?: string;
  level: number;
  className?: string;
  caps?: Partial<ClassCaps>;         // capability overrides for the class/prereq gating
  allowedSources?: FacilitySource[]; // which content is offered (default ["base"])
  enforceFactionRenown?: boolean;
  flavor?: string;
  defensiveWallSquares?: number;      // traditional only; each 5-ft square is 250 gp / 10 days
  topDeck?: boolean;                  // ship: build the optional 4th top deck
}

export interface BastionPlan {
  kind: BastionKind;
  decks: number;         // active deck count (1 traditional; 3 or 4 ship)
  gridN: number;         // squares per side
  levels: number[][];    // decks x (gridN*gridN); each cell = 1-based placement index, 0 = empty
  placements: Placement[];
  doors: BastionDoor[];
  meta: BastionMeta;
}

// ---- deck helpers ------------------------------------------------------------------------------

export function deckCount(kind: BastionKind, topDeck = false): number {
  if (kind === "ship") return topDeck ? SHIP_MAX_DECKS : SHIP_DECKS;
  return 1;
}

export function deckLabel(plan: BastionPlan, deck: number): string {
  if (plan.kind !== "ship") return `Level ${deck + 1}`;
  if (plan.meta.topDeck && deck === plan.decks - 1) return "Top deck";
  return ["Lower deck", "Main deck", "Upper deck", "Top deck"][deck] ?? `Deck ${deck + 1}`;
}

function emptyDecks(count: number, n: number): number[][] {
  return Array.from({ length: count }, () => new Array<number>(n * n).fill(0));
}

// ---- construction / normalization --------------------------------------------------------------

export function emptyPlan(kind: BastionKind = "traditional", level = 5): BastionPlan {
  const decks = deckCount(kind, false);
  return {
    kind, decks, gridN: DEFAULT_GRID_N,
    levels: emptyDecks(decks, DEFAULT_GRID_N),
    placements: [],
    doors: [],
    meta: { level, allowedSources: ["base"] },
  };
}

const KINDS: BastionKind[] = ["traditional", "ship"];

// Coerce loaded JSONB into a valid plan: clamp decks, fix grid, drop cell values that point past the
// placement list, and keep only doors on real decks. Unknown keys survive (spread), like the other
// builders' loaders.
export function normalizePlan(raw: unknown): BastionPlan {
  const base = emptyPlan();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<BastionPlan>;
  const kind: BastionKind = KINDS.includes(r.kind as BastionKind) ? (r.kind as BastionKind) : "traditional";
  const gridN = BASTION_GRID_SIZES.includes(r.gridN as number) ? (r.gridN as number) : DEFAULT_GRID_N;
  const meta: BastionMeta = { level: 5, allowedSources: ["base"], ...(r.meta ?? {}) };
  const maxDecks = kind === "ship" ? (meta.topDeck ? SHIP_MAX_DECKS : SHIP_DECKS) : 1;
  const decks = Math.max(1, Math.min(maxDecks, Math.round(r.decks ?? maxDecks) || maxDecks));
  const placements = Array.isArray(r.placements) ? (r.placements as Placement[]).filter((p) => p && p.id) : [];
  const pc = placements.length;
  const levels = emptyDecks(decks, gridN);
  if (Array.isArray(r.levels)) {
    for (let d = 0; d < decks; d++) {
      const lvl = r.levels[d];
      if (Array.isArray(lvl)) for (let i = 0; i < gridN * gridN; i++) {
        const v = lvl[i];
        if (typeof v === "number" && v >= 1 && v <= pc) levels[d][i] = v;
      }
    }
  }
  const doors: BastionDoor[] = Array.isArray(r.doors)
    ? (r.doors as BastionDoor[]).filter((d) => d && d.deck >= 0 && d.deck < decks && d.x >= 0 && d.y >= 0 && d.x < gridN && d.y < gridN)
    : [];
  return { kind, decks, gridN, levels, placements, doors, meta };
}

// Switch traditional <-> ship, or toggle the ship's top deck: adds/removes decks keeping existing ones,
// and drops doors on removed decks.
export function setDecks(plan: BastionPlan, kind: BastionKind, topDeck: boolean): BastionPlan {
  const count = deckCount(kind, topDeck);
  const levels = emptyDecks(count, plan.gridN);
  for (let d = 0; d < Math.min(count, plan.levels.length); d++) levels[d] = plan.levels[d].slice();
  return {
    ...plan, kind, decks: count, levels,
    doors: plan.doors.filter((dr) => dr.deck < count),
    meta: { ...plan.meta, topDeck: kind === "ship" ? topDeck : undefined },
  };
}

// Resize the grid keeping the top-left overlap on every deck (like the dungeon).
export function resizePlan(plan: BastionPlan, newN: number): BastionPlan {
  if (newN === plan.gridN) return plan;
  const k = Math.min(plan.gridN, newN);
  const levels = plan.levels.map((lvl) => {
    const out = new Array<number>(newN * newN).fill(0);
    for (let r = 0; r < k; r++) for (let c = 0; c < k; c++) out[r * newN + c] = lvl[r * plan.gridN + c] ?? 0;
    return out;
  });
  return {
    ...plan, gridN: newN, levels,
    doors: plan.doors.filter((d) => d.x < newN && d.y < newN),
  };
}

// ---- placements --------------------------------------------------------------------------------

export function addPlacement(plan: BastionPlan, p: Placement): BastionPlan {
  return { ...plan, placements: [...plan.placements, p] };
}

// Remove a placement (1-based index): clear its cells, then shift higher cell references down so the
// compact index scheme stays consistent.
export function removePlacement(plan: BastionPlan, index1: number): BastionPlan {
  if (index1 < 1 || index1 > plan.placements.length) return plan;
  const placements = plan.placements.filter((_, i) => i !== index1 - 1);
  const levels = plan.levels.map((lvl) =>
    lvl.map((v) => (v === index1 ? 0 : v > index1 ? v - 1 : v)),
  );
  return { ...plan, placements, levels };
}

// Squares a placement occupies, summed across ALL decks (facilities may be stacked over multiple
// levels, per the rules). index1 is the placement's 1-based index.
export function squaresUsed(plan: BastionPlan, index1: number): number {
  let n = 0;
  for (const lvl of plan.levels) for (const v of lvl) if (v === index1) n++;
  return n;
}

// Max squares a placement may occupy (its space, upgraded to Vast if enlarged).
export function maxSquares(p: Placement): number {
  return SPACE_SQUARES[p.enlarged ? "Vast" : p.space];
}

export function isOverMax(plan: BastionPlan, index1: number): boolean {
  const p = plan.placements[index1 - 1];
  return !!p && squaresUsed(plan, index1) > maxSquares(p);
}

// ---- cost summary ------------------------------------------------------------------------------

export interface CostLine { label: string; gp: number; days: number }
export interface CostSummary { lines: CostLine[]; totalGp: number; totalDays: number }

// Money + time to BUILD the bastion as laid out. Basic facilities cost by space; special facilities are
// gained through leveling (no gp) but an enlarge-to-Vast costs its facility's price; defensive walls
// cost per 5-ft square. Special facilities contribute 0 gp and are counted separately against the
// level's slot allowance by the caller.
export function costSummary(plan: BastionPlan): CostSummary {
  const lines: CostLine[] = [];
  for (const p of plan.placements) {
    if (p.kind === "basic") {
      const c = BASIC_ADD_COST[p.space];
      lines.push({ label: `${p.label} (basic, ${p.space})`, gp: c.gp, days: c.days });
    }
    if (p.enlarged) {
      const gp = p.kind === "special" ? (facilityById(p.facilityId ?? "")?.enlargeToVastGp ?? 2000) : 2000;
      lines.push({ label: `${p.label} - enlarge to Vast`, gp, days: 80 });
    }
  }
  const wallSq = Math.max(0, Math.round(plan.meta.defensiveWallSquares ?? 0));
  if (wallSq > 0 && plan.kind !== "ship") {
    lines.push({ label: `Defensive walls (${wallSq} sq)`, gp: wallSq * 250, days: wallSq * 10 });
  }
  const totalGp = lines.reduce((s, l) => s + l.gp, 0);
  const totalDays = lines.reduce((s, l) => s + l.days, 0);
  return { lines, totalGp, totalDays };
}

// ---- coloring ----------------------------------------------------------------------------------

// Facilities are colored by the ORDER they take, so the map reads meaningfully; basics are neutral.
export const ORDER_COLORS: Record<BastionOrder, string> = {
  Craft: "#c8934b",
  Trade: "#b0863f",
  Recruit: "#a15a4a",
  Research: "#4e7f77",
  Empower: "#7a6bb0",
  Harvest: "#7c9a55",
  Maintain: "#8a8272",
};
export const BASIC_COLOR = "#b8ad93";
export const CUSTOM_COLOR = "#9a93b0";

export function placementColor(p: { kind: Placement["kind"]; order?: BastionOrder }): string {
  if (p.kind === "basic") return BASIC_COLOR;
  if (p.kind === "custom") return CUSTOM_COLOR;
  return p.order ? ORDER_COLORS[p.order] : "#c0b498";
}

// ---- renderer ----------------------------------------------------------------------------------

// Draw one deck as a control image: each facility a colored region, dark walls where a cell borders a
// DIFFERENT facility or empty space (so one facility's squares read as a single room and neighbours are
// separated), doors drawn as light gaps straddling the edge. Browser-only (uses a canvas), like the
// dungeon renderer.
export function renderBastionDeck(plan: BastionPlan, deck: number, size = 1024): string {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const n = plan.gridN, CELL = size / n, g = plan.levels[deck] ?? [];

  ctx.fillStyle = "#0e0b08";
  ctx.fillRect(0, 0, size, size);

  // Fills.
  for (let i = 0; i < n * n; i++) {
    const v = g[i]; if (!v) continue;
    const p = plan.placements[v - 1]; if (!p) continue;
    const x = (i % n) * CELL, y = ((i / n) | 0) * CELL;
    ctx.fillStyle = p.color || placementColor(p);
    ctx.fillRect(x, y, CELL, CELL);
  }

  // Walls: between a filled cell and any neighbour holding a DIFFERENT placement (or empty / off-grid).
  ctx.strokeStyle = "#2a2620"; ctx.lineWidth = Math.max(1.5, CELL * 0.14); ctx.lineCap = "round";
  const at = (rr: number, cc: number) => (rr < 0 || cc < 0 || rr >= n || cc >= n) ? 0 : g[rr * n + cc];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const v = g[r * n + c]; if (!v) continue;
    const x = c * CELL, y = r * CELL;
    ctx.beginPath();
    if (at(r - 1, c) !== v) { ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); }
    if (at(r + 1, c) !== v) { ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); }
    if (at(r, c - 1) !== v) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); }
    if (at(r, c + 1) !== v) { ctx.moveTo(x + CELL, y); ctx.lineTo(x + CELL, y + CELL); }
    ctx.stroke();
  }

  // Doors on this deck: a light bar straddling the chosen edge of a cell (secret = dashed).
  const dw = Math.max(3, CELL * 0.5);
  for (const d of plan.doors) {
    if (d.deck !== deck) continue;
    const x = d.x * CELL, y = d.y * CELL;
    ctx.fillStyle = d.kind === "portcullis" ? "#8a8272" : d.kind === "window" ? "#8fb0c0" : "#d8cdb5";
    const thick = Math.max(2, CELL * 0.14);
    if (d.edge === "N") ctx.fillRect(x + (CELL - dw) / 2, y - thick / 2, dw, thick);
    else if (d.edge === "S") ctx.fillRect(x + (CELL - dw) / 2, y + CELL - thick / 2, dw, thick);
    else if (d.edge === "W") ctx.fillRect(x - thick / 2, y + (CELL - dw) / 2, thick, dw);
    else ctx.fillRect(x + CELL - thick / 2, y + (CELL - dw) / 2, thick, dw);
  }

  return canvas.toDataURL("image/png");
}
