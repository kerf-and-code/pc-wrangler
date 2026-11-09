// lib/tabletop/guided-cut.ts (2026-11-08)
//
// The guided cut: separates a subject from its background from rough strokes the user paints, "keep"
// over the subject and "remove" over the background. A graph cut, the technique behind GrabCut:
//   - each stroke set trains a colour model (a smoothed colour histogram) for the subject and for the
//     background; when there are no remove strokes, the top and side edges stand in for them;
//   - every pixel pays a cost to be labelled subject or background, by how well its colour fits each
//     model, and neighbouring pixels pay to be split apart, cheaply where the picture has a real edge
//     and dearly where it does not, so the boundary follows outlines;
//   - a minimum cut (Boykov-Kolmogorov max-flow) finds the cheapest labelling; strokes are hard rules,
//     so a pixel painted "keep" can never be removed and one painted "remove" can never stay;
//   - the models are re-trained from the result and the cut runs again (two passes).
// It works on a copy at most WORK_SIDE pixels across and scales the answer up, with a soft one-pixel
// edge. Runs in the browser; nothing is uploaded.

const WORK_SIDE = 520;
const HARD = 100_000_000;

// ---- Boykov-Kolmogorov max-flow on integer capacities ----

const NONE = -1, TERMINAL = -2, ORPHAN = -3;

export class MaxFlow {
  private first: Int32Array; private head: Int32Array; private next: Int32Array; private rcap: Int32Array;
  private tr: Float64Array; private parent: Int32Array; private sink: Uint8Array;
  private ts: Int32Array; private dist: Int32Array;
  private queue: Int32Array; private inQ: Uint8Array; private qh = 0; private qt = 0;
  private orphans: number[] = [];
  private arcs = 0; private time = 0;
  flow = 0;

  constructor(readonly n: number, maxEdges: number) {
    this.first = new Int32Array(n).fill(-1);
    this.head = new Int32Array(maxEdges * 2); this.next = new Int32Array(maxEdges * 2); this.rcap = new Int32Array(maxEdges * 2);
    this.tr = new Float64Array(n); this.parent = new Int32Array(n).fill(NONE); this.sink = new Uint8Array(n);
    this.ts = new Int32Array(n); this.dist = new Int32Array(n);
    this.queue = new Int32Array(n + 1); this.inQ = new Uint8Array(n);
  }
  /** An edge i to j with capacity cap, and j to i with rev. */
  addEdge(i: number, j: number, cap: number, rev: number) {
    const a = this.arcs++, b = this.arcs++;
    this.head[a] = j; this.next[a] = this.first[i]; this.first[i] = a; this.rcap[a] = cap;
    this.head[b] = i; this.next[b] = this.first[j]; this.first[j] = b; this.rcap[b] = rev;
  }
  /** Capacity from the source to i (cs) and from i to the sink (ct). */
  addTerminal(i: number, cs: number, ct: number) {
    const d = this.tr[i];
    if (d > 0) cs += d; else ct -= d;
    this.flow += Math.min(cs, ct);
    this.tr[i] = cs - ct;
  }
  private sis(a: number) { return a ^ 1; }
  private push(i: number) { if (this.inQ[i]) return; this.inQ[i] = 1; this.queue[this.qt] = i; this.qt = (this.qt + 1) % this.queue.length; }
  private pop(): number {
    while (this.qh !== this.qt) {
      const i = this.queue[this.qh]; this.qh = (this.qh + 1) % this.queue.length; this.inQ[i] = 0;
      if (this.parent[i] !== NONE) return i;
    }
    return -1;
  }
  private orphan(i: number) { this.parent[i] = ORPHAN; this.orphans.push(i); }

