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
// shells cannot drift apart from each other or from the home page.

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
  --forge-btn-stone-bg: #232c3c;
  --forge-btn-stone-shadow: inset 0 0 0 1px rgba(174,180,190,0.22);
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

/* layout */
.sn-wrap { max-width: 1320px; margin: 0 auto; padding: 0 40px; }
.sn-body { flex: 1 0 auto; width: 100%; max-width: 860px; margin: 0 auto; padding: 56px 40px 40px; }
.sn-head { margin-bottom: 30px; }
.sn-eyebrow { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; font-size: 16px; font-weight: 700; color: var(--sn-amber-hi); }
.sn-eyebrow a { margin-left: auto; font-weight: 600; color: var(--sn-amber-hi); text-decoration: none; }
.sn-eyebrow a:hover { text-decoration: underline; text-underline-offset: 3px; }
.sn-h1 { font-family: var(--sn-display); font-weight: 800; font-size: 54px; line-height: 1.04; letter-spacing: -0.01em; color: var(--sn-ink); margin: 0 0 14px; }
.sn-lead { font-size: 20px; line-height: 1.55; color: var(--sn-dim); margin: 0; max-width: 34em; }
.sn-rule { height: 1px; background: var(--sn-line2); margin: 30px 0 34px; border: 0; }

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

/* buttons (matches the home page) */
.sn-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 50px; padding: 0 24px; border-radius: 8px;
  font-family: var(--sn-body); font-weight: 700; font-size: 17px; text-decoration: none; transition: background .2s, border-color .2s, color .2s; }
.sn-btn-fill { background: var(--sn-amber); color: var(--sn-amber-ink); box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 0 rgba(0,0,0,0.35); }
.sn-btn-fill:hover { background: var(--sn-amber-hi); }
.sn-btn-ghost { border: 1.5px solid rgba(232,228,218,0.45); color: var(--sn-ink); }
.sn-btn-ghost:hover { border-color: var(--sn-ink); }
.sn-btn-sm { min-height: 44px; padding: 0 16px; font-size: 15px; }

/* the forge buttons inside page and tool bodies: inline styles carry the night values through the
   --forge-btn-* variables; these rules only fix the hover and press states, which inline styles block */
.sax-night .forge-btn { transition: filter .2s, color .2s; text-decoration: none; }
.sax-night .forge-btn:active { transform: none; }
.sax-night .forge-btn.is-primary:hover { filter: brightness(1.08); color: var(--sn-amber-ink) !important; }
.sax-night .forge-btn.is-ghost:hover { color: var(--sn-amber-hi) !important; box-shadow: inset 0 0 0 1.5px var(--sn-ink) !important; }
.sax-night .forge-btn:not(.is-primary):not(.is-ghost):hover { color: var(--sn-amber-hi) !important; }

/* a plain card, the same as the home page's */
.sn-card { background: var(--sn-card); border: 1px solid var(--sn-line2); border-radius: 10px; padding: 28px 30px; }
.sn-card h2 { font-family: var(--sn-display); font-weight: 800; font-size: 30px; line-height: 1.1; margin: 0 0 10px; color: var(--sn-ink); }
.sn-card p { color: var(--sn-dim); margin: 0 0 14px; max-width: 34em; }
.sn-ctas { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 18px; }

/* page-body components whose hover or tab states live in class CSS rather than inline styles */
.sax-night .tool-card:hover { box-shadow: 0 0 0 1px rgba(224,168,74,0.5) !important; }
.sax-night .feat-tab { background: var(--sn-bg2); box-shadow: inset 0 0 0 1px var(--sn-line2);
  font-family: var(--sn-body); font-size: 16px; letter-spacing: 0; color: var(--sn-dim); }
.sax-night .feat-tab:hover { color: var(--sn-ink); }
.sax-night .feat-tab.is-on { background: var(--sn-amber); color: var(--sn-amber-ink); box-shadow: none; }

/* footer (matches the home page) */
.sn-foot { border-top: 1px solid var(--sn-line2); background: var(--sn-band); margin-top: 40px; }
.sn-foot-note { padding-top: 24px; font-size: 15px; color: var(--sn-faint); margin: 0; }
.sn-foot-in { display: flex; justify-content: space-between; gap: 18px; flex-wrap: wrap; padding-top: 24px; padding-bottom: 32px; font-size: 15px; color: var(--sn-faint); }
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
.sax-night .sax-mm-cta { min-height: 46px; display: flex; align-items: center; justify-content: center; }

@media (max-width: 980px) {
  .sax-night { font-size: 17px; }
  .sn-wrap { padding: 0 20px; }
  .sn-body { padding: 36px 20px 28px; }
  .sn-nav { gap: 0; margin-left: auto; }
  .sn-navlink { display: none; }
  .sax-night .sax-mm { display: block; }
  .sax-night .sax-mm-btn { width: 44px; height: 44px; margin-left: 10px; }
  .sn-top-in { gap: 8px; }
  .sn-h1 { font-size: 40px; }
  .sn-lead { font-size: 18px; }
  .sn-card { padding: 22px 20px; }
  .sn-card h2 { font-size: 26px; }
  .sn-brand, .sn-by, .sn-foot-links a, .sn-foot-maker, .sn-eyebrow a { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; }
  .sn-foot-links { gap: 0 20px; }
}
@media (max-width: 520px) {
  .sn-by { display: none !important; }
  .sn-btn-sm { padding: 0 12px; font-size: 14px; }
  .sn-h1 { font-size: 36px; }
}
@media (prefers-reduced-motion: reduce) {
  .sn-btn, .sax-night .forge-btn { transition: none; }
}
`;
