// lib/codex-themes.ts (2026-11-11, push 32, audit P11: themes for the published codex)
//
// The looks a GM can give their public codex (/c/[slug]): a short, curated list rather than free
// colour pickers, so every published campaign still reads well, and every one comes in the reader's
// dark and light modes. The key is stored on campaigns.codex_theme (p156) and read by the public page
// through public_campaign_theme(). "forge" is the original gold look and the default.
//
// Each theme overrides the codex stylesheet's role variables (app/c/[slug]/shared.tsx) and may change
// the heading face. Pure data, plus the CSS it turns into.

export type CodexTheme = {
  key: string;
  label: string;
  blurb: string;
  heading: "Cinzel" | "EB Garamond";
  dark: Record<string, string>;
  light: Record<string, string>;
};

export const CODEX_THEMES: CodexTheme[] = [
  {
    key: "forge", label: "Forge", blurb: "Gold on warm dark, the Six Axes look.", heading: "Cinzel",
    dark: {}, light: {},
  },
  {
    key: "frost", label: "Frost", blurb: "Silver and ice blue, for the cold north.", heading: "Cinzel",
    dark: { "--w-deep": "#0e1217", "--w-bg": "#11161c", "--w-panel": "#171e26", "--w-panel-2": "#1c2530", "--w-ink": "#e3e9ef", "--w-ink-2": "#bcc8d4", "--w-muted": "#93a3b3", "--w-accent": "#9cc6e6", "--w-accent-dim": "#5a7d99", "--w-line": "#2a3542", "--w-tag-bg": "rgba(156,198,230,0.12)" },
    light: { "--w-deep": "#e6edf3", "--w-bg": "#eef3f7", "--w-panel": "#fbfdff", "--w-panel-2": "#f3f7fb", "--w-ink": "#1b232c", "--w-ink-2": "#3d4a57", "--w-muted": "#6c7b8a", "--w-accent": "#2f6a96", "--w-accent-dim": "#5f8db0", "--w-line": "#cfdae5", "--w-tag-bg": "#dde8f2" },
  },
  {
    key: "verdant", label: "Verdant", blurb: "Moss and old leaves, for wild places.", heading: "EB Garamond",
    dark: { "--w-deep": "#0f130e", "--w-bg": "#121710", "--w-panel": "#182016", "--w-panel-2": "#1e281b", "--w-ink": "#e4eadb", "--w-ink-2": "#c2cdb2", "--w-muted": "#98a585", "--w-accent": "#a7c97a", "--w-accent-dim": "#6b8a48", "--w-line": "#2d3a27", "--w-tag-bg": "rgba(167,201,122,0.12)" },
    light: { "--w-deep": "#e7ecdc", "--w-bg": "#eff3e6", "--w-panel": "#fcfdf8", "--w-panel-2": "#f4f7ec", "--w-ink": "#1f2618", "--w-ink-2": "#435036", "--w-muted": "#6f7d5d", "--w-accent": "#4d7a24", "--w-accent-dim": "#7a9a55", "--w-line": "#d4dcc4", "--w-tag-bg": "#e2ead2" },
  },
  {
    key: "crimson", label: "Crimson", blurb: "Blood red and iron, for grim tales.", heading: "Cinzel",
    dark: { "--w-deep": "#140e0e", "--w-bg": "#181111", "--w-panel": "#211716", "--w-panel-2": "#2a1c1b", "--w-ink": "#eee0dc", "--w-ink-2": "#d0b9b3", "--w-muted": "#a8908a", "--w-accent": "#d8695c", "--w-accent-dim": "#8f4037", "--w-line": "#3d2b29", "--w-tag-bg": "rgba(216,105,92,0.12)" },
    light: { "--w-deep": "#f1e6e2", "--w-bg": "#f6eeea", "--w-panel": "#fffbf9", "--w-panel-2": "#faf2ef", "--w-ink": "#2a1b19", "--w-ink-2": "#553b37", "--w-muted": "#87675f", "--w-accent": "#9e3326", "--w-accent-dim": "#b8665b", "--w-line": "#e3cfc9", "--w-tag-bg": "#f0dcd6" },
  },
  {
    key: "arcane", label: "Arcane", blurb: "Violet and starlight, for magic and mystery.", heading: "EB Garamond",
    dark: { "--w-deep": "#110f17", "--w-bg": "#14121b", "--w-panel": "#1b1824", "--w-panel-2": "#221e2e", "--w-ink": "#e8e3f1", "--w-ink-2": "#c8bfd9", "--w-muted": "#a096b4", "--w-accent": "#b49af0", "--w-accent-dim": "#715ba8", "--w-line": "#332d44", "--w-tag-bg": "rgba(180,154,240,0.12)" },
    light: { "--w-deep": "#ebe7f3", "--w-bg": "#f2eff8", "--w-panel": "#fdfcff", "--w-panel-2": "#f6f3fb", "--w-ink": "#211c2c", "--w-ink-2": "#463d58", "--w-muted": "#766c8c", "--w-accent": "#5b3fa6", "--w-accent-dim": "#8a74c4", "--w-line": "#d9d2e8", "--w-tag-bg": "#e6def6" },
  },
];

export const DEFAULT_CODEX_THEME = "forge";
export const codexTheme = (key: string | null | undefined): CodexTheme =>
  CODEX_THEMES.find((t) => t.key === key) ?? CODEX_THEMES[0];

/** The CSS that puts a theme over the codex stylesheet. Selectors carry html so they outrank the
 *  stylesheet's own [data-wiki] rules; the default theme needs none. */
export function codexThemeCss(key: string | null | undefined): string {
  const t = codexTheme(key);
  if (t.key === DEFAULT_CODEX_THEME) return "";
  const vars = (v: Record<string, string>) => Object.entries(v).map(([k, val]) => `${k}: ${val};`).join(" ");
  const out = [
    `html[data-wiki="dark"], html:not([data-wiki]) { ${vars(t.dark)} }`,
    `html[data-wiki="light"] { ${vars(t.light)} }`,
    // the top bar is painted with fixed warm tones in the base sheet; follow the theme instead
    `html[data-wiki="dark"] .w-topbar, html:not([data-wiki]) .w-topbar { background: linear-gradient(180deg, ${t.dark["--w-bg"]}, ${t.dark["--w-deep"]}); }`,
    `html[data-wiki="light"] .w-topbar { background: linear-gradient(180deg, ${t.light["--w-panel-2"]}, ${t.light["--w-bg"]}); }`,
  ];
  if (t.heading !== "Cinzel") {
    out.push(`.w-banner h1, .w-h2, .w-brand .nm { font-family: 'EB Garamond', Georgia, serif; }`);
  }
  return out.join("\n");
}
