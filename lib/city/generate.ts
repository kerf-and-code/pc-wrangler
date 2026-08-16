import { generateRadialCity, type Centerpiece } from "./radial";

// Dispatcher over the city layouts. Each layout draws the same colour legend (ground, shaded
// districts, dark streets #4b4239, brown wall #6b4f34, gold centerpiece, blue water #5a86a8), so the
// imagine route's city mode and prompts need no per-layout change. Radial is delegated to its existing
// module untouched; grid and merging-nuclei are drawn here.

export type { Centerpiece } from "./radial";
export type CityLayout = "radial" | "grid" | "nuclei";

export type CityOpts = {
  layout: CityLayout;
  density: number; // primary param, meaning depends on layout
  detail: number;  // secondary param
  jitter: number;  // 0..0.6
  centerpiece: Centerpiece;
  wall: boolean;
  river: boolean;
  seed: number;
  size?: number;
};

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toDataURL(size: number, draw: (ctx: CanvasRenderingContext2D, W: number) => void): string {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  draw(ctx, size);
  return canvas.toDataURL("image/png");
}

function centerpiece(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, cp: Centerpiece): void {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = "#c9a24b"; ctx.strokeStyle = "#7a5f24"; ctx.lineWidth = 3;
  if (cp === "castle") {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, rr = i % 2 ? R : R * 1.35; if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (cp === "library") {
    ctx.fillRect(-R * 1.2, -R * 0.8, R * 2.4, R * 1.6); ctx.strokeRect(-R * 1.2, -R * 0.8, R * 2.4, R * 1.6);
    ctx.beginPath(); ctx.moveTo(-R * 1.4, -R * 0.8); ctx.lineTo(0, -R * 1.6); ctx.lineTo(R * 1.4, -R * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (cp === "temple") {
    ctx.beginPath(); ctx.arc(0, 0, R * 1.2, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#7a5f24"; ctx.fillRect(-R * 0.18, -R * 1.9, R * 0.36, R * 1.4);
  } else {
    ctx.beginPath(); ctx.arc(0, 0, R * 1.3, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function texture(ctx: CanvasRenderingContext2D, rng: () => number, x: number, y: number, w: number, h: number, count: number): void {
  for (let k = 0; k < count; k++) {
    const px = x + rng() * w, py = y + rng() * h, s = 2 + rng() * 4, g = 150 + ((rng() * 40) | 0);
    ctx.fillStyle = `rgba(${g},${g - 12},${g - 26},0.5)`;
    ctx.fillRect(px, py, s, s * (0.7 + rng() * 0.8));
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, W: number, o: CityOpts): void {
  const rng = mulberry32(o.seed);
  const blocks = Math.round(o.density), aves = Math.round(o.detail), jit = o.jitter;
  const cx = W / 2, cy = W / 2, margin = W * 0.09, area = W - margin * 2, step = area / blocks;
  ctx.fillStyle = "#e7dfce"; ctx.fillRect(0, 0, W, W);
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i <= blocks; i++) { const e = i > 0 && i < blocks ? 1 : 0; xs.push(margin + i * step + e * (rng() - 0.5) * step * jit); ys.push(margin + i * step + e * (rng() - 0.5) * step * jit); }
  for (let bx = 0; bx < blocks; bx++) for (let by = 0; by < blocks; by++) {
    const x0 = xs[bx], x1 = xs[bx + 1], y0 = ys[by], y1 = ys[by + 1];
    const mx = (x0 + x1) / 2 - cx, my = (y0 + y1) / 2 - cy, d = Math.min(1, Math.hypot(mx, my) / (area * 0.55));
    const v = Math.round(198 - (1 - d) * 42 + (rng() - 0.5) * 12);
    ctx.fillStyle = `rgb(${v},${v - 9},${v - 24})`; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  texture(ctx, rng, margin, margin, area, area, 2200);
  const majEvery = aves > 0 ? Math.max(1, Math.round(blocks / aves)) : 0;
  for (let i = 0; i <= blocks; i++) {
    const maj = majEvery !== 0 && i % majEvery === 0;
    ctx.strokeStyle = "#4b4239"; ctx.lineWidth = W * (maj ? 0.008 : 0.0035);
    ctx.beginPath(); ctx.moveTo(xs[i], ys[0]); ctx.lineTo(xs[i], ys[blocks]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xs[0], ys[i]); ctx.lineTo(xs[blocks], ys[i]); ctx.stroke();
  }
  if (o.river) {
    ctx.strokeStyle = "#5a86a8"; ctx.lineWidth = W * 0.05; ctx.lineCap = "round"; ctx.beginPath();
    for (let t = 0; t <= 1; t += 0.03) { const x = margin + t * area + Math.sin(t * 7 + o.seed) * area * 0.06, y = margin + t * area; if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  }
  if (o.wall) { ctx.strokeStyle = "#6b4f34"; ctx.lineWidth = W * 0.012; ctx.strokeRect(margin * 0.6, margin * 0.6, W - margin * 1.2, W - margin * 1.2); }
  centerpiece(ctx, cx, cy, step * 0.9, o.centerpiece);
}

function drawNuclei(ctx: CanvasRenderingContext2D, W: number, o: CityOpts): void {
  const rng = mulberry32(o.seed);
  const n = Math.round(o.density), spread = o.detail, jit = o.jitter;
  const cx = W / 2, cy = W / 2, R = W * 0.42;
  ctx.fillStyle = "#e7dfce"; ctx.fillRect(0, 0, W, W);
  const nuc: { x: number; y: number; rad: number; ph: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, rr = i === 0 ? R * 0.12 * rng() : R * 0.52 * (0.4 + rng() * 0.6);
    nuc.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, rad: R * (0.17 + rng() * 0.13) * (spread / 9), ph: rng() * 7 });
  }
  for (const nu of nuc) {
    ctx.beginPath();
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const wob = 1 + (Math.sin(a * 3 + nu.ph) * 0.5 + Math.sin(a * 5 + nu.ph * 2) * 0.3) * jit;
      const rad = nu.rad * wob, x = nu.x + Math.cos(a) * rad, y = nu.y + Math.sin(a) * rad;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const d = Math.min(1, Math.hypot(nu.x - cx, nu.y - cy) / (R * 0.7)), v = Math.round(196 - (1 - d) * 36);
    ctx.fillStyle = `rgb(${v},${v - 9},${v - 24})`; ctx.fill();
  }
  for (const nu of nuc) {
    for (let k = 0; k < 800; k++) {
      const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * nu.rad * 0.92, x = nu.x + Math.cos(a) * rr, y = nu.y + Math.sin(a) * rr, s = 2 + rng() * 4, g = 150 + ((rng() * 40) | 0);
      ctx.fillStyle = `rgba(${g},${g - 12},${g - 26},0.5)`; ctx.fillRect(x, y, s, s);
    }
  }
  ctx.strokeStyle = "#4b4239"; ctx.lineWidth = W * 0.006;
  for (let i = 1; i < n; i++) { ctx.beginPath(); ctx.moveTo(nuc[0].x, nuc[0].y); ctx.lineTo(nuc[i].x, nuc[i].y); ctx.stroke(); }
  ctx.lineWidth = W * 0.0035;
  for (const nu of nuc) { for (let k = 0; k < 6; k++) { const a = rng() * Math.PI * 2; ctx.beginPath(); ctx.moveTo(nu.x, nu.y); ctx.lineTo(nu.x + Math.cos(a) * nu.rad * 0.9, nu.y + Math.sin(a) * nu.rad * 0.9); ctx.stroke(); } }
  if (o.river) {
    ctx.strokeStyle = "#5a86a8"; ctx.lineWidth = W * 0.05; ctx.lineCap = "round"; const a0 = rng() * Math.PI * 2; ctx.beginPath();
    for (let t = -1; t <= 1; t += 0.04) { const rr = t * R * 1.1, wob = Math.sin(t * 6 + o.seed) * R * 0.09, x = cx + Math.cos(a0) * rr - Math.sin(a0) * wob, y = cy + Math.sin(a0) * rr + Math.cos(a0) * wob; if (t === -1) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  }
  if (o.wall) { ctx.strokeStyle = "#6b4f34"; ctx.lineWidth = W * 0.012; ctx.beginPath(); ctx.arc(cx, cy, R * 0.98, 0, 7); ctx.stroke(); }
  centerpiece(ctx, nuc[0].x, nuc[0].y, R * 0.06, o.centerpiece);
}

export function generateCity(o: CityOpts): string {
  if (o.layout === "radial") {
    return generateRadialCity({ rings: o.density, spokes: o.detail, jitter: o.jitter, centerpiece: o.centerpiece, wall: o.wall, river: o.river, seed: o.seed, size: o.size });
  }
  return toDataURL(o.size ?? 1024, (ctx, W) => (o.layout === "grid" ? drawGrid : drawNuclei)(ctx, W, o));
}
