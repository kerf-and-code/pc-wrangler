// Per-system ambient theme, applied as CSS custom properties. The feel-carrying tokens in lib/theme.ts
// (SAX / STONE / the fonts / the page background / the panel material) read `var(--x, <default>)`, and
// SystemThemeProvider sets those variables on <html> from the active campaign's system. Everything that
// reads them (directly or through the `C` palette in forge-theme) re-skins at once, with no per-page edits.
//
// WHY JS, NOT A STYLESHEET: an earlier version injected a `<style>` with `[data-system="..."]` rules in
// the document head. In the App Router that head injection is unreliable, and when it doesn't land the
// variables silently fall back to the dungeon defaults. Setting the variables directly on the element via
// style.setProperty (see SystemThemeProvider) cannot fail that way.
//
// FONTS: --forge-display / --forge-body / --forge-mono point at the per-system webfonts loaded in
// app/layout.tsx (next/font, exposed as --font-*). The system-font stacks after each var are the fallback
// used until the webfont paints. D&D keeps Cinzel + the system serif exactly as before.
//
// LICENSING: each look EVOKES the game's aesthetic; it never reproduces a publisher's logos, wordmarks, or
// art.

type Vars = Record<string, string>;

// The dungeon default (byte-identical to the values baked as fallbacks in lib/theme.ts). D&D and its
// 5e-compatible settings use this. Every other theme is this map with a handful of tokens overridden, so
// all keys are always present and switching systems fully repaints.
const DEFAULT: Vars = {
  "--sax-ink": "#140E1F",
  "--sax-ink-deep": "#0B0712",
  "--sax-line": "#3A2C4E",
  "--sax-accent": "#C8A24B",
  "--sax-accent-dim": "#7A632E",
  "--sax-accent-hi": "#e2b878",
  "--sax-accent-deep": "#6e4e26",
  "--sax-text": "#F1E9F7",
  "--sax-muted": "#A091B8",
  "--sax-good": "#5DBE9A",
  "--sax-warn": "#E07A5F",
  "--stone-face": "#2b2620",
  "--stone-lit": "#3a342b",
  "--stone-hi": "#4a4237",
  "--stone-shadow": "#1a1611",
  "--stone-mortar": "#0c0a07",
  "--stone-ink": "#e8dcc4",
  "--stone-ink-dim": "#a99e86",
  "--stone-ink-faint": "#8a8069",
  "--stone-moss-lit": "#9aa880",
  "--stone-blood-lit": "#d97d6d",
  "--forge-display": "var(--font-cinzel), 'Cinzel', 'Iowan Old Style', Georgia, serif",
  "--forge-body": "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  "--forge-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
  "--forge-panel-bg": "linear-gradient(160deg, rgba(52,47,39,0.80) 0%, rgba(38,34,28,0.85) 45%, rgba(22,19,15,0.90) 100%)",
  "--forge-slate-bg": "linear-gradient(180deg, rgba(38,34,28,0.94), rgba(24,21,17,0.96))",
  "--sax-page-bg": "radial-gradient(ellipse 66% 44% at 50% 12%, rgba(184,135,74,0.16), transparent 62%), linear-gradient(180deg, rgba(18,13,8,0.28), rgba(10,7,4,0.52)), url(/wall-2.png) center / cover no-repeat #0B0712",
};

