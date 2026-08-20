// lib/seo.ts
//
// Structured-data (JSON-LD) builders. These emit schema.org objects that <JsonLd> serializes into
// <script type="application/ld+json"> tags. Google reads these to understand the site as an entity
// (Organization / WebSite), the product (SoftwareApplication), the FAQ (FAQPage rich result), and the
// tool hierarchy (BreadcrumbList). Everything here is static, controlled content - no user input is
// ever serialized, so the dangerouslySetInnerHTML in <JsonLd> is safe.
//
// SITE_URL mirrors layout.tsx's metadataBase logic on purpose: canonical tags and JSON-LD @ids must
// agree on one host, or they split authority. NEXT_PUBLIC_SITE_URL (e.g. https://www.six-axes.com) is
// authoritative in prod; the VERCEL_URL fallback keeps preview builds self-consistent.

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

// The publisher entity, referenced by @id from every other node. Kept lean and true: name, logo,
// founder, and the one verifiable external profile.
export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: "Six Axes",
    legalName: "Kerf and Code",
    url: SITE_URL,
    logo: `${SITE_URL}/icon.png`,
    description:
      "Six Axes records your tabletop RPG session, writes the recap, keeps the campaign wiki, and "
      + "tracks what was actually rolled.",
    founder: { "@type": "Person", name: "Terry Mickail" },
    sameAs: ["https://github.com/kerf-and-code"],
  };
}

// The site itself. No SearchAction: there is no public site-wide search endpoint, and pointing one at
// a route that does not exist is worse than omitting it.
export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: "Six Axes",
    url: SITE_URL,
    publisher: { "@id": ORG_ID },
  };
}

// The product. `offers` at price 0 reflects the current reality (free during the pilot, and the
// no-login tools are free for good); update to real tiers when pricing ships. No aggregateRating -
// we don't invent reviews.
export function softwareApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Six Axes",
    applicationCategory: "GameApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description:
      "Session analytics for tabletop RPGs. Records your table, writes the recap, builds the campaign "
      + "wiki, and tracks what was actually rolled - across D&D 5e, Pathfinder 2e, Draw Steel and "
      + "Daggerheart, on Discord or in person.",
    publisher: { "@id": ORG_ID },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

// FAQPage rich-result markup. Answers MUST be plain text (schema.org acceptedAnswer.text), so callers
// pass the plain-text version alongside their rendered JSX.
export function faqPageSchema(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}

// Breadcrumb trail. Pass segments in order, each a name + absolute-or-relative path (relative is
// resolved against SITE_URL).
export function breadcrumbSchema(segments: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: segments.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: s.name,
      item: s.path.startsWith("http") ? s.path : `${SITE_URL}${s.path}`,
    })),
  };
}

// Article (guide) markup. Unlike FAQ/HowTo, Article structured data still earns SERP treatment and
// helps entity/author understanding. datePublished/dateModified take an ISO date string.
export function articleSchema(g: { slug: string; title: string; description: string; updated: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: g.title,
    description: g.description,
    url: `${SITE_URL}/guides/${g.slug}`,
    mainEntityOfPage: `${SITE_URL}/guides/${g.slug}`,
    datePublished: g.updated,
    dateModified: g.updated,
    author: { "@type": "Person", name: "Terry Mickail" },
    publisher: { "@id": ORG_ID },
  };
}

// Convenience for the free-tool pages: Home › Free tools › <tool>.
export function toolBreadcrumb(name: string, slug: string) {
  return breadcrumbSchema([
    { name: "Home", path: "/" },
    { name: "Free tools", path: "/tools" },
    { name, path: `/tools/${slug}` },
  ]);
}
