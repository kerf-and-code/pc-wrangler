// lib/tabletop/dice3d.ts (2026-11-09)
//
// 3D dice for rolls at the tabletop (phase 5z, gap 10 in the tabletop audit doc). No library and no
// art: each die is its real solid (d4 tetrahedron, d6 cube, d8 octahedron, d10 pentagonal
// trapezohedron, d12 dodecahedron, d20 icosahedron; a d100 is drawn as a d10), shaded flat and drawn on
// a 2D canvas. The SERVER rolls (lib/dice); these only show it: they tumble, bounce, slow down, turn a
// face up, and that face shows the number the server rolled.
//
// The faces are not typed in: they are the convex hull of each solid's corners, found once, so every
// face is exactly flat and every die has the right number of faces (checked in tests/dice3d.test.ts).

export type V3 = [number, number, number];
export type Solid = { verts: V3[]; faces: number[][] };

const PHI = (1 + Math.sqrt(5)) / 2;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The faces of the convex hull of a set of points: each a list of corner indices, in order around it. */
export function hullFaces(verts: V3[]): number[][] {
  const n = verts.length, seen = new Set<string>(), faces: number[][] = [];
  const c: V3 = [0, 0, 0]; for (const v of verts) { c[0] += v[0] / n; c[1] += v[1] / n; c[2] += v[2] / n; }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    let nr = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
    if (Math.hypot(nr[0], nr[1], nr[2]) < 1e-9) continue;
    nr = norm(nr);
    if (dot(nr, sub(c, verts[i])) > 0) nr = [-nr[0], -nr[1], -nr[2]];         // point outward
    const d = dot(nr, verts[i]);
    let ok = true; const on: number[] = [];
    for (let m = 0; m < n; m++) {
      const s = dot(nr, verts[m]) - d;
      if (s > 1e-6) { ok = false; break; }
      if (Math.abs(s) <= 1e-6) on.push(m);
    }
    if (!ok) continue;
    const key = on.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    // order the corners around the face's middle
    const fc: V3 = [0, 0, 0]; for (const m of on) { fc[0] += verts[m][0] / on.length; fc[1] += verts[m][1] / on.length; fc[2] += verts[m][2] / on.length; }
    const u = norm(sub(verts[on[0]], fc)), w = cross(nr, u);
    on.sort((a, b) => { const pa = sub(verts[a], fc), pb = sub(verts[b], fc); return Math.atan2(dot(pa, w), dot(pa, u)) - Math.atan2(dot(pb, w), dot(pb, u)); });
    faces.push(on);
  }
  return faces;
}

function d10Verts(): V3[] {
  // a pentagonal trapezohedron: two rings of five, offset by 36 degrees, and two tips placed so every
  // kite face is flat (tip = h (1 + cos 36) / (1 - cos 36))
  const h = 0.105, c36 = Math.cos(Math.PI / 5), tip = (h * (1 + c36)) / (1 - c36), out: V3[] = [[0, 0, tip], [0, 0, -tip]];
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5, b = a + Math.PI / 5;
    out.push([Math.cos(a), Math.sin(a), h], [Math.cos(b), Math.sin(b), -h]);
  }
  return out;
}

const RAW: Record<number, V3[]> = {
  4: [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
  6: [[-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1], [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]],
  8: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  10: d10Verts(),
  12: [
    ...[-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as V3))),
    ...[-1, 1].flatMap((a) => [-1, 1].map((b) => [0, a / PHI, b * PHI] as V3)),
    ...[-1, 1].flatMap((a) => [-1, 1].map((b) => [a / PHI, b * PHI, 0] as V3)),
    ...[-1, 1].flatMap((a) => [-1, 1].map((b) => [a * PHI, 0, b / PHI] as V3)),
  ],
  20: [
    ...[-1, 1].flatMap((a) => [-1, 1].map((b) => [0, a, b * PHI] as V3)),
    ...[-1, 1].flatMap((a) => [-1, 1].map((b) => [a, b * PHI, 0] as V3)),
    ...[-1, 1].flatMap((a) => [-1, 1].map((b) => [a * PHI, 0, b] as V3)),
  ],
};

const cache = new Map<number, Solid>();
/** The solid for a die of this many sides (scaled to fit a unit sphere). Unusual dice use a d20; d100 a d10. */
export function solidFor(sides: number): Solid {
  const key = sides === 100 ? 10 : RAW[sides] ? sides : 20;
  const hit = cache.get(key); if (hit) return hit;
  const raw = RAW[key], r = Math.max(...raw.map((v) => Math.hypot(v[0], v[1], v[2])));
  const verts = raw.map((v) => [v[0] / r, v[1] / r, v[2] / r] as V3);
  const s = { verts, faces: hullFaces(verts) };
  cache.set(key, s);
  return s;
}

