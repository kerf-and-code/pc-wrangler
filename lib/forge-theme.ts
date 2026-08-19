// lib/forge-theme.ts
//
// The dungeon design language for Six Axes: weathered stone surfaces, carved-depth controls,
// torchlit brass. Built to EXTEND lib/theme (SAX / surfaces / ui / stoneBackground), not replace
// it — the palette here reuses SAX.brass/ink/plum and adds only the weathered-stone tones SAX
// lacks. Every export returns a CSSProperties object (or a factory that does), exactly like
// stoneBackground(), so any page can drop these in as inline styles and stay cohesive.
//
// Approved as the design language for the whole app (starting with the PC creator / the Forge):
// the dungeon color scheme laid over the real /wall-2.png, translucent stone panels so the wall
// texture reads through, carved buttons with real depth, one brass CTA per view. No generated
// texture — the weathering is the wall itself.

import type { CSSProperties } from "react";
import { SAX, STONE, FORGE_RADIUS } from "./theme";

// STONE and FORGE_RADIUS moved into ./theme so the shared `surfaces` and `ui` there can use them
// without importing this file (that direction would be a cycle). Re-exported so every existing
// `import { STONE } from "@/lib/forge-theme"` keeps working untouched.
export { STONE, FORGE_RADIUS };


// Cinzel is the Forge display face (carved-inscription serif); load it in the page head. Body
// stays on SAX.serif (Iowan Old Style), stat readouts on SAX.mono.
export const FORGE_FONTS = {
  display: "var(--forge-display, 'Cinzel', 'Iowan Old Style', Georgia, serif)",
  body: SAX.serif,
  mono: SAX.mono,
} as const;


// The page background: the dungeon tint (warm brass lamp glow + a LIGHT ink darkening, since the
// wall is already dark) over the real /wall-2.png. Mirrors stoneBackground() but re-tinted for
// the Forge. Pass a different url only for a themed room.
export function forgeBackground(url = "/wall-2.png"): CSSProperties {
  // The whole background is one CSS variable so a system can replace it wholesale (Lancer swaps the
  // stone wall for a gunmetal terminal grid, no image asset needed). The fallback reproduces the
  // dungeon look exactly: warm lamp glow + a light ink darkening over the wall, on the deep-ink base.
  // backgroundAttachment stays a separate longhand so it survives the shorthand and keeps the wall fixed.
  return {
    background: `var(--sax-page-bg, radial-gradient(ellipse 66% 44% at 50% 12%, rgba(184,135,74,0.16), transparent 62%), linear-gradient(180deg, rgba(18,13,8,0.28), rgba(10,7,4,0.52)), url(${url}) center / cover no-repeat #0B0712)`,
    backgroundAttachment: "fixed",
  };
}

// The edge vignette (matches PageShell's), as a style for a fixed full-bleed div.
export const forgeVignette: CSSProperties = {
  position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
  background: "radial-gradient(ellipse 80% 64% at 50% 40%, transparent 46%, rgba(8,5,3,0.62) 100%)",
};

// A carved stone panel: a translucent block so the wall texture reads through the face, with a
// bright top-left bevel, dark bottom-right, sunk into a mortar seam. The signature surface.
export function stonePanel(): CSSProperties {
  return {
    background:
      "var(--forge-panel-bg, linear-gradient(160deg, rgba(52,47,39,0.80) 0%, rgba(38,34,28,0.85) 45%, rgba(22,19,15,0.90) 100%))",
    borderRadius: FORGE_RADIUS,
    padding: "24px 26px",
    position: "relative",
    boxShadow: [
      "inset 1px 1px 0 rgba(255,235,200,0.13)",
      "inset -1px -1px 0 rgba(0,0,0,0.6)",
      "inset 0 0 46px rgba(0,0,0,0.4)",
      "0 5px 14px rgba(0,0,0,0.6)",
      `0 0 0 1px ${STONE.mortar}`,
      "0 0 0 2px var(--sax-panel-frame, transparent)",
      "0 0 0 3px rgba(0,0,0,0.4)",
    ].join(","),
  };
}

