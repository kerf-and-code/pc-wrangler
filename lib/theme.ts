import type { CSSProperties } from "react";

/* Six Axes: shared theme (the cellar look).
   One source of truth for palette, type, surfaces, and the stone background.
   Pages import SAX for colors and `surfaces` / `ui` for ready-made style blocks
   so every screen stays cohesive without copy-pasting CSS.

   PER-SYSTEM THEMING: the feel-carrying tokens below resolve to CSS custom properties with their
   current value as the fallback, e.g. `var(--sax-accent, #C8A24B)`. The defaults live in
   lib/systems/system-theme.ts as a `:root { ... }` block, and a per-system block such as
   `[data-system="lancer"] { ... }` overrides them; SystemThemeProvider sets `data-system` on <html>
   from the active campaign. Because these are the values every page already reads (directly or through
   the `C` palette in forge-theme), the whole app re-skins when the campaign's system changes, with no
   per-page edits. The fallbacks keep the app byte-identical if the stylesheet ever fails to load. */

export const SAX = {
  // stone / ink
  ink: "var(--sax-ink, #140E1F)",
  inkDeep: "var(--sax-ink-deep, #0B0712)",
  // surfaces
  panelBg: "rgba(26,19,37,0.82)",   // atmospheric "chrome" plate
  slateBg: "rgba(18,13,26,0.92)",   // dark + clean, for chart panels
  parch: "#E7DCC4",                 // warm parchment, for text/form cards
  parchInk: "#2B2218",
  parchLine: "#C9B894",
  // lines & metal
  line: "var(--sax-line, #3A2C4E)",
  brass: "var(--sax-accent, #C8A24B)",
  brassDim: "var(--sax-accent-dim, #7A632E)",
  copper: "#B5763A",
  // text
  text: "var(--sax-text, #F1E9F7)",
  muted: "var(--sax-muted, #A091B8)",
  // states
  good: "var(--sax-good, #5DBE9A)",
  warn: "var(--sax-warn, #E07A5F)",
  spark: "#BFE3FF",
  ember: "#E8923A",
  plum: "#9B7BD4",
  sun: "#F4C430",
  // the six axes, DATA ENCODING, kept literal so a hue means the same axis in every chart on every
  // system. These never theme.
  axis: { N: "#B7615A", T: "#C8A24B", O: "#4E8077", S: "#CE8A42", E: "#6C76B0", I: "#9A93B0" },
  // type
  serif: "var(--forge-body, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif)",
  mono: "var(--forge-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
} as const;

export type AxisKey = "N" | "T" | "O" | "S" | "E" | "I";

export type AxisDescriptor = {
  key: AxisKey;
  name: string;        // analytical name, e.g. "The Character"
  tavern: string;      // TAVERN letter, e.g. "V"
  tavernName: string;  // display name, e.g. "Voice"
  facet: string;       // short descriptor
  color: string;
};

/* The six axes: single source of truth for labels and colors. Internal keys stay
   N/T/O/S/E/I so scoring and the disposition model are untouched; `tavernName` is
   the display layer (the axes spell TAVERN, the tavern being where you meet your
   characters). Colors come from SAX.axis so a hue is defined in exactly one place. */
export const AXES: Record<AxisKey, AxisDescriptor> = {
  N: { key: "N", name: "The Character", tavern: "V", tavernName: "Voice", facet: "Narrative & immersion", color: SAX.axis.N },
  T: { key: "T", name: "The Encounter", tavern: "T", tavernName: "Tactics", facet: "Tactical play", color: SAX.axis.T },
  O: { key: "O", name: "The System", tavern: "A", tavernName: "Arcana", facet: "Optimization & mastery", color: SAX.axis.O },
  S: { key: "S", name: "The Table", tavern: "R", tavernName: "Rapport", facet: "Social & cohesion", color: SAX.axis.S },
  E: { key: "E", name: "The World", tavern: "E", tavernName: "Exploration", facet: "Exploration & discovery", color: SAX.axis.E },
  I: { key: "I", name: "Presence", tavern: "N", tavernName: "Nerve", facet: "Engagement intensity", color: SAX.axis.I },
};

/* TAVERN reading order: T-A-V-E-R-N maps to these internal keys. */
export const TAVERN_ORDER: AxisKey[] = ["T", "O", "N", "E", "S", "I"];

/* full-page stone background: the wall image, darkened, with a faint warm
   lamp glow toward the top so the center reads as lit. Left LITERAL (not themed): PageShell and the
   Forge paint the app-wide background via forgeBackground(), which is the themed one; stoneBackground
   is the older cool tint kept for any page still calling it directly. */
