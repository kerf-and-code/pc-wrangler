"use client";

// Help: renders lib/help-content.mjs. That file is the single source of truth;
// scripts/export-help-md.mjs turns the same content into docs/six-axes-guide.md.

import React from "react";
import PageShell from "@/components/page-shell";
import { HELP as HELP_RAW } from "@/lib/help-content.mjs";
import { SAX } from "@/lib/theme";

type HelpBlock =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "sub"; title: string; text: string };
type HelpSection = { id: string; title: string; blocks: HelpBlock[] };
type HelpDoc = { title: string; subtitle: string; sections: HelpSection[] };

const HELP = HELP_RAW as unknown as HelpDoc;

const C = {
  surface: SAX.slateBg, surface2: "rgba(11,7,18,0.6)", line: SAX.line,
  text: SAX.text, muted: SAX.muted, brass: SAX.brass, sun: SAX.sun,
};

function Block({ b }: { b: HelpBlock }) {
  if (b.kind === "p") {
    return <p style={{ color: C.text, fontSize: 14.5, lineHeight: 1.7, margin: "0 0 12px" }}>{b.text}</p>;
  }
  if (b.kind === "sub") {
    return (
      <p style={{ color: C.text, fontSize: 14.5, lineHeight: 1.7, margin: "0 0 12px" }}>
        <b style={{ color: C.brass }}>{b.title}.</b> <span style={{ color: C.muted }}>{b.text}</span>
      </p>
    );
  }
  return (
    <ol style={{ margin: "0 0 14px", paddingLeft: 22 }}>
      {b.items.map((item, i) => (
        <li key={i} style={{ color: C.text, fontSize: 14.5, lineHeight: 1.7, marginBottom: 8 }}>{item}</li>
      ))}
    </ol>
  );
}

export default function HelpPage() {
  return (
    <PageShell width={880}>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>
        Guide
      </div>
      <h1 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>{HELP.title}</h1>
      <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.6, margin: "0 0 20px", maxWidth: 640 }}>{HELP.subtitle}</p>

      <nav style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 18px", marginBottom: 22, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {HELP.sections.map((s) => (
          <a key={s.id} href={`#${s.id}`}
            style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, textDecoration: "none", border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 11px" }}>
            {s.title}
          </a>
        ))}
      </nav>

      {HELP.sections.map((s) => (
        <section key={s.id} id={s.id} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "20px 22px", marginBottom: 16, scrollMarginTop: 16 }}>
          <h2 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 21, fontWeight: 700, margin: "0 0 12px", color: C.sun }}>{s.title}</h2>
          {s.blocks.map((b, i) => (<Block key={i} b={b} />))}
        </section>
      ))}

      <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
        Want this outside the app? The same guide ships as a markdown file (docs/six-axes-guide.md) you can paste into Discord or send to a new GM.
      </p>
    </PageShell>
  );
}
