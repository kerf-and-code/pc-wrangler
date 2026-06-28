import type { CSSProperties } from "react";

/* Six Axes — shared theme (the cellar look).
   One source of truth for palette, type, surfaces, and the stone background.
   Pages import SAX for colors and `surfaces` / `ui` for ready-made style blocks
   so every screen stays cohesive without copy-pasting CSS. */

export const SAX = {
  // stone / ink
  ink: "#140E1F",
  inkDeep: "#0B0712",
  // surfaces
  panelBg: "rgba(26,19,37,0.82)",   // atmospheric "chrome" plate
  slateBg: "rgba(18,13,26,0.92)",   // dark + clean, for chart panels
  parch: "#E7DCC4",                 // warm parchment, for text/form cards
  parchInk: "#2B2218",
  parchLine: "#C9B894",
  // lines & metal
  line: "#3A2C4E",
  brass: "#C8A24B",
  brassDim: "#7A632E",
  copper: "#B5763A",
  // text
  text: "#F1E9F7",
  muted: "#A091B8",
  // states
  good: "#5DBE9A",
  warn: "#E07A5F",
  spark: "#BFE3FF",
  ember: "#E8923A",
  plum: "#9B7BD4",
  sun: "#F4C430",
  // the six axes
  axis: { N: "#B7615A", T: "#C8A24B", O: "#4E8077", S: "#CE8A42", E: "#6C76B0", I: "#9A93B0" },
  // type
  serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/* full-page stone background: the wall image, darkened, with a faint warm
   lamp glow toward the top so the center reads as lit. */
export function stoneBackground(url = "/wall-2.png"): CSSProperties {
  return {
    backgroundColor: SAX.inkDeep,
    backgroundImage: [
      "radial-gradient(ellipse 70% 48% at 50% 16%, rgba(232,146,58,0.10), transparent 62%)",
      "linear-gradient(180deg, rgba(12,8,18,0.58), rgba(7,4,12,0.82))",
      `url(${url})`,
    ].join(","),
    backgroundSize: "cover, cover, cover",
    backgroundPosition: "center top",
    backgroundAttachment: "fixed",
    backgroundRepeat: "no-repeat",
  };
}

/* surface plates */
export const surfaces: Record<string, CSSProperties> = {
  // atmospheric chrome: brass-edged dark plate that sits on the wall
  panel: {
    background: SAX.panelBg,
    border: `1px solid ${SAX.line}`,
    borderRadius: 14,
    boxShadow: "0 18px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.03)",
    backdropFilter: "blur(2px)",
  },
  // dark + clean, keeps chart colors legible
  slate: {
    background: SAX.slateBg,
    border: `1px solid ${SAX.line}`,
    borderRadius: 14,
    boxShadow: "0 14px 30px rgba(0,0,0,0.4)",
  },
  // light parchment for text/forms (no charts)
  parchment: {
    background: `linear-gradient(180deg, #EFE6D2, ${SAX.parch})`,
    color: SAX.parchInk,
    border: `1px solid ${SAX.parchLine}`,
    borderRadius: 12,
    boxShadow: "0 16px 34px rgba(0,0,0,0.5)",
  },
};

/* reusable controls + type */
export const ui: Record<string, CSSProperties> = {
  eyebrow: {
    fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.24em",
    textTransform: "uppercase", color: SAX.brass,
  },
  h1: { fontFamily: SAX.serif, fontSize: 34, fontWeight: 600, letterSpacing: 0.2, margin: "6px 0 10px" },
  label: {
    fontFamily: SAX.mono, fontSize: 10, letterSpacing: "0.16em",
    textTransform: "uppercase", color: SAX.muted,
  },
  btnPrimary: {
    background: SAX.brass, color: SAX.inkDeep, border: "none", borderRadius: 999,
    padding: "10px 22px", fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.12em",
    textTransform: "uppercase", cursor: "pointer",
  },
  btnGhost: {
    background: "transparent", color: SAX.brass, border: `1px solid ${SAX.brass}`,
    borderRadius: 999, padding: "9px 20px", fontFamily: SAX.mono, fontSize: 12,
    letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer",
  },
};