  maxflow(): number {
    const { first, head, next, rcap, tr, parent, sink, ts, dist } = this;
    for (let i = 0; i < this.n; i++) {
      if (tr[i] !== 0) { parent[i] = TERMINAL; sink[i] = tr[i] < 0 ? 1 : 0; ts[i] = 0; dist[i] = 1; this.push(i); }
    }
    for (;;) {
      const i = this.pop(); if (i < 0) break;
      let mid = -1;
      if (!sink[i]) {
        for (let a = first[i]; a !== -1; a = next[a]) {
          if (!rcap[a]) continue;
          const j = head[a];
          if (parent[j] === NONE) { sink[j] = 0; parent[j] = this.sis(a); ts[j] = ts[i]; dist[j] = dist[i] + 1; this.push(j); }
          else if (sink[j]) { mid = a; break; }
          else if (ts[j] <= ts[i] && dist[j] > dist[i]) { parent[j] = this.sis(a); ts[j] = ts[i]; dist[j] = dist[i] + 1; }
        }
      } else {
        for (let a = first[i]; a !== -1; a = next[a]) {
          if (!rcap[this.sis(a)]) continue;
          const j = head[a];
          if (parent[j] === NONE) { sink[j] = 1; parent[j] = this.sis(a); ts[j] = ts[i]; dist[j] = dist[i] + 1; this.push(j); }
          else if (!sink[j]) { mid = this.sis(a); break; }
          else if (ts[j] <= ts[i] && dist[j] > dist[i]) { parent[j] = this.sis(a); ts[j] = ts[i]; dist[j] = dist[i] + 1; }
        }
      }
      this.time++;
      if (mid < 0) continue;
      this.push(i);
      this.augment(mid);
      this.adopt();
    }
    return this.flow;
  }

  private augment(mid: number) {
    const { head, rcap, tr, parent } = this;
    let b = rcap[mid];
    let i = head[this.sis(mid)];
    for (;;) { const a = parent[i]; if (a === TERMINAL) break; if (b > rcap[this.sis(a)]) b = rcap[this.sis(a)]; i = head[a]; }
    if (b > tr[i]) b = tr[i];
    i = head[mid];
    for (;;) { const a = parent[i]; if (a === TERMINAL) break; if (b > rcap[a]) b = rcap[a]; i = head[a]; }
    if (b > -tr[i]) b = -tr[i];

    rcap[this.sis(mid)] += b; rcap[mid] -= b;
    i = head[this.sis(mid)];
    for (;;) {
      const a = parent[i];
      if (a === TERMINAL) { tr[i] -= b; if (!tr[i]) this.orphan(i); break; }
      rcap[a] += b; rcap[this.sis(a)] -= b; if (!rcap[this.sis(a)]) this.orphan(i);
      i = head[a];
    }
    i = head[mid];
    for (;;) {
      const a = parent[i];
      if (a === TERMINAL) { tr[i] += b; if (!tr[i]) this.orphan(i); break; }
      rcap[this.sis(a)] += b; rcap[a] -= b; if (!rcap[a]) this.orphan(i);
      i = head[a];
    }
    this.flow += b;
  }

  private adopt() {
    const { first, head, next, rcap, parent, sink, ts, dist } = this;
    const INF = 1 << 30;
    while (this.orphans.length) {
      const i = this.orphans.pop()!;
      const isSink = sink[i];
      let best = -1, dmin = INF;
      for (let a0 = first[i]; a0 !== -1; a0 = next[a0]) {
        if (!(isSink ? rcap[a0] : rcap[this.sis(a0)])) continue;
        const j = head[a0];
        if (sink[j] !== isSink || parent[j] === NONE) continue;
        let d = 0, k = j;
        for (;;) {
          if (ts[k] === this.time) { d += dist[k]; break; }
          const a = parent[k]; d++;
          if (a === TERMINAL) { ts[k] = this.time; dist[k] = 1; break; }
          if (a === ORPHAN || a === NONE) { d = INF; break; }
          k = head[a];
        }
        if (d < INF) {
          if (d < dmin) { best = a0; dmin = d; }
          for (k = j; ts[k] !== this.time; k = head[parent[k]]) { ts[k] = this.time; dist[k] = d--; }
        }
      }
      if (best >= 0) { parent[i] = best; ts[i] = this.time; dist[i] = dmin + 1; continue; }
      parent[i] = NONE;
      for (let a0 = first[i]; a0 !== -1; a0 = next[a0]) {
        const j = head[a0];
        if (sink[j] !== isSink) continue;
        const a = parent[j];
        if (a === NONE) continue;
        if (isSink ? rcap[a0] : rcap[this.sis(a0)]) this.push(j);
        if (a !== TERMINAL && a !== ORPHAN && head[a] === i) this.orphan(j);
      }
    }
  }

