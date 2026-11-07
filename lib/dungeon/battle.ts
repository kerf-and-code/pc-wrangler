// lib/dungeon/battle.ts
//
// The battle map model (p104 battle_maps): many named maps per campaign, each indoor or outdoor, each
// with three stacked levels of terrain, doors on square edges and freely placed pieces. Tolerant readers
// for jsonb that may be missing or partial, the write shape, and the one-time carry-over of a campaign's
// old dungeon_maps row (p84, p88, p103) into a first battle map. No React, no network.

import { CELL_TYPES, LEVELS, DEFAULT_N, normalizeLevels, gridSizeOf } from "./render";
import {
  DOOR_KINDS, FEATURES, DEFAULT_GRID_LOOK, parseEdge, normalizeMarks, normalizeMeta,
  type DoorKind, type GridLook, type MapElement,
} from "./classic";
import { OUTDOOR_ELEMENTS } from "./outdoor";

export type MapKind = "indoor" | "outdoor";
export type BattleMeta = { title: string; levelNames: string[]; autoNumber: boolean; showGrid: boolean; ground: number; grid: GridLook };
export type BattleMap = {
  id: string;
  name: string;
  kind: MapKind;
  n: number;
  feetPerSquare: number;
  levels: number[][];
  custom: Record<string, string>[];
  doors: Record<string, DoorKind>[];
  elements: MapElement[][];
  meta: BattleMeta;
};
export type BattleMapSummary = { id: string; name: string; kind: MapKind; updated_at: string | null };

export const MAX_ELEMENTS = 2000;            // per level, so a runaway paste cannot bloat a row
export const GRASS = CELL_TYPES.findIndex((t) => t.key === "grass");

// Everything a GM can place, grouped for the palette. Indoor pieces work outdoors and the reverse.
export type PieceDef = { key: string; label: string; group: "indoor" | "outdoor" | "text"; s: number };
export const PIECES: PieceDef[] = [
  ...OUTDOOR_ELEMENTS.map((e) => ({ key: e.key as string, label: e.label, group: "outdoor" as const, s: e.s })),
  ...FEATURES.map((f) => ({ key: f.key as string, label: f.label, group: "indoor" as const, s: 1 })),
  { key: "label", label: "Text label", group: "text", s: 1 },
];
const PIECE_KEYS = new Set(PIECES.map((p) => p.key));
const DOOR_KEYS = new Set<string>(DOOR_KINDS.map((d) => d.key));

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14);

export function defaultBattleMeta(kind: MapKind): BattleMeta {
  return {
    title: "",
    levelNames: Array.from({ length: LEVELS }, (_, i) => (kind === "outdoor" && i === 0 ? "Ground" : `Level ${i + 1}`)),
    autoNumber: kind === "indoor",
    showGrid: true,
    ground: GRASS,
    grid: { ...DEFAULT_GRID_LOOK, cover: kind === "outdoor" ? "all" : "floor", opacity: kind === "outdoor" ? 0.22 : DEFAULT_GRID_LOOK.opacity },
  };
}

export function blankMap(id: string, name: string, kind: MapKind, n = DEFAULT_N): BattleMap {
  return {
    id, name, kind, n, feetPerSquare: 5,
    levels: Array.from({ length: LEVELS }, () => new Array<number>(n * n).fill(0)),
    custom: Array.from({ length: LEVELS }, () => ({})),
    doors: Array.from({ length: LEVELS }, () => ({})),
    elements: Array.from({ length: LEVELS }, () => []),
    meta: defaultBattleMeta(kind),
  };
}

const num = (v: unknown, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };

export function normCustom(raw: unknown, n: number): Record<string, string>[] {
  const out: Record<string, string>[] = Array.from({ length: LEVELS }, () => ({}));
  if (Array.isArray(raw)) for (let l = 0; l < LEVELS; l++) {
    const o = raw[l];
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < n * n && typeof v === "string") out[l][k] = v;
    }
  }
  return out;
}

