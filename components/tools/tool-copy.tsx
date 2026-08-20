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
// value now is the visible, headed content itself - which is what featured snippets and AI Overviews
// read. BreadcrumbList schema (which still renders) is added on the page, not here.

export type ToolCopyProps = {
  heading: string;            // H2, keyword-bearing
  intro: string[];            // one or more lead paragraphs
  steps?: string[];           // "how to use it" — ordered
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

      <p style={cta}>
        These tools come from <strong style={{ color: STONE.ink }}>Six Axes</strong>, which sits in your
        session and records the table, writes the recap, and builds the campaign wiki automatically.{" "}
        <Link href="/features" style={link}>See what it does</Link> or{" "}
        <Link href="/pilot" style={link}>join the pilot</Link>.
      </p>
    </section>
  );
}

const wrap: React.CSSProperties = { margin: "40px 0 8px", maxWidth: 760 };
const rule: React.CSSProperties = {
  height: 1, background: `linear-gradient(90deg, ${STONE.brassDeep}, transparent)`, margin: "0 0 22px",
};
const h2: React.CSSProperties = {
  fontFamily: "var(--forge-display, 'Cinzel', serif)", fontWeight: 700, fontSize: 23, color: STONE.ink,
  margin: "0 0 12px", letterSpacing: "0.02em",
};
const h3: React.CSSProperties = {
  fontFamily: "var(--forge-display, 'Cinzel', serif)", fontWeight: 600, fontSize: 17, color: STONE.brassHi,
  margin: "26px 0 8px", letterSpacing: "0.03em",
};
const body: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.7, color: STONE.inkDim, margin: "0 0 14px", fontFamily: SAX.serif };
const ol: React.CSSProperties = { margin: "0 0 4px", padding: "0 0 0 22px", display: "grid", gap: 8 };
const li: React.CSSProperties = { fontSize: 16, lineHeight: 1.6, color: STONE.inkDim, fontFamily: SAX.serif };
const q: React.CSSProperties = { fontSize: 16, lineHeight: 1.5, color: STONE.ink, fontWeight: 600, margin: "0 0 3px", fontFamily: SAX.serif };
const a: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.65, color: STONE.inkDim, margin: 0, fontFamily: SAX.serif };
const relatedRow: React.CSSProperties = { fontSize: 15, lineHeight: 1.7, margin: "28px 0 0", fontFamily: SAX.serif };
const relatedLabel: React.CSSProperties = { color: STONE.inkFaint, fontFamily: SAX.mono, fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.06em" };
const cta: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.7, color: STONE.inkDim, margin: "16px 0 0", fontFamily: SAX.serif };
const link: React.CSSProperties = { color: STONE.brassHi, textDecoration: "none" };
