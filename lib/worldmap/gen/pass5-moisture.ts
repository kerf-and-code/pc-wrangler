// lib/worldmap/gen/pass5-moisture.ts
// Pass 5: moisture as a directional sweep (F8). The grid is traversed as exact hex lines along the
// wind direction; each line carries an air parcel that recharges over water and precipitates over
// land, extra on uplift (orographic rain on windward slopes). Rain shadow on the leeward side then
// emerges with no explicit rule, in O(n). River/lake adjacency bonuses come later (Pass 6).

import { type Fields, type GenConfig } from "./types";
import { neighborsByDir } from "./grid";

export function pass5Moisture(f: Fields, cfg: GenConfig): void {
  const { width: W, height: H } = f;
  const N = W * H;
  const d = ((cfg.windDir % 6) + 6) % 6;   // downwind direction
  const up = (d + 3) % 6;                   // upwind (opposite)
  const { cBase, pBase, pOro } = cfg;

  const raw = new Float32Array(N);
  const nb = new Int32Array(6);
  const visited = new Uint8Array(N);

  for (let start = 0; start < N; start++) {
    const scol = start % W, srow = (start / W) | 0;
    neighborsByDir(scol, srow, W, H, nb);
    if (nb[up] >= 0) continue; // not the upwind end of a line

    let cur = start, m = 0, prevBand = -1;
    while (cur >= 0 && !visited[cur]) {
      visited[cur] = 1;
      const c = cBase * (0.4 + 0.6 * f.temperature[cur]); // warm air holds more; cold polar air is dry
      if (!f.land[cur]) {
        m = c; // saturate: a full parcel leaves every coast
        prevBand = -1;
      } else {
        let precip = pBase * m;
        const band = f.elevBand[cur];
        if (prevBand >= 0 && band > prevBand) precip += pOro * (band - prevBand) * m; // orographic
        if (precip > m) precip = m;
        raw[cur] += precip;
        m -= precip;
        prevBand = band;
      }
      const cc = cur % W, cr = (cur / W) | 0;
      neighborsByDir(cc, cr, W, H, nb);
      cur = nb[d];
    }
  }

  // Light diffusion over land: the single-parcel sweep depletes big interiors to a flat mass of near
  // zeros that no normalization can spread. A few smoothing passes carry moisture inland as a
  // gradient with distinct values, while keeping windward wetter than leeward (the shadow survives).
  const nb2 = new Int32Array(6);
  // A distance-to-water base: deep interiors, which the single parcel leaves near zero, get a smooth
  // falloff from the nearest coast (never an exact-zero mass), so quantiles have distinct values to
  // split. Near coasts the sweep (with its rain shadow) dominates; far inland the gradient does.
  const scale = Math.max(W, H) / 5;
  for (let i = 0; i < N; i++) if (f.land[i]) raw[i] += 0.09 * Math.exp(-(f.distToOcean[i] < 0 ? 0 : f.distToOcean[i]) / scale);
  for (let iter = 0; iter < 2; iter++) {
    const next = Float32Array.from(raw);
    for (let i = 0; i < N; i++) {
      if (!f.land[i]) continue;
      const c = i % W, r = (i / W) | 0;
      neighborsByDir(c, r, W, H, nb2);
      let sum = 0, cnt = 0;
      for (let dd = 0; dd < 6; dd++) { const nn = nb2[dd]; if (nn >= 0 && f.land[nn]) { sum += raw[nn]; cnt++; } }
      if (cnt) next[i] = raw[i] * 0.55 + (sum / cnt) * 0.45;
    }
    raw.set(next);
  }

  // Normalize (min-max over land, now smooth) for the rainfall magnitude used by rivers + the view.
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < N; i++) if (f.land[i]) { if (raw[i] < mn) mn = raw[i]; if (raw[i] > mx) mx = raw[i]; }
  const range = mx - mn || 1;
  for (let i = 0; i < N; i++) {
    if (!f.land[i]) { f.moisture[i] = 1; continue; }
    f.moisture[i] = (raw[i] - mn) / range;
  }

  // Bands from quantiles of land moisture (like the elevation bands): guarantees a spread and makes
  // the rain shadow visible as bands (leeward ranks low = arid, windward high = humid), where a flat
  // value-threshold on an exponential field would read almost all land as arid.
  const lm: number[] = [];
  for (let i = 0; i < N; i++) if (f.land[i]) lm.push(f.moisture[i]);
  lm.sort((a, b) => a - b);
  const mq = (q: number) => (lm.length ? lm[Math.floor(q * (lm.length - 1))] : 0);
  const q12 = mq(0.12), q30 = mq(0.30), q55 = mq(0.55), q80 = mq(0.80);
  for (let i = 0; i < N; i++) {
    if (!f.land[i]) { f.moistureBand[i] = 4; continue; }
    const v = f.moisture[i];
    f.moistureBand[i] = v <= q12 ? 0 : v <= q30 ? 1 : v <= q55 ? 2 : v <= q80 ? 3 : 4;
  }
}
