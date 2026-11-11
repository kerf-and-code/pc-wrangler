// lib/tabletop/effects.ts (2026-11-07)
//
// Phase 4e: animated effects on the tabletop, drawn by the table itself (no art to license): fire,
// cold, acid, lightning, poison, darkness, fog, radiant and necrotic. An effect fills an area template
// or surrounds a token (p114).
//
// Every particle is a pure function of (effect seed, particle number, time), so nothing is stored
// between frames, a redraw at any moment is correct, and every screen at the table animates alike.
// The region comes in as a path to clip to plus its bounding box, in canvas pixels. With reduced motion
// the effect is drawn still (time held at zero).

import { templateOutline, type TemplateGeom } from "@/lib/tabletop/geometry";

export type EffectKind = "fire" | "cold" | "acid" | "lightning" | "poison" | "darkness" | "fog" | "radiant" | "necrotic";

export const EFFECTS: { key: EffectKind; label: string; color: string }[] = [
  { key: "fire", label: "Fire", color: "#ff7a2a" },
  { key: "cold", label: "Cold", color: "#9fd6ff" },
  { key: "acid", label: "Acid", color: "#8fe04a" },
  { key: "lightning", label: "Lightning", color: "#b9c6ff" },
  { key: "poison", label: "Poison", color: "#6fae3a" },
  { key: "darkness", label: "Darkness", color: "#1a1424" },
  { key: "fog", label: "Fog", color: "#c9ccd6" },
  { key: "radiant", label: "Radiant", color: "#ffe08a" },
  { key: "necrotic", label: "Necrotic", color: "#7a3d8f" },
];
export const EFFECT_KEYS = new Set<string>(EFFECTS.map((e) => e.key));
export const isEffect = (k: unknown): k is EffectKind => typeof k === "string" && EFFECT_KEYS.has(k);

/** Effects that shed light (push 28, V2): fire and radiant, in feet past the area's edge, bright then
 *  dim. A brazier (a 5 ft square of fire) lights about as far as a torch. */
export const EFFECT_LIGHT: Partial<Record<EffectKind, { bright: number; dim: number }>> = {
  fire: { bright: 10, dim: 10 },
  radiant: { bright: 5, dim: 10 },
};

/** A burning or radiant template as a light source, in squares, the shape lib/tabletop/sight.ts takes
 *  (before its visibility polygon): centred in the middle of the area, bright out to the area's
 *  farthest edge plus the effect's bright light, dim beyond. A round light from the middle is a fair
 *  stand-in for a cone or a line, which are rarely left burning on a map. Null for any other effect. */
export function templateLight(t: TemplateGeom & { effect?: string | null }, fps: number): { x: number; y: number; bright: number; r: number } | null {
  if (!isEffect(t.effect)) return null;
  const l = EFFECT_LIGHT[t.effect];
  if (!l) return null;
  const f = fps > 0 ? fps : 5;
  const pts = templateOutline(t, f);
  if (!pts.length) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const reach = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  return { x: cx, y: cy, bright: reach + l.bright / f, r: reach + (l.bright + l.dim) / f };
}

export type EffectRegion = { path: (ctx: CanvasRenderingContext2D) => void; x: number; y: number; w: number; h: number };

// A small, fast, repeatable random number in [0, 1) from two integers.
export function rnd(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// How many particles for a region, by its area in squares: enough to read, capped for speed.
export function particleCount(w: number, h: number, cell: number, perSquare: number, max: number): number {
  const squares = (w * h) / Math.max(1, cell * cell);
  return Math.max(10, Math.min(max, Math.round(squares * perSquare)));
}

const blob = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, inner: string, outer: string) => {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
};

