// lib/tabletop/cutout.ts (2026-11-08)
//
// Background removal for the token maker, entirely in the browser: no upload, no outside service, no
// model. It finds the background from the picture's edges (up to four colour clusters), flood-fills
// inward from the edges through pixels close to those colours, and softens the boundary so the cut does
// not look jagged. A brush then erases or restores by hand. Works best on a plain or simple background;
// the brush covers the rest.
//
// Everything works on a mask (one byte per pixel, 0 removed, 255 kept) kept beside the original pixels,
// so nothing is lost: restoring brings the original back.

export type RGBA = Uint8ClampedArray;

const dist2 = (a: RGBA, i: number, c: number[]) => {
  const dr = a[i] - c[0], dg = a[i + 1] - c[1], db = a[i + 2] - c[2];
  return dr * dr + dg * dg + db * db;
};

/** Up to four background colours, from the pixels around the edge. Empty when the edge is already clear. */
export function edgeColours(rgba: RGBA, w: number, h: number): number[][] {
  const idx: number[] = [];
  const step = Math.max(1, Math.floor((2 * (w + h)) / 1600));
  for (let x = 0; x < w; x += step) { idx.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y += step) { idx.push(y * w, y * w + w - 1); }
  const opaque = idx.filter((p) => rgba[p * 4 + 3] > 16);
  if (opaque.length < idx.length * 0.25) return [];
  const k = Math.min(4, Math.max(1, Math.floor(opaque.length / 20)));
  let cs: number[][] = [];
  for (let j = 0; j < k; j++) { const p = opaque[Math.floor(((j + 0.5) * opaque.length) / k)] * 4; cs.push([rgba[p], rgba[p + 1], rgba[p + 2]]); }
  for (let it = 0; it < 8; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (const p of opaque) {
      const i = p * 4; let best = 0, bd = Infinity;
      cs.forEach((c, j) => { const d = dist2(rgba, i, c); if (d < bd) { bd = d; best = j; } });
      const s = sum[best]; s[0] += rgba[i]; s[1] += rgba[i + 1]; s[2] += rgba[i + 2]; s[3]++;
    }
    cs = sum.filter((s) => s[3] > opaque.length * 0.04).map((s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]]);
    if (!cs.length) return [];
  }
  return cs;
}

/**
 * A mask with the background removed. `tolerance` is 0 to 100: how different a colour may be from the
 * edge colours and still count as background.
 */
export function autoMask(rgba: RGBA, w: number, h: number, tolerance: number): Uint8ClampedArray {
  const n = w * h, mask = new Uint8ClampedArray(n).fill(255);
  const cs = edgeColours(rgba, w, h);
  if (!cs.length) return mask;
  const T = 10 + Math.max(0, Math.min(100, tolerance)) * 1.5, T2 = T * T;
  const near = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4; let bd = Infinity;
    for (const c of cs) { const d = dist2(rgba, i, c); if (d < bd) bd = d; }
    near[p] = rgba[i + 3] <= 16 ? 0 : bd;
  }
  const seen = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 0;
  const seed = (p: number) => { if (!seen[p] && near[p] < T2) { seen[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % w, y = (p - x) / w;
    mask[p] = 0;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  // soften the boundary: kept pixels touching the background fade by how close they are to it
  const soft = new Uint8ClampedArray(mask);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    if (!mask[p]) continue;
    let touch = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!mask[p + dy * w + dx]) touch++;
    if (!touch) continue;
    const d = Math.sqrt(near[p]), k = Math.max(0, Math.min(1, (d - T * 0.6) / (T * 0.9)));
    soft[p] = Math.round(255 * Math.min(k, 1 - touch / 12));
  }
  return soft;
}

/** Paints a round soft brush into the mask: value 0 erases, 255 restores. */
export function paintMask(mask: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, radius: number, value: 0 | 255) {
  const r = Math.max(1, radius), x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x - cx, y - cy) / r;
    if (d > 1) continue;
    const k = d < 0.7 ? 1 : (1 - d) / 0.3, p = y * w + x;
    mask[p] = value ? Math.max(mask[p], 255 * k) : Math.min(mask[p], 255 * (1 - k));
  }
}

/** The picture with the mask applied to its alpha. */
export function applyMask(rgba: RGBA, mask: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let p = 0, i = 3; p < mask.length; p++, i += 4) out[i] = Math.min(out[i], mask[p]);
  return out;
}

/** Share of the picture the mask keeps (0 to 1), for a sanity line under the preview. */
export function keptShare(mask: Uint8ClampedArray): number {
  let s = 0; for (let i = 0; i < mask.length; i++) s += mask[i];
  return mask.length ? s / (mask.length * 255) : 1;
}
