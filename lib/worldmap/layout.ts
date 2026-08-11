// lib/worldmap/layout.ts
//
// Flat-top hex pixel geometry: the bridge between the offset grid coordinates hex.ts stores and
// the pixels the renderer and paint tool draw and hit-test. Flat top and bottom edges, points left
// and right. `size` is the centre-to-corner radius in pixels. Also home to the placed-image type
// and its default fit, since both are pixel-space concerns. Self-contained (only imports the
// coordinate helpers from hex.ts), so it is truly type-checkable and round-trip testable.

import { offsetToAxial, axialToOffset, cubeRound, cubeToAxial, type Offset } from "./hex";

export type Point = { x: number; y: number };

// The reference hex radius in pixels. Stored image transforms (map_images.x/y/scale) live in this
// pixel frame, so this constant is fixed: changing it would move every placed image. Shared by the
// renderer and the page so they agree.
export const BASE_SIZE = 14;

// One uploaded map image placed in the world: a transform over the hex pixel frame. Mirrors the
// map_images row. x,y is the top-left in world pixels, scale is world px per image px, z stacks.
export type PlacedImage = {
  id: string;
  url: string;
  x: number;
  y: number;
  scale: number;
  z: number;
};

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

// The pixel origin (top-left) of the grid, matching gridPixelSize's box: one hex margin out from the
// centre of hex (0,0). Used to place an uploaded image over the grid.
export function gridOrigin(): Point {
  return { x: -BASE_SIZE, y: -(SQRT3 * BASE_SIZE) / 2 };
}

// Default placement for a freshly uploaded image: scaled so its width matches the grid's pixel
// width, positioned at the grid's top-left. The GM drags and scales from there.
export function fitImageToGrid(width: number, height: number, imgW: number): { x: number; y: number; scale: number } {
  const g = gridPixelSize(width, height, BASE_SIZE);
  const o = gridOrigin();
  const scale = imgW > 0 ? g.w / imgW : 1;
  return { x: o.x, y: o.y, scale };
}
