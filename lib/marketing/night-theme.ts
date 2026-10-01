// lib/marketing/night-theme.ts
//
// The "night table" palette for the public marketing site (palette C, chosen 2026-09). The home page
// carries its own copy of these values in app/page.tsx; this file brings every other public page onto
// the same look through SiteShell and ToolsShell.
//
// HOW IT WORKS: the app's theme tokens (SAX, STONE, the forge helpers) all resolve to CSS variables.
// NIGHT_CSS sets those variables on the `.sax-night` element a shell renders as its root, so everything
// inside it (page bodies, forms, tool panels, buttons) re-tones with no per-page edits. The signed-in app
// never renders `.sax-night`, so it keeps the forge look and its per-system themes.
//
// NIGHT_CSS also holds the shared chrome (top bar, page heading, footer, buttons, mobile menu) so the two
// shells cannot drift apart from each other or from the home page, plus the inner-page layout system:
//   .sn-wrap        the home page's column geometry (1320px, 1520px from 1280px up, 40px gutters)
//   .sn-main        the content column inside it; .is-narrow caps it at 1040px for forms and short pages
//   .sn-split       40/60 two-column layout, the home page's split
//   .sn-toolgrid    a tool page: the tool in the 60% column, its explainer (the last child) in the 40%
//   .fx-*           opt-in classes on shared tool components; they only take effect inside .sax-night,
//                   so the same component keeps its forge look inside the app.

export const NIGHT_CLASS = "sax-night";

