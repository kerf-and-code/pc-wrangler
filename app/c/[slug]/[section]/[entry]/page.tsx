import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  load, Shell, Frame, countsOf, sectionBySlug, matchesSection,
  relatedTo, sectionForItem, type WikiBlock,
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

// Render a rich entry: text blocks as prose, image blocks with caption and alignment. Blocks flow
// left to right and wrap; a "half" block takes about half the width, so two halves sit side by side.
function WikiBlocks({ blocks }: { blocks: WikiBlock[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
      {blocks.map((b) => {
        const half = b.width === "half";
        return (
          <div key={b.id} style={{ flexBasis: half ? "calc(50% - 10px)" : "100%", flexGrow: half ? 1 : 0, minWidth: 240 }}>
            {b.type === "header" ? (
              <h2 id={`h-${b.id}`} className="w-h2">{b.text}</h2>
            ) : b.type === "text" ? (
              <div className="w-body">{b.text}</div>
            ) : (
              <figure style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.url} alt={b.caption}
                  style={{
                    display: "block", borderRadius: 8, border: "1px solid var(--w-line)", maxWidth: "100%",
                    width: b.align === "full" || half ? "100%" : "auto",
                    marginLeft: b.align === "right" || b.align === "center" ? "auto" : 0,
                    marginRight: b.align === "left" || b.align === "center" ? "auto" : 0,
                  }} />
                {b.caption && (
                  <figcaption style={{ fontSize: 13.5, color: "var(--w-muted)", fontStyle: "italic", marginTop: 8 }}>
                    {b.caption}
                  </figcaption>
                )}
              </figure>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EntryPage({ params }: P) {
  return <Frame><EntryBody params={params} /></Frame>;
}

async function EntryBody({ params }: P) {
  const { slug, section, entry } = await params;
  const { campaign, items, links, sec, item } = await find(slug, section, entry);
  if (!campaign || !sec || !item) notFound();

  const related = relatedTo(item, links, items);
  const headers = (item.blocks || []).filter(
    (b): b is Extract<WikiBlock, { type: "header" }> => b.type === "header" && !!b.text.trim()
  );
  const hasLeft = headers.length > 0 || related.length > 0;

  return (
    <Shell slug={slug} campaign={campaign} counts={countsOf(items)} current={sec.slug} wide>
      <div className="w-entry" style={hasLeft ? undefined : { gridTemplateColumns: "minmax(0,1fr)" }}>
        {/* Left rail: the entry's own contents (from header blocks), then its connections. Present
            only when there's something to show; otherwise the content takes the full width. */}
        {hasLeft && (
          <aside className="w-rail-l">
            {headers.length > 0 && (
              <div className="w-card" style={{ marginBottom: 16 }}>
                <div className="ey" style={{ marginBottom: 12 }}>Contents</div>
                <nav className="w-toc">
                  {headers.map((h) => (
                    <a key={h.id} href={`#h-${h.id}`}>{h.text}</a>
                  ))}
                </nav>
              </div>
            )}
            {related.length > 0 && (
              <div className="w-card">
                <div className="ey" style={{ marginBottom: 12 }}>Connections</div>
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
            )}
          </aside>
        )}

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

          {item.summary && (
            <p style={{ fontSize: 19, lineHeight: 1.6, color: "var(--w-ink-2)", fontStyle: "italic", margin: "0 0 20px" }}>
              {item.summary}
            </p>
          )}

          {item.blocks && item.blocks.length > 0 ? (
            <WikiBlocks blocks={item.blocks} />
          ) : item.body ? (
            <div className="w-body">{item.body}</div>
          ) : (
            <p style={{ color: "var(--w-muted)", fontSize: 15 }}>
              This one has a name and nothing else yet.
            </p>
          )}
        </article>
      </div>
    </Shell>
  );
}