export type StoneButtonVariant = "stone" | "primary" | "danger" | "ghost";

// A carved-stone button with real depth: it sits proud on a lip and depresses on :active. The
// :active / :hover states can't live in an inline style, so the page pairs this base with a small
// <style> block keyed on the class names below (see FORGE_BUTTON_CSS). This returns the resting
// style; `variant` picks the material.
export function stoneButton(variant: StoneButtonVariant = "stone"): CSSProperties {
  const base: CSSProperties = {
    fontFamily: FORGE_FONTS.display,
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: "0.1em",
    color: STONE.ink,
    cursor: "pointer",
    userSelect: "none",
    padding: "13px 24px",
    border: "none",
    borderRadius: FORGE_RADIUS,
    position: "relative",
    transition: "transform 0.06s ease, box-shadow 0.06s ease, color 0.15s ease",
    textShadow: "0 -1px 0 rgba(0,0,0,0.7), 0 1px 0 rgba(255,220,180,0.08)",
  };
  if (variant === "primary") {
    return {
      ...base,
      color: "#241a0d",
      background: `linear-gradient(180deg, ${STONE.brassHi} 0%, ${SAX.brass} 52%, ${STONE.brassDeep} 100%)`,
      boxShadow: [
        "inset 0 1px 0 rgba(255,240,210,0.6)", "inset 0 -2px 3px rgba(60,35,10,0.55)",
        "inset 0 0 0 1px rgba(70,45,15,0.5)", "0 4px 0 -1px #3a260f", "0 5px 7px rgba(0,0,0,0.6)",
      ].join(","),
      textShadow: "0 1px 0 rgba(255,240,210,0.4)",
    };
  }
  if (variant === "danger") {
    return {
      ...base,
      background: "linear-gradient(180deg, #7a3e30 0%, #5c2a20 55%, #3a1712 100%)",
      boxShadow: [
        "inset 0 1px 0 rgba(255,180,150,0.2)", "inset 0 -2px 3px rgba(0,0,0,0.5)",
        "inset 0 0 0 1px rgba(0,0,0,0.4)", "0 4px 0 -1px #1c0b08", "0 5px 6px rgba(0,0,0,0.6)",
      ].join(","),
    };
  }
  if (variant === "ghost") {
    return {
      ...base,
      color: STONE.inkDim,
      background: "linear-gradient(180deg, rgba(22,19,15,0.72), rgba(40,36,30,0.72))",
      boxShadow: [
        "inset 1px 1px 3px rgba(0,0,0,0.6)", "inset -1px -1px 0 rgba(255,230,190,0.06)",
        "inset 0 0 0 1px rgba(0,0,0,0.3)",
      ].join(","),
    };
  }
  return {
    ...base,
    background: `linear-gradient(180deg, ${STONE.hi} 0%, ${STONE.face} 55%, ${STONE.shadow} 100%)`,
    boxShadow: [
      "inset 0 1px 0 rgba(255,235,200,0.22)", "inset 0 -2px 3px rgba(0,0,0,0.5)",
      "inset 0 0 0 1px rgba(0,0,0,0.4)", "0 4px 0 -1px #17130d", "0 5px 6px rgba(0,0,0,0.6)",
    ].join(","),
  };
}

// Hover/active depth can't be inline. Pages inject this once; buttons get className "forge-btn"
// plus a variant class ("is-primary" / "is-danger" / "is-ghost").
export const FORGE_BUTTON_CSS = `
.forge-btn:hover{ color:${STONE.brassHi}; }
.forge-btn:active{ transform:translateY(3px);
  box-shadow:inset 0 1px 0 rgba(255,235,200,0.12), inset 0 2px 6px rgba(0,0,0,0.6),
    inset 0 0 0 1px rgba(0,0,0,0.5), 0 1px 0 -1px #17130d, 0 1px 2px rgba(0,0,0,0.6); }
.forge-btn:focus-visible{ outline:2px solid ${SAX.brass}; outline-offset:3px; }
.forge-btn.is-primary:hover{ color:#160f04; }
.forge-btn.is-primary:active{ transform:translateY(3px);
  box-shadow:inset 0 2px 6px rgba(60,35,10,0.6), inset 0 0 0 1px rgba(70,45,15,0.6), 0 1px 0 -1px #3a260f; }
.forge-btn.is-danger:hover{ color:#f0c0a8; }
.forge-btn.is-ghost:hover{ color:${SAX.brass}; }
.forge-btn.is-ghost:active{ transform:none; box-shadow:inset 1px 1px 5px rgba(0,0,0,0.8); }
`;