// Lancer: NavSat / COMP-CON terminal. Gunmetal, a faint technical grid, teal readout, amber alerts,
// squared technical display (Chakra Petch) with a monospace readout (JetBrains Mono).
const LANCER: Vars = {
  ...DEFAULT,
  "--sax-ink": "#0c1116", "--sax-ink-deep": "#070a0d", "--sax-line": "#26333d",
  "--sax-accent": "#37b6c6", "--sax-accent-dim": "#1c5a61", "--sax-accent-hi": "#6fe3ef", "--sax-accent-deep": "#12707b",
  "--sax-text": "#e2ebf0", "--sax-muted": "#7f929d", "--sax-good": "#4fc98a", "--sax-warn": "#e8974b",
  "--stone-face": "#18212a", "--stone-lit": "#22303a", "--stone-hi": "#2e404c", "--stone-shadow": "#0f171d", "--stone-mortar": "#05090c",
  "--stone-ink": "#e2ebf0", "--stone-ink-dim": "#93a6b1", "--stone-ink-faint": "#6a7c87",
  "--stone-moss-lit": "#57cf9a", "--stone-blood-lit": "#ef9a5a",
  "--forge-display": "var(--font-chakra), 'Chakra Petch', 'Bahnschrift', ui-monospace, monospace",
  "--forge-body": "ui-sans-serif, 'Segoe UI', system-ui, 'Helvetica Neue', sans-serif",
  "--forge-mono": "var(--font-jetbrains), ui-monospace, SFMono-Regular, Menlo, monospace",
  "--forge-panel-bg": "linear-gradient(160deg, rgba(30,42,52,0.86) 0%, rgba(20,29,36,0.9) 45%, rgba(12,18,23,0.94) 100%)",
  "--forge-slate-bg": "linear-gradient(180deg, rgba(22,31,39,0.95), rgba(12,18,23,0.97))",
  "--sax-page-bg": "radial-gradient(ellipse 72% 46% at 50% 8%, rgba(55,182,198,0.10), transparent 60%), linear-gradient(0deg, rgba(7,10,13,0.55), rgba(7,10,13,0.55)), repeating-linear-gradient(0deg, transparent 0 39px, rgba(120,150,165,0.045) 39px 40px), repeating-linear-gradient(90deg, transparent 0 39px, rgba(120,150,165,0.045) 39px 40px), #0a0e12",
};

// Pathfinder 2e: heraldic crimson and gold, an ornate inscription serif (Cinzel Decorative) over a book
// serif (EB Garamond), deep oxblood surfaces.
const PF2E: Vars = {
  ...DEFAULT,
  "--sax-ink": "#1a0f10", "--sax-ink-deep": "#0f0708", "--sax-line": "#4a2226",
  "--sax-accent": "#cf9b34", "--sax-accent-dim": "#7c5c1c", "--sax-accent-hi": "#ecc85e", "--sax-accent-deep": "#6b4e14",
  "--sax-text": "#f2e6d4", "--sax-muted": "#b79a8e", "--sax-good": "#7fb07a", "--sax-warn": "#d9503f",
  "--stone-face": "#2a1516", "--stone-lit": "#3a1d1f", "--stone-hi": "#4c2528", "--stone-shadow": "#190c0d", "--stone-mortar": "#0a0405",
  "--stone-ink": "#f2e6d4", "--stone-ink-dim": "#c2a898", "--stone-ink-faint": "#9c8072",
  "--stone-moss-lit": "#8bb07f", "--stone-blood-lit": "#e0715f",
  "--forge-display": "var(--font-cinzel-dec), 'Cinzel', 'Trajan Pro', Georgia, serif",
  "--forge-body": "var(--font-garamond), 'Palatino Linotype', Palatino, Georgia, serif",
  "--forge-panel-bg": "linear-gradient(160deg, rgba(60,28,30,0.85) 0%, rgba(42,20,22,0.9) 45%, rgba(24,11,12,0.94) 100%)",
  "--forge-slate-bg": "linear-gradient(180deg, rgba(42,20,22,0.95), rgba(24,11,12,0.97))",
  "--sax-page-bg": "radial-gradient(ellipse 66% 44% at 50% 12%, rgba(207,155,52,0.12), transparent 60%), linear-gradient(180deg, rgba(26,10,11,0.55), rgba(12,5,6,0.8)), #100708",
};