export function drawEffect(ctx: CanvasRenderingContext2D, kind: EffectKind, reg: EffectRegion, timeSec: number, seed: number, cell: number) {
  const t = timeSec, { x, y, w, h } = reg;
  if (w <= 0 || h <= 0) return;
  ctx.save();
  reg.path(ctx); ctx.clip();
  const R = (i: number, k: number) => rnd(seed + k * 7919, i);
  const tint = (c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  switch (kind) {
    case "fire": {
      tint("rgba(255,96,24,0.16)");
      ctx.globalCompositeOperation = "lighter";
      const n = particleCount(w, h, cell, 9, 220);
      for (let i = 0; i < n; i++) {
        const sp = 0.6 + R(i, 1) * 0.8, ph = (t * sp + R(i, 2)) % 1;
        const bx = x + R(i, 3) * w, by = y + R(i, 4) * h;
        const px = bx + Math.sin(t * 3 + i) * cell * 0.08, py = by - ph * cell * 0.9;
        const r = cell * (0.06 + 0.2 * (1 - ph));
        const a = 0.55 * (1 - ph);
        blob(ctx, px, py, r, `rgba(255,${Math.round(200 - 140 * ph)},40,${a})`, "rgba(255,40,0,0)");
      }
      break;
    }
    case "cold": {
      tint("rgba(150,210,255,0.18)");
      const n = particleCount(w, h, cell, 6, 160);
      for (let i = 0; i < n; i++) {
        const ph = (t * (0.08 + R(i, 1) * 0.1) + R(i, 2)) % 1;
        const px = x + ((R(i, 3) * w + Math.sin(t + i) * cell * 0.2) % w + w) % w, py = y + ph * h;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i));
        ctx.fillStyle = `rgba(235,248,255,${0.75 * tw})`;
        ctx.beginPath(); ctx.arc(px, py, cell * (0.03 + 0.04 * R(i, 4)), 0, Math.PI * 2); ctx.fill();
        if (i % 9 === 0) {
          ctx.strokeStyle = `rgba(255,255,255,${0.6 * tw})`; ctx.lineWidth = Math.max(1, cell * 0.02);
          const s = cell * 0.1; ctx.beginPath(); ctx.moveTo(px - s, py); ctx.lineTo(px + s, py); ctx.moveTo(px, py - s); ctx.lineTo(px, py + s); ctx.stroke();
        }
      }
      break;
    }
    case "acid": {
      tint("rgba(120,220,60,0.2)");
      const n = particleCount(w, h, cell, 3, 90);
      for (let i = 0; i < n; i++) {
        const ph = (t * (0.4 + R(i, 1) * 0.5) + R(i, 2)) % 1;
        const px = x + R(i, 3) * w, py = y + R(i, 4) * h, r = cell * (0.05 + 0.18 * ph);
        ctx.strokeStyle = `rgba(200,255,120,${0.8 * (1 - ph)})`; ctx.lineWidth = Math.max(1, cell * 0.03);
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(150,240,70,${0.25 * (1 - ph)})`; ctx.fill();
      }
      break;
    }
    case "lightning": {
      tint("rgba(150,170,255,0.1)");
      const frame = Math.floor(t / 0.14), flash = 0.5 + 0.5 * rnd(seed, frame);
      ctx.globalCompositeOperation = "lighter";
      const bolts = Math.max(2, Math.min(7, Math.round((w * h) / (cell * cell) / 6)));
      for (let b = 0; b < bolts; b++) {
        const r = (k: number) => rnd(seed + frame * 131 + b * 17, k);
        let px = x + r(1) * w, py = y + r(2) * h;
        const ex = x + r(3) * w, ey = y + r(4) * h, steps = 7;
        ctx.beginPath(); ctx.moveTo(px, py);
        for (let s = 1; s <= steps; s++) {
          const f = s / steps;
          px = px + (ex - px) / (steps - s + 1) + (r(10 + s) - 0.5) * cell * 0.5;
          py = py + (ey - py) / (steps - s + 1) + (r(30 + s) - 0.5) * cell * 0.5;
          ctx.lineTo(f === 1 ? ex : px, f === 1 ? ey : py);
        }
        ctx.strokeStyle = `rgba(120,140,255,${0.35 * flash})`; ctx.lineWidth = Math.max(3, cell * 0.14); ctx.stroke();
        ctx.strokeStyle = `rgba(245,248,255,${0.9 * flash})`; ctx.lineWidth = Math.max(1, cell * 0.04); ctx.stroke();
      }
      break;
    }
    case "poison": {
      tint("rgba(90,150,40,0.22)");
      const n = particleCount(w, h, cell, 1.2, 40);
      for (let i = 0; i < n; i++) {
        const a = t * (0.15 + R(i, 1) * 0.2) + R(i, 2) * 6.28;
        const px = x + R(i, 3) * w + Math.cos(a) * cell * 0.5, py = y + R(i, 4) * h + Math.sin(a) * cell * 0.4;
        blob(ctx, px, py, cell * (0.6 + R(i, 5) * 0.8), "rgba(140,200,60,0.28)", "rgba(80,140,30,0)");
      }
      break;
    }
    case "darkness": {
      tint("rgba(6,4,12,0.86)");
      const n = particleCount(w, h, cell, 0.8, 30);
      for (let i = 0; i < n; i++) {
        const a = t * (0.1 + R(i, 1) * 0.15) + R(i, 2) * 6.28;
        const px = x + R(i, 3) * w + Math.cos(a) * cell * 0.6, py = y + R(i, 4) * h + Math.sin(a) * cell * 0.6;
        blob(ctx, px, py, cell * (0.8 + R(i, 5)), "rgba(0,0,0,0.5)", "rgba(0,0,0,0)");
      }
      break;
    }
    case "fog": {
      tint("rgba(205,208,218,0.38)");
      const n = particleCount(w, h, cell, 1, 36);
      for (let i = 0; i < n; i++) {
        const drift = ((R(i, 3) * w + t * cell * (0.15 + R(i, 1) * 0.2)) % (w + cell * 2)) - cell;
        blob(ctx, x + drift, y + R(i, 4) * h, cell * (0.7 + R(i, 5) * 0.9), "rgba(240,242,248,0.35)", "rgba(240,242,248,0)");
      }
      break;
    }
    case "radiant": {
      tint("rgba(255,228,140,0.16)");
      ctx.globalCompositeOperation = "lighter";
      const cx = x + w / 2, cy = y + h / 2, reach = Math.hypot(w, h) / 2, rays = 12;
      for (let k = 0; k < rays; k++) {
        const a = t * 0.25 + (k / rays) * Math.PI * 2;
        const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
        g.addColorStop(0, "rgba(255,240,180,0.22)"); g.addColorStop(1, "rgba(255,240,180,0)");
        ctx.strokeStyle = g; ctx.lineWidth = cell * 0.35;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach); ctx.stroke();
      }
      const n = particleCount(w, h, cell, 4, 120);
      for (let i = 0; i < n; i++) {
        const ph = (t * (0.3 + R(i, 1) * 0.4) + R(i, 2)) % 1;
        blob(ctx, x + R(i, 3) * w, y + R(i, 4) * h - ph * cell * 0.6, cell * 0.09, `rgba(255,250,210,${0.8 * Math.sin(ph * Math.PI)})`, "rgba(255,230,120,0)");
      }
      break;
    }
    case "necrotic": {
      tint("rgba(50,16,60,0.32)");
      const n = particleCount(w, h, cell, 4, 130);
      for (let i = 0; i < n; i++) {
        const ph = (t * (0.15 + R(i, 1) * 0.2) + R(i, 2)) % 1;
        const px = x + R(i, 3) * w + Math.sin(t * 1.5 + i) * cell * 0.15, py = y + R(i, 4) * h + ph * cell * 0.8;
        const a = Math.sin(ph * Math.PI);
        if (i % 5 === 0) blob(ctx, px, py, cell * 0.08, `rgba(170,255,170,${0.5 * a})`, "rgba(80,200,90,0)");
        else blob(ctx, px, py, cell * 0.28, `rgba(90,30,110,${0.45 * a})`, "rgba(30,0,40,0)");
      }
      break;
    }
  }
  ctx.restore();
}
