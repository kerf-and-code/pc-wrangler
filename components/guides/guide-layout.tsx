import Link from "next/link";
import SiteShell from "@/components/site/site-shell";
import JsonLd from "@/components/json-ld";
import { articleSchema, breadcrumbSchema } from "@/lib/seo";
import { SAX, STONE } from "@/lib/theme";

// components/guides/guide-layout.tsx
//
// The article chrome for a single guide: the shared site shell (which supplies the H1 from `title`),
// the "updated" byline, Article + BreadcrumbList JSON-LD, and a scoped prose stylesheet so guide bodies
// can be authored as plain semantic HTML (<h2>/<p>/<ul>/<a>) and still match the site. Server component.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// Format an ISO date string without constructing a Date (deterministic, no hydration drift).
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export default function GuideLayout({
  slug, title, description, excerpt, updated, children,
}: {
  slug: string;
  title: string;
  description: string;
  excerpt?: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <SiteShell title={title} tagline={excerpt}>
      <JsonLd
        data={[
          articleSchema({ slug, title, description, updated }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Guides", path: "/guides" },
            { name: title, path: `/guides/${slug}` },
          ]),
        ]}
      />
      <p style={meta}>Updated {formatDate(updated)} · Kerf and Code</p>
      <style dangerouslySetInnerHTML={{ __html: PROSE_CSS }} />
      <article className="guide-prose">{children}</article>
      <div style={foot}>
        <Link href="/guides" style={link}>← All guides</Link>
      </div>
    </SiteShell>
  );
}

const meta: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 12.5, letterSpacing: "0.06em", textTransform: "uppercase",
  color: STONE.inkFaint, margin: "-8px 0 24px",
};
const foot: React.CSSProperties = { marginTop: 36, paddingTop: 18, borderTop: `1px solid ${STONE.mortar}` };
const link: React.CSSProperties = { color: STONE.brassHi, textDecoration: "none", fontFamily: SAX.serif, fontSize: 15.5 };

const PROSE_CSS = `
.guide-prose { max-width: 720px; }
.guide-prose h2 {
  font-family: var(--forge-display, 'Cinzel', serif); font-weight: 700; font-size: 24px;
  color: var(--stone-ink, #e8dcc4); letter-spacing: 0.02em; margin: 36px 0 10px; line-height: 1.25;
}
.guide-prose h3 {
  font-family: var(--forge-display, 'Cinzel', serif); font-weight: 600; font-size: 18px;
  color: var(--sax-accent-hi, #e2b878); letter-spacing: 0.03em; margin: 26px 0 8px;
}
.guide-prose p {
  font-size: 17px; line-height: 1.72; color: var(--stone-ink-dim, #a99e86); margin: 0 0 16px;
  font-family: var(--forge-body, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif);
}
.guide-prose ul, .guide-prose ol { margin: 0 0 16px; padding-left: 22px; display: grid; gap: 8px; }
.guide-prose li {
  font-size: 16.5px; line-height: 1.62; color: var(--stone-ink-dim, #a99e86);
  font-family: var(--forge-body, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif);
}
.guide-prose a { color: var(--sax-accent-hi, #e2b878); text-decoration: none; }
.guide-prose a:hover { text-decoration: underline; }
.guide-prose strong { color: var(--stone-ink, #e8dcc4); font-weight: 600; }
.guide-prose blockquote {
  border-left: 2px solid var(--sax-accent-deep, #6e4e26); margin: 0 0 16px; padding: 2px 0 2px 16px;
  color: var(--stone-ink-dim, #a99e86); font-style: italic;
  font-family: var(--forge-body, 'Iowan Old Style', Palatino, Georgia, serif);
}
.guide-prose .lede {
  font-size: 18.5px; color: var(--stone-ink, #e8dcc4); line-height: 1.7;
}
`;
