// lib/worldmap/gen/pass4-temperature.ts
// Pass 4: temperature from latitude (cosine over the rows, using the row directly since pointy-top
// has no odd-q vertical stagger), an elevation lapse rate so peaks go cold even at the equator, and
// coastal moderation, then bands. Latitude window is config (latN/latS): a 100-row map defaults to a
// temperate-dominant band so biomes are not pole-to-equator stripes.

import { type Fields, type GenConfig } from "./types";

export function pass4Temperature(f: Fields, cfg: GenConfig): void {
  const { width: W, height: H } = f;
  const N = W * H;
  const { latN, latS, lapsePerBand } = cfg;

  // Base: cos(latitude), latitude linear across rows.
  const raw = new Float32Array(N);
  let mn = Infinity, mx = -Infinity;
  for (let row = 0; row < H; row++) {
    const lat = latN + (latS - latN) * (H > 1 ? row / (H - 1) : 0);
    const base = Math.cos((lat * Math.PI) / 180);
    for (let col = 0; col < W; col++) raw[row * W + col] = base;
    if (base < mn) mn = base;
    if (base > mx) mx = base;
  }
  const range = mx - mn || 1;
  const temp = f.temperature;
  for (let i = 0; i < N; i++) temp[i] = (raw[i] - mn) / range;

  // Lapse: colder per land band above lowland.
  for (let i = 0; i < N; i++) if (f.land[i]) temp[i] = Math.max(0, temp[i] - lapsePerBand * f.elevBand[i]);

  // Coastal moderation: land within 2 hops of ocean moves 25% toward the map median.
  const sorted = Float32Array.from(temp).sort();
  const median = sorted[sorted.length >> 1];
  const src = Float32Array.from(temp);
  for (let i = 0; i < N; i++) {
    if (f.land[i] && f.distToOcean[i] >= 0 && f.distToOcean[i] <= 2) temp[i] = src[i] + 0.25 * (median - src[i]);
  }
  for (let i = 0; i < N; i++) temp[i] = temp[i] < 0 ? 0 : temp[i] > 1 ? 1 : temp[i];

  // Bands: Polar / Cold / Temperate / Warm / Tropical.
  for (let i = 0; i < N; i++) {
    const t = temp[i];
    f.tempBand[i] = t <= 0.15 ? 0 : t <= 0.35 ? 1 : t <= 0.60 ? 2 : t <= 0.80 ? 3 : 4;
  }
}
