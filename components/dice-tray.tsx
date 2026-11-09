"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { IDENT, axisAngle, drawDie, mul, settleStep, solidFor, topFace, type M3, type Solid, type V3 } from "@/lib/tabletop/dice3d";

// components/dice-tray.tsx (2026-11-09)
//
// Phase 5z: 3D dice over the table. When a roll lands in chat (anyone's, as long as this person may see
// it: secret rolls never reach players at all), its dice are thrown in from the right, tumble, bounce
// off the edges and each other, slow down and come to rest showing what the server rolled. Then they
// fade. Dice that did not count (the low die of advantage, dropped dice) rest dimmed.
//
// Nothing here decides a result; it only shows one. Each person can turn the dice off (kept in this
// browser), and they never play when the device asks for reduced motion or the tab is hidden.

export type TrayDie = { sides: number; value: number; kept?: boolean };
export type DiceTrayApi = { play: (dice: TrayDie[], opts: { color: string; total?: number | null; label?: string }) => void };

const STORE = "sixaxes:dice3d";
/** Whether this person wants 3D dice (default yes), kept in this browser. */
export function useDiceSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => { try { if (window.localStorage.getItem(STORE) === "off") setOn(false); } catch { /* storage unavailable: default on */ } }, []);
  const set = useCallback((v: boolean) => { setOn(v); try { window.localStorage.setItem(STORE, v ? "on" : "off"); } catch { /* ignore */ } }, []);
  return [on, set];
}

export const DICE_COLORS = ["#d9a43a", "#7fc4ea", "#e07a70", "#7fcf7a", "#c79be0", "#f2e6c9", "#e8a0c8", "#9fb7c9"];
/** A steady colour for whoever rolled (the same person always gets the same colour). */
export function diceColor(seed: string): string {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return DICE_COLORS[Math.abs(h) % DICE_COLORS.length];
}

const MAX_DICE = 16;
const TUMBLE = 1.15, SETTLE = 0.35, HOLD = 2.4, FADE = 0.5;

type Part = "die" | "tens" | "ones";
type Die = {
  solid: Solid; sides: number; part: Part; label: string; finalLabel: string; dim: boolean;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  m: M3; spin: V3; spinRate: number; settled: boolean; topIdx: number; group: number;
};
type Group = { id: number; color: string; total: number | null; label: string; born: number; dice: Die[] };