  /** True when node i ended on the source side of the minimum cut. */
  isSource(i: number) { return this.parent[i] !== NONE && !this.sink[i]; }
}

// ---- colour models ----

const BINS = 32; // per channel
const binOf = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

function model(rgba: Uint8ClampedArray, pick: (p: number) => boolean, n: number): Float32Array {
  const h = new Float32Array(BINS * BINS * BINS);
  let total = 0;
  for (let p = 0; p < n; p++) if (pick(p)) { const i = p * 4; h[binOf(rgba[i], rgba[i + 1], rgba[i + 2])]++; total++; }
  // smooth by spreading each bin to its neighbours, so near colours count too
  const s = new Float32Array(h.length);
  for (let r = 0; r < BINS; r++) for (let g = 0; g < BINS; g++) for (let b = 0; b < BINS; b++) {
    const v = h[(r << 10) | (g << 5) | b]; if (!v) continue;
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
      const R = r + dr, G = g + dg, B = b + db;
      if (R < 0 || G < 0 || B < 0 || R >= BINS || G >= BINS || B >= BINS) continue;
      s[(R << 10) | (G << 5) | B] += v * (dr || dg || db ? 0.25 : 1);
    }
  }
  let tot = 0; for (let i = 0; i < s.length; i++) tot += s[i];
  const eps = 0.05, norm = 1 / (tot + eps * s.length);
  for (let i = 0; i < s.length; i++) s[i] = (s[i] + eps) * norm;
  void total;
  return s;
}

// ---- the cut ----

function downscale(rgba: Uint8ClampedArray, w: number, h: number, sw: number, sh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(sw * sh * 4), kx = w / sw, ky = h / sh;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    const x0 = Math.floor(x * kx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * kx)), y0 = Math.floor(y * ky), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ky));
    for (let yy = y0; yy < y1 && yy < h; yy++) for (let xx = x0; xx < x1 && xx < w; xx++) { const i = (yy * w + xx) * 4; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3]; n++; }
    const o = (y * sw + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
  }
  return out;
}
function seedsDown(seed: Uint8Array, w: number, h: number, sw: number, sh: number): Uint8Array {
  const out = new Uint8Array(sw * sh), kx = sw / w, ky = sh / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (seed[y * w + x]) out[Math.min(sh - 1, Math.floor(y * ky)) * sw + Math.min(sw - 1, Math.floor(x * kx))] = 1;
  return out;
}

export type CutResult = { mask: Uint8ClampedArray; keptShare: number };

/**
 * Cuts the subject out. `keep` and `remove` are one byte per pixel (non-zero = painted) at the picture's
 * size. Returns null without at least one keep stroke. Transparent pixels in the picture stay removed.
 */
