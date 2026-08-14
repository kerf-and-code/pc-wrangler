// lib/worldmap/gen/pass1-elevation.ts
// Pass 1 (blueprint): continent mask for structure, plates for macro relief, domain-warped fBm for
// detail. The mask decides how many landmasses exist (F16), so islands only happen when asked for.
// Positions use pointy-top hex pixels at unit size; distances are Euclidean over that layout.

import { type GenConfig } from "./types";
import { hashSeed, passStream } from "./rng";
import { makeNoise2D, fbm } from "./noise";
import { hexToPixel } from "../layout";

type V2 = { x: number; y: number };
const smoother = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));

export function pass1Elevation(cfg: GenConfig): { elevation: Float32Array; volcanicCandidate: Uint8Array } {
  const W = cfg.width, H = cfg.height, N = W * H;
  const master = hashSeed(cfg.seed);

  const px = new Float32Array(N), py = new Float32Array(N);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const p = hexToPixel(col, row, 1);
      const i = row * W + col;
      px[i] = p.x; py[i] = p.y;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
  }
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const small = Math.min(spanX, spanY);

  // ---- continent mask ----
  const mask = new Float32Array(N);
  const rndM = passStream(master, "mask");
  const warp = makeNoise2D(master ^ 0x9e3779b9);
  const centers: V2[] = [];
  const minSep = small / 3;
  let guard = 0;
  while (centers.length < Math.max(1, cfg.continentCount) && guard++ < 800) {
    const cx = minX + (0.2 + 0.6 * rndM()) * spanX;
    const cy = minY + (0.2 + 0.6 * rndM()) * spanY;
    if (centers.every((c) => Math.hypot(c.x - cx, c.y - cy) >= minSep)) centers.push({ x: cx, y: cy });
  }
  const contRadius = small * 0.6;
  for (let i = 0; i < N; i++) {
    if (cfg.archipelago) { mask[i] = 0.5; continue; }
    const wx = px[i] + warp(px[i] * 0.04, py[i] * 0.04) * small * 0.16;
    const wy = py[i] + warp(px[i] * 0.04 + 100, py[i] * 0.04 + 100) * small * 0.16;
    let m = 0;
    for (const c of centers) {
      const f = Math.max(0, 1 - Math.hypot(wx - c.x, wy - c.y) / contRadius);
      const v = smoother(f);
      if (v > m) m = v;
    }
    mask[i] = m;
  }

  // ---- plates ----
  const rndP = passStream(master, "plates");
  const P = Math.max(5, cfg.plateCount);
  const sites: V2[] = [];
  for (let k = 0; k < P; k++) sites.push({ x: minX + rndP() * spanX, y: minY + rndP() * spanY });
  const base: number[] = [], drift: V2[] = [];
  for (let k = 0; k < P; k++) {
    // nearest hex to the site, to read the mask there
    let bi = 0, bd = Infinity;
    for (let i = 0; i < N; i++) { const d = (px[i] - sites[k].x) ** 2 + (py[i] - sites[k].y) ** 2; if (d < bd) { bd = d; bi = i; } }
    const continental = mask[bi] >= 0.5;
    base.push((continental ? 0.35 : -0.35) + (rndP() - 0.5) * 0.15);
    const ang = rndP() * Math.PI * 2, sp = 0.2 + rndP() * 0.8;
    drift.push({ x: Math.cos(ang) * sp, y: Math.sin(ang) * sp });
  }
  const B = small * 0.06;
  const plateField = new Float32Array(N);
  const volcanicCandidate = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let a = 0, ad = Infinity, fk = -1, fd = Infinity;
    for (let k = 0; k < P; k++) {
      const d = Math.hypot(px[i] - sites[k].x, py[i] - sites[k].y);
      if (d < ad) { fd = ad; fk = a; ad = d; a = k; }
      else if (d < fd) { fd = d; fk = k; }
    }
    let bf = 0;
    const boundaryDist = (fd - ad) / 2; // approx distance to the a|fk bisector
    if (fk >= 0 && boundaryDist < B) {
      const strength = 1 - boundaryDist / B;
      const nx = sites[fk].x - sites[a].x, ny = sites[fk].y - sites[a].y;
      const nl = Math.hypot(nx, ny) || 1;
      const rel = (drift[a].x - drift[fk].x) * (nx / nl) + (drift[a].y - drift[fk].y) * (ny / nl);
      bf = rel * strength * 0.6; // convergent (+) ridge / divergent (-) rift
      if (rel > 0 && strength > 0.7) volcanicCandidate[i] = 1; // narrow band on the boundary spine
    }
    plateField[i] = base[a] + bf;
  }

  // ---- detail fBm, domain-warped ----
  const detail = makeNoise2D(master ^ 0x1234567);
  const dwarp = makeNoise2D(master ^ 0x89abcdef);
  const fscale = 3 / small;
  // Strong domain warp: coasts trace the fBm detail more than the plate steps, so warping it hard bends
  // the shoreline off the straight Voronoi plate edges into natural, irregular lines.
  const COAST_FBM_WARP = 1.5;
  const fbmField = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const wx = px[i] * fscale + dwarp(px[i] * fscale * 0.5, py[i] * fscale * 0.5) * COAST_FBM_WARP;
    const wy = py[i] * fscale + dwarp(px[i] * fscale * 0.5 + 50, py[i] * fscale * 0.5 + 50) * COAST_FBM_WARP;
    fbmField[i] = fbm(detail, wx, wy, 5);
  }

  // ---- combine + min-max normalize to 0..1 ----
  const raw = new Float32Array(N);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < N; i++) {
    raw[i] = cfg.landConcentration * mask[i] + 0.45 * plateField[i] + 0.55 * fbmField[i];
    if (raw[i] < mn) mn = raw[i];
    if (raw[i] > mx) mx = raw[i];
  }
  const range = mx - mn || 1;
  const elev = new Float32Array(N);
  for (let i = 0; i < N; i++) elev[i] = (raw[i] - mn) / range;
  return { elevation: elev, volcanicCandidate };
}
