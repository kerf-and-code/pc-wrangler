// lib/tabletop/geometry.ts
//
// Pure geometry for the tabletop (2026-11-06): token snapping, the ruler's distance under each
// diagonal rule, and the camera. Coordinates are in SQUARES from the grid's top-left corner unless a
// name says pixels. No React, no Supabase, so it can be tested on its own.

export type Pt = { x: number; y: number };
export type DiagonalRule = "five" | "alternate" | "euclid";

export const DIAGONAL_RULES: { key: DiagonalRule; label: string }[] = [
  { key: "five", label: "5e: every diagonal is one square" },
  { key: "alternate", label: "Alternating 5 and 10 feet" },
  { key: "euclid", label: "Straight-line distance" },
];

// A token's centre lands so its edges sit on grid lines: an odd number of squares across (Medium,
// Huge) centres on a square, an even number (Large, Gargantuan) on a grid line. Tiny tokens snap to
// half squares, so four can share a square.
export function snapToken(x: number, y: number, size: number): Pt {
  if (size < 1) return { x: Math.floor(x * 2) / 2 + 0.25, y: Math.floor(y * 2) / 2 + 0.25 };
  const even = Math.round(size) % 2 === 0;
  const f = (v: number) => (even ? Math.round(v) : Math.floor(v) + 0.5);
  return { x: f(x), y: f(y) };
}

// The ruler snaps to square centres, so a measure counts whole squares.
export const snapCenter = (p: Pt): Pt => ({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });

// Distance along a path of points (start, waypoints, end), in squares and feet. The alternating rule
// carries its diagonal count across waypoints, as it does on a real table: the second diagonal of a
// move costs double wherever the turn happens.
export function measure(points: Pt[], rule: DiagonalRule, feetPerSquare: number): { squares: number; feet: number } {
  let squares = 0, diagonals = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = Math.abs(points[i].x - points[i - 1].x), dy = Math.abs(points[i].y - points[i - 1].y);
    if (rule === "euclid") { squares += Math.hypot(dx, dy); continue; }
    const diag = Math.min(dx, dy), straight = Math.max(dx, dy) - diag;
    if (rule === "five") { squares += straight + diag; continue; }
    // alternating: every second diagonal costs two squares
    const whole = Math.round(diag);
    const extra = Math.floor((diagonals + whole) / 2) - Math.floor(diagonals / 2);
    diagonals += whole;
    squares += straight + diag + extra;
  }
  const feet = squares * feetPerSquare;
  return { squares, feet: rule === "euclid" ? Math.round(feet * 10) / 10 : Math.round(feet) };
}

// ---- camera: screen = world * s + o (world in pixels of the rendered map) ----
export type Camera = { s: number; ox: number; oy: number };
export const MIN_ZOOM = 0.08, MAX_ZOOM = 5;

export function fitCamera(viewW: number, viewH: number, worldW: number, worldH: number, pad = 24): Camera {
  const s = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((viewW - pad * 2) / worldW, (viewH - pad * 2) / worldH)));
  return { s, ox: (viewW - worldW * s) / 2, oy: (viewH - worldH * s) / 2 };
}

// Zoom by a factor, keeping the world point under the cursor where it is.
export function zoomAt(cam: Camera, factor: number, sx: number, sy: number): Camera {
  const s = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.s * factor));
  const wx = (sx - cam.ox) / cam.s, wy = (sy - cam.oy) / cam.s;
  return { s, ox: sx - wx * s, oy: sy - wy * s };
}

// Centre a world point (pixels) in the view at the current zoom.
export const centerOn = (cam: Camera, wx: number, wy: number, viewW: number, viewH: number): Camera =>
  ({ s: cam.s, ox: viewW / 2 - wx * cam.s, oy: viewH / 2 - wy * cam.s });

export const toWorld = (cam: Camera, sx: number, sy: number): Pt => ({ x: (sx - cam.ox) / cam.s, y: (sy - cam.oy) / cam.s });

// ---- chat commands ----
export type Parsed =
  | { kind: "roll"; notation: string; label: string; gmOnly: boolean }
  | { kind: "whisper"; to: string[]; body: string }
  | { kind: "emote"; body: string }
  | { kind: "say"; body: string }
  | { kind: "error"; message: string };

// /r 1d20+5 Attack, /gr 2d6 (GM only), /w Nova hello (names may have spaces), /em or /me waves.
// `names` are the people a whisper may go to, matched longest first and ignoring case.
export function parseChat(text: string, names: string[]): Parsed {
  const t = text.trim();
  const m = /^\/(r|roll|gr|gmroll)\s+(.+)$/i.exec(t);
  if (m) {
    const rest = m[2];
    const dice = /^([0-9dDkKhHlL+\-\s]+)(.*)$/.exec(rest);
    const notation = (dice ? dice[1] : rest).replace(/\s+/g, "");
    if (!/d\d/i.test(notation)) return { kind: "error", message: "Write the dice after /r, for example /r 1d20+5 Attack." };
    return { kind: "roll", notation, label: (dice ? dice[2] : "").trim(), gmOnly: /^g/i.test(m[1]) };
  }
  const w = /^\/w(?:hisper)?\s+(.+)$/i.exec(t);
  if (w) {
    const rest = w[1];
    const sorted = [...names].sort((a, b) => b.length - a.length);
    const hit = sorted.find((n) => rest.toLowerCase().startsWith(n.toLowerCase() + " ") || rest.toLowerCase() === n.toLowerCase());
    if (!hit) return { kind: "error", message: "Nobody at this table by that name. Try /w GM hello." };
    const body = rest.slice(hit.length).trim();
    if (!body) return { kind: "error", message: `What do you want to whisper to ${hit}?` };
    return { kind: "whisper", to: [hit], body };
  }
  const e = /^\/(em|me|emote)\s+(.+)$/i.exec(t);
  if (e) return { kind: "emote", body: e[2].trim() };
  if (t.startsWith("/")) return { kind: "error", message: "Commands: /r, /gr, /w name, /em. Anything else is said to the table." };
  return { kind: "say", body: t };
}
