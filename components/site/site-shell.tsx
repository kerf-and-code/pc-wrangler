import Link from "next/link";
import { SAX, STONE } from "@/lib/theme";
import { C, forgeBackground, forgeVignette, stoneButton, FORGE_BUTTON_CSS } from "@/lib/forge-theme";

// components/site/site-shell.tsx
//
// The shared chrome for the marketing site's inner pages (contact, about, pricing, faq, features): the
// forge background, the sticky top bar, and the footer, matching the landing page's register so every
// page reads as one site. The landing page keeps its own bespoke hero + scrollspy; standard pages wrap
// their content in this. Server component (static nav, no client state).

export default function SiteShell({
  title,
  tagline,
  children,
}: {
  title: string;
  tagline?: string;
  children: React.ReactNode;
}) {
  return (
    <main style={{ ...forgeBackground(), minHeight: "100vh", color: C.text, position: "relative", overflowX: "clip" }}>
      <div style={forgeVignette} />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <header className="site-top">
        <Link href="/" className="site-brand">
          <img src="/six-axes-logo.png" alt="" className="site-mark" aria-hidden />
          <span className="site-word">Six Axes</span>
        </Link>
        <nav className="site-nav">
          <Link href="/features" className="site-link">Features</Link>
          <Link href="/players" className="site-link">For players</Link>
          <Link href="/tools" className="site-link">Free tools</Link>
          <Link href="/pricing" className="site-link">Pricing</Link>
          <Link href="/contact" className="site-link">Contact</Link>
          <Link href="/enter" className="site-link">Enter</Link>
          <Link href="/pilot" className="forge-btn is-primary" style={{ ...stoneButton("primary"), padding: "9px 18px", fontSize: 12.5 }}>
            Join the pilot
          </Link>
        </nav>
      </header>

      <div className="site-body">
        <header style={{ marginBottom: 24 }}>
          <h1 style={h1}>{title}</h1>
          {tagline && <p style={lead}>{tagline}</p>}
        </header>
        {children}
      </div>

      <footer className="site-foot">
        <div className="site-foot-inner">
          <span>Six Axes is made by Kerf and Code.</span>
          <span>
            <Link href="/players" style={link}>For players</Link>
            {" · "}
            <Link href="/tools" style={link}>Free tools</Link>
            {" · "}
            <Link href="/about" style={link}>About</Link>
            {" · "}
            <Link href="/faq" style={link}>FAQ</Link>
            {" · "}
            <Link href="/contact" style={link}>Contact</Link>
            {" · "}
            <Link href="/privacy" style={link}>Privacy</Link>
            {" · "}
            <Link href="/terms" style={link}>Terms</Link>
          </span>
        </div>
      </footer>
    </main>
  );
}

const h1: React.CSSProperties = {
  fontFamily: "var(--forge-display, 'Cinzel', serif)", fontWeight: 700, fontSize: 38, lineHeight: 1.15,
  letterSpacing: "0.04em", color: STONE.ink, margin: "0 0 8px",
  textShadow: "0 -1px 0 rgba(0,0,0,0.9), 0 1px 0 rgba(255,230,190,0.08)",
};
const lead: React.CSSProperties = { fontSize: 18, lineHeight: 1.6, color: STONE.inkDim, margin: 0, fontFamily: SAX.serif };
const link: React.CSSProperties = { color: STONE.brassHi, textDecoration: "none" };

const CSS = `
${FORGE_BUTTON_CSS}
.site-top {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 24px;
  background: linear-gradient(180deg, rgba(14,11,8,0.92), rgba(14,11,8,0.66));
  border-bottom: 1px solid ${STONE.mortar};
  backdrop-filter: blur(4px);
}
.site-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.site-mark { width: 30px; height: 30px; mix-blend-mode: screen; }
.site-word { font-family: var(--font-cinzel, 'Cinzel', serif); font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase; color: ${STONE.ink}; font-size: 16px; }
.site-nav { display: flex; align-items: center; gap: 16px; }
.site-link { font-family: ${SAX.mono}; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: ${STONE.inkDim}; text-decoration: none; }
.site-link:hover { color: ${STONE.brassHi}; }
.site-body { max-width: 820px; margin: 0 auto; padding: 46px 24px 24px; position: relative; z-index: 1; }
.site-foot { border-top: 1px solid ${STONE.mortar}; margin-top: 30px; position: relative; z-index: 1;
  background: linear-gradient(180deg, transparent, rgba(10,7,4,0.5)); }
.site-foot-inner { max-width: 820px; margin: 0 auto; padding: 22px 24px; display: flex; gap: 14px;
  justify-content: space-between; flex-wrap: wrap; font-family: ${SAX.mono}; font-size: 12.5px; color: ${STONE.inkFaint}; }
@media (max-width: 620px) {
  .site-nav { gap: 12px; }
  .site-link { display: none; }
}
`;