/** The number a face shows while the die is still tumbling (any face, so it reads as rolling). */
function faceLabel(part: Part, sides: number, idx: number): string {
  if (part === "tens") return `${(idx % 10) * 10}`.padStart(2, "0");
  if (part === "ones") return `${idx % 10}`;
  return `${(idx % sides) + 1}`;
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export default function DiceTray({ api, enabled }: { api: { current: DiceTrayApi | null }; enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const groups = useRef<Group[]>([]);
  const raf = useRef<number | null>(null);
  const last = useRef(0);
  const size = useRef({ w: 0, h: 0 });
  const nextId = useRef(1);
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; if (!enabled) { groups.current = []; clear(canvasRef.current); } }, [enabled]);

  const frame = useCallback((now: number) => {
    const dt = Math.min(0.05, (now - last.current) / 1000 || 0.016); last.current = now;
    const c = canvasRef.current, ctx = c?.getContext("2d");
    if (!c || !ctx) { raf.current = null; return; }
    const { w, h } = size.current, dpr = window.devicePixelRatio || 1;
    const t = now / 1000;
    groups.current = groups.current.filter((g) => t - g.born < TUMBLE + SETTLE + HOLD + FADE + 1.2 || g.dice.some((d) => !d.settled));
    const all = groups.current.flatMap((g) => g.dice);

    // ---- move ----
    for (const d of all) {
      const g = groups.current.find((x) => x.id === d.group)!;
      const age = t - g.born, r = dieRadius(w, h, all.length);
      if (!d.settled) {
        // height: thrown up a little, falls, bounces lower each time
        d.vz -= 9 * dt; d.z += d.vz * dt;
        if (d.z < 0) { d.z = 0; d.vz = Math.abs(d.vz) > 0.6 ? -d.vz * 0.45 : 0; d.vx *= 0.86; d.vy *= 0.86; }
        const drag = d.z > 0 ? 0.25 : 1.9;
        d.vx *= Math.exp(-drag * dt); d.vy *= Math.exp(-drag * dt);
        d.x += d.vx * dt; d.y += d.vy * dt;
        // the edges of the table (the right edge only once the die has come in)
        if (d.x < r) { d.x = r; d.vx = Math.abs(d.vx) * 0.6; }
        if (d.x > w - r && d.vx > 0) { d.x = w - r; d.vx = -Math.abs(d.vx) * 0.6; }
        if (d.y < r) { d.y = r; d.vy = Math.abs(d.vy) * 0.6; }
        if (d.y > h - r) { d.y = h - r; d.vy = -Math.abs(d.vy) * 0.6; }
        // tumbling: rolls along the way it travels, plus a little wobble
        const sp = Math.hypot(d.vx, d.vy);
        if (age < TUMBLE) {
          const roll: V3 = sp > 1 ? [d.vy / sp, -d.vx / sp, 0] : [0, 0, 1];
          d.m = mul(axisAngle(roll, (sp / r) * dt * (d.z > 0 ? 0.6 : 1)), d.m);
          d.m = mul(axisAngle(d.spin, d.spinRate * dt), d.m);
          d.spinRate *= Math.exp(-1.2 * dt);
          const top = topFace(d.solid, d.m).face;
          if (top !== d.topIdx) { d.topIdx = top; d.label = faceLabel(d.part, d.sides, top); }
        } else {
          // come to rest: the face nearest the top turns up, showing the rolled number
          d.label = d.finalLabel;
          d.vx *= Math.exp(-8 * dt); d.vy *= Math.exp(-8 * dt);
          d.m = settleStep(d.solid, d.m, 1 - Math.exp(-14 * dt));
          if (age > TUMBLE + SETTLE) { d.settled = true; d.z = 0; d.m = settleStep(d.solid, d.m, 1); }
        }
      }
    }
    // dice knock each other aside
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j], r = dieRadius(w, h, all.length);
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 0.01, min = r * 1.85;
      if (dist >= min) continue;
      const nx = dx / dist, ny = dy / dist, push = (min - dist) / 2;
      if (!a.settled) { a.x -= nx * push; a.y -= ny * push; }
      if (!b.settled) { b.x += nx * push; b.y += ny * push; }
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) { a.vx += rel * nx * 0.9; a.vy += rel * ny * 0.9; b.vx -= rel * nx * 0.9; b.vy -= rel * ny * 0.9; }
    }

    // ---- draw ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pills: { x: number; y: number; w: number }[] = [];
    for (const g of groups.current) {
      const age = t - g.born, end = TUMBLE + SETTLE + HOLD;
      const alpha = age > end ? Math.max(0, 1 - (age - end) / FADE) : 1;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      const r0 = dieRadius(w, h, all.length);
      for (const d of g.dice) {
        const r = r0 * (1 + d.z * 0.35);
        // shadow on the table, further off the higher the die is
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath(); ctx.ellipse(d.x + r * 0.18 + d.z * r * 0.5, d.y + r * 0.3 + d.z * r * 0.6, r * 0.85, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        drawDie(ctx, d.solid, d.m, d.x, d.y, r, g.color, d.label, d.dim);
      }
      // once they rest: the total over the group
      if (g.dice.every((d) => d.settled) && g.total != null) {
        const mx = g.dice.reduce((a, d) => a + d.x, 0) / g.dice.length, top = Math.min(...g.dice.map((d) => d.y)) - r0 * 1.7;
        const text = `${g.label ? g.label + "  " : ""}${g.total}`;
        ctx.font = "700 14px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const tw = ctx.measureText(text).width + 18, px = Math.max(tw / 2 + 4, Math.min(w - tw / 2 - 4, mx));
        let py = Math.max(16, top);
        // two totals never sit on top of each other
        for (let k = 0; k < 8 && pills.some((q) => Math.abs(q.y - py) < 30 && Math.abs(q.x - px) < (q.w + tw) / 2 + 6); k++) py += 30;
        pills.push({ x: px, y: py, w: tw });
        ctx.fillStyle = "rgba(20,16,12,0.88)"; ctx.strokeStyle = g.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(px - tw / 2, py - 13, tw, 26, 13); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fbf3df"; ctx.fillText(text, px, py + 1);
      }
      ctx.globalAlpha = 1;
    }
    if (groups.current.length) raf.current = requestAnimationFrame(frame);
    else { raf.current = null; clear(c); }
  }, []);

  const play = useCallback<DiceTrayApi["play"]>((dice, opts) => {
    if (!enabledRef.current || document.hidden || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const { w, h } = size.current;
    if (!w || !h || !dice.length) return;
    // a d100 is two d10s: tens and ones
    const shown: { sides: number; final: string; kept: boolean; part: Part }[] = [];
    for (const d of dice) {
      const kept = d.kept !== false;
      if (d.sides === 100) {
        const v = d.value % 100;
        shown.push({ sides: 10, final: `${Math.floor(v / 10) * 10}`.padStart(2, "0"), kept, part: "tens" }, { sides: 10, final: `${v % 10}`, kept, part: "ones" });
      } else shown.push({ sides: d.sides, final: `${d.value}`, kept, part: "die" });
    }
    const list = shown.slice(0, MAX_DICE);
    // make room: the oldest rolls go first
    let count = groups.current.reduce((a, g) => a + g.dice.length, 0);
    while (groups.current.length && count + list.length > MAX_DICE) count -= groups.current.shift()!.dice.length;
    const id = nextId.current++, now = performance.now() / 1000, r = dieRadius(w, h, count + list.length);
    const g: Group = { id, color: opts.color, total: opts.total ?? null, label: (opts.label ?? "").slice(0, 24), born: now, dice: [] };
    list.forEach((s, i) => {
      const solid = solidFor(s.sides);
      let m = IDENT;
      for (let k = 0; k < 3; k++) m = mul(axisAngle([rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)], rnd(0, Math.PI * 2)), m);
      g.dice.push({
        solid, sides: s.sides, part: s.part, label: "", finalLabel: s.final, dim: !s.kept,
        x: w - r * (1 + (i % 3) * 0.4), y: h * rnd(0.4, 0.8), z: rnd(0.3, 0.7),
        vx: -w * rnd(0.5, 0.75), vy: -h * rnd(0.05, 0.4), vz: rnd(0.8, 1.6),
        m, spin: [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)], spinRate: rnd(6, 11), settled: false, topIdx: -1, group: id,
      });
    });
    groups.current.push(g);
    if (raf.current == null) { last.current = performance.now(); raf.current = requestAnimationFrame(frame); }
  }, [frame]);

  useEffect(() => { api.current = { play }; return () => { api.current = null; }; }, [api, play]);

  // keep the canvas the size of the table, sharp on high density screens
  useEffect(() => {
    const c = canvasRef.current; const host = c?.parentElement;
    if (!c || !host) return;
    const fitSize = () => {
      const rect = host.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      size.current = { w: rect.width, h: rect.height };
      c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr);
    };
    fitSize();
    const ro = new ResizeObserver(fitSize); ro.observe(host);
    return () => { ro.disconnect(); if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; };
  }, []);

  return <canvas ref={canvasRef} aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 4 }} />;
}

function clear(c: HTMLCanvasElement | null) {
  const ctx = c?.getContext("2d");
  if (c && ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); }
}

function dieRadius(w: number, h: number, n: number): number {
  const base = Math.max(20, Math.min(40, Math.min(w, h) * 0.065));
  return n > 8 ? base * 0.75 : n > 4 ? base * 0.88 : base;
}
