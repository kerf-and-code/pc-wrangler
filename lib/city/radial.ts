// Radial city generator. Draws the city's "bones" - concentric district bands, ring roads, radial
// spokes, an optional walled edge with gates, a central landmark, an optional river - to an offscreen
// canvas and returns it as a control-image data URL. That image is the structural map the imagine
// route paints a genre city over, exactly as the hex terrain is for the world map. Client-only (uses
// a canvas). The colour choices ARE a legend the city prompt reads: gold = centerpiece, dark lines =
// streets, shaded bands = districts, brown = wall, blue = water.

export type Centerpiece = "castle" | "library" | "temple" | "plaza";

export type RadialOpts = {
  rings: number;        // 3..9 concentric ring roads
  spokes: number;       // 4..16 radial roads
  jitter: number;       // 0..0.6 irregularity
  centerpiece: Centerpiece;
  wall: boolean;
  river: boolean;
  seed: number;
  size?: number;        // px, square; default 1024
};

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateRadialCity(opts: RadialOpts): string {
  const size = opts.size ?? 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  drawRadial(ctx, size, opts);
  return canvas.toDataURL("image/png");
}

function drawRadial(ctx: CanvasRenderingContext2D, W: number, opts: RadialOpts): void {
  const { rings, spokes, jitter, centerpiece, wall, river, seed } = opts;
  const rng = mulberry32(seed);
  const cx = W / 2, cy = W / 2, maxR = W * 0.44, coreR = maxR * 0.07;

  ctx.fillStyle = "#e7dfce";
  ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = "#dcd3bd";
  ctx.beginPath(); ctx.arc(cx, cy, maxR * 1.02, 0, 7); ctx.fill();

  const radii: number[] = [];
  for (let i = 1; i <= rings; i++) {
    const b = coreR + (i / rings) * (maxR - coreR);
    radii.push(b * (1 + (rng() - 0.5) * jitter * 0.6));
  }
  const angles: number[] = [];
  for (let i = 0; i < spokes; i++) {
    angles.push((i / spokes) * Math.PI * 2 + (rng() - 0.5) * jitter * (Math.PI / spokes));
  }

  // district bands: darker (denser) toward the core
  for (let i = radii.length - 1; i >= 0; i--) {
    const t = 1 - i / radii.length;
    const v = Math.round(198 - t * 58);
    ctx.beginPath(); ctx.arc(cx, cy, radii[i], 0, 7);
    ctx.fillStyle = `rgb(${v},${v - 9},${v - 24})`; ctx.fill();
  }

  // building texture: little blocks, denser toward the core
  for (let k = 0; k < 2600; k++) {
    const a = rng() * Math.PI * 2;
    const rr = coreR + Math.pow(rng(), 0.7) * (maxR - coreR);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    const s = 2 + rng() * 4, g = 150 + ((rng() * 40) | 0);
    ctx.fillStyle = `rgba(${g},${g - 12},${g - 26},0.5)`;
    ctx.fillRect(x - s / 2, y - s / 2, s, s * (0.7 + rng() * 0.8));
  }

  if (river) {
    ctx.strokeStyle = "#5a86a8"; ctx.lineWidth = maxR * 0.05; ctx.lineCap = "round";
    const a0 = rng() * Math.PI * 2;
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 0.04) {
      const rr = s * maxR * 1.1, wob = Math.sin(s * 6 + seed) * maxR * 0.08;
      const x = cx + Math.cos(a0) * rr - Math.sin(a0) * wob;
      const y = cy + Math.sin(a0) * rr + Math.cos(a0) * wob;
      if (s === -1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // streets
  ctx.strokeStyle = "#4b4239"; ctx.lineWidth = W * 0.004;
  for (const r of radii) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); }
  for (const a of angles) {
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * coreR, cy + Math.sin(a) * coreR);
    ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
    ctx.stroke();
  }

  // walls with gates where the spokes cross
  if (wall) {
    ctx.strokeStyle = "#6b4f34"; ctx.lineWidth = W * 0.012;
    for (let i = 0; i < spokes; i++) {
      const a = angles[i];
      const a2 = angles[(i + 1) % spokes] + (i + 1 === spokes ? Math.PI * 2 : 0);
      const gate = (a2 - a) * 0.12;
      ctx.beginPath(); ctx.arc(cx, cy, maxR, a + gate, a2 - gate); ctx.stroke();
    }
  }

  // centerpiece (gold landmark)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#c9a24b"; ctx.strokeStyle = "#7a5f24"; ctx.lineWidth = 3;
  const R = coreR * 1.5;
  if (centerpiece === "castle") {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, rr = i % 2 ? R : R * 1.35;
      if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (centerpiece === "library") {
    ctx.fillRect(-R * 1.2, -R * 0.8, R * 2.4, R * 1.6);
    ctx.strokeRect(-R * 1.2, -R * 0.8, R * 2.4, R * 1.6);
    ctx.beginPath();
    ctx.moveTo(-R * 1.4, -R * 0.8); ctx.lineTo(0, -R * 1.6); ctx.lineTo(R * 1.4, -R * 0.8);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (centerpiece === "temple") {
    ctx.beginPath(); ctx.arc(0, 0, R * 1.2, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#7a5f24"; ctx.fillRect(-R * 0.18, -R * 1.9, R * 0.36, R * 1.4);
  } else {
    ctx.beginPath(); ctx.arc(0, 0, R * 1.3, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