// ---- rotation, as a 3x3 matrix (row major) ----
export type M3 = number[];
export const IDENT: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const apply = (m: M3, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export function mul(a: M3, b: M3): M3 {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
/** Rotation by angle (radians) about a unit axis. */
export function axisAngle(ax: V3, ang: number): M3 {
  const [x, y, z] = norm(ax), c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

/** The face turned most toward the viewer (+z) under rotation m, and how far it is from facing them. */
export function topFace(s: Solid, m: M3): { face: number; normal: V3 } {
  let best = 0, bz = -Infinity, bn: V3 = [0, 0, 1];
  s.faces.forEach((f, i) => {
    const a = apply(m, s.verts[f[0]]), b = apply(m, s.verts[f[1]]), c = apply(m, s.verts[f[2]]);
    let nr = norm(cross(sub(b, a), sub(c, a)));
    const mid = f.reduce<V3>((acc, k) => { const p = apply(m, s.verts[k]); return [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]]; }, [0, 0, 0]);
    if (dot(nr, mid) < 0) nr = [-nr[0], -nr[1], -nr[2]];
    if (nr[2] > bz) { bz = nr[2]; best = i; bn = nr; }
  });
  return { face: best, normal: bn };
}

/** A step of rotation that turns the top face toward the viewer (share 0..1 of the way). */
export function settleStep(s: Solid, m: M3, share: number): M3 {
  const { normal } = topFace(s, m);
  const ax = cross(normal, [0, 0, 1]), sin = Math.hypot(ax[0], ax[1], ax[2]);
  if (sin < 1e-6) return m;
  const ang = Math.atan2(sin, normal[2]) * share;
  return mul(axisAngle(ax, ang), m);
}

/**
 * Draws a die at (x, y) of radius r under rotation m: back faces skipped, the rest shaded by a light
 * from the upper left, edges inked, and the top face labelled.
 */
export function drawDie(ctx: CanvasRenderingContext2D, s: Solid, m: M3, x: number, y: number, r: number, color: string, label: string, dim = false) {
  const light = norm([-0.45, -0.6, 0.85]);
  const proj = s.verts.map((v) => apply(m, v));
  const shown: { pts: V3[]; shade: number; z: number }[] = [];
  for (const f of s.faces) {
    const pts = f.map((k) => proj[k]);
    let nr = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    const mid = pts.reduce<V3>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
    if (dot(nr, mid) < 0) nr = [-nr[0], -nr[1], -nr[2]];
    if (nr[2] <= 0.01) continue;
    shown.push({ pts, shade: 0.42 + 0.58 * Math.max(0, dot(nr, light)), z: mid[2] });
  }
  shown.sort((a, b) => a.z - b.z);
  const rgb = hexRgb(color);
  ctx.save();
  ctx.globalAlpha *= dim ? 0.45 : 1;
  ctx.lineJoin = "round"; ctx.lineWidth = Math.max(1, r * 0.04); ctx.strokeStyle = "rgba(20,16,12,0.85)";
  for (const f of shown) {
    ctx.beginPath();
    f.pts.forEach((p, i) => (i ? ctx.lineTo(x + p[0] * r, y + p[1] * r) : ctx.moveTo(x + p[0] * r, y + p[1] * r)));
    ctx.closePath();
    ctx.fillStyle = `rgb(${Math.round(rgb[0] * f.shade)},${Math.round(rgb[1] * f.shade)},${Math.round(rgb[2] * f.shade)})`;
    ctx.fill(); ctx.stroke();
  }
  // the number on the face toward the viewer
  const top = shown[shown.length - 1];
  if (top && label) {
    const cx = x + (top.pts.reduce((a, p) => a + p[0], 0) / top.pts.length) * r, cy = y + (top.pts.reduce((a, p) => a + p[1], 0) / top.pts.length) * r;
    const fs = r * (label.length > 2 ? 0.42 : label.length > 1 ? 0.55 : 0.68);
    ctx.font = `800 ${fs}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const light2 = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 140;
    ctx.lineWidth = Math.max(1.5, fs * 0.14); ctx.strokeStyle = light2 ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.6)";
    ctx.strokeText(label, cx, cy + fs * 0.04);
    ctx.fillStyle = light2 ? "#1b1712" : "#fbf3df"; ctx.fillText(label, cx, cy + fs * 0.04);
  }
  ctx.restore();
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); const n = m ? parseInt(m[1], 16) : 0xd9a43a;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
