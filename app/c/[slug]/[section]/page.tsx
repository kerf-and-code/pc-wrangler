import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { load, Shell, countsOf, sectionBySlug } from "../shared";

// One category: every place, or everyone the party has met.
//
// A PAGE PER CATEGORY rather than an anchor on one long document. The difference is that a category
// is now somewhere you can link to, come back to, and land on from a search - which is most of what
// separates a wiki from a page with headings.

type P = { params: Promise<{ slug: string; section: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug, section } = await params;
  const sec = sectionBySlug(section);
  const { campaign, listed } = await load(slug);
  if (!campaign || !sec) return { title: "Not found" };
  const title = `${sec.label} — ${campaign.name}`;
  return {
    title,
    description: sec.blurb,
    openGraph: { title, description: sec.blurb, type: "article" },
    robots: listed ? undefined : { index: false, follow: false },
  };
}

export default async function SectionPage({ params }: P) {
  const { slug, section } = await params;
  const sec = sectionBySlug(section);
  const { campaign, items } = await load(slug);
  if (!campaign || !sec) notFound();

  const rows = items
    .filter((i) => i.item_type === sec.type)
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  return (
    <Shell slug={slug} campaign={campaign} counts={countsOf(items)} current={sec.slug}>
      <h1 style={{ fontSize: 32, lineHeight: 1.15, margin: "0 0 6px", fontWeight: 600 }}>
        {sec.label}
      </h1>
      <p style={{ fontSize: 15, color: "var(--w-muted)", margin: "0 0 24px" }}>{sec.blurb}</p>

      {rows.length === 0 ? (
        <p style={{ color: "var(--w-muted)", fontSize: 15 }}>Nothing here yet.</p>
      ) : (
        rows.map((it) => (
          <a key={it.id} href={`/c/${slug}/${sec.slug}/${it.slug || it.id}`}
            style={{
              display: "block", padding: "14px 0",
              borderBottom: "1px solid var(--w-line)", textDecoration: "none", color: "inherit",
            }}>
            <div style={{ fontSize: 19, fontWeight: 600, marginBottom: 4 }}>{it.title}</div>
            {it.body ? (
              <p style={{
                fontSize: 15, lineHeight: 1.6, margin: 0, color: "var(--w-ink-2)",
                display: "-webkit-box", WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical" as const, overflow: "hidden",
              }}>
                {it.body}
              </p>
            ) : (
              // Named but not yet described. Said plainly rather than with an apologetic italic
              // "No description yet" - the name IS information, and the phrasing was saying more
              // about the tool than about the place.
              <p style={{ fontSize: 14, color: "var(--w-muted)", margin: 0 }}>Not yet described.</p>
            )}
          </a>
        ))
      )}
    </Shell>
  );
}