export function guidedCut(rgba: Uint8ClampedArray, w: number, h: number, keep: Uint8Array, remove: Uint8Array): CutResult | null {
  let anyKeep = false, anyRemove = false;
  for (let p = 0; p < keep.length; p++) { if (keep[p]) anyKeep = true; if (remove[p]) anyRemove = true; if (anyKeep && anyRemove) break; }
  if (!anyKeep) return null;

  const k = Math.min(1, WORK_SIDE / Math.max(w, h)), sw = Math.max(2, Math.round(w * k)), sh = Math.max(2, Math.round(h * k)), n = sw * sh;
  const img = k < 1 ? downscale(rgba, w, h, sw, sh) : rgba;
  const fgSeed = k < 1 ? seedsDown(keep, w, h, sw, sh) : keep, bgSeed = k < 1 ? seedsDown(remove, w, h, sw, sh) : remove;
  for (let p = 0; p < n; p++) if (fgSeed[p]) bgSeed[p] = 0; // keep wins where both were painted

  // without remove strokes, a thin band on the top and side edges stands in for the background
  const band = Math.max(2, Math.round(Math.min(sw, sh) * 0.03));
  const edgeBg = (p: number) => { const x = p % sw, y = (p - x) / sw; return !fgSeed[p] && (y < band || x < band || x >= sw - band); };
  const transparent = (p: number) => img[p * 4 + 3] < 16;

  // neighbour weights: contrast-sensitive, so cuts run along edges
  const nb: [number, number, number][] = [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2]];
  let sum = 0, cnt = 0;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (const [dx, dy] of nb) {
    const X = x + dx, Y = y + dy; if (X < 0 || Y >= sh || X >= sw) continue;
    const i = (y * sw + x) * 4, j = (Y * sw + X) * 4;
    sum += (img[i] - img[j]) ** 2 + (img[i + 1] - img[j + 1]) ** 2 + (img[i + 2] - img[j + 2]) ** 2; cnt++;
  }
  const beta = 1 / (2 * Math.max(1, sum / Math.max(1, cnt))), gamma = 50, scale = 100;

  let fgLab = new Uint8Array(n);
  let fgModel = model(img, (p) => !!fgSeed[p], n);
  let bgModel = model(img, (p) => !!bgSeed[p] || (!anyRemove && edgeBg(p)) || transparent(p), n);

  for (let pass = 0; pass < 2; pass++) {
    const g = new MaxFlow(n, n * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const p = y * sw + x, i = p * 4;
      if (fgSeed[p]) g.addTerminal(p, HARD, 0);
      else if (bgSeed[p] || transparent(p)) g.addTerminal(p, 0, HARD);
      else {
        const bin = binOf(img[i], img[i + 1], img[i + 2]);
        const dFg = -Math.log(fgModel[bin]), dBg = -Math.log(bgModel[bin]);
        // cost of being background flows from the source side; of being subject, to the sink side
        g.addTerminal(p, Math.round(dBg * scale), Math.round(dFg * scale));
      }
      for (const [dx, dy, len] of nb) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y >= sh || X >= sw) continue;
        const q = Y * sw + X, j = q * 4;
        const d2 = (img[i] - img[j]) ** 2 + (img[i + 1] - img[j + 1]) ** 2 + (img[i + 2] - img[j + 2]) ** 2;
        const wgt = Math.round((gamma * Math.exp(-beta * d2) / len) * scale);
        if (wgt > 0) g.addEdge(p, q, wgt, wgt);
      }
    }
    g.maxflow();
    fgLab = new Uint8Array(n);
    for (let p = 0; p < n; p++) fgLab[p] = g.isSource(p) ? 1 : 0;
    if (pass === 0) {
      fgModel = model(img, (p) => !!fgLab[p] || !!fgSeed[p], n);
      bgModel = model(img, (p) => (!fgLab[p] && !fgSeed[p]) || !!bgSeed[p], n);
    }
  }

  // scale up with a soft edge, then make the strokes exact at full size
  const mask = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * (sw / w) - 0.5)), fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * (sh / h) - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    const v = fgLab[y0 * sw + x0] * (1 - ax) * (1 - ay) + fgLab[y0 * sw + x1] * ax * (1 - ay) + fgLab[y1 * sw + x0] * (1 - ax) * ay + fgLab[y1 * sw + x1] * ax * ay;
    const soft = Math.max(0, Math.min(1, (v - 0.5) * 2.2 + 0.5));
    const p = y * w + x;
    mask[p] = keep[p] ? 255 : remove[p] ? 0 : Math.round(soft * 255);
  }
  let s = 0; for (let p = 0; p < mask.length; p++) s += mask[p];
  return { mask, keptShare: s / (mask.length * 255) };
}
