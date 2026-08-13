// lib/worldmap/gen/pass12-pois.ts
// Pass 12: scatter generated POIs. Resource nodes are biome-locked; cave entrances go on rugged
// terrain (and always on crystal caverns) as POIs, never the Cave biome; dungeons are sampled from a
// remoteness x biome-weight distribution far from settlements, spaced apart; a few hazard zones use
// the same remoteness logic and may sit in fantasy regions. Faithful to the blueprint's Pass 12.

import { type Fields, type GenConfig, type GenPoi } from "./types";
import { hashSeed, passStream } from "./rng";
import { neighborsByDir } from "./grid";
import { offsetToAxial } from "../hex";

function hexDist(a: number, b: number, W: number): number {
  const pa = offsetToAxial(a % W, (a / W) | 0), pb = offsetToAxial(b % W, (b / W) | 0);
  const dq = pa.q - pb.q, dr = pa.r - pb.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function pass12Pois(f: Fields, cfg: GenConfig): void {
  const { width: W, height: H } = f;
  const N = W * H;
  const rnd = passStream(hashSeed(cfg.seed), "pois");
  const nb = new Int32Array(6);
  const pois: GenPoi[] = [];
  const occupied = new Uint8Array(N);
  for (const st of f.settlements) occupied[st.index] = 1;

  // distToSettlement (BFS over land).
  const distS = new Int32Array(N).fill(-1);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (const st of f.settlements) { distS[st.index] = 0; q[qt++] = st.index; }
  while (qh < qt) {
    const c = q[qh++];
    neighborsByDir(c % W, (c / W) | 0, W, H, nb);
    for (let d = 0; d < 6; d++) { const n = nb[d]; if (n < 0 || !f.land[n] || distS[n] >= 0) continue; distS[n] = distS[c] + 1; q[qt++] = n; }
  }
  const remoteOf = (i: number) => (distS[i] < 0 ? 10 : distS[i]);

  const mtnAdj = (i: number) => { neighborsByDir(i % W, (i / W) | 0, W, H, nb); for (let d = 0; d < 6; d++) { const n = nb[d]; if (n >= 0 && f.biome[n] === 20) return true; } return false; };
  const waterAdj = (i: number) => { if (f.river[i] || f.lake[i]) return true; neighborsByDir(i % W, (i / W) | 0, W, H, nb); for (let d = 0; d < 6; d++) { const n = nb[d]; if (n >= 0 && (f.lake[n] || f.river[n] || !f.land[n])) return true; } return false; };

  // Resource nodes (one per hex, priority order, density chance).
  const dens = cfg.resourceDensity;
  for (let i = 0; i < N; i++) {
    if (!f.land[i] || occupied[i]) continue;
    const b = f.biome[i];
    let kind: string | null = null;
    if ((f.elevBand[i] === 1 || f.elevBand[i] === 2) && mtnAdj(i)) kind = rnd() < 0.2 ? "gems" : "ore";
    else if (b === 3 || b === 4 || b === 5 || b === 6) kind = "lumber";
    else if ((b === 0 || b === 1 || b === 2) && distS[i] >= 0 && distS[i] <= 2) kind = "farmland";
    else if (b === 18 || waterAdj(i)) kind = "fishing";
    else if (b === 13 || b === 3 || b === 4 || b === 6) kind = "herbs";
    if (kind && rnd() < dens) { pois.push({ index: i, kind }); occupied[i] = 1; }
  }

  // Cave entrances (POIs, never the Cave biome). Crystal caverns always get one.
  for (let i = 0; i < N; i++) {
    if (!f.land[i]) continue;
    if (f.biome[i] === 26 && !occupied[i]) { pois.push({ index: i, kind: "cave" }); occupied[i] = 1; continue; }
    if (occupied[i]) continue;
    const elig = f.biome[i] === 20 || f.biome[i] === 11 || f.biome[i] === 22 || f.elevBand[i] === 1;
    if (!elig) continue;
    const remote = Math.min(1, remoteOf(i) / 12);
    if (rnd() < 0.03 + 0.05 * remote) { pois.push({ index: i, kind: "cave" }); occupied[i] = 1; }
  }

  // Dungeons: remoteness x biome weight, floor 6 from settlements, sampled w/o replacement, spaced.
  let landN = 0;
  for (let i = 0; i < N; i++) if (f.land[i]) landN++;
  const biomeWeight = (b: number) => {
    if (b === 20 || b === 11) return 3;
    if (b === 13 || b === 14) return 2.5;
    if (b === 8 || b === 9 || b === 22) return 2.5;
    if (b === 4 || b === 5 || b === 6) return 2;
    if (b === 0 || b === 1 || b === 2) return 0;
    return 1;
  };
  const cand: number[] = [], wts: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!f.land[i] || occupied[i]) continue;
    if (distS[i] >= 0 && distS[i] < 6) continue;
    const w = biomeWeight(f.biome[i]) * (1 + remoteOf(i) / 6);
    if (w <= 0) continue;
    cand.push(i); wts.push(w);
  }
  let totalW = 0; for (const w of wts) totalW += w;
  const placed: number[] = [];
  const sampleWeighted = (count: number, kind: string, spacing: number) => {
    let guard = 0;
    while (placed.length < count && totalW > 1e-9 && guard++ < count * 60) {
      let r = rnd() * totalW, pick = -1;
      for (let k = 0; k < cand.length; k++) { if (wts[k] <= 0) continue; r -= wts[k]; if (r <= 0) { pick = k; break; } }
      if (pick < 0) break;
      const idx = cand[pick];
      totalW -= wts[pick]; wts[pick] = 0;
      if (occupied[idx]) continue;
      let tooClose = false;
      for (const pd of placed) if (hexDist(idx, pd, W) < spacing) { tooClose = true; break; }
      if (tooClose) continue;
      pois.push({ index: idx, kind }); occupied[idx] = 1; placed.push(idx);
    }
  };
  const dungeonCount = Math.max(1, Math.floor(landN / cfg.dungeonPer));
  sampleWeighted(dungeonCount, "dungeon", cfg.dungeonMinSpacing);

  // Hazards: a few more from the same weighted pool (may overlap fantasy since occupancy allows it).
  const hazardTarget = placed.length + Math.max(0, Math.floor(dungeonCount / 3));
  sampleWeighted(hazardTarget, "hazard", cfg.dungeonMinSpacing);

  f.pois = pois;
}