// Draw Steel: heroic steel. Cool slate surfaces with a bold ember-red action and a strong condensed
// display (Oswald) over a clean sans.
const DRAWSTEEL: Vars = {
  ...DEFAULT,
  "--sax-ink": "#0f1317", "--sax-ink-deep": "#080b0e", "--sax-line": "#2c353d",
  "--sax-accent": "#dc5230", "--sax-accent-dim": "#7c3320", "--sax-accent-hi": "#f4835f", "--sax-accent-deep": "#8a2f18",
  "--sax-text": "#e9edf1", "--sax-muted": "#8b98a3", "--sax-good": "#5bbf8e", "--sax-warn": "#e9b13f",
  "--stone-face": "#1c232a", "--stone-lit": "#28313a", "--stone-hi": "#35414c", "--stone-shadow": "#121820", "--stone-mortar": "#070a0d",
  "--stone-ink": "#e9edf1", "--stone-ink-dim": "#9aa7b1", "--stone-ink-faint": "#71808b",
  "--stone-moss-lit": "#61c795", "--stone-blood-lit": "#f0805c",
  "--forge-display": "var(--font-oswald), 'Bahnschrift', 'Arial Narrow', sans-serif",
  "--forge-body": "ui-sans-serif, 'Segoe UI', system-ui, 'Helvetica Neue', sans-serif",
  "--forge-panel-bg": "linear-gradient(160deg, rgba(32,40,48,0.86) 0%, rgba(22,29,36,0.9) 45%, rgba(14,19,24,0.94) 100%)",
  "--forge-slate-bg": "linear-gradient(180deg, rgba(24,31,38,0.95), rgba(14,19,24,0.97))",
  "--sax-page-bg": "radial-gradient(ellipse 70% 46% at 50% 8%, rgba(220,82,48,0.12), transparent 58%), linear-gradient(180deg, rgba(12,16,20,0.5), rgba(7,10,13,0.8)), #0a0e12",
};

// Daggerheart: warm painterly high fantasy. Plum surfaces, gold and rose, an elegant display (Marcellus)
// over a book serif (EB Garamond).
const DAGGERHEART: Vars = {
  ...DEFAULT,
  "--sax-ink": "#1a1329", "--sax-ink-deep": "#0f0a1a", "--sax-line": "#3c2f52",
  "--sax-accent": "#d9a441", "--sax-accent-dim": "#836329", "--sax-accent-hi": "#f0cf78", "--sax-accent-deep": "#6f5220",
  "--sax-text": "#f3ecf7", "--sax-muted": "#a99bc0", "--sax-good": "#66c2a6", "--sax-warn": "#e58aa0",
  "--stone-face": "#271c3a", "--stone-lit": "#33264b", "--stone-hi": "#41335d", "--stone-shadow": "#170f24", "--stone-mortar": "#0a0613",
  "--stone-ink": "#f3ecf7", "--stone-ink-dim": "#b9abce", "--stone-ink-faint": "#8f81a6",
  "--stone-moss-lit": "#7fcfb2", "--stone-blood-lit": "#eb9db0",
  "--forge-display": "var(--font-marcellus), 'Cinzel', Georgia, serif",
  "--forge-body": "var(--font-garamond), 'Iowan Old Style', Palatino, Georgia, serif",
  "--forge-panel-bg": "linear-gradient(160deg, rgba(52,40,74,0.82) 0%, rgba(38,28,56,0.88) 45%, rgba(23,16,36,0.92) 100%)",
  "--forge-slate-bg": "linear-gradient(180deg, rgba(40,30,58,0.94), rgba(24,17,37,0.96))",
  "--sax-page-bg": "radial-gradient(ellipse 68% 46% at 50% 10%, rgba(217,164,65,0.12), transparent 60%), linear-gradient(180deg, rgba(26,17,42,0.5), rgba(13,8,22,0.8)), #0f0a1a",
};

