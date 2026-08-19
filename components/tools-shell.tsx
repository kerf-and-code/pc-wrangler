import Link from "next/link";
import { SAX, STONE, surfaces } from "@/lib/theme";
import { C, forgeBackground, forgeVignette, stoneButton, FORGE_BUTTON_CSS } from "@/lib/forge-theme";

// components/tools-shell.tsx
//
// The shared frame every free tool sits in. No auth, no database, no account: these pages exist to be
// found in search and used on the spot, then to breadcrumb the visitor toward the pilot.
//
// REGISTER (updated 2026-08): the CHROME is now the site's forge look (dark stone, the logo, the same top
// nav as the marketing pages) so the tools match the rest of the site, while the tool BODY sits on a
// PARCHMENT reading sheet laid on the stone, the app's own idiom (dungeon chrome, vellum for reading).
// The individual tool components keep their light cards untouched; they simply sit on the sheet now.
//
// Every tool passes a title and a one-line tagline; the shell supplies the top bar, the eyebrow, the
// back-link to the tools hub, the pilot CTA, and the footer, so each tool page only writes its own body.

export default function ToolsShell({
  title,
  tagline,
  hideHubLink,
  children,
}: {
  title: string;
  tagline?: string;
  hideHubLink?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main style={{ ...forgeBackground(), minHeight: "100vh", color: C.text, position: "relative", overflowX: "hidden" }}>
      <div style={forgeVignette} />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <header className="ts-top">
        <Link href="/" className="ts-brand">
          <img src="/six-axes-logo.png" alt="" className="ts-mark" aria-hidden />
          <span className="ts-word">Six Axes</span>
        </Link>
        <nav className="ts-nav">
          <Link href="/tools" className="ts-link">Free tools</Link>
          <Link href="/pricing" className="ts-link">Pricing</Link>
          <Link href="/contact" className="ts-link">Contact</Link>
          <Link href="/enter" className="ts-link">Enter</Link>
          <Link href="/pilot" className="forge-btn is-primary" style={{ ...stoneButton("primary"), padding: "9px 18px", fontSize: 12.5 }}>
            Join the pilot
          </Link>
        </nav>
      </header>

      <div className="ts-wrap">
        <article style={sheet}>
          <div style={topRow}>
            <span style={eyebrow}>Free tools</span>
            {!hideHubLink && <Link href="/tools" style={hubLink}>All tools</Link>}
          </div>
          <h1 style={h1}>{title}</h1>
          {tagline && <p style={lede}>{tagline}</p>}

          <div style={{ marginTop: 22 }}>{children}</div>

          <section style={cta}>
            <p style={ctaLead}>These tools run on a slice of what Six Axes does at the table.</p>
            <p style={ctaBody}>
              The full product records your session, writes the recap, keeps the campaign wiki, and reads how
              your table actually plays, across whatever system you run. It is in free pilot now.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
              <Link href="/pilot" style={ctaBtn}>Join the pilot</Link>
              <Link href="/features" style={ctaGhost}>What is Six Axes?</Link>
            </div>
          </section>
        </article>
      </div>

      <footer className="ts-foot">
        <div className="ts-foot-inner">
          <span>No account, nothing saved. System names are referenced for compatibility only.</span>
          <span>
            <Link href="/tools" style={footLink}>All tools</Link>
            {" · "}
            <Link href="/features" style={footLink}>Overview</Link>
            {" · "}
            <Link href="/pilot" style={footLink}>Join the pilot</Link>
          </span>
        </div>
      </footer>
    </main>
  );
}

// ---- the parchment reading sheet (light, for reading) laid on the dark stone ----

const sheet: React.CSSProperties = {
  ...surfaces.parchment,
  maxWidth: 800,
  margin: "0 auto",
  padding: "34px 38px 30px",
  position: "relative",
  zIndex: 1,
};
const topRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 };
const eyebrow: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, letterSpacing: "0.2em",
  textTransform: "uppercase", color: "#8a7a55",
};
const hubLink: React.CSSProperties = { marginLeft: "auto", color: "#8a6a2f", fontSize: 14, textDecoration: "none" };
const h1: React.CSSProperties = {
  fontFamily: "var(--forge-display, 'Cinzel', 'Iowan Old Style', Georgia, serif)",
  fontSize: 34, lineHeight: 1.15, margin: "0 0 10px", fontWeight: 700, color: SAX.parchInk, letterSpacing: "0.02em",
};
const lede: React.CSSProperties = { fontSize: 18, lineHeight: 1.6, color: "#4a443a", margin: 0, fontFamily: SAX.serif };
const cta: React.CSSProperties = { marginTop: 34, padding: "22px 0 0", borderTop: "1px solid #cbba95" };
const ctaLead: React.CSSProperties = { fontSize: 17, fontWeight: 600, color: SAX.parchInk, margin: "0 0 6px", fontFamily: SAX.serif };
const ctaBody: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.65, color: "#4a443a", margin: 0, fontFamily: SAX.serif };
const ctaBtn: React.CSSProperties = {
  display: "inline-block", background: "#3a352c", color: "#f6f2e9", padding: "11px 22px", borderRadius: 3,
  textDecoration: "none", fontFamily: "ui-monospace, monospace", fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase",
};
const ctaGhost: React.CSSProperties = { ...ctaBtn, background: "transparent", color: "#3a352c", border: "1px solid #b9a878" };
const footLink: React.CSSProperties = { color: STONE.brassHi, textDecoration: "none" };

const CSS = `
${FORGE_BUTTON_CSS}
.ts-top {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 24px;
  background: linear-gradient(180deg, rgba(14,11,8,0.92), rgba(14,11,8,0.66));
  border-bottom: 1px solid ${STONE.mortar};
  backdrop-filter: blur(4px);
}
.ts-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.ts-mark { width: 30px; height: 30px; mix-blend-mode: screen; }
.ts-word { font-family: var(--font-cinzel, 'Cinzel', serif); font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase; color: ${STONE.ink}; font-size: 16px; }
.ts-nav { display: flex; align-items: center; gap: 16px; }
.ts-link { font-family: ${SAX.mono}; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: ${STONE.inkDim}; text-decoration: none; }
.ts-link:hover { color: ${STONE.brassHi}; }
.ts-wrap { padding: 40px 20px 26px; position: relative; z-index: 1; }
.ts-foot { border-top: 1px solid ${STONE.mortar}; position: relative; z-index: 1;
  background: linear-gradient(180deg, transparent, rgba(10,7,4,0.5)); }
.ts-foot-inner { max-width: 820px; margin: 0 auto; padding: 22px 24px; display: flex; gap: 14px;
  justify-content: space-between; flex-wrap: wrap; font-family: ${SAX.mono}; font-size: 12.5px; color: ${STONE.inkFaint}; }
@media (max-width: 620px) { .ts-link { display: none; } }
`;