export function normDoors(raw: unknown, n: number): Record<string, DoorKind>[] {
  const out: Record<string, DoorKind>[] = Array.from({ length: LEVELS }, () => ({}));
  if (Array.isArray(raw)) for (let l = 0; l < LEVELS; l++) {
    const o = raw[l];
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const e = parseEdge(k);
      if (e && e.i >= 0 && e.i <= n * n + n && typeof v === "string" && DOOR_KEYS.has(v)) out[l][k] = v as DoorKind;
    }
  }
  return out;
}

export function normElements(raw: unknown, n: number): MapElement[][] {
  const out: MapElement[][] = Array.from({ length: LEVELS }, () => []);
  if (!Array.isArray(raw)) return out;
  for (let l = 0; l < LEVELS; l++) {
    const arr = raw[l];
    if (!Array.isArray(arr)) continue;
    const seen = new Set<string>();
    for (const v of arr.slice(0, MAX_ELEMENTS)) {
      if (!v || typeof v !== "object") continue;
      const e = v as Partial<MapElement>;
      if (typeof e.k !== "string" || !PIECE_KEYS.has(e.k)) continue;
      let id = typeof e.id === "string" && e.id ? e.id.slice(0, 40) : newId();
      if (seen.has(id)) id = newId();
      seen.add(id);
      const el: MapElement = { id, k: e.k, x: num(e.x, -2, n + 2, n / 2), y: num(e.y, -2, n + 2, n / 2), rot: ((num(e.rot, -3600, 3600, 0) % 360) + 360) % 360, s: num(e.s, 0.25, 8, 1) };
      if (e.k === "label") { const t = typeof e.text === "string" ? e.text.trim().slice(0, 60) : ""; if (!t) continue; el.text = t; }
      out[l].push(el);
    }
  }
  return out;
}

export function normBattleMeta(raw: unknown, kind: MapKind): BattleMeta {
  const base = defaultBattleMeta(kind);
  if (!raw || typeof raw !== "object") return base;
  const m = raw as Partial<BattleMeta> & { grid?: Partial<GridLook> };
  const g: Partial<GridLook> = m.grid && typeof m.grid === "object" ? m.grid : {};
  return {
    title: typeof m.title === "string" ? m.title.slice(0, 80) : "",
    levelNames: base.levelNames.map((d, i) => (Array.isArray(m.levelNames) && typeof m.levelNames[i] === "string" && m.levelNames[i].trim() ? m.levelNames[i].slice(0, 60) : d)),
    autoNumber: typeof m.autoNumber === "boolean" ? m.autoNumber : base.autoNumber,
    showGrid: m.showGrid !== false,
    ground: typeof m.ground === "number" && m.ground > 0 && m.ground < CELL_TYPES.length ? m.ground : base.ground,
    grid: {
      color: g.color === "black" || g.color === "white" || g.color === "red" ? g.color : "ink",
      opacity: num(g.opacity, 0.05, 1, base.grid.opacity),
      weight: g.weight === "medium" || g.weight === "bold" ? g.weight : "thin",
      cover: g.cover === "all" || g.cover === "floor" ? g.cover : base.grid.cover,
    },
  };
}

type Row = {
  id: string; name?: string | null; kind?: string | null; n?: number | null; feet_per_square?: number | null;
  levels?: unknown; custom_cells?: unknown; doors?: unknown; elements?: unknown; meta?: unknown;
};

export function fromRow(row: Row): BattleMap {
  const kind: MapKind = row.kind === "outdoor" ? "outdoor" : "indoor";
  const n = row.n && row.n > 0 ? row.n : gridSizeOf(row.levels);
  return {
    id: row.id,
    name: (row.name || "Untitled map").slice(0, 80),
    kind, n,
    feetPerSquare: row.feet_per_square && row.feet_per_square > 0 ? row.feet_per_square : 5,
    levels: normalizeLevels(row.levels, n),
    custom: normCustom(row.custom_cells, n),
    doors: normDoors(row.doors, n),
    elements: normElements(row.elements, n),
    meta: normBattleMeta(row.meta, kind),
  };
}