export function stoneBackground(url = "/wall-2.png"): CSSProperties {
  return {
    backgroundColor: "#0B0712",
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

// Weathered-stone tones, the dungeon palette. Defined HERE rather than in forge-theme because
// surfaces/ui below need them, and forge-theme imports this file, the other direction would be a
// cycle. forge-theme re-exports STONE, so `import { STONE } from "@/lib/forge-theme"` still works.
// Each feel-carrying tone resolves to a CSS variable (fallback = its current value), so the whole
// stone palette shifts per system while defaulting to the dungeon look.
export const STONE = {
  face: "var(--stone-face, #2b2620)",     // the working stone surface
  lit: "var(--stone-lit, #3a342b)",       // a raised edge catching torchlight (top-left bevel)
  hi: "var(--stone-hi, #4a4237)",         // the brightest bevel
  shadow: "var(--stone-shadow, #1a1611)", // recessed stone, sunk below the face
  mortar: "var(--stone-mortar, #0c0a07)", // the dark seams between blocks
  brassHi: "var(--sax-accent-hi, #e2b878)",  // polished highlight on the accent (SAX.brass is the base)
  brassDeep: "var(--sax-accent-deep, #6e4e26)",
  moss: "#6f7d55",     // age and damp, the green of old stone
  blood: "#8a3324",    // dried-blood warning red
  // Text-safe values of moss and blood. The base tones are surface colours: against the panel
  // face they measure 3.38 and 1.84, both under the 4.5 needed for readable text, and warn is
  // used as a text colour in 46 places. These are the same hues lifted until they clear it.
  mossLit: "var(--stone-moss-lit, #9aa880)",
  bloodLit: "var(--stone-blood-lit, #d97d6d)",
  ink: "var(--stone-ink, #e8dcc4)",      // parchment text on stone
  inkDim: "var(--stone-ink-dim, #a99e86)",   // weathered secondary
  inkFaint: "var(--stone-ink-faint, #8a8069)", // hints and captions
} as const;

// Corner rounding, per active system. Stone barely rounds (4px default); Lancer and CoC square off
// to 0, Daggerheart softens to 14. One variable so every panel, field and button reshapes at once.
export const FORGE_RADIUS = "var(--sax-radius, 4px)"; // stone chips, it doesn't round

// The themed panel gradient (the carved-stone plate by default). One variable so a system can swap
// the whole surface material (e.g. gunmetal for Lancer) without touching the sixteen pages that
// spread `surfaces.panel`.
const PANEL_BG = "var(--forge-panel-bg, linear-gradient(160deg, rgba(52,47,39,0.80) 0%, rgba(38,34,28,0.85) 45%, rgba(22,19,15,0.90) 100%))";
const SLATE_BG = "var(--forge-slate-bg, linear-gradient(180deg, rgba(38,34,28,0.94), rgba(24,21,17,0.96)))";

export const surfaces: Record<string, CSSProperties> = {
  // These are what most pages spread for their cards, so retoning them here moves roughly sixteen
  // pages at once. The face is translucent on purpose: the wall texture reads through it, which is
  // what stops a panel looking like a floating card and makes it look cut into the wall behind.
  panel: {
    background: PANEL_BG,
    borderRadius: FORGE_RADIUS,
    boxShadow: [
      "inset 1px 1px 0 rgba(255,235,200,0.13)",
      "inset -1px -1px 0 rgba(0,0,0,0.6)",
      "inset 0 0 46px rgba(0,0,0,0.4)",
      "0 5px 14px rgba(0,0,0,0.6)",
      `0 0 0 1px ${STONE.mortar}`,
      "0 0 0 2px var(--sax-panel-frame, transparent)",
    ].join(","),
  },
  // Slightly flatter and more opaque, for panels holding charts where a texture behind the data
  // would fight the plot.
  slate: {
    background: SLATE_BG,
    borderRadius: FORGE_RADIUS,
    boxShadow: [
      "inset 1px 1px 0 rgba(255,235,200,0.10)",
      "inset -1px -1px 0 rgba(0,0,0,0.6)",
      "0 5px 14px rgba(0,0,0,0.6)",
      `0 0 0 1px ${STONE.mortar}`,
      "0 0 0 2px var(--sax-panel-frame, transparent)",
    ].join(","),
  },
  // Unchanged: parchment is a deliberate contrast surface for reading, not a stone panel.
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
    textTransform: "uppercase", color: STONE.inkDim,
  },
  // Carved, not flat. The depth is three things together: a vertical gradient so the face catches
  // light at the top, an inset rim, and a solid offset shadow underneath acting as the lip the button
  // sits proud of. The PRESS is not here (:active can't be inline); PageShell injects that rule.
  btnPrimary: {
    background: `linear-gradient(180deg, ${STONE.brassHi} 0%, ${SAX.brass} 52%, ${STONE.brassDeep} 100%)`,
    color: "#241a0d",
    border: "none",
    borderRadius: FORGE_RADIUS,
    padding: "11px 22px",
    fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase",
    cursor: "pointer",
    textShadow: "0 1px 0 rgba(255,240,210,0.4)",
    transition: "transform 0.06s ease, box-shadow 0.06s ease, color 0.15s ease",
    boxShadow: [
      "inset 0 1px 0 rgba(255,240,210,0.6)", "inset 0 -2px 3px rgba(60,35,10,0.55)",
      "inset 0 0 0 1px rgba(70,45,15,0.5)", "0 4px 0 -1px #3a260f", "0 5px 7px rgba(0,0,0,0.6)",
    ].join(","),
  },
  btnGhost: {
    background: "linear-gradient(180deg, rgba(22,19,15,0.72), rgba(40,36,30,0.72))",
    color: STONE.inkDim,
    border: "none",
    borderRadius: FORGE_RADIUS,
    padding: "11px 20px",
    fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase",
    cursor: "pointer",
    transition: "transform 0.06s ease, box-shadow 0.06s ease, color 0.15s ease",
    boxShadow: [
      "inset 1px 1px 3px rgba(0,0,0,0.6)", "inset -1px -1px 0 rgba(255,230,190,0.06)",
      "inset 0 0 0 1px rgba(0,0,0,0.3)",
    ].join(","),
  },
};
