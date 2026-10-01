import Link from "next/link";
import { SAX, STONE } from "@/lib/theme";

// components/tools/tool-copy.tsx
//
// The crawlable explanatory block that sits BELOW each free tool's widget. This is the SEO payload of
// the tool pages: real content a search engine (and an AI answer engine) can read and rank, plus a
// funnel line into the product. Server-rendered, no client JS.
//
// NOTE on schema: we intentionally do NOT emit FAQPage/HowTo JSON-LD here. Google deprecated FAQ rich
// results (2026) and HowTo rich results earlier, so that markup no longer earns a SERP feature. The
// value now is the visible, headed content itself, which is what featured snippets and AI Overviews
// read. BreadcrumbList schema (which still renders) is added on the page, not here.
//
// 2026-10: on wide screens ToolsShell places this block (the last child of each tool page) in the 40%
// column beside the tool, so it carries no width cap or divider of its own; type follows the marketing
// site's night register (17px body, EB Garamond headings in ink). The funnel line into the product now
// lives once, in ToolsShell's pilot card, rather than repeated here.

export type ToolCopyProps = {
  heading: string;            // H2, keyword-bearing
  intro: string[];            // one or more lead paragraphs
  steps?: string[];           // "how to use it", ordered
  systemsHeading?: string;    // H3 for the per-system note
  systems?: string[];         // per-system explanation paragraphs
  faq?: { q: string; a: string }[];
  related?: { href: string; label: string }[];
};

export default function ToolCopy({ heading, intro, steps, systemsHeading, systems, faq, related }: ToolCopyProps) {
  return (
    <section style={wrap} aria-label="About this tool">
      <div style={rule} />
      <h2 style={h2}>{heading}</h2>
      {intro.map((p, i) => (
        <p key={i} style={body}>{p}</p>
      ))}

      {steps && steps.length > 0 && (
        <>
          <h3 style={h3}>How to use it</h3>
          <ol style={ol}>
            {steps.map((s, i) => (
              <li key={i} style={li}>{s}</li>
            ))}
          </ol>
        </>
      )}

      {systems && systems.length > 0 && (
        <>
          {systemsHeading && <h3 style={h3}>{systemsHeading}</h3>}
          {systems.map((p, i) => (
            <p key={i} style={body}>{p}</p>
          ))}
        </>
      )}

      {faq && faq.length > 0 && (
        <>
          <h3 style={h3}>Common questions</h3>
          <div style={{ display: "grid", gap: 14 }}>
            {faq.map((f, i) => (
              <div key={i}>
                <p style={q}>{f.q}</p>
                <p style={a}>{f.a}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {related && related.length > 0 && (
        <p style={relatedRow}>
          <span style={relatedLabel}>Related tools: </span>
          {related.map((r, i) => (
            <span key={r.href}>
              <Link href={r.href} style={link}>{r.label}</Link>
              {i < related.length - 1 ? <span style={{ color: STONE.inkFaint }}> · </span> : null}
            </span>
          ))}
        </p>
      )}

    </section>
  );
}

const wrap: React.CSSProperties = { marginBottom: 8 };
const rule: React.CSSProperties = { display: "none" };
const h2: React.CSSProperties = {
  fontFamily: "var(--forge-display, 'Cinzel', serif)", fontWeight: 800, fontSize: 30, color: STONE.ink,
  margin: "0 0 14px", lineHeight: 1.1, letterSpacing: "-0.01em",
};
const h3: React.CSSProperties = {
  fontFamily: "var(--forge-display, 'Cinzel', serif)", fontWeight: 700, fontSize: 23, color: STONE.ink,
  margin: "30px 0 10px", lineHeight: 1.2,
};
const body: React.CSSProperties = { fontSize: 17, lineHeight: 1.65, color: STONE.inkDim, margin: "0 0 14px", fontFamily: SAX.serif };
const ol: React.CSSProperties = { margin: "0 0 4px", padding: "0 0 0 22px", display: "grid", gap: 8 };
const li: React.CSSProperties = { fontSize: 17, lineHeight: 1.6, color: STONE.inkDim, fontFamily: SAX.serif };
const q: React.CSSProperties = { fontSize: 17, lineHeight: 1.5, color: STONE.ink, fontWeight: 600, margin: "0 0 4px", fontFamily: SAX.serif };
const a: React.CSSProperties = { fontSize: 17, lineHeight: 1.6, color: STONE.inkDim, margin: 0, fontFamily: SAX.serif };
const relatedRow: React.CSSProperties = { fontSize: 17, lineHeight: 1.7, margin: "30px 0 0", fontFamily: SAX.serif };
const relatedLabel: React.CSSProperties = { color: STONE.inkDim, fontWeight: 600 };
const link: React.CSSProperties = {
  color: STONE.brassHi, textDecoration: "underline", textDecorationColor: "rgba(236,191,110,0.45)", textUnderlineOffset: 3,
};
