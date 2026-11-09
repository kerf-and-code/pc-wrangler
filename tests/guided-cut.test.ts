// tests/guided-cut.test.ts: the guided cut on a picture with a known answer (a red disc on a blue
// ground with soft noise), from one Keep scribble and one Remove scribble.
import { describe, expect, it } from "vitest";
import { guidedCut } from "@/lib/tabletop/guided-cut";

function picture(w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4), inDisc = new Uint8Array(w * h);
  let seed = 9; const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, d = Math.hypot(x - w / 2, y - h / 2) < w * 0.3, n = (r() - 0.5) * 30;
    inDisc[p] = d ? 1 : 0;
    rgba.set(d ? [190 + n, 40 + n, 40] : [50, 110 + n, 200 + n], p * 4); rgba[p * 4 + 3] = 255;
  }
  return { rgba, inDisc };
}

describe("guidedCut", () => {
  it("keeps the subject and removes the background from two scribbles", () => {
    const w = 120, h = 120, { rgba, inDisc } = picture(w, h);
    const keep = new Uint8Array(w * h), drop = new Uint8Array(w * h);
    for (let x = 50; x < 70; x++) keep[60 * w + x] = 1;          // a short line across the disc's middle
    for (let x = 5; x < 30; x++) drop[8 * w + x] = 1;            // a short line in the top-left corner
    const r = guidedCut(rgba, w, h, keep, drop);
    expect(r).not.toBeNull();
    let rightIn = 0, inN = 0, rightOut = 0, outN = 0;
    for (let p = 0; p < w * h; p++) {
      if (inDisc[p]) { inN++; if (r!.mask[p] >= 128) rightIn++; } else { outN++; if (r!.mask[p] < 128) rightOut++; }
    }
    expect(rightIn / inN).toBeGreaterThan(0.97);
    expect(rightOut / outN).toBeGreaterThan(0.97);
  });

  it("never removes a pixel marked Keep", () => {
    const w = 80, h = 80, { rgba } = picture(w, h);
    const keep = new Uint8Array(w * h), drop = new Uint8Array(w * h);
    for (let x = 2; x < 78; x++) { keep[40 * w + x] = 1; drop[3 * w + x] = 1; }   // keep crosses the background too
    const r = guidedCut(rgba, w, h, keep, drop)!;
    for (let p = 0; p < w * h; p++) if (keep[p]) expect(r.mask[p]).toBeGreaterThanOrEqual(128);
  });

  it("does nothing without a Keep stroke", () => {
    const w = 20, h = 20, { rgba } = picture(w, h);
    expect(guidedCut(rgba, w, h, new Uint8Array(w * h), new Uint8Array(w * h))).toBeNull();
  });
});
