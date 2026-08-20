import Link from "next/link";
import { SAX, STONE } from "@/lib/theme";
import {
  C, forgeBackground, forgeVignette, stonePanel, stoneButton, FORGE_BUTTON_CSS, forgeRuleLine, forgeBoss,
} from "@/lib/forge-theme";

// components/tools-shell.tsx
//
// The shared frame every free tool sits in. No auth, no database, no account: these pages exist to be
// found in search and used on the spot, then to breadcrumb the visitor toward the pilot.
//
// REGISTER (2026-08): the full dungeon/forge look, matching the site and the app, dark stone, carved
// panels, brass. The tool bodies themselves are carved dark panels too (each tool's own styles), so the
// whole tools surface reads with the app's depth rather than a flat document.
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
    <main style={{ ...forgeBackground(), minHeight: "100vh", color: C.text, position: "relative", overflowX: "clip" }}>
      <div style={forgeVignette} />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <header className="ts-top">
        <Link href="/" className="ts-brand">
          <img src="/six-axes-logo.png" alt="" className="ts-mark" aria-hidden />
          <span className="ts-word">Six Axes</span>
        </Link>
        <nav className="ts-nav">
          <Link href="/features" className="ts-link">Features</Link>
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
        <div style={topRow}>
          <span style={eyebrow}>Free tools</span>
          {!hideHubLink && <Link href="/tools" style={hubLink}>All tools</Link>}
        </div>
        <h1 style={h1}>{title}</h1>
        {tagline && <p style={lede}>{tagline}</p>}

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0 26px" }} aria-hidden>
          <span style={forgeRuleLine} />
          <span style={forgeBoss} />
          <span style={{ ...forgeRuleLine, transform: "scaleX(-1)" }} />
        </div>

        <div>{children}</div>

        <section style={{ ...stonePanel(), padding: "22px 24px", marginTop: 34 }}>
          <p style={ctaLead}>These tools run on a slice of what Six Axes does at the table.</p>
          <p style={ctaBody}>
            The full product records your session, writes the recap, keeps the campaign wiki, and reads how
            your table actually plays, across whatever system you run. It is in free pilot now.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
            <Link href="/pilot" className="forge-btn is-primary" style={stoneButton("primary")}>Join the pilot</Link>
            <Link href="/features" className="forge-btn is-ghost" style={stoneButton("ghost")}>What is Six Axes?</Link>
          </div>
        </section>
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

const topRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 };
const eyebrow: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: SAX.brass,
};
const hubLink: React.CSSProperties = { marginLeft: "auto", color: STONE.brassHi, fontSize: 14, textDecoration: "none" };
const h1: React.CSSProperties = {
  fontFamily: "var(--forge-display, 'Cinzel', serif)", fontSize: 36, lineHeight: 1.14, margin: "0 0 10px",
  fontWeight: 700, color: STONE.ink, letterSpacing: "0.03em",
  textShadow: "0 -1px 0 rgba(0,0,0,0.9), 0 1px 0 rgba(255,230,190,0.08)",
};
const lede: React.CSSProperties = { fontSize: 18, lineHeight: 1.6, color: STONE.inkDim, margin: 0, fontFamily: SAX.serif };
const ctaLead: React.CSSProperties = { fontSize: 17, fontWeight: 600, color: STONE.ink, margin: "0 0 6px", fontFamily: SAX.serif };
const ctaBody: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.65, color: STONE.inkDim, margin: 0, fontFamily: SAX.serif };
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
.ts-wrap { max-width: 820px; margin: 0 auto; padding: 46px 24px 24px; position: relative; z-index: 1; }
.ts-foot { border-top: 1px solid ${STONE.mortar}; margin-top: 30px; position: relative; z-index: 1;
  background: linear-gradient(180deg, transparent, rgba(10,7,4,0.5)); }
.ts-foot-inner { max-width: 820px; margin: 0 auto; padding: 22px 24px; display: flex; gap: 14px;
  justify-content: space-between; flex-wrap: wrap; font-family: ${SAX.mono}; font-size: 12.5px; color: ${STONE.inkFaint}; }
@media (max-width: 620px) { .ts-link { display: none; } }
`;
