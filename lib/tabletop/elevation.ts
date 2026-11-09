// lib/tabletop/elevation.ts (2026-11-09)
//
// Token elevation (phase 5w, gap 7 in the tabletop audit doc): how high a token is above the ground, in
// feet (negative: burrowing, swimming under, standing in a pit). Kept in vtt_tokens.style.elevation and
// changed by tabletop_set_token_elevation (p127), which lets the GM set any token and a player their own.
// Pure: no React, no network.
//
// Distance between two tokens at different heights counts the height as one more direction, by the
// scene's diagonal rule: "five" (every square 5 ft) takes the longer of the two, "alternate" (5-10-5)
// adds half the shorter in whole squares, and "euclid" uses the straight line. So a bird 30 ft up and
// 20 ft away is 30 ft away under the usual 5e rule.

import type { DiagonalRule } from "@/lib/tabletop/geometry";

export const MAX_ELEVATION = 9999;

/** A token's height in feet from its style: a whole number, 0 when unset or unreadable. */
export function elevationOf(style: Record<string, unknown> | null | undefined): number {
  const v = style?.elevation;
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, Math.round(v)));
}

/** Distance in feet from flat distance h and height difference v (both feet), by the diagonal rule. */
export function distance3d(h: number, v: number, rule: DiagonalRule, feetPerSquare: number): number {
  const dv = Math.abs(v), dh = Math.abs(h);
  if (!dv) return dh;
  if (rule === "euclid") return Math.round(Math.hypot(dh, dv) * 10) / 10;
  if (rule === "alternate") {
    const fps = feetPerSquare > 0 ? feetPerSquare : 5;
    const a = Math.round(dh / fps), b = Math.round(dv / fps);
    return (Math.max(a, b) + Math.floor(Math.min(a, b) / 2)) * fps;
  }
  return Math.max(dh, dv);
}

/** "30 ft up", "10 ft down", or "" on the ground. */
export function elevationText(feet: number): string {
  return feet > 0 ? `${feet} ft up` : feet < 0 ? `${-feet} ft down` : "";
}
