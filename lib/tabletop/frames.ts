// lib/tabletop/frames.ts (2026-11-08)
//
// Token frames: the shape a portrait is cut to, the border around it, and the moving effects on that
// border. One renderer draws them everywhere: the tabletop canvas (style.frame on a token, drawn live so
// the animation runs at the table), the token maker's preview, and the free tool's PNG and video exports.
//
// A frame has three layers, each optional and each personalisable:
//   1. a static DESIGN (a plain band, or a themed border inspired by a class or subclass: thornvine for
//      druids, gilded filigree for paladins, crossed blades for fighters, moon phases for the Circle of
//      the Moon), in two colours;
//   2. an animated EFFECT themed on a damage type (licking fire, crackling lightning, acid drips,
//      thunder rings, psychic ripples), tinted by its own colours or one the user picks;
//   3. a MOTION style over the band (glow, pulse, colour flow, rainbow, sparkle, spin).
// Plus an imported border image (a PNG with a clear middle) drawn over all of it.
//
// All the art is drawn in code and is Six Axes' own. Designs are "inspired by" a class or subclass: the
// names are only labels for the picker.
//
// Coordinates: every draw call is centred on the origin. `r` is the portrait's radius, where the band is
// centred; designs and effects reach outward from there by about three band widths at most.

export type Shape = "circle" | "rounded" | "square" | "hex" | "octagon" | "diamond" | "shield";
export const SHAPES: { key: Shape; label: string }[] = [
  { key: "circle", label: "Circle" },
  { key: "rounded", label: "Rounded square" },
  { key: "square", label: "Square" },
  { key: "hex", label: "Hexagon" },
  { key: "octagon", label: "Octagon" },
  { key: "diamond", label: "Diamond" },
  { key: "shield", label: "Shield" },
];

export type Frame = {
  v: 1;
  shape: Shape;
  design: string;
  color: string;
  color2: string;
  width: number;      // band thickness as a share of the radius
  effect: string;     // "" or a damage type id
  effectColor: string | null; // null = the effect's own colours
  motion: string;     // "" or a motion id
  speed: number;      // 0.25 to 3
  intensity: number;  // 0 to 1
  importUrl: string | null;
};

export const DEFAULT_FRAME: Frame = {
  v: 1, shape: "circle", design: "plain", color: "#d9a43a", color2: "#6b4a1e", width: 0.14,
  effect: "", effectColor: null, motion: "", speed: 1, intensity: 0.7, importUrl: null,
};

// ---- colour helpers ----

