// lib/worldmap/layout.ts
//
// Pointy-top hex pixel geometry: the bridge between the offset grid coordinates hex.ts stores and
// the pixels the renderer and paint tool draw and hit-test. Point at top and bottom, flat left and
// right edges. `size` is the centre-to-corner radius in pixels. Also home to the placed-image type
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

// Pixel centre of hex (col,row). Pointy-top axial->pixel:
//   x = size * (sqrt3 * q + sqrt3/2 * r),  y = size * 3/2 * r
export function hexToPixel(col: number, row: number, size: number): Point {
  const { q, r } = offsetToAxial(col, row);
  return { x: size * (SQRT3 * q + (SQRT3 / 2) * r), y: size * (1.5 * r) };
}

// Pixel -> the hex containing it. Inverse of hexToPixel, via fractional axial and cube rounding.
export function pixelToHex(x: number, y: number, size: number): Offset {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  const c = cubeRound(q, -q - r, r);
  const a = cubeToAxial(c.x, c.z);
  return axialToOffset(a.q, a.r);
}

// The six corner points of a pointy-top hex (angle 60*i - 30, y-down), going clockwise from the
// upper-right vertex. Point at top (i=5, -90) and bottom (i=2, +90); flat left and right edges.
export function hexCorners(center: Point, size: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i - 30);
    pts.push({ x: center.x + size * Math.cos(ang), y: center.y + size * Math.sin(ang) });
  }
  return pts;
}

// Bounding pixel size of a width x height grid, with a one-hex margin so edge hexes are not clipped.
export function gridPixelSize(width: number, height: number, size: number): { w: number; h: number } {
  const w = SQRT3 * size * (width + (height >= 2 ? 0.5 : 0));
  const h = size * (1.5 * Math.max(0, height - 1) + 2);
  return { w, h };
}

// The pixel origin (top-left) of the grid, matching gridPixelSize's box: one hex margin out from the
// centre of hex (0,0). Used to place an uploaded image over the grid.
export function gridOrigin(): Point {
  return { x: -(SQRT3 * BASE_SIZE) / 2, y: -BASE_SIZE };
}

// Default placement for a freshly uploaded image: scaled so its width matches the grid's pixel
// width, positioned at the grid's top-left. The GM drags and scales from there.
export function fitImageToGrid(width: number, height: number, imgW: number): { x: number; y: number; scale: number } {
  const g = gridPixelSize(width, height, BASE_SIZE);
  const o = gridOrigin();
  const scale = imgW > 0 ? g.w / imgW : 1;
  return { x: o.x, y: o.y, scale };
}