// Call of Cthulhu: 1920s. Aged sepia and olive-dark surfaces, a sickly green accent, a distressed
// typewriter display (Special Elite) over a clean typewriter body (Courier Prime).
const COC: Vars = {
  ...DEFAULT,
  "--sax-ink": "#16150f", "--sax-ink-deep": "#0d0c08", "--sax-line": "#3a3826",
  "--sax-accent": "#8a9a52", "--sax-accent-dim": "#565e31", "--sax-accent-hi": "#b6c47f", "--sax-accent-deep": "#454b28",
  "--sax-text": "#e5dcc2", "--sax-muted": "#a39a7f", "--sax-good": "#94a86a", "--sax-warn": "#bd6a4a",
  "--stone-face": "#26241a", "--stone-lit": "#312f22", "--stone-hi": "#3f3c2c", "--stone-shadow": "#181610", "--stone-mortar": "#0a0906",
  "--stone-ink": "#e5dcc2", "--stone-ink-dim": "#ada484", "--stone-ink-faint": "#877e63",
  "--stone-moss-lit": "#a8b57f", "--stone-blood-lit": "#cf8062",
  "--forge-display": "var(--font-special-elite), 'Courier New', Courier, monospace",
  "--forge-body": "var(--font-courier-prime), 'Courier New', Courier, monospace",
  "--forge-mono": "var(--font-courier-prime), ui-monospace, SFMono-Regular, monospace",
  "--forge-panel-bg": "linear-gradient(160deg, rgba(44,42,30,0.86) 0%, rgba(34,32,22,0.9) 45%, rgba(20,19,13,0.94) 100%)",
  "--forge-slate-bg": "linear-gradient(180deg, rgba(34,32,22,0.95), rgba(20,19,13,0.97))",
  "--sax-page-bg": "radial-gradient(ellipse 66% 44% at 50% 14%, rgba(138,154,82,0.09), transparent 60%), linear-gradient(180deg, rgba(22,21,14,0.5), rgba(11,10,7,0.82)), #100f0a",
};

// The generic d10 pool (unbranded Vampire): gothic. Near-black surfaces, blood red, a gothic display
// (Pirata One) over an old-print serif (IM Fell English).
const POOLD10: Vars = {
  ...DEFAULT,
  "--sax-ink": "#120b0d", "--sax-ink-deep": "#0a0507", "--sax-line": "#3a1e22",
  "--sax-accent": "#a51f2c", "--sax-accent-dim": "#5e1219", "--sax-accent-hi": "#d94452", "--sax-accent-deep": "#4c0e14",
  "--sax-text": "#e9dede", "--sax-muted": "#9c8388", "--sax-good": "#7aa080", "--sax-warn": "#d24a52",
  "--stone-face": "#1c1214", "--stone-lit": "#271719", "--stone-hi": "#341f22", "--stone-shadow": "#120a0c", "--stone-mortar": "#070303",
  "--stone-ink": "#e9dede", "--stone-ink-dim": "#b09aa0", "--stone-ink-faint": "#877075",
  "--stone-moss-lit": "#8aa88f", "--stone-blood-lit": "#e06068",
  "--forge-display": "var(--font-pirata), 'Cinzel', 'Times New Roman', Georgia, serif",
  "--forge-body": "var(--font-imfell), 'Times New Roman', Georgia, 'Palatino Linotype', serif",
  "--forge-panel-bg": "linear-gradient(160deg, rgba(40,22,25,0.86) 0%, rgba(28,16,18,0.9) 45%, rgba(16,9,10,0.94) 100%)",
  "--forge-slate-bg": "linear-gradient(180deg, rgba(28,16,18,0.95), rgba(16,9,10,0.97))",
  "--sax-page-bg": "radial-gradient(ellipse 64% 44% at 50% 12%, rgba(165,31,44,0.10), transparent 58%), linear-gradient(180deg, rgba(18,10,12,0.55), rgba(8,4,5,0.85)), #0a0507",
};

const SYSTEM_THEME_VARS: Record<string, Vars> = {
  default: DEFAULT,
  lancer: LANCER,
  pf2e: PF2E,
  drawsteel: DRAWSTEEL,
  daggerheart: DAGGERHEART,
  coc7e: COC,
  poold10: POOLD10,
};

// D&D and its 5e-compatible settings keep the dungeon default.
const DND_FAMILY = new Set(["5e", "2014", "5.5e", "dnd5e", "darkmatter"]);

// The variable set to apply for a campaign's system. Unknown or D&D-family systems get the default.
export function resolveSystemVars(system: string | null | undefined): Vars {
  const sys = system || "default";
  if (DND_FAMILY.has(sys)) return DEFAULT;
  return SYSTEM_THEME_VARS[sys] ?? DEFAULT;
}

// Systems that ship a distinct look (for reference / tests).
export const THEMED_SYSTEMS = Object.keys(SYSTEM_THEME_VARS).filter((k) => k !== "default");
