import React from "react";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";

/* Shared frame for the legal pages (privacy, terms, AI disclosure).
   Provides the cellar PageShell plus typographic styling for long-form prose,
   so each page file only carries its content. */

const LEGAL_CSS = `
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
    <PageShell width={760}>
      <style>{LEGAL_CSS}</style>
      <article className="sax-legal">{children}</article>
    </PageShell>
  );
}
