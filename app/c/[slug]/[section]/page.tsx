import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { load, Shell, Frame, countsOf, sectionBySlug, matchesSection } from "../shared";

// One category: every place, or everyone the party has met.
//
// A PAGE PER CATEGORY rather than an anchor on one long document. A category is now somewhere you can
// link to, come back to, and land on from a search - which is most of what separates a wiki from a
// page with headings.

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

export default function SectionPage({ params }: P) {
  return <Frame><SectionBody params={params} /></Frame>;
}

async function SectionBody({ params }: P) {
  const { slug, section } = await params;
  const sec = sectionBySlug(section);
  const { campaign, items } = await load(slug);
  if (!campaign || !sec) notFound();

  const rows = items
    .filter((i) => matchesSection(i, sec))
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  return (
    <Shell slug={slug} campaign={campaign} counts={countsOf(items)} current={sec.slug}>
      <div className="ey" style={{ marginBottom: 8 }}>Codex</div>
      <div className="w-sec-head" style={{ marginBottom: 6 }}>
        <h2 style={{ fontSize: 30 }}>{sec.label}</h2>
      </div>
      <p className="w-sec-blurb" style={{ margin: "8px 0 24px" }}>{sec.blurb}</p>

      {rows.length === 0 ? (
        <p className="w-empty">Nothing here yet.</p>
      ) : (
        rows.map((it) => (
          <a key={it.id} className="w-item" href={`/c/${slug}/${sec.slug}/${it.slug || it.id}`}>
            <div className="w-row">
              {it.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="w-thumb" src={it.image_url} alt="" loading="lazy" />
              )}
              <div style={{ minWidth: 0 }}>
                <div className="w-item-t" style={{ fontSize: 19 }}>{it.title}</div>
                {it.body ? (
                  <p style={{
                    fontSize: 15, lineHeight: 1.6, margin: 0, color: "var(--w-ink-2)",
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden",
                  }}>
                    {it.body}
                  </p>
                ) : (
                  <p style={{ fontSize: 14, color: "var(--w-muted)", margin: 0 }}>Not yet described.</p>
                )}
              </div>
            </div>
          </a>
        ))
      )}
    </Shell>
  );
}
