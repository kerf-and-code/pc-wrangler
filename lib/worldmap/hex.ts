// lib/worldmap/hex.ts
//
// The shared coordinate system and terrain-blob codec for the hex world map. Flat-top hexes, odd-q
// offset storage, row-major over a bounded rectangle. This is the ONE definition of the packed
// format the hand-paint path (Phase 1) and the generator (Phase 6) both read and write, so the
// format lives here and nowhere else. Self-contained (no project imports), so it is unit-testable
// and truly type-checkable rather than waved through.

// ---- biome sentinel + render-flag bitfield (blob byte 1) ----
export const BIOME_UNSET = 255;

export const FLAG_SHALLOWS = 1 << 0;
export const FLAG_CLIFF    = 1 << 1;
export const FLAG_DELTA    = 1 << 2;
export const FLAG_GORGE    = 1 << 3;
export const FLAG_FROZEN   = 1 << 4;
export const FLAG_SALTPAN  = 1 << 5;
export const FLAG_GLACIER  = 1 << 6;
export const FLAG_SNOWCAP  = 1 << 7;
// bit 7 (1 << 7) reserved

// ---- coordinates ----
export type Offset = { col: number; row: number };
export type Axial = { q: number; r: number };
export type Cube = { x: number; y: number; z: number };

// odd-r offset -> axial (pointy-top): q = col - (row - (row & 1)) / 2, r = row.
export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row };
}
export function axialToOffset(q: number, r: number): Offset {
  return { col: q + (r - (r & 1)) / 2, row: r };
}
export function axialToCube(q: number, r: number): Cube {
  const x = q;
  const z = r;
  return { x, y: -x - z, z };
}
export function cubeToAxial(x: number, z: number): Axial {
  return { q: x, r: z };
}
export function cubeRound(x: number, y: number, z: number): Cube {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

// The six neighbour vectors in axial space. Same axial vectors regardless of orientation; on the
// pointy-top grid they point E, NE, NW, W, SW, SE (verified against the pixel geometry). The index
// into this array is the flowDir value 0..5 the generator uses.
export const AXIAL_DIRS: ReadonlyArray<Axial> = [
  { q: +1, r: 0 }, { q: +1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: +1 }, { q: 0, r: +1 },
];
export const DIR_NAMES = ["E", "NE", "NW", "W", "SW", "SE"] as const;

export function axialNeighbor(q: number, r: number, dir: number): Axial {
  const d = AXIAL_DIRS[((dir % 6) + 6) % 6];
  return { q: q + d.q, r: r + d.r };
}

// ---- row-major index over the stored rectangle ----
export function index(col: number, row: number, width: number): number {
  return row * width + col;
}
export function inBounds(col: number, row: number, width: number, height: number): boolean {
  return col >= 0 && col < width && row >= 0 && row < height;
}
// True vertical position: on the pointy-top grid rows stack cleanly and the stagger is horizontal,
// so latitude is simply the row. Use for latitude/climate.
export function trueY(col: number, row: number): number {
  void col;
  return row;
}

// ---- the terrain blob: 12-byte header + width*height records of 2 bytes ----
export const BLOB_MAGIC0 = 0x53; // 'S'
export const BLOB_MAGIC1 = 0x58; // 'X'
export const BLOB_HEADER_BYTES = 12;
export const RECORD_BYTES = 2;

export type WorldMeta = {
  formatVersion: number;
  originCol: number;
  originRow: number;
  width: number;
  height: number;
};

// biome[i] is blob byte 0, flags[i] is blob byte 1, i = row*width + col.
export type Terrain = {
  meta: WorldMeta;
  biome: Uint8Array;
  flags: Uint8Array;
};

export function createTerrain(width: number, height: number, originCol: number, originRow: number): Terrain {
  const n = width * height;
  const biome = new Uint8Array(n).fill(BIOME_UNSET);
  const flags = new Uint8Array(n); // all 0
  return { meta: { formatVersion: 1, originCol, originRow, width, height }, biome, flags };
}

export function encodeTerrain(t: Terrain): Uint8Array {
  const { meta, biome, flags } = t;
  const n = meta.width * meta.height;
  const out = new Uint8Array(BLOB_HEADER_BYTES + n * RECORD_BYTES);
  const dv = new DataView(out.buffer);
  out[0] = BLOB_MAGIC0;
  out[1] = BLOB_MAGIC1;
  out[2] = meta.formatVersion & 0xff;
  out[3] = 0; // reserved
  dv.setInt16(4, meta.originCol, true);
  dv.setInt16(6, meta.originRow, true);
  dv.setUint16(8, meta.width, true);
  dv.setUint16(10, meta.height, true);
  let p = BLOB_HEADER_BYTES;
  for (let i = 0; i < n; i++) {
    out[p++] = biome[i];
    out[p++] = flags[i];
  }
  return out;
}

export function decodeTerrain(blob: Uint8Array): Terrain {
  if (blob.length < BLOB_HEADER_BYTES) throw new Error("terrain blob too short for header");
  if (blob[0] !== BLOB_MAGIC0 || blob[1] !== BLOB_MAGIC1) throw new Error("bad terrain blob magic");
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const meta: WorldMeta = {
    formatVersion: blob[2],
    originCol: dv.getInt16(4, true),
    originRow: dv.getInt16(6, true),
    width: dv.getUint16(8, true),
    height: dv.getUint16(10, true),
  };
  const n = meta.width * meta.height;
  const need = BLOB_HEADER_BYTES + n * RECORD_BYTES;
  if (blob.length < need) throw new Error(`terrain blob truncated: have ${blob.length}, need ${need}`);
  const biome = new Uint8Array(n);
  const flags = new Uint8Array(n);
  let p = BLOB_HEADER_BYTES;
  for (let i = 0; i < n; i++) {
    biome[i] = blob[p++];
    flags[i] = blob[p++];
  }
  return { meta, biome, flags };
}

// ---- per-hex access (offset coordinates) ----
export function getBiome(t: Terrain, col: number, row: number): number {
  return t.biome[index(col, row, t.meta.width)];
}
export function setBiome(t: Terrain, col: number, row: number, biomeId: number): void {
  t.biome[index(col, row, t.meta.width)] = biomeId & 0xff;
}
export function getFlags(t: Terrain, col: number, row: number): number {
  return t.flags[index(col, row, t.meta.width)];
}
export function setFlags(t: Terrain, col: number, row: number, f: number): void {
  t.flags[index(col, row, t.meta.width)] = f & 0xff;
}

// ---- expand a bounded, centre-origin grid: copy the old rectangle in at its offset ----
export function expandTerrain(t: Terrain, newW: number, newH: number, newOriginCol: number, newOriginRow: number): Terrain {
  const out = createTerrain(newW, newH, newOriginCol, newOriginRow);
  const dCol = t.meta.originCol - newOriginCol; // where the old (0,0) lands in the new grid
  const dRow = t.meta.originRow - newOriginRow;
  for (let row = 0; row < t.meta.height; row++) {
    for (let col = 0; col < t.meta.width; col++) {
      const nc = col + dCol;
      const nr = row + dRow;
      if (!inBounds(nc, nr, newW, newH)) continue;
      out.biome[index(nc, nr, newW)] = t.biome[index(col, row, t.meta.width)];
      out.flags[index(nc, nr, newW)] = t.flags[index(col, row, t.meta.width)];
    }
  }
  return out;
}

// ---- base64 <-> bytes, for the text column (map_fog's approach). Client-side (btoa/atob). ----
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
