// lib/dungeon/outdoor.ts
//
// Outdoor pieces for the adventure-book map renderer (2026-11-06): ground textures for the outdoor
// terrains (grass, meadow, forest floor, dirt, road, sand, snow, swamp, deep water, stone ground, cliff)
// and the outdoor elements a GM places freely (trees, rocks, tents, wagons, fences, bridges...). Ink on
// muted washes, in the same hand as lib/dungeon/classic. Pure drawing code: no AI, no network.
//
// Every element draws centred on (0, 0) in a box of w x h squares (OUTDOOR_ELEMENTS), with S = one square
// in pixels. The caller has already moved, turned and scaled the canvas.

const INK = "#2b2018";
const LEAF = "#a9b673";
const LEAF_DK = "#86985a";
const PINE = "#8a9d63";
const BARK = "#8a6a45";
const WOOD = "#b98b52";
const STONE = "#cfc6b0";
const STONE_DK = "#b3a88e";
const CLOTH = "#d9c79c";

function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- ground ----

export type GroundKind = "grass" | "meadow" | "forest" | "dirt" | "road" | "sand" | "snow" | "swamp" | "deep" | "stone" | "cliff";
export const GROUND_KINDS = new Set<string>(["grass", "meadow", "forest", "dirt", "road", "sand", "snow", "swamp", "deep", "stone", "cliff"]);

