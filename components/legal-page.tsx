import React from "react";
import { SAX } from "@/lib/theme";

/* Shared frame for the legal pages (privacy, terms, AI disclosure).
 *
 * These pages must read as STANDALONE legal documents, not as part of the app.
 *
 * They used to render inside PageShell, which draws the Six Axes navigation (Table /
 * Play / Story / Insight). The Chrome Web Store rejected the extension for exactly
 * this: a privacy policy wrapped in the product's own chrome reads as an "owner site"
 * rather than a dedicated privacy policy, which the store does not accept ("Owner
 * sites are not considered valid privacy policies").
 *
 * So there is no PageShell here, no nav, and nothing that requires a session. Just a
 * centered document with a small brand line at the top, on the same dark ground as the
 * rest of the site. A logged-out reviewer, and a player following the consent link
 * before they have an account, both see a clean policy.
 */

const LEGAL_CSS = `
.sax-legal-page { min-height: 100vh; background: ${SAX.ink}; padding: 0 20px 80px; }
.sax-legal-wrap { max-width: 760px; margin: 0 auto; }
.sax-legal-brand { display: flex; align-items: baseline; gap: 10px; padding: 26px 0 22px; border-bottom: 1px solid ${SAX.line}; margin-bottom: 30px; }
.sax-legal-brand .name { font-family: ${SAX.serif}; font-size: 20px; font-weight: 700; color: ${SAX.text}; }
.sax-legal-brand .tag { font-family: ${SAX.mono}; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: ${SAX.muted}; }
.sax-legal-brand a { text-decoration: none; }

.sax-legal { color: ${SAX.text}; font-family: ${SAX.serif}; line-height: 1.7; font-size: 16px; }
.sax-legal h1 { font-size: 32px; font-weight: 600; letter-spacing: 0.2px; margin: 6px 0 14px; }
.sax-legal h2 { font-size: 20px; font-weight: 600; color: ${SAX.text}; margin: 34px 0 10px; padding-bottom: 6px; border-bottom: 1px solid ${SAX.line}; }
.sax-legal h3 { font-family: ${SAX.mono}; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: ${SAX.brass}; margin: 26px 0 8px; }
.sax-legal p { margin: 12px 0; color: ${SAX.text}; }
.sax-legal strong { color: ${SAX.text}; font-weight: 600; }
.sax-legal a { color: ${SAX.plum}; text-decoration: underline; }
.sax-legal ul, .sax-legal ol { padding-left: 22px; margin: 12px 0; }
.sax-legal li { margin: 7px 0; }
.sax-legal hr { border: none; border-top: 1px solid ${SAX.line}; margin: 30px 0; }
.sax-legal table { width: 100%; border-collapse: collapse; margin: 16px 0; }
.sax-legal th, .sax-legal td { border: 1px solid ${SAX.line}; padding: 9px 11px; text-align: left; font-size: 14px; vertical-align: top; }
.sax-legal th { color: ${SAX.brass}; font-family: ${SAX.mono}; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; background: rgba(200,162,75,0.06); }
.sax-legal blockquote { border-left: 3px solid ${SAX.brass}; background: rgba(26,19,37,0.6); border-radius: 8px; padding: 12px 16px; margin: 18px 0; color: ${SAX.muted}; }
.sax-legal code { font-family: ${SAX.mono}; font-size: 13px; background: rgba(11,7,18,0.6); border: 1px solid ${SAX.line}; border-radius: 6px; padding: 1px 6px; color: ${SAX.spark}; }
.sax-legal .meta { color: ${SAX.muted}; font-size: 14px; margin: 2px 0; }
`;

export default function LegalPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="sax-legal-page">
      <style>{LEGAL_CSS}</style>
      <div className="sax-legal-wrap">
        {/* A brand line, not a nav. It identifies whose policy this is and links to the
            marketing site, but offers no way into the authenticated app. That is the
            distinction the store cares about: an identifier, not product chrome. */}
        <div className="sax-legal-brand">
          <span className="name">Six Axes</span>
          <span className="tag">Kerf and Code, LLC</span>
        </div>
        <article className="sax-legal">{children}</article>
      </div>
    </div>
  );
}
