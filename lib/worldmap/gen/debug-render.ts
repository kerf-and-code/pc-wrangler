// lib/worldmap/gen/debug-render.ts
// A raw-field debug renderer for 6a: draws the generated Fields to a 2D context, one flat hex per
// cell, coloured by the chosen field. Not the product renderer, just an eyeball tool for the passes.

import { type Fields } from "./types";
import { hexToPixel, hexCorners, gridPixelSize } from "../layout";

export type DebugMode = "elevation" | "terrain" | "temperature" | "moisture" | "rivers" | "landmass";

const OCEAN = "#20476b";
const SQRT3 = Math.sqrt(3);
const BANDS = ["#8bbf6a", "#b7b06a", "#a8905f", "#8f8f8f", "#ececec"]; // lowland..peak

function lerpHex(a: number[], b: number[], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function tempColor(t: number): string {
  if (t < 0.5) return lerpHex([40, 90, 160], [120, 190, 120], t * 2);
  return lerpHex([120, 190, 120], [200, 70, 50], (t - 0.5) * 2);
}
const PALETTE = ["#c85b5b", "#5bc87a", "#5b8bc8", "#c8a24b", "#a25bc8", "#4bc8c0", "#c87ba2", "#8ac85b"];

export function renderFields(f: Fields, ctx: CanvasRenderingContext2D, cw: number, ch: number, mode: DebugMode): void {
  const gb = gridPixelSize(f.width, f.height, 1);
  const scale = Math.min(cw / gb.w, ch / gb.h);
  const ox = -SQRT3 / 2, oy = -1; // grid origin at unit hex size
  ctx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);

  for (let row = 0; row < f.height; row++) {
    for (let col = 0; col < f.width; col++) {
      const i = row * f.width + col;
      let fill = OCEAN;
      if (!f.land[i]) {
        if (mode === "elevation") fill = f.elevation[i] < f.seaLevel * 0.5 ? "#16324c" : OCEAN;
        else if (f.shallows[i]) fill = "#2e628a";
        else fill = OCEAN;
      } else if (mode === "elevation") {
        fill = lerpHex([70, 120, 70], [245, 245, 245], Math.min(1, Math.max(0, (f.elevation[i] - f.seaLevel) / (1 - f.seaLevel))));
      } else if (mode === "terrain") {
        fill = f.coast[i] ? "#d8c48a" : BANDS[f.elevBand[i]];
      } else if (mode === "temperature") {
        fill = tempColor(f.temperature[i]);
      } else if (mode === "moisture") {
        fill = lerpHex([200, 170, 110], [40, 130, 130], f.moisture[i]);
      } else if (mode === "rivers") {
        fill = f.lake[i] ? "#2f6fb0" : f.coast[i] ? "#d8c48a" : BANDS[f.elevBand[i]];
      } else {
        fill = f.landmassId[i] >= 0 ? PALETTE[f.landmassId[i] % PALETTE.length] : "#333";
      }
      const c = hexToPixel(col, row, 1);
      const pts = hexCorners(c, 1);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < 6; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }

  if (mode === "rivers") {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#2f6fb0";
    for (const r of f.rivers) {
      if (r.path.length < 2) continue;
      ctx.lineWidth = r.width >= 2 ? 1.5 : 0.7;
      ctx.beginPath();
      for (let k = 0; k < r.path.length; k++) {
        const idx = r.path[k];
        const p = hexToPixel(idx % f.width, (idx / f.width) | 0, 1);
        if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