export const NIGHT_CSS = `
.sax-night {
  /* palette C, as on the home page */
  --sn-bg: #0f141c; --sn-bg2: #151b25; --sn-band: #0a0e14; --sn-card: #1b2230;
  --sn-ink: #e8e4da; --sn-dim: #aeb4be; --sn-faint: #959daa;
  --sn-line: rgba(224,168,74,0.25); --sn-line2: rgba(174,180,190,0.16);
  --sn-amber: #e0a84a; --sn-amber-hi: #ecbf6e; --sn-amber-ink: #1a1206;
  --sn-display: var(--font-garamond, 'EB Garamond'), Georgia, serif;
  --sn-body: var(--font-source-sans, 'Source Sans 3'), system-ui, sans-serif;

  /* the app's theme variables, mapped onto the night palette */
  --sax-ink: #0a0e14; --sax-ink-deep: #070a0f; --sax-line: #2a3240;
  --sax-accent: #e0a84a; --sax-accent-dim: #7a5a26; --sax-accent-hi: #ecbf6e; --sax-accent-deep: #9c6e22;
  --sax-text: #e8e4da; --sax-muted: #aeb4be; --sax-good: #7cc49a; --sax-warn: #e8907e;
  --stone-face: #1b2230; --stone-lit: #232c3c; --stone-hi: #2e3848; --stone-shadow: #151b25; --stone-mortar: #0a0e14;
  --stone-ink: #e8e4da; --stone-ink-dim: #aeb4be; --stone-ink-faint: #959daa;
  --stone-moss-lit: #9cc79a; --stone-blood-lit: #e8907e;
  --forge-display: var(--sn-display);
  --forge-body: var(--sn-body);
  --forge-mono: var(--sn-body);
  --forge-panel-bg: #1b2230;
  --forge-slate-bg: #151b25;
  --sax-page-bg: #0f141c;
  --sax-radius: 8px;
  --sax-panel-frame: transparent;

  /* the forge helper hooks (lib/forge-theme.ts): flat surfaces, hairline borders, no carved bevels */
  --forge-panel-shadow: 0 0 0 1px rgba(174,180,190,0.16);
  --forge-btn-font: var(--sn-body);
  --forge-btn-weight: 700;
  --forge-btn-size: 16px;
  --forge-btn-tracking: 0;
  --forge-btn-text-shadow: none;
  --forge-btn-primary-bg: #e0a84a;
  --forge-btn-primary-ink: #1a1206;
  --forge-btn-primary-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 0 rgba(0,0,0,0.35);
  --forge-btn-ghost-bg: transparent;
  --forge-btn-ghost-ink: #e8e4da;
  --forge-btn-ghost-shadow: inset 0 0 0 1.5px rgba(232,228,218,0.45);
  --forge-btn-stone-bg: transparent;
  --forge-btn-stone-shadow: inset 0 0 0 1.5px rgba(232,228,218,0.45);
  --forge-label-font: var(--sn-body);
  --forge-label-size: 15px;
  --forge-label-weight: 600;
  --forge-label-tracking: 0;
  --forge-label-case: none;
  --forge-label-color: #e8e4da;
  --forge-field-bg: #0f141c;
  --forge-field-shadow: inset 0 0 0 1px rgba(174,180,190,0.28);
  --forge-chip-bg: rgba(224,168,74,0.08);
  --forge-chip-shadow: inset 0 0 0 1px rgba(224,168,74,0.3);
  --forge-tile-bg: #0f141c;
  --forge-tile-shadow: inset 0 0 0 1px rgba(174,180,190,0.16);
  --forge-rule-bg: linear-gradient(90deg, transparent, rgba(224,168,74,0.6));
  --forge-heading-shadow: none;
  --forge-card-bg: #1b2230;
  --forge-card-shadow: 0 0 0 1px rgba(174,180,190,0.16);
  --forge-frame-bg: #0f141c;
  --forge-frame-shadow: 0 0 0 1px rgba(174,180,190,0.16);

  background: var(--sn-bg); color: var(--sn-ink); font-family: var(--sn-body);
  font-size: 18px; line-height: 1.6; min-height: 100vh; overflow-x: clip;
  display: flex; flex-direction: column;
}
.sax-night *, .sax-night *::before, .sax-night *::after { box-sizing: border-box; }
.sax-night a:focus-visible, .sax-night summary:focus-visible, .sax-night button:focus-visible,
.sax-night input:focus-visible, .sax-night select:focus-visible, .sax-night textarea:focus-visible {
  outline: 2px solid var(--sn-amber-hi); outline-offset: 3px;
}
.sax-night input::placeholder, .sax-night textarea::placeholder { color: var(--sn-faint); opacity: 1; }
.sn-main input:not([type=checkbox]):not([type=radio]):not([type=range]), .sn-main select { min-height: 46px; }
.sn-skip { position: absolute; left: 12px; top: -80px; z-index: 50; background: var(--sn-amber); color: var(--sn-amber-ink);
  font-weight: 700; padding: 12px 18px; border-radius: 8px; text-decoration: none; }
.sn-skip:focus { top: 12px; }

/* layout: the same column geometry as the home page */
.sn-wrap { max-width: 1320px; margin: 0 auto; padding: 0 40px; width: 100%; }
@media (min-width: 1280px) { .sn-wrap { max-width: 1520px; } }
.sn-body { flex: 1 0 auto; padding-top: 64px; padding-bottom: 48px; }
.sn-main.is-narrow { max-width: 1040px; }
.sn-head { margin-bottom: 36px; max-width: 900px; }
.sn-crumb { margin: 0 0 12px; font-size: 16px; color: var(--sn-dim); }
.sn-crumb a { color: var(--sn-dim); text-decoration: underline; text-decoration-color: rgba(174,180,190,0.45); text-underline-offset: 3px; }
.sn-crumb a:hover { color: var(--sn-ink); }
.sn-h1 { font-family: var(--sn-display); font-weight: 800; font-size: 58px; line-height: 1.03; letter-spacing: -0.01em; color: var(--sn-ink); margin: 0 0 16px; }
.sn-lead { font-size: 20px; line-height: 1.55; color: var(--sn-dim); margin: 0; max-width: 34em; }
.sn-rule { height: 1px; background: var(--sn-line2); margin: 0 0 40px; border: 0; }

/* body type for inner pages: the home page's sizes and measure */
.sn-main p, .sn-main li { font-size: 17px; line-height: 1.65; }
.sn-main p, .sn-main li, .sn-main dd { max-width: 34em; }
.sn-main p a:not([class]), .sn-main li a:not([class]), .sn-main dd a:not([class]) {
  color: var(--sn-amber-hi) !important; text-decoration: underline !important;
  text-decoration-color: rgba(236,191,110,0.45) !important; text-underline-offset: 3px;
}
.sn-h2 { font-family: var(--sn-display); font-weight: 800; font-size: 40px; line-height: 1.06; letter-spacing: -0.01em; color: var(--sn-ink); margin: 0 0 16px; }
.sn-h3 { font-family: var(--sn-display); font-weight: 700; font-size: 26px; line-height: 1.15; color: var(--sn-ink); margin: 0 0 10px; }
.sn-p { color: var(--sn-dim); margin: 0 0 14px; }
.sn-small { font-size: 15px !important; color: var(--sn-faint); }

/* two-column layouts */
.sn-split { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 64px; align-items: start; }
.sn-split.is-flip { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
.sn-sticky { position: sticky; top: 100px; }
.sn-mobile-only { display: none; }
.sn-toolgrid { display: block; }
.sn-toolgrid > :last-child { margin-top: 56px !important; }
@media (min-width: 1100px) {
  .sn-toolgrid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 0 56px; align-items: start; }
  .sn-toolgrid > * { grid-column: 1; min-width: 0; }
  .sn-toolgrid > :last-child { grid-column: 2; grid-row: 1 / span 12; margin-top: 0 !important; }
}

/* scroll reveal (taste brief A4), the home page's values; only active once Reveal has added .sn-js */
.sn-js [data-reveal] { opacity: 0; transform: translateY(24px); transition: opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1), transform 0.7s cubic-bezier(0.22, 1, 0.36, 1); }
.sn-js [data-reveal].is-in { opacity: 1; transform: none; }

/* top bar (matches the home page) */
.sn-top { position: sticky; top: 0; z-index: 30; background: rgba(15,20,28,0.92); border-bottom: 1px solid var(--sn-line2); backdrop-filter: blur(6px); }
.sn-top-in { display: flex; align-items: center; justify-content: space-between; min-height: 68px; }
.sn-brandwrap { display: flex; flex-direction: column; }
.sn-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--sn-ink); font-family: var(--sn-display); font-weight: 700; font-size: 22px; }
.sn-mark { width: 30px; height: 30px; mix-blend-mode: screen; }
.sn-by { font-size: 13px; color: var(--sn-faint); text-decoration: none; padding-left: 40px; line-height: 1.2; }
.sn-by:hover { color: var(--sn-amber-hi); }
.sn-nav { display: flex; align-items: center; gap: 24px; }
.sn-navlink { font-size: 16px; color: var(--sn-dim); text-decoration: none; }
.sn-navlink:hover, .sn-navlink[aria-current="page"] { color: var(--sn-ink); }

/* buttons: exactly two styles, as on the home page */
.sn-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 50px; padding: 0 24px; border-radius: 8px;
  font-family: var(--sn-body); font-weight: 700; font-size: 17px; text-decoration: none; transition: background .2s, border-color .2s, color .2s; }
.sn-btn-fill { background: var(--sn-amber); color: var(--sn-amber-ink); box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 0 rgba(0,0,0,0.35); }
.sn-btn-fill:hover { background: var(--sn-amber-hi); }
.sn-btn-ghost { border: 1.5px solid rgba(232,228,218,0.45); color: var(--sn-ink); }
.sn-btn-ghost:hover { border-color: var(--sn-ink); }
.sn-btn-sm { min-height: 44px; padding: 0 16px; font-size: 15px; }
.sn-textlink { color: var(--sn-amber-hi); text-decoration: underline; text-decoration-color: rgba(236,191,110,0.45); text-underline-offset: 3px; font-weight: 600; }
.sn-ctas { display: flex; gap: 14px 16px; flex-wrap: wrap; align-items: center; margin-top: 22px; }

/* the forge buttons inside page and tool bodies: inline styles carry the night values through the
   --forge-btn-* variables; these rules fix size and the hover and press states, which inline styles block */
.sax-night .forge-btn { transition: filter .2s, color .2s; text-decoration: none; min-height: 50px; display: inline-flex; align-items: center; justify-content: center; }
.sax-night .forge-btn:active { transform: none; }
.sax-night .forge-btn.is-primary:hover { filter: brightness(1.08); color: var(--sn-amber-ink) !important; }
.sax-night .forge-btn.is-ghost:hover, .sax-night .forge-btn:not(.is-primary):not(.is-danger):hover {
  color: var(--sn-ink) !important; box-shadow: inset 0 0 0 1.5px var(--sn-ink) !important;
}

/* a plain card, the same as the home page's */
.sn-card { background: var(--sn-card); border: 1px solid var(--sn-line2); border-radius: 10px; padding: 28px 30px; }
.sn-card h2 { font-family: var(--sn-display); font-weight: 800; font-size: 30px; line-height: 1.1; margin: 0 0 10px; color: var(--sn-ink); }
.sn-card p { color: var(--sn-dim); margin: 0 0 14px; }
.sn-figure { margin: 0; }
.sn-figure img { display: block; width: 100%; height: auto; border-radius: 10px; border: 1px solid var(--sn-line2); box-shadow: 0 24px 60px rgba(0,0,0,0.5); }
.sn-figure figcaption { font-size: 15px; color: var(--sn-faint); margin-top: 10px; }

/* shared tool components: opt-in classes, active only inside .sax-night (the app keeps its forge look) */
.sax-night .fx-label { font-family: var(--sn-body) !important; font-size: 15px !important; font-weight: 600 !important;
  letter-spacing: 0 !important; text-transform: none !important; color: var(--sn-ink) !important; }
.sax-night .fx-hint { font-family: var(--sn-body) !important; font-size: 15px !important; line-height: 1.55 !important; color: var(--sn-faint) !important; font-style: normal !important; }
.sax-night .fx-die, .sax-night .fx-chip { font-family: var(--sn-body) !important; font-size: 16px !important; letter-spacing: 0 !important;
  text-transform: none !important; min-height: 44px; min-width: 48px; padding: 0 14px !important; border-radius: 8px !important;
  background: transparent !important; border: 1px solid rgba(174,180,190,0.28) !important; color: var(--sn-ink) !important; }
.sax-night .fx-die:hover, .sax-night .fx-chip:hover { border-color: var(--sn-ink) !important; }
.sax-night .fx-chip[aria-pressed="true"] { background: #232c3c !important; border-color: var(--sn-ink) !important;
  box-shadow: inset 0 -2px 0 var(--sn-ink); font-weight: 700; }
.sax-night .fx-primary { background: var(--sn-amber) !important; color: var(--sn-amber-ink) !important; font-family: var(--sn-body) !important;
  font-size: 17px !important; font-weight: 700 !important; letter-spacing: 0 !important; text-transform: none !important;
  min-height: 50px; padding: 0 32px !important; border-radius: 8px !important; box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 0 rgba(0,0,0,0.35) !important; }
.sax-night .fx-primary:hover:not(:disabled) { background: var(--sn-amber-hi) !important; }
.sax-night .fx-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.sax-night .fx-panel { padding: 22px 24px !important; }

/* page-body components whose states live in class CSS rather than inline styles */
.sax-night .tool-card:hover { box-shadow: 0 0 0 1px rgba(232,228,218,0.5) !important; }
.sax-night .feat-tab { background: transparent; box-shadow: inset 0 0 0 1px var(--sn-line2);
  font-family: var(--sn-body); font-size: 17px; letter-spacing: 0; color: var(--sn-dim); min-height: 48px; border-radius: 8px; }
.sax-night .feat-tab:hover { color: var(--sn-ink); }
.sax-night .feat-tab.is-on { background: #232c3c; color: var(--sn-ink); box-shadow: inset 3px 0 0 var(--sn-ink); font-weight: 700; }

/* footer (matches the home page) */
.sn-foot { border-top: 1px solid var(--sn-line2); background: var(--sn-band); margin-top: 48px; }
.sn-foot-note { padding-top: 24px; font-size: 15px; color: var(--sn-faint); margin: 0; }
.sn-foot-in { display: flex; justify-content: space-between; gap: 18px; flex-wrap: wrap; padding-top: 28px; padding-bottom: 32px; font-size: 15px; color: var(--sn-faint); }
.sn-foot-maker { color: var(--sn-amber-hi); text-decoration: underline; text-decoration-color: rgba(236,191,110,0.4); text-underline-offset: 3px; }
.sn-foot-links { display: flex; flex-wrap: wrap; gap: 4px 18px; }
.sn-foot-links a { color: var(--sn-dim); text-decoration: none; }
.sn-foot-links a:hover { color: var(--sn-amber-hi); }

/* the shared mobile menu, re-toned */
.sax-night .sax-mm-btn { border-color: var(--sn-line2); background: var(--sn-bg2); }
.sax-night .sax-mm-bars span { background: var(--sn-ink); }
.sax-night .sax-mm-panel { background: #151b25; border-color: var(--sn-line2); }
.sax-night .sax-mm-link { font-family: var(--sn-body); font-size: 17px; letter-spacing: 0; text-transform: none; color: var(--sn-ink); }
.sax-night .sax-mm-link:hover { color: var(--sn-amber-hi); background: rgba(255,255,255,0.04); }
.sax-night .sax-mm-cta { min-height: 46px; display: flex; align-items: center; justify-content: center; font-size: 17px !important; }

@media (max-width: 980px) {
  .sax-night { font-size: 17px; }
  .sn-wrap { padding: 0 20px; }
  .sn-body { padding-top: 36px; padding-bottom: 28px; }
  .sn-nav { gap: 0; margin-left: auto; }
  .sn-navlink { display: none; }
  .sax-night .sax-mm { display: block; }
  .sax-night .sax-mm-btn { width: 44px; height: 44px; margin-left: 10px; }
  .sn-top-in { gap: 8px; }
  .sn-h1 { font-size: 42px; }
  .sn-lead { font-size: 18px; }
  .sn-h2 { font-size: 32px; }
  .sn-h3 { font-size: 23px; }
  .sn-split, .sn-split.is-flip { grid-template-columns: 1fr; gap: 32px; }
  .sn-sticky { position: static; }
  .sn-mobile-only { display: block; }
  .sn-card { padding: 22px 20px; }
  .sn-card h2 { font-size: 26px; }
  .sn-brand, .sn-by, .sn-foot-maker, .sn-crumb a { display: inline-flex; align-items: center; min-height: 44px; }
  .sn-foot-links { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; width: 100%; }
  .sn-foot-links a { display: flex; align-items: center; min-height: 44px; }
}
@media (max-width: 520px) {
  .sn-by { display: none !important; }
  .sn-btn-sm { padding: 0 12px; font-size: 14px; }
  .sn-h1 { font-size: 38px; }
}
@media (prefers-reduced-motion: reduce) {
  .sn-btn, .sax-night .forge-btn { transition: none; }
  .sn-js [data-reveal] { opacity: 1; transform: none; transition: none; }
}
`;
