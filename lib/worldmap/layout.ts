// lib/worldmap/layout.ts
//
// Flat-top hex pixel geometry: the bridge between the offset grid coordinates hex.ts stores and
// the pixels the renderer and paint tool draw and hit-test. Flat top and bottom edges, points left
// and right. `size` is the centre-to-corner radius in pixels. Self-contained (only imports the
// coordinate helpers from hex.ts), so it is truly type-checkable and round-trip testable.

import { offsetToAxial, axialToOffset, cubeRound, cubeToAxial, type Offset } from "./hex";

export type Point = { x: number; y: number };

const SQRT3 = Math.sqrt(3);

// Pixel centre of hex (col,row). Flat-top axial->pixel:
//   x = size * 3/2 * q,  y = size * sqrt(3) * (r + q/2)
export function hexToPixel(col: number, row: number, size: number): Point {
  const { q, r } = offsetToAxial(col, row);
  return { x: size * 1.5 * q, y: size * SQRT3 * (r + q / 2) };
}

// Pixel -> the hex containing it. Inverse of hexToPixel, via fractional axial and cube rounding.
export function pixelToHex(x: number, y: number, size: number): Offset {
  const q = (2 / 3) * (x / size);
  const r = (-1 / 3) * (x / size) + (SQRT3 / 3) * (y / size);
  const c = cubeRound(q, -q - r, r);
  const a = cubeToAxial(c.x, c.z);
  return axialToOffset(a.q, a.r);
}

// The six corner points of a flat-top hex, starting at the right vertex (angle 0) going clockwise.
export function hexCorners(center: Point, size: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i);
    pts.push({ x: center.x + size * Math.cos(ang), y: center.y + size * Math.sin(ang) });
  }
  return pts;
}

// Bounding pixel size of a width x height grid, with a one-hex margin so edge hexes are not clipped.
export function gridPixelSize(width: number, height: number, size: number): { w: number; h: number } {
  const w = 1.5 * size * Math.max(0, width - 1) + 2 * size;
  const h = SQRT3 * size * (Math.max(0, height - 1) + 0.5) + SQRT3 * size;
  return { w, h };
}
