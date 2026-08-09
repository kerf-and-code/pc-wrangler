import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { load, Shell, countsOf, sectionBySlug } from "../../shared";

// One entry, on its own page.
//
// THE SLUG IS THE ADDRESS, and it never changes on its own - a GM fixing a typo in a title does not
// break a link somebody shared last week. The id is accepted as a fallback so an entry created
// before slugs existed, or one whose slug is somehow null, is still reachable rather than lost.

type P = { params: Promise<{ slug: string; section: string; entry: string }> };

async function find(slug: string, section: string, entry: string) {
  const sec = sectionBySlug(section);
  const { campaign, items, listed } = await load(slug);
  const item = sec
    ? items.find((i) => i.item_type === sec.type && (i.slug === entry || i.id === entry))
    : undefined;
  return { campaign, items, listed, sec, item };
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug, section, entry } = await params;
  const { campaign, item, listed } = await find(slug, section, entry);
  if (!campaign || !item) return { title: "Not found" };
  const title = `${item.title} — ${campaign.name}`;
  const description = (item.body || "").slice(0, 180) || `${item.title}, from ${campaign.name}.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    robots: listed ? undefined : { index: false, follow: false },
  };
}

export default async function EntryPage({ params }: P) {
  const { slug, section, entry } = await params;
  const { campaign, items, sec, item } = await find(slug, section, entry);
  if (!campaign || !sec || !item) notFound();

  return (
    <Shell slug={slug} campaign={campaign} counts={countsOf(items)} current={sec.slug}>
      <a href={`/c/${slug}/${sec.slug}`} style={{
        fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.14em",
        textTransform: "uppercase", color: "var(--w-muted)", textDecoration: "none",
      }}>
        &larr; {sec.label}
      </a>

      <h1 style={{ fontSize: 36, lineHeight: 1.15, margin: "10px 0 12px", fontWeight: 600 }}>
        {item.title}
      </h1>

      {item.tags && item.tags.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {item.tags.map((t) => (
            <span key={t} style={{
              display: "inline-block", fontFamily: "ui-monospace, monospace", fontSize: 11,
              color: "var(--w-accent)", background: "var(--w-tag-bg)",
              borderRadius: 3, padding: "2px 7px", marginRight: 6,
            }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {item.body ? (
        // whiteSpace preserves the paragraph breaks a GM typed. Without it the whole entry runs
        // together into one block and reads as a wall.
        <div style={{
          fontSize: 17, lineHeight: 1.75, color: "var(--w-ink)", whiteSpace: "pre-wrap",
        }}>
          {item.body}
        </div>
      ) : (
        <p style={{ color: "var(--w-muted)", fontSize: 15 }}>
          This one has a name and nothing else yet.
        </p>
      )}
    </Shell>
  );
}
