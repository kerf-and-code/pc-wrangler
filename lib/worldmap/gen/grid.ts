// lib/worldmap/gen/grid.ts
// The six-neighbour helper the passes share, in axial space over the current pointy-top grid. Fills
// a caller-owned length-6 Int32Array with each direction's neighbour index (row*W+col), or -1 when
// that neighbour is off the bounded rectangle. Direction index d matches AXIAL_DIRS, so it doubles
// as the flowDir value.

import { offsetToAxial, axialToOffset, AXIAL_DIRS } from "../hex";

export function neighborsByDir(col: number, row: number, W: number, H: number, out: Int32Array): void {
  const a = offsetToAxial(col, row);
  for (let d = 0; d < 6; d++) {
    const dir = AXIAL_DIRS[d];
    const o = axialToOffset(a.q + dir.q, a.r + dir.r);
    out[d] = o.col >= 0 && o.col < W && o.row >= 0 && o.row < H ? o.row * W + o.col : -1;
  }
}