export function drawGroundDetail(ctx: CanvasRenderingContext2D, kind: GroundKind, x: number, y: number, S: number, r: number, c: number): void {
  ctx.save();
  const lw = Math.max(0.6, S * 0.03);
  const tuft = (tx: number, ty: number, h: number, color: string) => {
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
    ctx.moveTo(tx - h * 0.45, ty - h * 0.7); ctx.lineTo(tx - h * 0.1, ty);
    ctx.moveTo(tx, ty - h); ctx.lineTo(tx + h * 0.05, ty);
    ctx.moveTo(tx + h * 0.45, ty - h * 0.7); ctx.lineTo(tx + h * 0.12, ty);
    ctx.stroke();
  };
  const dots = (count: number, color: string, rad: number, seed: number) => {
    ctx.fillStyle = color;
    for (let k = 0; k < count; k++) { ctx.beginPath(); ctx.arc(x + S * hash(r, c, seed + k), y + S * hash(r, c, seed + 40 + k), Math.max(0.5, rad * (0.6 + hash(r, c, seed + 80 + k) * 0.8)), 0, Math.PI * 2); ctx.fill(); }
  };
  switch (kind) {
    case "grass":
      if (hash(r, c, 1) < 0.65) tuft(x + S * (0.2 + hash(r, c, 2) * 0.6), y + S * (0.3 + hash(r, c, 3) * 0.6), S * 0.2, "rgba(80,100,45,0.55)");
      if (hash(r, c, 4) < 0.3) tuft(x + S * (0.15 + hash(r, c, 5) * 0.7), y + S * (0.3 + hash(r, c, 6) * 0.6), S * 0.15, "rgba(80,100,45,0.45)");
      break;
    case "meadow":
      if (hash(r, c, 1) < 0.5) tuft(x + S * (0.2 + hash(r, c, 2) * 0.6), y + S * (0.3 + hash(r, c, 3) * 0.6), S * 0.18, "rgba(80,100,45,0.5)");
      for (let k = 0; k < 3; k++) {
        if (hash(r, c, 10 + k) < 0.45) continue;
        const fx = x + S * hash(r, c, 20 + k), fy = y + S * hash(r, c, 30 + k), pal = ["#f4efe0", "#e8c65a", "#c9796a"];
        ctx.fillStyle = pal[Math.floor(hash(r, c, 40 + k) * 3)]; ctx.beginPath(); ctx.arc(fx, fy, Math.max(0.8, S * 0.04), 0, Math.PI * 2); ctx.fill();
      }
      break;
    case "forest":
      dots(4, "rgba(70,85,40,0.45)", S * 0.035, 50);
      if (hash(r, c, 7) < 0.35) {
        ctx.strokeStyle = "rgba(100,75,45,0.55)"; ctx.lineWidth = lw;
        const tx = x + S * (0.2 + hash(r, c, 8) * 0.6), ty = y + S * (0.2 + hash(r, c, 9) * 0.6), a = hash(r, c, 11) * Math.PI;
        ctx.beginPath(); ctx.moveTo(tx - Math.cos(a) * S * 0.14, ty - Math.sin(a) * S * 0.14); ctx.lineTo(tx + Math.cos(a) * S * 0.14, ty + Math.sin(a) * S * 0.14); ctx.stroke();
      }
      break;
    case "dirt":
      dots(5, "rgba(110,80,45,0.4)", S * 0.03, 60);
      if (hash(r, c, 12) < 0.3) { ctx.fillStyle = "rgba(150,130,100,0.6)"; ctx.strokeStyle = "rgba(60,45,30,0.5)"; ctx.lineWidth = lw * 0.8; ctx.beginPath(); ctx.ellipse(x + S * (0.2 + hash(r, c, 13) * 0.6), y + S * (0.2 + hash(r, c, 14) * 0.6), S * 0.06, S * 0.045, hash(r, c, 15) * 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      break;
    case "road":
      dots(4, "rgba(120,95,60,0.4)", S * 0.03, 70);
      if (hash(r, c, 16) < 0.35) { ctx.strokeStyle = "rgba(120,95,60,0.35)"; ctx.lineWidth = lw; const yy = y + S * (0.3 + hash(r, c, 17) * 0.4); ctx.beginPath(); ctx.moveTo(x + S * 0.15, yy); ctx.lineTo(x + S * 0.55, yy + S * 0.02); ctx.stroke(); }
      break;
    case "sand":
      dots(9, "rgba(150,120,70,0.38)", S * 0.018, 90);
      if (hash(r, c, 18) < 0.25) { ctx.strokeStyle = "rgba(150,120,70,0.4)"; ctx.lineWidth = lw; const yy = y + S * (0.3 + hash(r, c, 19) * 0.4); ctx.beginPath(); ctx.moveTo(x + S * 0.1, yy); ctx.quadraticCurveTo(x + S * 0.5, yy - S * 0.08, x + S * 0.9, yy); ctx.stroke(); }
      break;
    case "snow":
      if (hash(r, c, 20) < 0.35) { ctx.strokeStyle = "rgba(120,140,160,0.45)"; ctx.lineWidth = lw; const yy = y + S * (0.3 + hash(r, c, 21) * 0.4), xx = x + S * hash(r, c, 22) * 0.3; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.quadraticCurveTo(xx + S * 0.3, yy - S * 0.1, xx + S * 0.6, yy); ctx.stroke(); }
      dots(2, "rgba(150,165,180,0.35)", S * 0.02, 100);
      break;
    case "swamp":
      if (hash(r, c, 23) < 0.45) { ctx.fillStyle = "rgba(110,140,140,0.55)"; ctx.beginPath(); ctx.ellipse(x + S * (0.3 + hash(r, c, 24) * 0.4), y + S * (0.3 + hash(r, c, 25) * 0.4), S * (0.16 + hash(r, c, 26) * 0.12), S * 0.08, hash(r, c, 27) * 3, 0, Math.PI * 2); ctx.fill(); }
      if (hash(r, c, 28) < 0.6) tuft(x + S * (0.2 + hash(r, c, 29) * 0.6), y + S * (0.4 + hash(r, c, 30) * 0.5), S * 0.24, "rgba(55,70,35,0.6)");
      break;
    case "deep": {
      ctx.strokeStyle = "rgba(30,60,85,0.55)"; ctx.lineWidth = Math.max(0.8, S * 0.035);
      for (let k = 0; k < 2; k++) {
        if (hash(r, c, 31 + k) < 0.3) continue;
        const yy = y + S * (0.3 + k * 0.4), xx = x + S * (0.1 + hash(r, c, 33 + k) * 0.3), w = S * 0.5;
        ctx.beginPath(); ctx.moveTo(xx, yy); ctx.quadraticCurveTo(xx + w * 0.25, yy - S * 0.08, xx + w * 0.5, yy); ctx.quadraticCurveTo(xx + w * 0.75, yy + S * 0.08, xx + w, yy); ctx.stroke();
      }
      break;
    }
    case "stone": {
      ctx.strokeStyle = "rgba(90,80,60,0.45)"; ctx.lineWidth = lw;
      const sx = x + S * (0.3 + hash(r, c, 35) * 0.4), sy = y + S * (0.3 + hash(r, c, 36) * 0.4);
      ctx.beginPath(); ctx.moveTo(x, sy + (hash(r, c, 37) - 0.5) * S * 0.2); ctx.lineTo(sx, sy); ctx.lineTo(x + S, sy + (hash(r, c, 38) - 0.5) * S * 0.2);
      ctx.moveTo(sx, sy); ctx.lineTo(sx + (hash(r, c, 39) - 0.5) * S * 0.3, hash(r, c, 41) < 0.5 ? y : y + S); ctx.stroke();
      break;
    }
    case "cliff": {
      ctx.strokeStyle = "rgba(70,55,35,0.6)"; ctx.lineWidth = lw; ctx.lineCap = "round";
      const a = 0.9 + hash(r, c, 42) * 0.5;
      for (let k = 0; k < 3; k++) {
        const cx = x + S * (0.2 + hash(r, c, 43 + k) * 0.6), cy = y + S * (0.2 + hash(r, c, 47 + k) * 0.6), len = S * 0.22;
        for (let s = -1; s <= 1; s++) {
          const ox = -Math.sin(a) * s * S * 0.06, oy = Math.cos(a) * s * S * 0.06;
          ctx.beginPath(); ctx.moveTo(cx + ox - Math.cos(a) * len / 2, cy + oy - Math.sin(a) * len / 2); ctx.lineTo(cx + ox + Math.cos(a) * len / 2, cy + oy + Math.sin(a) * len / 2); ctx.stroke();
        }
      }
      break;
    }
  }
  ctx.restore();
}

// ---- elements ----

export type OutdoorKind =
  | "tree" | "pine" | "deadtree" | "bush" | "boulder" | "rocks" | "stump" | "log" | "campfire" | "tent"
  | "wagon" | "fence" | "signpost" | "gravestone" | "standingstone" | "bridge" | "boat" | "tallgrass" | "ruinedwall";

// w and h: the piece's box in squares at size 1. s: the size it starts at when placed.
export const OUTDOOR_ELEMENTS: { key: OutdoorKind; label: string; w: number; h: number; s: number }[] = [
  { key: "tree", label: "Tree", w: 1, h: 1, s: 2 },
  { key: "pine", label: "Pine", w: 1, h: 1, s: 1.5 },
  { key: "deadtree", label: "Dead tree", w: 1, h: 1, s: 1.5 },
  { key: "bush", label: "Bush", w: 1, h: 1, s: 1 },
  { key: "tallgrass", label: "Tall grass", w: 1, h: 1, s: 1 },
  { key: "boulder", label: "Boulder", w: 1, h: 1, s: 1 },
  { key: "rocks", label: "Rocks", w: 1, h: 1, s: 1 },
  { key: "stump", label: "Stump", w: 1, h: 1, s: 1 },
  { key: "log", label: "Fallen log", w: 1, h: 1, s: 2 },
  { key: "campfire", label: "Campfire", w: 1, h: 1, s: 1 },
  { key: "tent", label: "Tent", w: 1, h: 1, s: 2 },
  { key: "wagon", label: "Wagon", w: 1, h: 2, s: 1 },
  { key: "boat", label: "Boat", w: 1, h: 2, s: 1 },
  { key: "bridge", label: "Bridge", w: 1, h: 3, s: 1 },
  { key: "fence", label: "Fence", w: 1, h: 0.25, s: 1 },
  { key: "ruinedwall", label: "Ruined wall", w: 1, h: 0.3, s: 1 },
  { key: "signpost", label: "Signpost", w: 1, h: 1, s: 1 },
  { key: "gravestone", label: "Gravestone", w: 1, h: 1, s: 1 },
  { key: "standingstone", label: "Standing stone", w: 1, h: 1, s: 1 },
];
const OUTDOOR_KEYS = new Set<string>(OUTDOOR_ELEMENTS.map((e) => e.key));
export const isOutdoorKind = (k: string): k is OutdoorKind => OUTDOOR_KEYS.has(k);

export function drawOutdoorElement(ctx: CanvasRenderingContext2D, k: OutdoorKind, S: number, seed: number, inkS = S): void {
  ctx.save();
  const lw = Math.max(1, inkS * 0.045);
  ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.lineJoin = "round"; ctx.lineCap = "round";
  const R = (i: number) => hash(seed, i, 7);
  // A union of circles with one clean outline: stroke them all thick, then fill them all on top.
  const blob = (circles: [number, number, number][], fill: string) => {
    ctx.lineWidth = lw * 2;
    for (const [cx, cy, rr] of circles) { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = fill;
    for (const [cx, cy, rr] of circles) { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill(); }
    ctx.lineWidth = lw;
  };
  const stoneShape = (cx: number, cy: number, rr: number, sd: number, fill = STONE) => {
    ctx.fillStyle = fill; ctx.beginPath();
    for (let v = 0; v < 7; v++) { const a = v * 2 * Math.PI / 7 + hash(seed, sd, 3) * 2, rad = rr * (0.75 + hash(seed, sd * 7 + v, 4) * 0.35); ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  };
  switch (k) {
    case "tree": {
      const circles: [number, number, number][] = [[0, 0, S * 0.3]];
      const bumps = 9;
      for (let b = 0; b < bumps; b++) { const a = b * 2 * Math.PI / bumps + R(1) * 0.6, rad = S * (0.29 + R(b + 2) * 0.05); circles.push([Math.cos(a) * rad * 0.76, Math.sin(a) * rad * 0.76, S * (0.19 + R(b + 20) * 0.04)]); }
      blob(circles, LEAF);
      ctx.strokeStyle = "rgba(60,75,35,0.55)"; ctx.lineWidth = lw * 0.8;
      for (let b = 0; b < 4; b++) { const a = 0.3 + b * 0.5 + R(b + 40) * 0.3, rr = S * (0.16 + R(b + 44) * 0.12); ctx.beginPath(); ctx.arc(0, 0, rr, a, a + 0.7); ctx.stroke(); }
      ctx.fillStyle = BARK; ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.8; ctx.beginPath(); ctx.arc(S * 0.02, S * 0.03, S * 0.05, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case "pine": {
      const pts = 14; ctx.fillStyle = PINE; ctx.beginPath();
      for (let p = 0; p < pts; p++) { const a = p * 2 * Math.PI / pts + R(1) * 0.4, rad = S * (p % 2 ? 0.27 : 0.46); ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(45,60,30,0.7)"; ctx.lineWidth = lw * 0.7; ctx.beginPath();
      for (let p = 0; p < pts; p += 2) { const a = p * 2 * Math.PI / pts + R(1) * 0.4; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * S * 0.36, Math.sin(a) * S * 0.36); }
      ctx.stroke();
      ctx.fillStyle = BARK; ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(0, 0, S * 0.05, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case "deadtree": {
      ctx.strokeStyle = INK;
      const branch = (x0: number, y0: number, a: number, len: number, depth: number, sd: number) => {
        const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
        ctx.lineWidth = Math.max(0.8, lw * (0.6 + depth * 0.5)); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        if (depth <= 0) return;
        branch(x1, y1, a - 0.5 - hash(seed, sd, 5) * 0.3, len * 0.6, depth - 1, sd * 2 + 1);
        branch(x1, y1, a + 0.4 + hash(seed, sd, 6) * 0.3, len * 0.55, depth - 1, sd * 2 + 2);
      };
      for (let b = 0; b < 5; b++) branch(0, 0, b * 2 * Math.PI / 5 + R(2), S * 0.2, 2, b + 1);
      ctx.fillStyle = BARK; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(0, 0, S * 0.07, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case "bush": {
      const circles: [number, number, number][] = [];
      for (let b = 0; b < 5; b++) { const a = b * 2 * Math.PI / 5 + R(1), rad = S * 0.16; circles.push([Math.cos(a) * rad, Math.sin(a) * rad, S * (0.16 + R(b + 3) * 0.05)]); }
      circles.push([0, 0, S * 0.18]);
      blob(circles, LEAF_DK);
      ctx.fillStyle = "rgba(60,75,35,0.5)";
      for (let b = 0; b < 4; b++) { ctx.beginPath(); ctx.arc((R(b + 10) - 0.5) * S * 0.4, (R(b + 14) - 0.5) * S * 0.4, S * 0.03, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case "tallgrass": {
      ctx.strokeStyle = "rgba(60,80,35,0.85)"; ctx.lineWidth = lw * 0.8;
      for (let t = 0; t < 9; t++) {
        const tx = (R(t) - 0.5) * S * 0.75, ty = (R(t + 20) - 0.5) * S * 0.6 + S * 0.15, h = S * (0.22 + R(t + 40) * 0.15);
        ctx.beginPath(); ctx.moveTo(tx - h * 0.4, ty - h * 0.8); ctx.quadraticCurveTo(tx - h * 0.1, ty - h * 0.3, tx, ty); ctx.quadraticCurveTo(tx + h * 0.05, ty - h * 0.5, tx + h * 0.1, ty - h); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + h * 0.2, ty - h * 0.3, tx + h * 0.45, ty - h * 0.75); ctx.stroke();
      }
      break;
    }
    case "boulder": {
      stoneShape(0, 0, S * 0.4, 1);
      ctx.strokeStyle = "rgba(60,50,35,0.55)"; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.arc(-S * 0.05, -S * 0.05, S * 0.22, 2.3, 3.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S * 0.05, S * 0.12); ctx.lineTo(S * 0.2, S * 0.18); ctx.stroke();
      break;
    }
    case "rocks": {
      stoneShape(-S * 0.17, -S * 0.12, S * 0.17, 1); stoneShape(S * 0.18, -S * 0.05, S * 0.13, 2, STONE_DK); stoneShape(-S * 0.02, S * 0.2, S * 0.12, 3); stoneShape(S * 0.25, S * 0.25, S * 0.07, 4, STONE_DK);
      break;
    }
    case "stump": {
      ctx.fillStyle = BARK; ctx.beginPath(); ctx.arc(0, 0, S * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#d9b886"; ctx.beginPath(); ctx.arc(0, 0, S * 0.23, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(110,80,45,0.7)"; ctx.lineWidth = lw * 0.6;
      for (const rr of [0.15, 0.08]) { ctx.beginPath(); ctx.arc(0, 0, S * rr, 0, Math.PI * 2); ctx.stroke(); }
      break;
    }
    case "log": {
      // along the box's x axis, end grain on the right
      ctx.fillStyle = BARK; ctx.beginPath(); ctx.rect(-S * 0.42, -S * 0.11, S * 0.78, S * 0.22); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(50,35,20,0.6)"; ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(-S * 0.36, -S * 0.03); ctx.lineTo(S * 0.2, -S * 0.04); ctx.moveTo(-S * 0.3, S * 0.05); ctx.lineTo(S * 0.28, S * 0.04); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.fillStyle = "#d9b886"; ctx.beginPath(); ctx.ellipse(S * 0.36, 0, S * 0.06, S * 0.11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case "campfire": {
      for (let k2 = 0; k2 < 8; k2++) { const a = k2 * Math.PI / 4; stoneShape(Math.cos(a) * S * 0.3, Math.sin(a) * S * 0.3, S * 0.08, k2 + 1); }
      ctx.strokeStyle = INK; ctx.lineWidth = lw * 1.4; ctx.beginPath(); ctx.moveTo(-S * 0.17, -S * 0.12); ctx.lineTo(S * 0.17, S * 0.12); ctx.moveTo(S * 0.17, -S * 0.12); ctx.lineTo(-S * 0.17, S * 0.12); ctx.stroke();
      ctx.fillStyle = "#e8913c"; ctx.beginPath(); ctx.moveTo(0, -S * 0.2); ctx.quadraticCurveTo(S * 0.16, 0, 0, S * 0.14); ctx.quadraticCurveTo(-S * 0.16, 0, 0, -S * 0.2); ctx.fill();
      ctx.fillStyle = "#f6d27a"; ctx.beginPath(); ctx.arc(0, S * 0.02, S * 0.06, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "tent": {
      // seen from above: a ridge down the middle, two cloth slopes, the door flap at the bottom
      ctx.fillStyle = CLOTH; ctx.beginPath(); ctx.rect(-S * 0.4, -S * 0.36, S * 0.8, S * 0.72); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(120,95,55,0.25)"; ctx.fillRect(0, -S * 0.36, S * 0.4, S * 0.72);
      ctx.beginPath(); ctx.moveTo(0, -S * 0.42); ctx.lineTo(0, S * 0.42); ctx.stroke();
      ctx.fillStyle = "#b39a68"; ctx.beginPath(); ctx.moveTo(-S * 0.14, S * 0.36); ctx.lineTo(0, S * 0.2); ctx.lineTo(S * 0.14, S * 0.36); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(-S * 0.4, -S * 0.36); ctx.lineTo(-S * 0.48, -S * 0.46); ctx.moveTo(S * 0.4, -S * 0.36); ctx.lineTo(S * 0.48, -S * 0.46); ctx.moveTo(-S * 0.4, S * 0.36); ctx.lineTo(-S * 0.48, S * 0.46); ctx.moveTo(S * 0.4, S * 0.36); ctx.lineTo(S * 0.48, S * 0.46); ctx.stroke();
      break;
    }
    case "wagon": {
      // box is 1 x 2 squares, the tongue points up
      ctx.fillStyle = "#3d3027";
      for (const wy of [-S * 0.45, S * 0.5]) for (const wx of [-S * 0.42, S * 0.42]) { ctx.beginPath(); ctx.rect(wx - S * 0.05, wy - S * 0.14, S * 0.1, S * 0.28); ctx.fill(); }
      ctx.fillStyle = WOOD; ctx.beginPath(); ctx.rect(-S * 0.36, -S * 0.7, S * 0.72, S * 1.5); ctx.fill(); ctx.stroke();
      ctx.lineWidth = lw * 0.6; for (let p = 1; p < 4; p++) { ctx.beginPath(); ctx.moveTo(-S * 0.36 + p * S * 0.18, -S * 0.7); ctx.lineTo(-S * 0.36 + p * S * 0.18, S * 0.8); ctx.stroke(); }
      ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(0, -S * 0.7); ctx.lineTo(0, -S * 0.98); ctx.moveTo(-S * 0.14, -S * 0.98); ctx.lineTo(S * 0.14, -S * 0.98); ctx.stroke();
      break;
    }
    case "boat": {
      ctx.fillStyle = WOOD; ctx.beginPath(); ctx.moveTo(0, -S * 0.95); ctx.quadraticCurveTo(S * 0.42, -S * 0.3, S * 0.34, S * 0.85); ctx.lineTo(-S * 0.34, S * 0.85); ctx.quadraticCurveTo(-S * 0.42, -S * 0.3, 0, -S * 0.95); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = lw * 0.7; for (const by of [-S * 0.2, S * 0.3]) { ctx.beginPath(); ctx.moveTo(-S * 0.33, by); ctx.lineTo(S * 0.33, by); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(0, -S * 0.75); ctx.lineTo(0, S * 0.8); ctx.stroke();
      break;
    }
    case "bridge": {
      // box is 1 x 3 squares: planks across, rails down both sides
      ctx.fillStyle = WOOD; ctx.beginPath(); ctx.rect(-S * 0.42, -S * 1.5, S * 0.84, S * 3); ctx.fill(); ctx.stroke();
      ctx.lineWidth = lw * 0.6; for (let p = 1; p < 12; p++) { const py = -S * 1.5 + p * S * 0.25; ctx.beginPath(); ctx.moveTo(-S * 0.42, py); ctx.lineTo(S * 0.42, py); ctx.stroke(); }
      ctx.lineWidth = lw * 1.6; ctx.beginPath(); ctx.moveTo(-S * 0.46, -S * 1.5); ctx.lineTo(-S * 0.46, S * 1.5); ctx.moveTo(S * 0.46, -S * 1.5); ctx.lineTo(S * 0.46, S * 1.5); ctx.stroke();
      break;
    }
    case "fence": {
      ctx.lineWidth = lw * 0.9; ctx.beginPath(); ctx.moveTo(-S * 0.5, -S * 0.04); ctx.lineTo(S * 0.5, -S * 0.04); ctx.moveTo(-S * 0.5, S * 0.04); ctx.lineTo(S * 0.5, S * 0.04); ctx.stroke();
      ctx.fillStyle = BARK; for (const px of [-S * 0.5, 0, S * 0.5]) { ctx.beginPath(); ctx.rect(px - S * 0.05, -S * 0.08, S * 0.1, S * 0.16); ctx.fill(); ctx.stroke(); }
      break;
    }
    case "ruinedwall": {
      // a broken run of stone blocks along the box's x axis
      for (let b = 0; b < 5; b++) {
        if (R(b + 1) < 0.2) continue;
        const bx = -S * 0.5 + b * S * 0.2, hh = S * (0.1 + R(b + 8) * 0.06);
        ctx.fillStyle = b % 2 ? STONE : STONE_DK; ctx.beginPath(); ctx.rect(bx + S * 0.01, -hh, S * 0.18, hh * 2); ctx.fill(); ctx.stroke();
      }
      if (R(20) < 0.7) stoneShape(S * (R(21) - 0.5) * 0.8, S * 0.25, S * 0.06, 9);
      break;
    }
    case "signpost": {
      ctx.fillStyle = BARK; ctx.beginPath(); ctx.arc(0, 0, S * 0.06, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = WOOD;
      ctx.beginPath(); ctx.moveTo(-S * 0.04, -S * 0.1); ctx.lineTo(S * 0.32, -S * 0.1); ctx.lineTo(S * 0.4, -S * 0.04); ctx.lineTo(S * 0.32, S * 0.02); ctx.lineTo(-S * 0.04, S * 0.02); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S * 0.04, S * 0.06); ctx.lineTo(-S * 0.3, S * 0.06); ctx.lineTo(-S * 0.38, S * 0.12); ctx.lineTo(-S * 0.3, S * 0.18); ctx.lineTo(S * 0.04, S * 0.18); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case "gravestone": {
      ctx.fillStyle = "rgba(110,95,70,0.35)"; ctx.beginPath(); ctx.rect(-S * 0.2, -S * 0.05, S * 0.4, S * 0.42); ctx.fill();
      ctx.fillStyle = STONE; ctx.beginPath(); ctx.moveTo(-S * 0.22, -S * 0.05); ctx.lineTo(-S * 0.22, -S * 0.25); ctx.arc(0, -S * 0.25, S * 0.22, Math.PI, 0); ctx.lineTo(S * 0.22, -S * 0.05); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.moveTo(0, -S * 0.38); ctx.lineTo(0, -S * 0.14); ctx.moveTo(-S * 0.08, -S * 0.3); ctx.lineTo(S * 0.08, -S * 0.3); ctx.stroke();
      break;
    }
    case "standingstone": {
      ctx.fillStyle = "rgba(90,75,50,0.25)"; ctx.beginPath(); ctx.ellipse(S * 0.08, S * 0.1, S * 0.3, S * 0.2, 0.4, 0, Math.PI * 2); ctx.fill();
      stoneShape(0, 0, S * 0.26, 3, STONE_DK);
      ctx.strokeStyle = "rgba(60,50,35,0.6)"; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.moveTo(-S * 0.08, -S * 0.1); ctx.lineTo(S * 0.06, S * 0.08); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
