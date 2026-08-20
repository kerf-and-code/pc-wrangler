import type { Metadata } from "next";
import Link from "next/link";
import SiteShell from "@/components/site/site-shell";
import JsonLd from "@/components/json-ld";
import { breadcrumbSchema } from "@/lib/seo";
import { GUIDES } from "@/lib/guides/guides";
import { SAX, STONE } from "@/lib/theme";
import { stonePanel } from "@/lib/forge-theme";

// app/guides/page.tsx
//
// The guides hub: long-form, system-agnostic articles for running a better table. Server-rendered,
// public (allowlisted in proxy.ts). Lists everything in the GUIDES registry.

export const metadata: Metadata = {
  title: "Guides",
  description:
    "Practical, system-agnostic guides for running tabletop RPGs: writing session recaps, recording "
    + "your game, keeping a campaign wiki, and notes that stay useful.",
  alternates: { canonical: "/guides" },
};

export default function GuidesIndex() {
  return (
    <SiteShell title="Guides" tagline="Practical, system-agnostic advice for running a better table.">
      <JsonLd data={breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Guides", path: "/guides" }])} />
      <div style={{ display: "grid", gap: 14 }}>
        {GUIDES.map((g) => (
          <Link key={g.slug} href={`/guides/${g.slug}`} style={{ ...stonePanel(), padding: "18px 20px", textDecoration: "none", display: "block" }}>
            <div style={cardTitle}>{g.title}</div>
            <p style={cardExcerpt}>{g.excerpt}</p>
          </Link>
        ))}
      </div>
    </SiteShell>
  );
}

const cardTitle: React.CSSProperties = {
  fontFamily: "var(--forge-display, 'Cinzel', serif)", fontWeight: 600, fontSize: 20, color: STONE.ink,
  letterSpacing: "0.02em",
};
const cardExcerpt: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.6, color: STONE.inkDim, margin: "7px 0 0", fontFamily: SAX.serif };
