import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  load, Shell, Frame, countsOf, sectionBySlug, matchesSection,
  relatedTo, sectionForItem,
} from "../../shared";

// One entry, on its own page.
//
// THE SLUG IS THE ADDRESS, and it never changes on its own - a GM fixing a typo in a title does not
// break a link somebody shared last week. The id is accepted as a fallback so an entry created before
// slugs existed, or one whose slug is somehow null, is still reachable rather than lost.

type P = { params: Promise<{ slug: string; section: string; entry: string }> };

async function find(slug: string, section: string, entry: string) {
  const sec = sectionBySlug(section);
  const { campaign, items, listed, links } = await load(slug);
  const item = sec
    ? items.find((i) => matchesSection(i, sec) && (i.slug === entry || i.id === entry))
    : undefined;
  return { campaign, items, listed, links, sec, item };
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

export default function EntryPage({ params }: P) {
  return <Frame><EntryBody params={params} /></Frame>;
}

async function EntryBody({ params }: P) {
  const { slug, section, entry } = await params;
  const { campaign, items, links, sec, item } = await find(slug, section, entry);
  if (!campaign || !sec || !item) notFound();

  const related = relatedTo(item, links, items);

  return (
    <Shell slug={slug} campaign={campaign} counts={countsOf(items)} current={sec.slug} wide>
      <div className="w-entry">
        <article>
          <a className="w-back" href={`/c/${slug}/${sec.slug}`}>&larr; {sec.label}</a>

          <h1 className="w-title">{item.title}</h1>

          {/* Below the title, not behind it: an entry has a title, tags and a body, so type over an
              unvetted image here would be a legibility gamble taken on the GM's behalf. */}
          {item.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="w-hero" src={item.image_url} alt="" />
          )}

          {item.tags && item.tags.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              {item.tags.map((t) => (
                <span key={t} className="w-tag">{t}</span>
              ))}
            </div>
          )}

          {item.body ? (
            // whiteSpace preserves the paragraph breaks a GM typed; without it the entry runs together
            // into one block and reads as a wall.
            <div className="w-body">{item.body}</div>
          ) : (
            <p style={{ color: "var(--w-muted)", fontSize: 15 }}>
              This one has a name and nothing else yet.
            </p>
          )}
        </article>

        {/* The right rail. Present only when there is something to put in it: an empty panel reads as
            broken, no panel reads as "nothing linked here yet", which is the truth. */}
        {related.length > 0 && (
          <aside className="w-rail-r">
            <div className="w-card">
              <div className="ey" style={{ marginBottom: 12 }}>Related</div>
              {related.map(({ item: r, relation }) => {
                const rs = sectionForItem(r);
                if (!rs) return null;
                return (
                  <a key={r.id} className="w-rel" href={`/c/${slug}/${rs.slug}/${r.slug || r.id}`}>
                    <span className="k">{rs.label}</span>
                    <span className="t">
                      {r.title}
                      {relation && <small>{relation}</small>}
                    </span>
                  </a>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </Shell>
  );
}