type RGB = [number, number, number];
function rgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [217, 164, 58];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const css = (c: RGB, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${+a.toFixed(3)})`);
const mixC = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const lighten = (hex: string, k: number, a = 1) => css(mixC(rgb(hex), [255, 255, 255], k), a);
const darken = (hex: string, k: number, a = 1) => css(mixC(rgb(hex), [0, 0, 0], k), a);
const alpha = (hex: string, a: number) => css(rgb(hex), a);
const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;
const isHex = (s: unknown): s is string => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s);

// deterministic noise
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---- shapes as polylines (unit radius), walked by arc length ----

type Pt = { x: number; y: number };
type Outline = { pts: Pt[]; cum: number[]; len: number };
const outlines = new Map<Shape, Outline>();

function shapePoints(shape: Shape): Pt[] {
  const pts: Pt[] = [];
  const poly = (n: number, rot: number, R: number) => {
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) { const a = rot + (i * Math.PI * 2) / n; out.push({ x: Math.cos(a) * R, y: Math.sin(a) * R }); }
    return out;
  };
  const densify = (corners: Pt[]) => {
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length];
      for (let k = 0; k < 24; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / 24, y: a.y + ((b.y - a.y) * k) / 24 });
    }
  };
  if (shape === "circle") {
    for (let i = 0; i < 160; i++) { const a = -Math.PI / 2 + (i * Math.PI * 2) / 160; pts.push({ x: Math.cos(a), y: Math.sin(a) }); }
  } else if (shape === "rounded" || shape === "square") {
    const h = 0.9, cr = shape === "rounded" ? 0.3 : 0.02;
    const corner = (cx: number, cy: number, a0: number) => { for (let k = 0; k <= 12; k++) { const a = a0 + (k * Math.PI) / 2 / 12; pts.push({ x: cx + Math.cos(a) * cr, y: cy + Math.sin(a) * cr }); } };
    const edge = (x0: number, y0: number, x1: number, y1: number) => { for (let k = 1; k < 20; k++) pts.push({ x: x0 + ((x1 - x0) * k) / 20, y: y0 + ((y1 - y0) * k) / 20 }); };
    pts.push({ x: 0, y: -h });
    edge(0, -h, h - cr, -h); corner(h - cr, -h + cr, -Math.PI / 2);
    edge(h, -h + cr, h, h - cr); corner(h - cr, h - cr, 0);
    edge(h - cr, h, -h + cr, h); corner(-h + cr, h - cr, Math.PI / 2);
    edge(-h, h - cr, -h, -h + cr); corner(-h + cr, -h + cr, Math.PI);
    edge(-h + cr, -h, 0, -h);
    pts.pop();
  } else if (shape === "hex") densify(poly(6, -Math.PI / 2, 1.02));
  else if (shape === "octagon") densify(poly(8, -Math.PI / 2 + Math.PI / 8, 1.0));
  else if (shape === "diamond") densify(poly(4, -Math.PI / 2, 1.12));
  else {
    // shield: flat top with rounded shoulders, sides, then curving to a point
    const top = -0.86, w = 0.86;
    for (let k = 0; k <= 20; k++) pts.push({ x: -w + 0.1 + ((2 * w - 0.2) * k) / 20, y: top });
    for (let k = 0; k <= 30; k++) { const s = k / 30; pts.push({ x: w - 0.02 * (1 - s), y: top + 0.1 + s * 0.72 }); }
    for (let k = 1; k <= 40; k++) { const s = k / 40, a = (s * Math.PI) / 2; pts.push({ x: w * Math.cos(a), y: -0.04 + Math.sin(a) * 1.14 }); }
    for (let k = 1; k <= 40; k++) { const s = k / 40, a = Math.PI / 2 + (s * Math.PI) / 2; pts.push({ x: w * Math.cos(a), y: -0.04 + Math.sin(a) * 1.14 }); }
    for (let k = 1; k <= 30; k++) { const s = k / 30; pts.push({ x: -w + 0.02 * s, y: top + 0.82 - s * 0.72 }); }
  }
  return pts;
}

function outlineOf(shape: Shape): Outline {
  let o = outlines.get(shape);
  if (o) return o;
  const raw = shapePoints(shape);
  let best = 0, bd = Infinity;
  raw.forEach((p, i) => { const d = Math.abs(Math.atan2(p.y, p.x) + Math.PI / 2); if (d < bd) { bd = d; best = i; } });
  const pts = [...raw.slice(best), ...raw.slice(0, best)], cum = [0];
  for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y)); }
  o = { pts, cum, len: cum[cum.length - 1] };
  outlines.set(shape, o);
  return o;
}

/** A point on the outline at fraction u (0 = top centre, clockwise), with its outward normal and angle. */
export type OutPt = { x: number; y: number; nx: number; ny: number; a: number };
function at(shape: Shape, r: number, u: number): OutPt {
  const o = outlineOf(shape), d = (((u % 1) + 1) % 1) * o.len;
  let lo = 0, hi = o.cum.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (o.cum[m] <= d) lo = m; else hi = m; }
  const a = o.pts[lo % o.pts.length], b = o.pts[(lo + 1) % o.pts.length], seg = o.cum[lo + 1] - o.cum[lo] || 1, k = (d - o.cum[lo]) / seg;
  const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
  // the normal from a wider span so polygon corners turn smoothly
  const p0 = o.pts[(lo - 3 + o.pts.length) % o.pts.length], p1 = o.pts[(lo + 4) % o.pts.length];
  let tx = p1.x - p0.x, ty = p1.y - p0.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
  const nx = ty, ny = -tx;
  return { x: x * r, y: y * r, nx, ny, a: Math.atan2(ny, nx) };
}

/** Traces the shape at radius r (plus an outward offset) as the current path. */
export function tracePath(ctx: CanvasRenderingContext2D, shape: Shape, r: number, off = 0, begin = true) {
  const o = outlineOf(shape);
  if (begin) ctx.beginPath();
  if (shape === "circle") { ctx.moveTo(Math.max(0.1, r + off), 0); ctx.arc(0, 0, Math.max(0.1, r + off), 0, Math.PI * 2); return; }
  const n = o.pts.length;
  for (let i = 0; i < n; i++) {
    const p = o.pts[i];
    let x = p.x * r, y = p.y * r;
    if (off) { const q = at(shape, 1, o.cum[i] / o.len); x += q.nx * off; y += q.ny * off; }
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/** Places a motif at fraction u, with local -y pointing outward and units of one band width. */
function motif(ctx: CanvasRenderingContext2D, shape: Shape, r: number, u: number, w: number, off: number, draw: (c: CanvasRenderingContext2D) => void, flip = false) {
  const p = at(shape, r, u);
  ctx.save();
  ctx.translate(p.x + p.nx * off, p.y + p.ny * off);
  ctx.rotate(p.a + Math.PI / 2 + (flip ? Math.PI : 0));
  ctx.scale(w, w);
  draw(ctx);
  ctx.restore();
}
/** Places a motif upright (not turned with the outline): for things that hang or stand, like a lamp. */
function motifUp(ctx: CanvasRenderingContext2D, shape: Shape, r: number, u: number, w: number, off: number, draw: (c: CanvasRenderingContext2D) => void) {
  const p = at(shape, r, u);
  ctx.save(); ctx.translate(p.x + p.nx * off, p.y + p.ny * off); ctx.scale(w, w); draw(ctx); ctx.restore();
}
/** Draws only outside the shape, so long pieces can cross "behind" the portrait. */
function outside(ctx: CanvasRenderingContext2D, shape: Shape, r: number, draw: () => void) {
  ctx.save(); ctx.beginPath(); ctx.rect(-r * 8, -r * 8, r * 16, r * 16); tracePath(ctx, shape, r, 0, false); ctx.clip("evenodd"); draw(); ctx.restore();
}
const count = (shape: Shape, r: number, spacing: number) => Math.max(6, Math.round((outlineOf(shape).len * r) / spacing));

// ---- static designs ----

type Ctx = CanvasRenderingContext2D;
type DesignFn = (c: Ctx, s: Shape, r: number, w: number, c1: string, c2: string) => void;
export type DesignGroup = "simple" | "class" | "subclass";
type DesignDef = { id: string; label: string; group: DesignGroup; inspired?: string; color: string; color2: string; draw: DesignFn };

function metal(c: Ctx, r: number, base: string): CanvasGradient {
  const g = c.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, lighten(base, 0.45)); g.addColorStop(0.35, base); g.addColorStop(0.55, darken(base, 0.25)); g.addColorStop(0.75, lighten(base, 0.25)); g.addColorStop(1, darken(base, 0.35));
  return g;
}
function band(c: Ctx, s: Shape, r: number, w: number, style: string | CanvasGradient, off = 0) {
  c.save(); c.lineJoin = "round"; c.lineWidth = w; c.strokeStyle = style; tracePath(c, s, r, off); c.stroke(); c.restore();
}
function edgeLines(c: Ctx, s: Shape, r: number, w: number, col: string) {
  c.save(); c.lineWidth = Math.max(0.6, w * 0.1); c.strokeStyle = col;
  tracePath(c, s, r, w / 2); c.stroke(); tracePath(c, s, r, -w / 2); c.stroke(); c.restore();
}
const fillPath = (c: Ctx, col: string | CanvasGradient, d: string) => { c.fillStyle = col; c.fill(new Path2D(d)); };
const strokePath = (c: Ctx, col: string, lw: number, d: string) => { c.strokeStyle = col; c.lineWidth = lw; c.lineCap = "round"; c.lineJoin = "round"; c.stroke(new Path2D(d)); };
const disc = (c: Ctx, x: number, y: number, rr: number, col: string | CanvasGradient) => { c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.fillStyle = col; c.fill(); };

// small reusable motifs (local units = one band width, -y outward)
const SWORD = (c: Ctx, base: string, grip: string) => {
  fillPath(c, metal(c, 2, base), "M-0.18 -0.2L-0.18 -2.6L0 -3.05L0.18 -2.6L0.18 -0.2Z");
  strokePath(c, darken(base, 0.4), 0.05, "M0 -0.3L0 -2.8");
  fillPath(c, grip, "M-0.75 -0.28L0.75 -0.28L0.75 -0.05L-0.75 -0.05Z");
  fillPath(c, grip, "M-0.12 0L0.12 0L0.12 0.75L-0.12 0.75Z");
  disc(c, 0, 0.9, 0.18, grip);
};
/** A long blade along local -y from the guard at the origin, sized in pixels. */
function longSword(c: Ctx, len: number, w: number, base: string, grip: string) {
  const bw = w * 0.2;
  const g = c.createLinearGradient(-bw, 0, bw, 0); g.addColorStop(0, lighten(base, 0.5)); g.addColorStop(0.5, base); g.addColorStop(1, darken(base, 0.35));
  c.beginPath(); c.moveTo(-bw, 0); c.lineTo(-bw, -len + bw * 2.5); c.lineTo(0, -len); c.lineTo(bw, -len + bw * 2.5); c.lineTo(bw, 0); c.closePath(); c.fillStyle = g; c.fill();
  c.strokeStyle = darken(base, 0.45); c.lineWidth = Math.max(0.5, w * 0.04); c.beginPath(); c.moveTo(0, -w * 0.2); c.lineTo(0, -len + bw * 3); c.stroke();
  c.fillStyle = grip; c.fillRect(-w * 0.85, -w * 0.08, w * 1.7, w * 0.26); c.fillRect(-w * 0.13, w * 0.18, w * 0.26, w * 0.85);
  disc(c, 0, w * 1.12, w * 0.2, grip);
}
/** A long-hafted axe along local -y, head at the far end. */
function longAxe(c: Ctx, len: number, w: number, base: string, haft: string) {
  c.fillStyle = haft; c.fillRect(-w * 0.12, -len, w * 0.24, len + w);
  c.save(); c.translate(0, -len); c.scale(w, w);
  fillPath(c, metal(c, 2, base), "M0.1 0.2C1.3 -0.3 2.0 0.5 1.8 1.6C1.5 1.25 0.8 1.15 0.1 1.3Z");
  fillPath(c, metal(c, 2, base), "M-0.1 0.35L-0.8 0.15L-0.8 1.0L-0.1 0.95Z");
  c.restore();
}
const DAGGER = (c: Ctx, metalC: string | CanvasGradient, grip: string) => {
  fillPath(c, metalC, "M-0.16 -0.1L-0.12 -1.5L0 -1.95L0.12 -1.5L0.16 -0.1Z");
  fillPath(c, grip, "M-0.5 -0.15L0.5 -0.15L0.5 0.05L-0.5 0.05Z");
  fillPath(c, grip, "M-0.1 0.05L0.1 0.05L0.1 0.6L-0.1 0.6Z");
};
const LEAF = (c: Ctx, col: string, vein: string, len = 1) => {
  fillPath(c, col, `M0 0C${0.45 * len} ${-0.3 * len} ${0.35 * len} ${-0.9 * len} 0 ${-1.2 * len}C${-0.35 * len} ${-0.9 * len} ${-0.45 * len} ${-0.3 * len} 0 0Z`);
  strokePath(c, vein, 0.05, `M0 0L0 ${-1.05 * len}`);
};
const STAR4 = (c: Ctx, col: string, sz: number) => fillPath(c, col, `M0 ${-sz}Q${sz * 0.15} ${-sz * 0.15} ${sz} 0Q${sz * 0.15} ${sz * 0.15} 0 ${sz}Q${-sz * 0.15} ${sz * 0.15} ${-sz} 0Q${-sz * 0.15} ${-sz * 0.15} 0 ${-sz}Z`);
const GEAR = (c: Ctx, col: string | CanvasGradient, hole: string, R: number, teeth: number) => {
  c.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i * Math.PI) / teeth, rr = i % 2 ? R * 0.78 : R;
    c.lineTo(Math.cos(a0 - 0.12) * rr, Math.sin(a0 - 0.12) * rr); c.lineTo(Math.cos(a0 + 0.12) * rr, Math.sin(a0 + 0.12) * rr);
  }
  c.closePath(); c.fillStyle = col; c.fill(); disc(c, 0, 0, R * 0.35, hole);
};
const SKULL = (c: Ctx, bone: string, dark: string) => {
  fillPath(c, bone, "M0 -1.25C0.62 -1.25 0.9 -0.85 0.9 -0.4C0.9 -0.05 0.7 0.12 0.55 0.2L0.55 0.55L-0.55 0.55L-0.55 0.2C-0.7 0.12 -0.9 -0.05 -0.9 -0.4C-0.9 -0.85 -0.62 -1.25 0 -1.25Z");
  disc(c, -0.35, -0.42, 0.2, dark); disc(c, 0.35, -0.42, 0.2, dark);
  fillPath(c, dark, "M0 -0.18L0.1 0.02L-0.1 0.02Z");
  strokePath(c, dark, 0.05, "M-0.25 0.3L-0.25 0.55M0 0.3L0 0.55M0.25 0.3L0.25 0.55");
};
const EYE = (c: Ctx, white: string, iris: string) => {
  fillPath(c, white, "M-0.9 0C-0.45 -0.6 0.45 -0.6 0.9 0C0.45 0.6 -0.45 0.6 -0.9 0Z");
  disc(c, 0, 0, 0.32, iris); fillPath(c, "#000", "M-0.06 -0.28L0.06 -0.28L0.06 0.28L-0.06 0.28Z");
};
const BOLT = (c: Ctx, col: string) => fillPath(c, col, "M0.15 -1.4L-0.55 0.05L-0.05 0.05L-0.3 1.2L0.55 -0.3L0.05 -0.3Z");

const DESIGNS: DesignDef[] = [
  // simple
  { id: "plain", label: "Plain band", group: "simple", color: "#d9a43a", color2: "#6b4a1e", draw: (c, s, r, w, c1) => { band(c, s, r, w, metal(c, r, c1)); } },
  { id: "double", label: "Double ring", group: "simple", color: "#d8dde6", color2: "#3b4252", draw: (c, s, r, w, c1, c2) => { band(c, s, r, w, c2); band(c, s, r, w * 0.28, metal(c, r, c1), w * 0.36); band(c, s, r, w * 0.28, metal(c, r, c1), -w * 0.36); } },
  { id: "beaded", label: "Beaded", group: "simple", color: "#f2e6c9", color2: "#2a241d", draw: (c, s, r, w, c1, c2) => { band(c, s, r, w, c2); const n = count(s, r, w * 1.15); for (let i = 0; i < n; i++) { const p = at(s, r, i / n); disc(c, p.x, p.y, w * 0.34, metal(c, r, c1)); } } },
  { id: "dashed", label: "Dashed", group: "simple", color: "#ffffff", color2: "#111111", draw: (c, s, r, w, c1, c2) => { band(c, s, r, w, c2); c.save(); c.setLineDash([w * 1.2, w * 0.8]); band(c, s, r, w * 0.55, c1); c.restore(); } },

  // classes
  { id: "artificer", label: "Clockwork", group: "class", inspired: "Artificer", color: "#c8963c", color2: "#3a3026", draw: (c, s, r, w, c1, c2) => {
    const n = count(s, r, w * 0.9);
    for (let i = 0; i < n; i++) motif(c, s, r, i / n, w, w * 0.45, (m) => fillPath(m, metal(m, 1, c1), "M-0.22 0L0.22 0L0.18 -0.4L-0.18 -0.4Z"));
    band(c, s, r, w, c2); band(c, s, r, w * 0.35, metal(c, r, c1));
    for (const u of [0.125, 0.375, 0.625, 0.875]) motif(c, s, r, u, w, 0, (m) => { GEAR(m, metal(m, 1, c1), c2, 0.95, 8); });
  } },
  { id: "barbarian", label: "Fang and bone", group: "class", inspired: "Barbarian", color: "#efe4cc", color2: "#5a3a22", draw: (c, s, r, w, c1, c2) => {
    const n = count(s, r, w * 0.95);
    for (let i = 0; i < n; i++) { const big = i % 2 === 0; motif(c, s, r, i / n, w, w * 0.4, (m) => { fillPath(m, c1, big ? "M-0.32 0Q0 -1.5 0.1 -1.6Q0.05 -0.6 0.32 0Z" : "M-0.22 0Q0 -0.8 0.05 -0.85Q0.05 -0.35 0.22 0Z"); strokePath(m, darken(c1, 0.3), 0.04, big ? "M-0.32 0Q0 -1.5 0.1 -1.6" : "M-0.22 0Q0 -0.8 0.05 -0.85"); }); }
    band(c, s, r, w, c2); c.save(); c.setLineDash([w * 0.25, w * 0.35]); band(c, s, r, w * 0.12, lighten(c2, 0.35), w * 0.25); band(c, s, r, w * 0.12, lighten(c2, 0.35), -w * 0.25); c.restore();
  } },
  { id: "bard", label: "Minstrel's flourish", group: "class", inspired: "Bard", color: "#e6b0ff", color2: "#3a1f4d", draw: (c, s, r, w, c1, c2) => {
    band(c, s, r, w, c2);
    for (const o of [-0.32, 0, 0.32]) band(c, s, r, w * 0.07, c1, o * w);
    const n = Math.max(4, Math.round(count(s, r, w * 3)));
    for (let i = 0; i < n; i++) motif(c, s, r, (i + 0.5) / n, w, w * (i % 2 ? 0.15 : -0.15), (m) => { m.save(); m.rotate(-0.4); disc(m, 0, 0, 0.26, c1); m.restore(); strokePath(m, c1, 0.09, "M0.22 -0.05L0.22 -1.15Q0.5 -0.95 0.6 -0.7"); });
    for (const u of [0, 0.5]) motif(c, s, r, u, w, w * 0.9, (m) => strokePath(m, c1, 0.14, "M-1.2 0.2C-1.2 -0.6 -0.2 -0.6 -0.2 0C-0.2 0.3 -0.6 0.3 -0.6 0M1.2 0.2C1.2 -0.6 0.2 -0.6 0.2 0C0.2 0.3 0.6 0.3 0.6 0"));
  } },
  { id: "cleric", label: "Sunburst halo", group: "class", inspired: "Cleric", color: "#ffd36b", color2: "#7a5a1e", draw: (c, s, r, w, c1, c2) => {
    const n = count(s, r, w * 0.75);
    for (let i = 0; i < n; i++) motif(c, s, r, i / n, w, w * 0.4, (m) => fillPath(m, i % 2 ? lighten(c1, 0.3) : c1, i % 2 ? "M-0.14 0L0 -0.8L0.14 0Z" : "M-0.2 0L0 -1.5L0.2 0Z"));
    band(c, s, r, w, metal(c, r, c1)); edgeLines(c, s, r, w, c2);
    motif(c, s, r, 0, w, w * 1.1, (m) => { STAR4(m, lighten(c1, 0.5), 1.2); disc(m, 0, 0, 0.3, c1); });
  } },
  { id: "druid", label: "Thornvine", group: "class", inspired: "Druid", color: "#5aa04a", color2: "#6b4a2a", draw: (c, s, r, w, c1, c2) => {
    const N = 900, waves = Math.max(8, Math.round(count(s, r, w * 2.4)));
    c.save(); c.lineWidth = w * 0.42; c.strokeStyle = c2; c.lineCap = "round"; c.beginPath();
    for (let i = 0; i <= N; i++) { const u = i / N, p = at(s, r, u), off = Math.sin(u * waves * Math.PI * 2) * w * 0.35; const x = p.x + p.nx * off, y = p.y + p.ny * off; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.stroke(); c.lineWidth = w * 0.18; c.strokeStyle = lighten(c2, 0.2); c.stroke(); c.restore();
    for (let i = 0; i < waves; i++) {
      const u = i / waves;
      motif(c, s, r, u + 0.25 / waves, w, w * 0.55, (m) => fillPath(m, lighten(c2, 0.15), "M-0.12 0L0 -0.55L0.12 0Z"));
      motif(c, s, r, u + 0.75 / waves, w, -w * 0.55, (m) => fillPath(m, lighten(c2, 0.15), "M-0.12 0L0 -0.55L0.12 0Z"), true);
      if (i % 2 === 0) motif(c, s, r, u + 0.5 / waves, w, w * 0.1, (m) => { m.rotate(0.6); LEAF(m, c1, darken(c1, 0.35), 1.15); m.rotate(-1.2); LEAF(m, lighten(c1, 0.15), darken(c1, 0.35), 0.8); });
    }
  } },
  { id: "fighter", label: "Crossed blades", group: "class", inspired: "Fighter", color: "#c8ced8", color2: "#6b4a2a", draw: (c, s, r, w, c1, c2) => {
    outside(c, s, r, () => { for (const k of [-1, 1]) { c.save(); c.rotate(k * 0.72); c.translate(0, r + w * 0.9); longSword(c, r * 2 + w * 3.2, w * 1.2, c1, c2); c.restore(); } });
    band(c, s, r, w, metal(c, r, c1)); edgeLines(c, s, r, w, darken(c1, 0.5));
    const n = count(s, r, w * 1.4);
    for (let i = 0; i < n; i++) { const p = at(s, r, i / n); disc(c, p.x, p.y, w * 0.16, darken(c1, 0.35)); disc(c, p.x - w * 0.04, p.y - w * 0.04, w * 0.07, lighten(c1, 0.6)); }
  } },
  { id: "monk", label: "Prayer beads", group: "class", inspired: "Monk", color: "#a0522d", color2: "#e8c060", draw: (c, s, r, w, c1, c2) => {
    band(c, s, r, w * 0.12, darken(c1, 0.4));
    const n = count(s, r, w * 1.05);
    for (let i = 0; i < n; i++) { const p = at(s, r, i / n); const g = c.createRadialGradient(p.x - w * 0.15, p.y - w * 0.15, w * 0.05, p.x, p.y, w * 0.5); g.addColorStop(0, lighten(c1, 0.5)); g.addColorStop(1, darken(c1, 0.3)); disc(c, p.x, p.y, w * 0.46, g); }
    motifUp(c, s, r, 0.5, w, w * 0.3, (m) => { for (let k = -3; k <= 3; k++) strokePath(m, c2, 0.08, `M${k * 0.1} 0.5L${k * 0.2} 2.2`); disc(m, 0, 0, 0.75, metal(m, 1, c2)); });
  } },
  { id: "paladin", label: "Gilded oath", group: "class", inspired: "Paladin", color: "#e0b040", color2: "#2f6fd8", draw: (c, s, r, w, c1, c2) => {
    band(c, s, r, w * 1.15, darken(c1, 0.55));
    band(c, s, r, w * 0.2, metal(c, r, c1), w * 0.48); band(c, s, r, w * 0.2, metal(c, r, c1), -w * 0.48);
    const n = Math.max(8, Math.round(count(s, r, w * 1.6)));
    for (let i = 0; i < n; i++) motif(c, s, r, i / n, w, 0, (m) => strokePath(m, c1, 0.1, "M-0.75 0C-0.6 -0.3 -0.2 -0.3 -0.2 0C-0.2 0.2 -0.4 0.2 -0.4 0.05M0.75 0C0.6 0.3 0.2 0.3 0.2 0C0.2 -0.2 0.4 -0.2 0.4 -0.05"));
    for (const u of [0, 0.25, 0.5, 0.75]) motif(c, s, r, u, w, 0, (m) => {
      fillPath(m, metal(m, 1, c1), "M0 -0.85L0.6 0L0 0.85L-0.6 0Z");
      const g = m.createRadialGradient(-0.1, -0.15, 0.05, 0, 0, 0.5); g.addColorStop(0, lighten(c2, 0.6)); g.addColorStop(1, darken(c2, 0.2));
      fillPath(m, g, "M0 -0.55L0.38 0L0 0.55L-0.38 0Z");
    });
    motif(c, s, r, 0, w, w * 1.05, (m) => fillPath(m, metal(m, 1, c1), "M0 -0.9C0.3 -0.6 0.3 -0.2 0.08 0L-0.08 0C-0.3 -0.2 -0.3 -0.6 0 -0.9ZM0.15 -0.1C0.5 -0.5 0.9 -0.3 0.8 0.1C0.6 -0.1 0.4 0 0.15 0ZM-0.15 -0.1C-0.5 -0.5 -0.9 -0.3 -0.8 0.1C-0.6 -0.1 -0.4 0 -0.15 0Z"));
  } },
  { id: "ranger", label: "Fletcher's ring", group: "class", inspired: "Ranger", color: "#c87a3a", color2: "#3d5a2e", draw: (c, s, r, w, c1, c2) => {
    const n = count(s, r, w * 1.0);
    for (let i = 0; i < n; i++) motif(c, s, r, i / n, w, w * 0.15, (m) => { m.rotate(0.5); fillPath(m, i % 2 ? c1 : c2, "M0 0C0.3 -0.3 0.32 -0.9 0 -1.35C-0.32 -0.9 -0.3 -0.3 0 0Z"); strokePath(m, lighten(i % 2 ? c1 : c2, 0.4), 0.04, "M0 -0.05L0 -1.3"); });
    band(c, s, r, w * 0.5, darken(c1, 0.35));
    motif(c, s, r, 0, w, w * 0.75, (m) => { strokePath(m, "#7a5a3a", 0.12, "M-2.2 0L1.9 0"); fillPath(m, "#c8ced8", "M1.8 -0.32L2.5 0L1.8 0.32Z"); fillPath(m, c1, "M-2.2 0L-2.6 -0.4L-1.7 -0.4L-1.4 0L-1.7 0.4L-2.6 0.4Z"); });
  } },
  { id: "rogue", label: "Shadow knives", group: "class", inspired: "Rogue", color: "#c8ced8", color2: "#2a2420", draw: (c, s, r, w, c1, c2) => {
    for (const u of [0.125, 0.375, 0.625, 0.875]) motif(c, s, r, u, w * 1.15, w * 0.3, (m) => DAGGER(m, metal(m, 1.5, c1), "#5a3a22"));
    band(c, s, r, w, c2); edgeLines(c, s, r, w, lighten(c2, 0.25));
    c.save(); c.setLineDash([w * 0.3, w * 0.25]); band(c, s, r, w * 0.09, lighten(c2, 0.55)); c.restore();
  } },
  { id: "sorcerer", label: "Dragonscale", group: "class", inspired: "Sorcerer", color: "#c0392b", color2: "#f0b040", draw: (c, s, r, w, c1, c2) => {
    band(c, s, r, w * 1.1, darken(c1, 0.45));
    const n = count(s, r, w * 0.62);
    for (const row of [0.3, -0.25]) for (let i = 0; i < n; i++) motif(c, s, r, (i + (row > 0 ? 0 : 0.5)) / n, w, row * w, (m) => {
      const g = m.createLinearGradient(0, -0.5, 0, 0.4); g.addColorStop(0, lighten(c1, 0.25)); g.addColorStop(1, darken(c1, 0.35));
      fillPath(m, g, "M-0.42 -0.25Q0 0.75 0.42 -0.25Z"); strokePath(m, alpha(c2, 0.8), 0.06, "M-0.42 -0.25Q0 0.75 0.42 -0.25");
    });
  } },
  { id: "warlock", label: "Eldritch pact", group: "class", inspired: "Warlock", color: "#9b59ff", color2: "#4a4a52", draw: (c, s, r, w, c1, c2) => {
    const n = count(s, r, w * 0.85);
    for (let i = 0; i < n; i++) motif(c, s, r, i / n, w, 0, (m) => { m.rotate(Math.PI / 2); m.beginPath(); if (i % 2) m.ellipse(0, 0, 0.62, 0.2, 0, 0, Math.PI * 2); else m.ellipse(0, 0, 0.55, 0.32, 0, 0, Math.PI * 2); m.strokeStyle = metal(m, 1, c2); m.lineWidth = 0.16; m.stroke(); });
    for (const u of [0, 0.25, 0.5, 0.75]) motif(c, s, r, u, w, 0, (m) => { disc(m, 0, 0, 0.95, darken(c1, 0.75)); m.save(); m.scale(0.9, 0.9); EYE(m, "#f0e8ff", c1); m.restore(); });
  } },
  { id: "wizard", label: "Arcane circle", group: "class", inspired: "Wizard", color: "#6fb4ff", color2: "#1c2448", draw: (c, s, r, w, c1, c2) => {
    band(c, s, r, w * 1.15, c2);
    band(c, s, r, w * 0.08, c1, w * 0.48); band(c, s, r, w * 0.08, c1, -w * 0.48);
    const n = count(s, r, w * 0.75);
    for (let i = 0; i < n; i++) motif(c, s, r, i / n, w, 0, (m) => {
      const k = Math.floor(hash(i + 7) * 6), G = ["M-0.2 -0.25L0.2 0.25M0.2 -0.25L-0.2 0.25", "M0 -0.28L0 0.28M-0.2 -0.1L0.2 -0.1", "M-0.2 0.25L0 -0.25L0.2 0.25", "M-0.2 -0.25L0.2 -0.25L-0.2 0.25L0.2 0.25", "M0 -0.28A0.22 0.22 0 1 1 -0.01 -0.28M0 -0.05L0 0.28", "M-0.22 0L0.22 0M0 -0.22L0 0.22"];
      strokePath(m, lighten(c1, 0.3), 0.07, G[k]);
    });
    for (let i = 0; i < 8; i++) motif(c, s, r, i / 8, w, w * 1.0, (m) => STAR4(m, i % 2 ? lighten(c1, 0.5) : c1, i % 2 ? 0.35 : 0.55));
  } },

  // subclasses
  { id: "moon", label: "Moon phases", group: "subclass", inspired: "Circle of the Moon", color: "#e8ecf4", color2: "#1e2a44", draw: (c, s, r, w, c1, c2) => {
    band(c, s, r, w * 1.2, c2); band(c, s, r, w * 0.06, alpha(c1, 0.6), w * 0.55); band(c, s, r, w * 0.06, alpha(c1, 0.6), -w * 0.55);
    const n = 8;
    for (let i = 0; i < n; i++) motif(c, s, r, i / n, w, 0, (m) => {
      const ph = (i / n) * 2, R = 0.48; m.beginPath();
      if (ph === 0) { m.arc(0, 0, R, 0, Math.PI * 2); m.strokeStyle = c1; m.lineWidth = 0.06; m.stroke(); return; }
      const lit = ph <= 1 ? 1 : -1, rx = R * Math.cos(Math.PI * (ph <= 1 ? ph : ph - 1));
      m.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, lit < 0);
      m.ellipse(0, 0, Math.abs(rx), R, 0, Math.PI / 2, -Math.PI / 2, (rx > 0) === (lit > 0));
      m.fillStyle = c1; m.fill();
    });
    for (let i = 0; i < 16; i++) { const p = at(s, r, (i + 0.5) / 16 + hash(i) * 0.02); disc(c, p.x + p.nx * w * (hash(i + 3) - 0.5) * 0.8, p.y + p.ny * w * (hash(i + 3) - 0.5) * 0.8, w * 0.05, c1); }
  } },
  { id: "spores", label: "Fungal ring", group: "subclass", inspired: "Circle of Spores", color: "#c8a0d8", color2: "#3a2e24", draw: (c, s, r, w, c1, c2) => {
    band(c, s, r, w, c2);
    for (let i = 0; i < 40; i++) { const p = at(s, r, hash(i * 3.1)); const o = (hash(i * 7.7) - 0.5) * w * 0.8; disc(c, p.x + p.nx * o, p.y + p.ny * o, w * 0.06, lighten(c1, 0.3)); }
    const n = Math.max(6, Math.round(count(s, r, w * 1.9)));
    for (let i = 0; i < n; i++) motif(c, s, r, i / n, w * (i % 3 === 0 ? 1.25 : 0.9), w * 0.25, (m) => {
      fillPath(m, "#efe4cc", "M-0.15 0L-0.12 -0.75L0.12 -0.75L0.15 0Z");
      const g = m.createLinearGradient(0, -1.3, 0, -0.7); g.addColorStop(0, lighten(c1, 0.2)); g.addColorStop(1, darken(c1, 0.3));
      fillPath(m, g, "M-0.65 -0.7Q-0.6 -1.35 0 -1.4Q0.6 -1.35 0.65 -0.7Z");
      disc(m, -0.25, -1.0, 0.07, "#fff8"); disc(m, 0.2, -1.12, 0.06, "#fff8");
    });
  } },
  { id: "life", label: "Laurel wreath", group: "subclass", inspired: "Life Domain", color: "#7cc06a", color2: "#e0b040", draw: (c, s, r, w, c1, c2) => {
    band(c, s, r, w * 0.15, darken(c1, 0.3), w * 0.05);
    const n = Math.max(10, Math.round(count(s, r, w * 0.85) / 2));
    for (let i = 1; i < n; i++) {
      const u = (i / n) * 0.47;
      motif(c, s, r, 0.5 - u, w, 0, (m) => { m.rotate(-0.9); LEAF(m, i % 2 ? c1 : lighten(c1, 0.15), darken(c1, 0.4), 0.95); m.rotate(1.5); LEAF(m, darken(c1, 0.1), darken(c1, 0.4), 0.75); });
      motif(c, s, r, 0.5 + u, w, 0, (m) => { m.rotate(0.9); LEAF(m, i % 2 ? c1 : lighten(c1, 0.15), darken(c1, 0.4), 0.95); m.rotate(-1.5); LEAF(m, darken(c1, 0.1), darken(c1, 0.4), 0.75); });
    }
    motifUp(c, s, r, 0.5, w, w * 0.1, (m) => { fillPath(m, darken(c2, 0.2), "M-0.4 0.2L-1.0 1.4L-0.55 1.2L-0.15 0.2ZM0.4 0.2L1.0 1.4L0.55 1.2L0.15 0.2Z"); fillPath(m, metal(m, 1, c2), "M-1 -0.35L1 -0.35L1 0.35L-1 0.35Z"); });
  } },
  { id: "tempest", label: "Storm crown", group: "subclass", inspired: "Tempest Domain", color: "#7fc8ff", color2: "#3a4250", draw: (c, s, r, w, c1, c2) => {
    const n = Math.max(8, Math.round(count(s, r, w * 1.1)));
    for (let i = 0; i < n; i++) motif(c, s, r, i / n, w, w * 0.35, (m) => { disc(m, -0.35, -0.1, 0.42, lighten(c2, 0.2)); disc(m, 0.25, -0.25, 0.5, lighten(c2, 0.3)); disc(m, 0.55, 0.05, 0.35, lighten(c2, 0.15)); });
    band(c, s, r, w, c2);
    for (let i = 0; i < 6; i++) motif(c, s, r, i / 6, w, w * 0.6, (m) => BOLT(m, c1));
  } },
  { id: "vengeance", label: "Oathbreaker spikes", group: "subclass", inspired: "Oath of Vengeance", color: "#8a1c1c", color2: "#1a1416", draw: (c, s, r, w, c1, c2) => {
    const n = count(s, r, w * 0.8);
    for (let i = 0; i < n; i++) motif(c, s, r, i / n, w, w * 0.4, (m) => fillPath(m, i % 3 === 0 ? c1 : darken(c1, 0.4), i % 3 === 0 ? "M-0.18 0L0 -1.9L0.18 0Z" : "M-0.14 0L0 -0.9L0.14 0Z"));
    band(c, s, r, w, metal(c, r, c2)); band(c, s, r, w * 0.18, c1);
    motif(c, s, r, 0, w, w * 1.0, (m) => fillPath(m, c1, "M0 -0.9C0.35 -0.35 0.5 0 0.5 0.25A0.5 0.5 0 0 1 -0.5 0.25C-0.5 0 -0.35 -0.35 0 -0.9Z"));
  } },
  { id: "genies", label: "Lamp and wisps", group: "subclass", inspired: "Oath of the Noble Genies", color: "#e0b040", color2: "#3ec8c0", draw: (c, s, r, w, c1, c2) => {
    band(c, s, r, w, darken(c2, 0.6));
    const N = 700, waves = Math.max(6, Math.round(count(s, r, w * 3)));
    for (const ph of [0, Math.PI]) {
      c.save(); c.lineWidth = w * 0.14; c.strokeStyle = alpha(c2, 0.9); c.beginPath();
      for (let i = 0; i <= N; i++) { const u = i / N, p = at(s, r, u), off = Math.sin(u * waves * Math.PI * 2 + ph) * w * 0.32; const x = p.x + p.nx * off, y = p.y + p.ny * off; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
      c.stroke(); c.restore();
    }
    band(c, s, r, w * 0.12, c1, w * 0.52); band(c, s, r, w * 0.12, c1, -w * 0.52);
    motifUp(c, s, r, 0.5, w * 1.3, w * 0.75, (m) => { fillPath(m, metal(m, 1.5, c1), "M-1.5 -0.1C-1.1 0.5 0.6 0.5 1 0L1.9 -0.55L1.7 -0.2L1.1 0.15C0.9 0.7 -0.9 0.75 -1.2 0.35L-1.6 0.4C-2 0.2 -2 -0.3 -1.5 -0.1ZM-0.3 -0.15C-0.3 -0.55 0.3 -0.55 0.3 -0.15ZM-0.5 0.55L0.5 0.55L0.7 0.85L-0.7 0.85Z"); strokePath(m, alpha(c2, 0.9), 0.12, "M1.9 -0.6C2.3 -1.2 1.7 -1.6 2.1 -2.2"); });
    for (const u of [0.15, 0.35, 0.65, 0.85]) motif(c, s, r, u, w, w * 0.95, (m) => STAR4(m, lighten(c1, 0.4), 0.4));
  } },
  { id: "berserker", label: "Cleaving axes", group: "subclass", inspired: "Path of the Berserker", color: "#c8ced8", color2: "#7a2a1a", draw: (c, s, r, w, c1, c2) => {
    outside(c, s, r, () => { for (const k of [-1, 1]) { c.save(); c.rotate(k * 0.62); c.translate(0, r + w * 0.8); if (k < 0) c.scale(-1, 1); longAxe(c, r * 2 + w * 2.2, w * 1.1, c1, "#6b4a2a"); c.restore(); } });
    band(c, s, r, w, c2);
    c.save(); c.lineWidth = w * 0.1; c.strokeStyle = darken(c2, 0.5); c.beginPath();
    const N = 220; for (let i = 0; i <= N; i++) { const u = i / N, p = at(s, r, u), off = (hash(i) - 0.5) * w * 0.7; if (i) c.lineTo(p.x + p.nx * off, p.y + p.ny * off); else c.moveTo(p.x + p.nx * off, p.y + p.ny * off); }
    c.stroke(); c.restore(); edgeLines(c, s, r, w, darken(c2, 0.4));
  } },
  { id: "hexblade", label: "Hexed blade", group: "subclass", inspired: "Hexblade", color: "#b06aff", color2: "#1e1428", draw: (c, s, r, w, c1, c2) => {
    motif(c, s, r, 0, w * 1.15, w * 0.3, (m) => SWORD(m, "#d8dde6", c1));
    band(c, s, r, w * 1.1, c2);
    const n = Math.max(6, Math.round(count(s, r, w * 1.5)));
    for (let i = 0; i < n; i++) motif(c, s, r, (i + 0.5) / n, w, 0, (m) => { m.beginPath(); for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; m.lineTo(Math.cos(a) * 0.38, Math.sin(a) * 0.38); } m.closePath(); m.strokeStyle = c1; m.lineWidth = 0.08; m.stroke(); disc(m, 0, 0, 0.1, c1); });
    edgeLines(c, s, r, w * 1.1, alpha(c1, 0.8));
  } },
  { id: "draconic", label: "Talon and horn", group: "subclass", inspired: "Draconic Sorcery", color: "#2e8b57", color2: "#efe4cc", draw: (c, s, r, w, c1, c2) => {
    for (const u of [0.92, 0.08]) motif(c, s, r, u, w, w * 0.35, (m) => { m.rotate(u < 0.5 ? 0.35 : -0.35); fillPath(m, c2, "M-0.3 0Q-0.2 -1.4 0.5 -2.2Q0.1 -1.2 0.3 0Z"); });
    for (const u of [0.25, 0.42, 0.58, 0.75]) motif(c, s, r, u, w, w * 0.35, (m) => fillPath(m, c2, "M-0.2 0Q0 -0.9 0.45 -1.1Q0.15 -0.6 0.2 0Z"));
    band(c, s, r, w * 1.1, darken(c1, 0.45));
    const n = count(s, r, w * 0.62);
    for (const row of [0.3, -0.25]) for (let i = 0; i < n; i++) motif(c, s, r, (i + (row > 0 ? 0 : 0.5)) / n, w, row * w, (m) => { const g = m.createLinearGradient(0, -0.5, 0, 0.4); g.addColorStop(0, lighten(c1, 0.25)); g.addColorStop(1, darken(c1, 0.35)); fillPath(m, g, "M-0.42 -0.25Q0 0.75 0.42 -0.25Z"); });
  } },
  { id: "necromancy", label: "Bone and skull", group: "subclass", inspired: "School of Necromancy", color: "#efe4cc", color2: "#2a2a26", draw: (c, s, r, w, c1, c2) => {
    band(c, s, r, w, c2);
    const n = count(s, r, w * 1.6);
    for (let i = 0; i < n; i++) motif(c, s, r, i / n, w, 0, (m) => { m.rotate(Math.PI / 2); fillPath(m, c1, "M-0.5 -0.08L0.5 -0.08L0.5 0.08L-0.5 0.08Z"); disc(m, -0.55, -0.1, 0.13, c1); disc(m, -0.55, 0.1, 0.13, c1); disc(m, 0.55, -0.1, 0.13, c1); disc(m, 0.55, 0.1, 0.13, c1); });
    for (const u of [0, 0.25, 0.5, 0.75]) motif(c, s, r, u, w, w * 0.35, (m) => SKULL(m, c1, c2));
  } },
];

export const FRAME_DESIGNS: { id: string; label: string; group: DesignGroup; inspired?: string; color: string; color2: string }[] =
  DESIGNS.map(({ id, label, group, inspired, color, color2 }) => ({ id, label, group, inspired, color, color2 }));
const DESIGN_BY_ID = new Map(DESIGNS.map((d) => [d.id, d]));

// ---- animated effects, themed on damage types ----

export type EffectDef = { id: string; label: string; colors: [string, string, string] };
export const FRAME_EFFECTS: EffectDef[] = [
  { id: "fire", label: "Fire", colors: ["#fff1a0", "#ff9a2e", "#d8301c"] },
  { id: "cold", label: "Cold", colors: ["#ffffff", "#9fe8ff", "#3a8fd8"] },
  { id: "lightning", label: "Lightning", colors: ["#ffffff", "#8fd8ff", "#3a6fff"] },
  { id: "thunder", label: "Thunder", colors: ["#e8eeff", "#a8b8ff", "#5a64c8"] },
  { id: "acid", label: "Acid", colors: ["#f0ffa0", "#a6e03c", "#4a8a14"] },
  { id: "poison", label: "Poison", colors: ["#c8ffb0", "#4fd24a", "#1e6a2a"] },
  { id: "necrotic", label: "Necrotic", colors: ["#c8f0b0", "#5a7a4a", "#1a1420"] },
  { id: "radiant", label: "Radiant", colors: ["#ffffff", "#ffe27a", "#ffb030"] },
  { id: "psychic", label: "Psychic", colors: ["#ffd0f4", "#ff70d0", "#8a3ad8"] },
  { id: "force", label: "Force", colors: ["#f0e0ff", "#c8a0ff", "#6a3ad8"] },
  { id: "bludgeoning", label: "Bludgeoning", colors: ["#f2e6c9", "#c9b8a0", "#6b5a44"] },
  { id: "piercing", label: "Piercing", colors: ["#ffffff", "#e0d8c8", "#8a8070"] },
  { id: "slashing", label: "Slashing", colors: ["#ffffff", "#ff8a80", "#b01818"] },
];
const EFFECT_BY_ID = new Map(FRAME_EFFECTS.map((e) => [e.id, e]));

export const FRAME_MOTIONS: { id: string; label: string }[] = [
  { id: "glow", label: "Glow" },
  { id: "pulse", label: "Pulse" },
  { id: "flow", label: "Colour flow" },
  { id: "rainbow", label: "Rainbow" },
  { id: "sparkle", label: "Sparkle" },
  { id: "spin", label: "Spinning dashes" },
];

function palette(f: Frame): [string, string, string] {
  const def = EFFECT_BY_ID.get(f.effect)?.colors ?? ["#ffffff", "#d9a43a", "#6b4a1e"];
  if (!f.effectColor) return def;
  return [lighten(f.effectColor, 0.7), f.effectColor, darken(f.effectColor, 0.45)];
}

/** Draws the moving effect around the band. t is seconds (already scaled by speed). */
function drawEffect(c: Ctx, f: Frame, r: number, w: number, t: number) {
  const s = f.shape, I = 0.35 + f.intensity * 0.65, [hi, mid, lo] = palette(f);
  const L = outlineOf(s).len * r;
  c.save();
  switch (f.effect) {
    case "fire": {
      const n = Math.max(14, Math.round(L / (w * 0.85)));
      c.globalCompositeOperation = "lighter";
      for (let layer = 0; layer < 3; layer++) {
        const col = [lo, mid, hi][layer], scale = [1.25, 0.9, 0.55][layer];
        for (let i = 0; i < n; i++) {
          const ph = hash(i * 3 + layer) * 6.28, flick = 0.55 + 0.45 * Math.sin(t * (5 + hash(i) * 4) + ph) * Math.sin(t * 2.3 + ph * 2);
          const h = w * (1.2 + 1.6 * I) * scale * (0.6 + 0.5 * flick), bw = w * 0.55 * scale;
          const sway = Math.sin(t * 3 + ph) * 0.25;
          motif(c, s, r, (i + layer * 0.33) / n, 1, w * 0.2, (m) => {
            m.beginPath(); m.moveTo(-bw, 0);
            m.quadraticCurveTo(-bw * 0.8, -h * 0.55, sway * bw * 2, -h);
            m.quadraticCurveTo(bw * 0.8, -h * 0.55, bw, 0); m.closePath();
            m.fillStyle = alpha(col, 0.55 * I); m.fill();
          });
        }
      }
      // embers
      for (let i = 0; i < 14; i++) {
        const life = (t * 0.6 + hash(i * 9)) % 1, u = hash(i * 5) + Math.sin(t * 0.7 + i) * 0.01;
        motif(c, s, r, u, 1, w * (0.5 + life * 3 * I), (m) => disc(m, Math.sin(life * 9 + i) * w * 0.3, 0, w * 0.09 * (1 - life), alpha(hi, (1 - life) * I)));
      }
      break;
    }
    case "cold": {
      const n = Math.max(10, Math.round(L / (w * 1.3)));
      for (let i = 0; i < n; i++) {
        const tall = (0.8 + hash(i * 4.4) * 1.3) * (0.7 + 0.5 * I);
        motif(c, s, r, i / n + hash(i) * 0.01, w, w * 0.3, (m) => {
          m.rotate((hash(i * 2) - 0.5) * 0.6);
          const g = m.createLinearGradient(0, 0, 0, -tall); g.addColorStop(0, alpha(lo, 0.85)); g.addColorStop(1, alpha(hi, 0.95));
          fillPath(m, g, `M-0.22 0L-0.08 ${-tall * 0.8}L0 ${-tall}L0.08 ${-tall * 0.8}L0.22 0Z`);
          strokePath(m, alpha(hi, 0.8), 0.04, `M0 0L0 ${-tall * 0.9}`);
        });
      }
      // a glint travelling round the band
      const gu = (t * 0.25) % 1;
      for (let k = -6; k <= 6; k++) { const p = at(s, r, gu + k * 0.004); disc(c, p.x, p.y, w * (0.5 - Math.abs(k) * 0.07), alpha(hi, 0.35 * I)); }
      // drifting snow
      for (let i = 0; i < 22; i++) {
        const life = (t * 0.35 + hash(i * 7)) % 1, u = hash(i * 3);
        motif(c, s, r, u + life * 0.03, 1, w * (0.2 + life * 2.8), (m) => STAR4(m, alpha(hi, (1 - life) * 0.9 * I), w * 0.13));
      }
      break;
    }
    case "lightning": {
      c.shadowColor = mid; c.shadowBlur = w * 1.2 * I;
      band(c, s, r, w * 0.3, alpha(mid, 0.35 + 0.25 * Math.sin(t * 20)));
      const tick = Math.floor(t * 14), arcs = 2 + Math.round(4 * I);
      for (let k = 0; k < arcs; k++) {
        const seed = tick * 31 + k * 7, u0 = hash(seed), span = 0.05 + hash(seed + 1) * 0.12;
        c.beginPath();
        for (let j = 0; j <= 10; j++) {
          const u = u0 + (span * j) / 10, p = at(s, r, u), jit = j === 0 || j === 10 ? 0 : (hash(seed + j * 3) - 0.3) * w * 2.4 * I;
          if (j) c.lineTo(p.x + p.nx * jit, p.y + p.ny * jit); else c.moveTo(p.x, p.y);
        }
        c.strokeStyle = alpha(hi, 0.95); c.lineWidth = w * 0.14; c.lineJoin = "round"; c.stroke();
        c.strokeStyle = alpha(mid, 0.6); c.lineWidth = w * 0.35; c.stroke();
      }
      break;
    }
    case "thunder": {
      for (let k = 0; k < 3; k++) {
        const life = (t * 0.7 + k / 3) % 1;
        c.lineWidth = w * (0.5 - life * 0.35); c.strokeStyle = alpha(k % 2 ? mid : hi, (1 - life) * 0.8 * I);
        tracePath(c, s, r, w * 0.4 + life * w * 3.2 * I); c.stroke();
      }
      const boom = Math.max(0, Math.sin(t * Math.PI * 0.7)) ** 8;
      band(c, s, r, w * (0.6 + boom * 0.6), alpha(lo, 0.5 + boom * 0.4));
      break;
    }
    case "acid": {
      band(c, s, r, w * 0.9, alpha(mid, 0.55 * I));
      for (let k = 0; k < 3; k++) { const ph = t * 1.4 + k * 2.1; tracePath(c, s, r, w * (0.15 + 0.25 * Math.sin(ph))); c.strokeStyle = alpha(k ? mid : hi, 0.35 * I); c.lineWidth = w * 0.18; c.stroke(); }
      for (let i = 0; i < 40; i++) {
        const u = hash(i * 2.3), life = (t * (0.35 + hash(i) * 0.3) + hash(i * 5)) % 1;
        const p = at(s, r, u); if (p.ny < -0.55) continue;
        const y = p.y + p.ny * w * 0.4 + life * w * 3.8 * I, x = p.x + p.nx * w * 0.4;
        c.beginPath(); const R = w * 0.42 * (1 - life * 0.35);
        c.moveTo(x, y - R * 2.2); c.quadraticCurveTo(x + R * 1.2, y - R * 0.2, x, y + R); c.quadraticCurveTo(x - R * 1.2, y - R * 0.2, x, y - R * 2.2);
        c.fillStyle = alpha(mid, (1 - life) * I); c.fill();
      }
      for (let i = 0; i < 18; i++) {
        const life = (t * 0.8 + hash(i * 11)) % 1, p = at(s, r, hash(i * 13)), o = (hash(i) - 0.5) * w * 0.6;
        c.beginPath(); c.arc(p.x + p.nx * o, p.y + p.ny * o, w * 0.08 + life * w * 0.25, 0, Math.PI * 2);
        c.strokeStyle = alpha(hi, (1 - life) * 0.9 * I); c.lineWidth = w * 0.06; c.stroke();
      }
      break;
    }
    case "poison": {
      for (let i = 0; i < 16; i++) {
        const life = (t * 0.25 + hash(i * 3)) % 1, u = hash(i * 17) + Math.sin(t * 0.5 + i) * 0.01;
        motif(c, s, r, u, 1, w * (0.3 + life * 2.2 * I), (m) => disc(m, Math.sin(life * 6 + i) * w * 0.4, 0, w * (0.45 + life * 0.8), alpha(mid, (1 - life) * 0.35 * I)));
      }
      for (let i = 0; i < 22; i++) {
        const life = (t * 0.5 + hash(i * 7)) % 1, u = hash(i * 23);
        motif(c, s, r, u, 1, w * (0.2 + life * 2.6 * I), (m) => { m.beginPath(); m.arc(Math.sin(life * 8 + i) * w * 0.25, 0, w * 0.24 * (0.6 + life), 0, Math.PI * 2); m.fillStyle = alpha(mid, (1 - life) * 0.75); m.fill(); m.strokeStyle = alpha(hi, (1 - life)); m.lineWidth = w * 0.06; m.stroke(); });
      }
      break;
    }
    case "necrotic": {
      c.shadowColor = mid; c.shadowBlur = w * 0.8 * I;
      band(c, s, r, w * 0.5, alpha(lo, 0.85));
      c.shadowBlur = 0;
      for (let i = 0; i < 30; i++) {
        const life = (t * 0.22 + hash(i * 5)) % 1, u = hash(i * 9) + t * 0.02 * (i % 2 ? 1 : -1);
        motif(c, s, r, u, 1, w * (0.2 + life * 2.4 * I), (m) => {
          m.rotate(life * 3 + i);
          m.beginPath(); m.ellipse(0, 0, w * (0.5 + life * 0.8), w * (0.22 + life * 0.3), 0, 0, Math.PI * 2);
          m.fillStyle = alpha(i % 3 ? mid : hi, (1 - life) * 0.45 * I); m.fill();
        });
      }
      for (let i = 0; i < 6; i++) { const life = (t * 0.4 + i / 6) % 1, p = at(s, r, hash(i * 31) + life * 0.05); disc(c, p.x + p.nx * w * life * 2, p.y + p.ny * w * life * 2, w * 0.08, alpha(hi, (1 - life) * I)); }
      break;
    }
    case "radiant": {
      const n = 16, rot = t * 0.15;
      c.globalCompositeOperation = "lighter";
      for (let i = 0; i < n; i++) {
        const len = w * (1.6 + 1.6 * I) * (i % 2 ? 0.6 : 1) * (0.85 + 0.15 * Math.sin(t * 3 + i));
        motif(c, s, r, i / n + rot, 1, w * 0.3, (m) => {
          const g = m.createLinearGradient(0, 0, 0, -len); g.addColorStop(0, alpha(mid, 0.8 * I)); g.addColorStop(1, alpha(hi, 0));
          fillPath(m, g, `M${-w * 0.28} 0L0 ${-len}L${w * 0.28} 0Z`);
        });
      }
      c.shadowColor = mid; c.shadowBlur = w * 1.5 * I;
      band(c, s, r, w * 0.45, alpha(hi, 0.7 + 0.3 * Math.sin(t * 2.5)));
      break;
    }
    case "psychic": {
      for (let k = 0; k < 3; k++) {
        c.beginPath();
        const N = 360, ph = t * (1.5 + k * 0.6) + k * 2, amp = w * (0.25 + 0.45 * I), base = w * (0.7 + k * 0.7);
        for (let i = 0; i <= N; i++) { const u = i / N, p = at(s, r, u), off = base + Math.sin(u * Math.PI * 2 * (7 + k * 3) + ph) * amp; if (i) c.lineTo(p.x + p.nx * off, p.y + p.ny * off); else c.moveTo(p.x + p.nx * off, p.y + p.ny * off); }
        c.closePath(); c.strokeStyle = alpha([hi, mid, lo][k], 0.75 - k * 0.15); c.lineWidth = w * (0.16 - k * 0.03); c.stroke();
      }
      for (let i = 0; i < 4; i++) { const life = (t * 0.5 + i / 4) % 1; motif(c, s, r, (i / 4 + t * 0.05) % 1, w, w * 1.6, (m) => { m.globalAlpha = Math.sin(life * Math.PI) * I; EYE(m, alpha(hi, 0.9), mid); }); }
      break;
    }
    case "force": {
      const n = Math.max(12, Math.round(L / (w * 1.1)));
      for (let i = 0; i < n; i++) {
        const pulse = Math.max(0, Math.sin(t * 3 - i * 0.6)) ** 3;
        motif(c, s, r, i / n, w, w * 0.15, (m) => { m.beginPath(); for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3 + Math.PI / 6; m.lineTo(Math.cos(a) * 0.55, Math.sin(a) * 0.55); } m.closePath(); m.fillStyle = alpha(mid, 0.12 + pulse * 0.5 * I); m.fill(); m.strokeStyle = alpha(hi, 0.4 + pulse * 0.6); m.lineWidth = 0.06; m.stroke(); });
      }
      c.shadowColor = mid; c.shadowBlur = w * I;
      tracePath(c, s, r, w * (0.9 + Math.sin(t * 2) * 0.15)); c.strokeStyle = alpha(mid, 0.5 * I); c.lineWidth = w * 0.1; c.stroke();
      break;
    }
    case "bludgeoning": {
      const beat = (t * 0.8) % 1, hit = Math.max(0, 1 - beat * 3);
      band(c, s, r, w * (0.9 + hit * 0.6), alpha(mid, 0.55 + hit * 0.45));
      for (let i = 0; i < 6; i++) { const p = at(s, r, hash(i * 3 + Math.floor(t * 0.8) * 7)); c.beginPath(); c.moveTo(p.x, p.y); let x = p.x, y = p.y; for (let j = 1; j <= 3; j++) { x += p.nx * w * 0.7 + (hash(i * 9 + j) - 0.5) * w * 0.8; y += p.ny * w * 0.7 + (hash(i * 5 + j) - 0.5) * w * 0.8; c.lineTo(x, y); } c.strokeStyle = alpha(lo, (0.4 + hit * 0.6) * I); c.lineWidth = w * 0.12; c.stroke(); }
      c.lineWidth = w * 0.2 * (1 - beat); c.strokeStyle = alpha(hi, (1 - beat) * 0.8 * I); tracePath(c, s, r, w * 0.5 + beat * w * 2.6 * I); c.stroke();
      for (let i = 0; i < 18; i++) {
        const u = hash(i * 7 + Math.floor(t * 0.8)), life = beat;
        motif(c, s, r, u, 1, w * (0.4 + life * 2 * I), (m) => fillPath(m, alpha(lo, (1 - life) * 0.9), `M0 ${-w * 0.15}L${w * 0.12} 0L0 ${w * 0.15}L${-w * 0.12} 0Z`));
      }
      break;
    }
    case "piercing": {
      const n = 3 + Math.round(5 * I);
      for (let i = 0; i < n; i++) {
        const u = (i / n + t * 0.18) % 1;
        motif(c, s, r, u, w, w * 0.9, (m) => {
          m.rotate(Math.PI / 2);
          strokePath(m, alpha(lo, 0.9), 0.14, "M-1.8 0L0.6 0");
          fillPath(m, hi, "M0.5 -0.35L1.3 0L0.5 0.35Z");
          for (let k = 1; k <= 4; k++) strokePath(m, alpha(mid, 0.5 - k * 0.1), 0.1, `M${-1.8 - k * 0.5} 0L${-1.6 - k * 0.5} 0`);
          fillPath(m, mid, "M-1.8 0L-2.2 -0.32L-1.5 -0.32L-1.3 0L-1.5 0.32L-2.2 0.32Z");
        });
      }
      break;
    }
    case "slashing": {
      for (let k = 0; k < 3 + Math.round(4 * I); k++) {
        const cyc = t * 1.1 + k * 0.29, idx = Math.floor(cyc), life = cyc - idx, u0 = hash(idx * 13 + k * 5);
        if (life > 0.7) continue;
        const prog = Math.min(1, life / 0.25), fade = life < 0.25 ? 1 : 1 - (life - 0.25) / 0.45;
        c.beginPath();
        const span = 0.12, N = 24;
        for (let j = 0; j <= N * prog; j++) { const q = j / N, p = at(s, r, u0 + q * span), off = w * (0.3 + Math.sin(q * Math.PI) * 1.6); if (j) c.lineTo(p.x + p.nx * off, p.y + p.ny * off); else c.moveTo(p.x + p.nx * off, p.y + p.ny * off); }
        c.strokeStyle = alpha(hi, fade); c.lineWidth = w * 0.18; c.lineCap = "round"; c.stroke();
        c.strokeStyle = alpha(mid, fade * 0.6); c.lineWidth = w * 0.45; c.stroke();
      }
      break;
    }
  }
  c.restore();
}

// ---- motion styles over the band ----

function drawMotion(c: Ctx, f: Frame, r: number, w: number, t: number) {
  const s = f.shape, I = 0.35 + f.intensity * 0.65;
  c.save();
  switch (f.motion) {
    case "glow": {
      const k = 0.5 + 0.5 * Math.sin(t * 2.4);
      c.shadowColor = f.color; c.shadowBlur = w * (1 + 2.5 * k) * I;
      band(c, s, r, w * 0.35, alpha(f.color, 0.4 + 0.5 * k)); band(c, s, r, w * 0.35, alpha(f.color, 0.3 + 0.4 * k));
      break;
    }
    case "pulse": {
      const k = 0.5 + 0.5 * Math.sin(t * 3);
      c.lineWidth = w * (0.2 + 0.3 * k); c.strokeStyle = alpha(f.color2, 0.6 + 0.3 * k);
      tracePath(c, s, r, w * (0.7 + k * 0.9 * I)); c.stroke();
      break;
    }
    case "flow":
    case "rainbow": {
      const cc = c as Ctx & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient };
      const rot = t * 0.9;
      let g: CanvasGradient;
      if (cc.createConicGradient) g = cc.createConicGradient(rot, 0, 0);
      else { g = c.createLinearGradient(Math.cos(rot) * -r, Math.sin(rot) * -r, Math.cos(rot) * r, Math.sin(rot) * r); }
      if (f.motion === "rainbow") for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, hsl(i * 30, 95, 60));
      else { g.addColorStop(0, f.color); g.addColorStop(0.5, f.color2); g.addColorStop(1, f.color); }
      c.globalAlpha = 0.55 + 0.45 * I;
      band(c, s, r, w * 0.8, g);
      break;
    }
    case "sparkle": {
      for (let i = 0; i < 18; i++) {
        const life = (t * 0.6 + hash(i * 3)) % 1, u = hash(i * 7 + Math.floor(t * 0.6 + hash(i * 3)) * 3);
        const k = Math.sin(life * Math.PI);
        motif(c, s, r, u, 1, (hash(i * 5) - 0.3) * w * 1.6, (m) => { m.rotate(life * 2); STAR4(m, alpha(i % 2 ? "#ffffff" : f.color, k * I), w * (0.2 + 0.25 * k)); });
      }
      break;
    }
    case "spin": {
      const L = outlineOf(s).len * r;
      c.setLineDash([w * 1.4, w * 1.0]); c.lineDashOffset = -t * w * 4;
      band(c, s, r, w * 0.45, f.color2);
      c.lineDashOffset = -t * w * 4 + w * 1.2; c.setLineDash([w * 0.5, w * 1.9]);
      band(c, s, r, w * 0.45, f.color);
      void L;
      break;
    }
  }
  c.restore();
}

// ---- normalising stored frames ----

const SHAPE_KEYS = new Set(SHAPES.map((x) => x.key));
const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d);

/** A frame from anything stored (style.frame), or null when there is none. */
export function normFrame(raw: unknown): Frame | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const design = typeof o.design === "string" && (DESIGN_BY_ID.has(o.design) || o.design === "none") ? o.design : "plain";
  return {
    v: 1,
    shape: SHAPE_KEYS.has(o.shape as Shape) ? (o.shape as Shape) : "circle",
    design,
    color: isHex(o.color) ? o.color : DEFAULT_FRAME.color,
    color2: isHex(o.color2) ? o.color2 : DEFAULT_FRAME.color2,
    width: clamp(o.width, 0.04, 0.3, DEFAULT_FRAME.width),
    effect: typeof o.effect === "string" && EFFECT_BY_ID.has(o.effect) ? o.effect : "",
    effectColor: isHex(o.effectColor) ? o.effectColor : null,
    motion: typeof o.motion === "string" && FRAME_MOTIONS.some((m) => m.id === o.motion) ? o.motion : "",
    speed: clamp(o.speed, 0.25, 3, 1),
    intensity: clamp(o.intensity, 0, 1, 0.7),
    importUrl: typeof o.importUrl === "string" && /^https:\/\//.test(o.importUrl) ? o.importUrl : null,
  };
}

export const frameMoves = (f: Frame) => !!(f.effect || f.motion);
export const designDefaults = (id: string) => { const d = DESIGN_BY_ID.get(id); return d ? { color: d.color, color2: d.color2 } : null; };

/** How far past r the frame can reach, as a share of r (for sizing exports). */
export const frameReach = (f: Frame) => 1 + f.width * (f.effect ? 4.2 : 3.2);

// ---- the design cache (audit A7) ----
//
// A design does not move (only the "pulse" motion resizes it), yet the tabletop redraws every framed
// token on every animation frame. So a design is drawn once per look and size onto an offscreen canvas
// and stamped from there; effects, motion and imported borders stay live on top. Sizes are rounded up to
// steps of about 19% in screen pixels, so zooming reuses a few bitmaps instead of making one per frame,
// and the bitmap is only ever drawn a little smaller than it was made (never blurred upward).

type Cached = { cv: HTMLCanvasElement | OffscreenCanvas; R: number; half: number };
const designCache = new Map<string, Cached>();
const CACHE_MAX = 96;

function designBitmap(d: DesignDef, f: Frame, devR: number): Cached | null {
  if (!(devR >= 6 && devR <= 900)) return null;
  const R = Math.pow(2, Math.ceil(Math.log2(devR) * 4) / 4);
  const key = `${d.id}|${f.shape}|${f.color}|${f.color2}|${f.width}|${R.toFixed(2)}`;
  const hit = designCache.get(key);
  if (hit) { designCache.delete(key); designCache.set(key, hit); return hit; }
  const half = Math.ceil(R * (1 + f.width * 4) + 6);
  let cv: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== "undefined") cv = new OffscreenCanvas(half * 2, half * 2);
  else if (typeof document !== "undefined") { cv = document.createElement("canvas"); cv.width = half * 2; cv.height = half * 2; }
  else return null;
  const c = cv.getContext("2d") as Ctx | null;
  if (!c) return null;
  c.translate(half, half);
  d.draw(c, f.shape, R, Math.max(1, R * f.width), f.color, f.color2);
  const made = { cv, R, half };
  designCache.set(key, made);
  if (designCache.size > CACHE_MAX) { const first = designCache.keys().next().value; if (first !== undefined) designCache.delete(first); }
  return made;
}

/**
 * Draws a frame centred on the origin around a portrait of radius r. `time` is in seconds; pass 0 to
 * draw it still (reduced motion, thumbnails). `image` resolves the imported border's URL, if any.
 * `live` draws the design straight onto c instead of from the cache (exports, where size is exact).
 */
export function drawFrame(c: Ctx, f: Frame, r: number, time: number, image?: (url: string) => CanvasImageSource | null, live = false) {
  const w = Math.max(1, r * f.width), t = time * f.speed;
  c.save();
  if (f.design !== "none") {
    const d = DESIGN_BY_ID.get(f.design) ?? DESIGNS[0];
    let ww = w;
    if (f.motion === "pulse") ww = w * (1 + 0.08 * Math.sin(t * 3));
    const m = !live && f.motion !== "pulse" && typeof c.getTransform === "function" ? c.getTransform() : null;
    const bm = m ? designBitmap(d, f, r * Math.hypot(m.a, m.b)) : null;
    if (bm) { const k = r / bm.R; c.drawImage(bm.cv, -bm.half * k, -bm.half * k, bm.half * 2 * k, bm.half * 2 * k); }
    else d.draw(c, f.shape, r, ww, f.color, f.color2);
  }
  if (f.motion) drawMotion(c, f, r, w, t);
  if (f.effect) drawEffect(c, f, r, w, t);
  if (f.importUrl && image) {
    const im = image(f.importUrl);
    if (im) { const R = r * (1 + f.width * 1.6); c.drawImage(im, -R, -R, R * 2, R * 2); }
  }
  c.restore();
}

/** Clips to the frame's shape at radius r (call between save and restore). */
export function clipToShape(c: Ctx, shape: Shape, r: number) { tracePath(c, shape, r); c.clip(); }