export function toRow(m: BattleMap) {
  return {
    name: m.name.trim().slice(0, 80) || "Untitled map",
    kind: m.kind, n: m.n, feet_per_square: m.feetPerSquare,
    levels: m.levels, custom_cells: m.custom, doors: m.doors, elements: m.elements, meta: m.meta,
    updated_at: new Date().toISOString(),
  };
}

// The old single dungeon (dungeon_maps) as a first battle map: floors and custom tiles as they were,
// doors as they were, furniture and labels turned into free pieces at the centre of their squares.
// Returns null when the old row has nothing painted, so an empty workspace is not carried over.
export function fromDungeonRow(raw: { levels?: unknown; feet_per_square?: number | null; custom_cells?: unknown; marks?: unknown; meta?: unknown } | null): Omit<BattleMap, "id"> | null {
  if (!raw || !Array.isArray(raw.levels)) return null;
  const n = gridSizeOf(raw.levels);
  const levels = normalizeLevels(raw.levels, n);
  const custom = normCustom(raw.custom_cells, n);
  if (!levels.some((l) => l.some((v) => v > 0)) && !custom.some((o) => Object.keys(o).length)) return null;
  const marks = normalizeMarks(raw.marks, LEVELS, n);
  const old = normalizeMeta(raw.meta, LEVELS);
  const elements: MapElement[][] = marks.map((m) => {
    const out: MapElement[] = [];
    for (const [k, f] of Object.entries(m.features)) { const i = Number(k); out.push({ id: newId(), k: f.k, x: (i % n) + 0.5, y: Math.floor(i / n) + 0.5, rot: ((f.r || 0) % 4) * 90, s: 1 }); }
    for (const [k, text] of Object.entries(m.labels)) { const i = Number(k); out.push({ id: newId(), k: "label", x: (i % n) + 0.5, y: Math.floor(i / n) + 0.5, rot: 0, s: 1, text }); }
    return out;
  });
  const meta = defaultBattleMeta("indoor");
  meta.title = old.title; meta.levelNames = old.levelNames; meta.autoNumber = old.autoNumber; meta.showGrid = old.grid;
  return {
    name: old.title.trim() || "Dungeon",
    kind: "indoor", n,
    feetPerSquare: raw.feet_per_square && raw.feet_per_square > 0 ? raw.feet_per_square : 5,
    levels, custom, doors: marks.map((m) => ({ ...m.doors })), elements, meta,
  };
}

// Resize keeping the top-left overlap; doors and pieces outside the new grid are dropped.
export function resizeMap(m: BattleMap, newN: number): BattleMap {
  const oldN = m.n, k = Math.min(oldN, newN);
  const levels = m.levels.map((g) => { const out = new Array<number>(newN * newN).fill(0); for (let r = 0; r < k; r++) for (let c = 0; c < k; c++) out[r * newN + c] = g[r * oldN + c] ?? 0; return out; });
  const cell = (i: number) => { const r = Math.floor(i / oldN), c = i % oldN; return r < newN && c < newN ? r * newN + c : -1; };
  const custom = m.custom.map((o) => { const next: Record<string, string> = {}; for (const [key, v] of Object.entries(o)) { const j = cell(Number(key)); if (j >= 0) next[String(j)] = v; } return next; });
  const doors = m.doors.map((o) => { const next: Record<string, DoorKind> = {}; for (const [key, v] of Object.entries(o)) { const e = parseEdge(key); if (!e) continue; const j = cell(e.i); if (j >= 0) next[`${j}${e.side}`] = v; } return next; });
  const elements = m.elements.map((arr) => arr.filter((e) => e.x < newN && e.y < newN));
  return { ...m, n: newN, levels, custom, doors, elements };
}
