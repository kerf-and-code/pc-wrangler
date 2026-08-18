// Per-system ambient theme. The app's feel-carrying tokens (lib/theme.ts SAX/STONE, the fonts, the
// page background, the panel material) resolve to the CSS custom properties defined here. `:root` holds
// the defaults (the dungeon look, byte-identical to before), and a `[data-system="<id>"]` block overrides
// them for a system that has a bespoke look. SystemThemeProvider sets `data-system` on <html> from the
// active campaign, so switching campaigns re-skins the whole app with no per-page edits.
//
// Systems without a block here fall through to `:root`, i.e. the default dungeon look, so D&D, Pathfinder,
// Call of Cthulhu, etc. are unchanged. Add a system by adding a block; nothing else needs touching.
//
// LICENSING: a system's look EVOKES the game's aesthetic (Lancer's gunmetal terminal / NavSat feel), it
// never reproduces a publisher's actual logos, wordmarks, or art. That keeps it clean under each system's
// third-party license (e.g. the Lancer Third Party License forbids Massif Press logos and wordmark).

export const THEMED_SYSTEMS = ["lancer"] as const;

export const SYSTEM_THEME_CSS = `
:root {
  --sax-ink: #140E1F;
  --sax-ink-deep: #0B0712;
  --sax-line: #3A2C4E;
  --sax-accent: #C8A24B;
  --sax-accent-dim: #7A632E;
  --sax-accent-hi: #e2b878;
  --sax-accent-deep: #6e4e26;
  --sax-text: #F1E9F7;
  --sax-muted: #A091B8;
  --sax-good: #5DBE9A;
  --sax-warn: #E07A5F;
  --stone-face: #2b2620;
  --stone-lit: #3a342b;
  --stone-hi: #4a4237;
  --stone-shadow: #1a1611;
  --stone-mortar: #0c0a07;
  --stone-ink: #e8dcc4;
  --stone-ink-dim: #a99e86;
  --stone-ink-faint: #8a8069;
  --stone-moss-lit: #9aa880;
  --stone-blood-lit: #d97d6d;
  --forge-display: 'Cinzel', 'Iowan Old Style', Georgia, serif;
  --forge-body: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  --forge-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --forge-panel-bg: linear-gradient(160deg, rgba(52,47,39,0.80) 0%, rgba(38,34,28,0.85) 45%, rgba(22,19,15,0.90) 100%);
  --forge-slate-bg: linear-gradient(180deg, rgba(38,34,28,0.94), rgba(24,21,17,0.96));
  --sax-page-bg: radial-gradient(ellipse 66% 44% at 50% 12%, rgba(184,135,74,0.16), transparent 62%), linear-gradient(180deg, rgba(18,13,8,0.28), rgba(10,7,4,0.52)), url(/wall-2.png) center / cover no-repeat #0B0712;
}

/* Lancer: the NavSat / COMP-CON terminal feel. Gunmetal surfaces, a faint technical grid, teal as the
   primary readout with amber alerts, and clean technical type. Evokes the game's UI, no MCDM assets. */
[data-system="lancer"] {
  --sax-ink: #0c1116;
  --sax-ink-deep: #070a0d;
  --sax-line: #26333d;
  --sax-accent: #37b6c6;
  --sax-accent-dim: #1c5a61;
  --sax-accent-hi: #6fe3ef;
  --sax-accent-deep: #12707b;
  --sax-text: #e2ebf0;
  --sax-muted: #7f929d;
  --sax-good: #4fc98a;
  --sax-warn: #e8974b;
  --stone-face: #18212a;
  --stone-lit: #22303a;
  --stone-hi: #2e404c;
  --stone-shadow: #0f171d;
  --stone-mortar: #05090c;
  --stone-ink: #e2ebf0;
  --stone-ink-dim: #93a6b1;
  --stone-ink-faint: #6a7c87;
  --stone-moss-lit: #57cf9a;
  --stone-blood-lit: #ef9a5a;
  --forge-display: 'Chakra Petch', 'Bahnschrift', 'DIN Alternate', ui-monospace, monospace;
  --forge-body: ui-sans-serif, 'Segoe UI', system-ui, 'Helvetica Neue', sans-serif;
  --forge-mono: ui-monospace, 'Cascadia Code', SFMono-Regular, Menlo, monospace;
  --forge-panel-bg: linear-gradient(160deg, rgba(30,42,52,0.86) 0%, rgba(20,29,36,0.9) 45%, rgba(12,18,23,0.94) 100%);
  --forge-slate-bg: linear-gradient(180deg, rgba(22,31,39,0.95), rgba(12,18,23,0.97));
  --sax-page-bg:
    radial-gradient(ellipse 72% 46% at 50% 8%, rgba(55,182,198,0.10), transparent 60%),
    linear-gradient(0deg, rgba(7,10,13,0.55), rgba(7,10,13,0.55)),
    repeating-linear-gradient(0deg, transparent 0 39px, rgba(120,150,165,0.045) 39px 40px),
    repeating-linear-gradient(90deg, transparent 0 39px, rgba(120,150,165,0.045) 39px 40px),
    #0a0e12;
}
`;