// A recessed stat slot: a number pressed into the stone. For the live-derived readouts.
export function statTile(): CSSProperties {
  return {
    textAlign: "center",
    padding: "14px 8px 12px",
    borderRadius: FORGE_RADIUS,
    background: "linear-gradient(180deg, rgba(14,11,8,0.78), rgba(6,4,3,0.82))",
    boxShadow: "inset 1px 1px 4px rgba(0,0,0,0.8), inset -1px -1px 0 rgba(255,230,190,0.06)",
  };
}

// A recessed form field (select / input), carved into the stone.
export function stoneField(): CSSProperties {
  return {
    width: "100%",
    fontFamily: FORGE_FONTS.body,
    fontSize: 16,
    color: STONE.ink,
    padding: "11px 14px",
    border: "none",
    borderRadius: FORGE_RADIUS,
    background: "linear-gradient(180deg, rgba(14,11,8,0.82), rgba(40,36,30,0.82))",
    boxShadow: [
      "inset 1px 1px 4px rgba(0,0,0,0.7)", "inset 0 0 0 1px rgba(0,0,0,0.35)",
      "inset -1px -1px 0 rgba(255,230,190,0.05)",
    ].join(","),
    cursor: "pointer",
    appearance: "none",
  };
}

// A brass-highlighted mono chip for tags (level, resistances, senses).
export function stoneChip(tone: "brass" | "moss" = "brass"): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: FORGE_FONTS.mono,
    fontSize: 12,
    color: tone === "moss" ? "#b7c99a" : STONE.brassHi,
    padding: "5px 11px",
    borderRadius: 2,
    margin: "3px 4px 3px 0",
    background: "linear-gradient(180deg, rgba(52,47,39,0.88), rgba(22,19,15,0.88))",
    boxShadow: `inset 0 1px 0 rgba(255,230,190,0.12), inset 0 -1px 2px rgba(0,0,0,0.5), 0 0 0 1px ${STONE.mortar}`,
  };
}

// Carved display heading (Cinzel, pressed into stone).
export const forgeHeading: CSSProperties = {
  fontFamily: FORGE_FONTS.display,
  fontWeight: 700,
  letterSpacing: "0.06em",
  color: STONE.ink,
  textShadow: "0 -1px 0 rgba(0,0,0,0.95), 0 1px 0 rgba(255,230,190,0.10), 0 3px 8px rgba(0,0,0,0.9)",
};

// A panel section label (brass, uppercase Cinzel), and the small mono eyebrow.
export const forgePanelTitle: CSSProperties = {
  fontFamily: FORGE_FONTS.display, fontWeight: 600, fontSize: 15, letterSpacing: "0.16em",
  textTransform: "uppercase", color: SAX.brass, marginBottom: 4,
};
export const forgeLabel: CSSProperties = {
  display: "block", fontFamily: FORGE_FONTS.mono, fontSize: 11, letterSpacing: "0.18em",
  textTransform: "uppercase", color: STONE.inkDim, marginBottom: 7,
};

// The brass divider with a diamond boss (the structural signature). Returns the pieces the page
// assembles; use forgeRule as the flex row and forgeBoss as the center diamond.
export const forgeRuleLine: CSSProperties = {
  height: 2, flex: 1,
  background: "linear-gradient(90deg, transparent, rgba(110,78,38,1) 30%, rgba(200,162,75,1) 100%)",
};
export const forgeBoss: CSSProperties = {
  width: 12, height: 12, transform: "rotate(45deg)",
  background: `linear-gradient(135deg, ${STONE.brassHi}, ${STONE.brassDeep})`,
  boxShadow: `0 0 0 2px ${STONE.mortar}, 0 0 12px rgba(184,135,74,0.6)`,
};


