import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { load, Shell, Frame, countsOf, SECTIONS, matchesSection, type Item } from "./shared";
import CodexFilter from "./codex-filter";

// The front page of a published campaign.
//
// WHY THIS IS A SERVER COMPONENT
//   This page exists to be FOUND. A crawler that receives an empty shell and a spinner indexes an
//   empty shell, and half the value of publishing a codex is that a search for a campaign or an NPC
//   can land on it. So the content is rendered on the server, in the HTML, with real metadata.
//
// SECURITY IS NOT THIS FILE'S JOB
//   public_codex() decides what a stranger may read; it is SECURITY DEFINER so anon holds no rights
//   of its own. This page cannot widen that by accident because it has nothing else to ask.

type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug } = await params;
  const { campaign, listed } = await load(slug);
  if (!campaign) return { title: "Campaign not found" };
  const title = `${campaign.name} — campaign codex`;
  const description =
    campaign.blurb ||
    `The places and cast of ${campaign.name}, drawn from what was actually said at the table.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary", title, description },
    robots: listed ? undefined : { index: false, follow: false },
  };
}

export default function CodexPage({ params }: P) {
  return <Frame><CodexBody params={params} /></Frame>;
}

async function CodexBody({ params }: P) {
  const { slug } = await params;
  const { campaign, items, snapshotUrl } = await load(slug);
  if (!campaign) notFound();

  const counts = countsOf(items);
  const cover = campaign.codex_cover_url;

  return (
    <Shell slug={slug} campaign={campaign} counts={counts}>
      {/* The cover is a BACKDROP for the title, not a banner above it: a visitor from a share link
          sees the campaign's own image with the name on top rather than scrolling past a picture.
          The crest carries the initial when there's a cover, so the eye has a focal point. */}
      <header
        className={cover ? "w-banner cover" : "w-banner"}
        style={cover ? {
          backgroundImage:
            `linear-gradient(rgba(20,17,13,0.30), rgba(20,17,13,0.86)), url(${JSON.stringify(cover)})`,
        } : undefined}
      >
        {cover && <div className="w-crest">{campaign.name.charAt(0)}</div>}
        <div className="w-banner-in">
          <div className="ey" style={{ marginBottom: 8 }}>Campaign codex</div>
          <h1 style={cover ? { color: "#fff" } : undefined}>{campaign.name}</h1>
          {campaign.blurb && (
            <p style={{ fontSize: 18, lineHeight: 1.6, margin: "0 0 10px", color: cover ? "rgba(255,255,255,0.86)" : "var(--w-ink-2)" }}>
              {campaign.blurb}
            </p>
          )}
          <p className="w-mono" style={{ fontSize: 12, margin: 0, letterSpacing: "0.08em", color: cover ? "rgba(255,255,255,0.66)" : "var(--w-muted)" }}>
            {items.length} entr{items.length === 1 ? "y" : "ies"}
          </p>
        </div>
      </header>

      {snapshotUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="w-hero" src={snapshotUrl} alt={`${campaign.name} world map`} />
      )}

      <CodexFilter total={items.length} />

      {items.length === 0 ? (
        <p className="w-empty">Nothing has been published here yet.</p>
      ) : (
        SECTIONS.map((sec) => {
          const rows = items
            .filter((i) => matchesSection(i, sec))
            .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
            .slice(0, 6);
          if (!rows.length) return null;
          return (
            <section key={sec.slug} id={sec.slug} className="w-sec" data-section>
              <div className="w-sec-head">
                <h2>{sec.label}</h2>
                <a className="w-all" href={`/c/${slug}/${sec.slug}`}>all {counts[sec.slug] ?? 0} &rarr;</a>
              </div>
              <p className="w-sec-blurb">{sec.blurb}</p>
              {rows.map((it: Item) => (
                <a key={it.id} className="w-item" href={`/c/${slug}/${sec.slug}/${it.slug || it.id}`}
                  data-item
                  data-search={`${it.title || ""} ${it.body || ""}`.toLowerCase()}>
                  <div className="w-item-t">{it.title}</div>
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
                </a>
              ))}
            </section>
          );
        })
      )}
    </Shell>
  );
}