// ---------------------------------------------------------------------------
// C — the compatibility palette
//
// Thirty-four pages each declare their own `const C = { ... }` built from SAX, then reference it
// ~1,100 times as C.surface, C.line, C.muted and so on. Those references are indirection that
// already exists, so the cheapest possible way to bring every page onto the dungeon palette is to
// change what C MEANS rather than touch a single line of JSX.
//
// A page migrates by deleting its local declaration and importing this one. Nothing else changes.
//
// The keys are the UNION of every key those 34 pages use, including the outliers (brass, panel,
// vellum, field, accent, have, missing), so the same import works everywhere and no page needs a
// bespoke mapping.
//
// WATCH THE NAME COLLISION ON `ink`. Pages use C.ink to mean the DARKEST surface — it is what they
// set as text colour on top of a bright brass button (`background: C.brass, color: C.ink`). That is
// the opposite of STONE.ink, which is the pale parchment used for body text. C.ink maps to
// STONE.mortar deliberately. Do not "fix" it to STONE.ink.
//
// Accents were chosen by measuring contrast against the panel face rather than by eye:
//   sun  #C8A24B 6.23   base brass, the primary action
//   plum #e2b878 8.11   bright brass, interactive: links, secondary buttons, active tabs, progress
//   good #9aa880 5.92   moss, lifted for text
//   warn #d97d6d 5.07   blood, lifted for text
// All four clear AA. The tradeoff accepted here is that sun and plum are two VALUES of one hue
// rather than two hues: the dungeon palette carries brass, moss and blood and nothing else, so
// primary and secondary now read as a hierarchy instead of as different colours.
// ---------------------------------------------------------------------------

export const C = {
  // Surfaces, darkest to lightest.
  bg: STONE.mortar,
  ink: STONE.mortar,        // page-local meaning: darkest, text-on-brass. NOT STONE.ink.
  inkDeep: STONE.mortar,
  surface2: STONE.shadow,
  panel2: STONE.shadow,
  field: STONE.shadow,
  surface: STONE.face,
  panel: STONE.face,
  line: STONE.hi,

  // Type.
  text: STONE.ink,
  vellum: STONE.ink,
  muted: STONE.inkDim,

  // Accents.
  sun: SAX.brass,
  brass: SAX.brass,
  brassDim: STONE.brassDeep,
  sunSoft: STONE.brassHi,
  plum: STONE.brassHi,
  accent: STONE.brassHi,
  good: STONE.mossLit,
  have: STONE.mossLit,
  agree: STONE.mossLit,
  warn: STONE.bloodLit,
  missing: STONE.bloodLit,
  disagree: STONE.bloodLit,

  // A translucent darker wash used over the wall, distinct from a solid surface.
  ink2: "rgba(0,0,0,0.34)",

  // PARCHMENT stays parchment. These are DARK INK ON A LIGHT CARD - the disposition inventory
  // prints its result on a vellum sheet - so mapping them onto STONE.ink (pale parchment TEXT)
  // would invert the card into unreadable light-on-light. The stone palette has no light surface
  // to map them to, and inventing one would change a deliberate design rather than retone it.
  vellumInk: SAX.parchInk,
  vellumLine: SAX.parchLine,
  parch: SAX.parch,
} as const;

// The six axes keep their own colours. They are DATA ENCODING, not chrome: the same hue means the
// same axis in every chart, chip and readout, and it is the product's visual identity. Restyling
// them to fit the stone palette would break that language everywhere at once for no gain.
export const AXIS_COLOR = {
  N: "#B7615A", T: "#C8A24B", O: "#4E8077", S: "#CE8A42", E: "#6C76B0", I: "#9A93B0",
} as const;
export const AXIS_NAME = {
  N: "Voice", T: "Tactics", O: "Arcana", S: "Rapport", E: "Exploration", I: "Nerve",
} as const;
