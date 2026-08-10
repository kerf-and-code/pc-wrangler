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
//   public_codex() decides what a stranger may read: the campaign must be published AND each item
//   marked public, and it is SECURITY DEFINER so anon holds no rights of its own. This page cannot
//   widen that by accident because it has nothing else to ask.

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
    // Readable by link, but the GM did not ask to be found. A crawler that follows the link anyway
    // is asked not to keep it: unlike an unshared link, an indexed page outlives unpublishing.
    robots: listed ? undefined : { index: false, follow: false },
  };
}

// The default export MUST NOT await. cacheComponents rejects any uncached await outside a Suspense
// boundary, and `await params` is one - so the awaiting work moves into a child that sits inside
// Frame's boundary.
export default function CodexPage({ params }: P) {
  return <Frame><CodexBody params={params} /></Frame>;
}

async function CodexBody({ params }: P) {
  const { slug } = await params;
  const { campaign, items } = await load(slug);
  if (!campaign) notFound();

  const counts = countsOf(items);
  const cover = campaign.codex_cover_url;

  return (
    <Shell slug={slug} campaign={campaign} counts={counts}>
      {/* The cover is a BACKDROP for the title, not a banner above it. A visitor arriving from a
          share link should see the campaign's own image with the name on top, rather than scrolling
          past a picture to reach the content. Absent entirely when unset: an empty frame looks
          broken, no frame does not. */}
      <header style={cover ? {
        backgroundImage:
          `linear-gradient(rgba(20,14,8,0.30), rgba(20,14,8,0.82)), url(${JSON.stringify(cover)})`,
        backgroundSize: "cover", backgroundPosition: "center",
        borderRadius: 6, marginBottom: 26, minHeight: 220,
        display: "flex", alignItems: "flex-end",
      } : { marginBottom: 26 }}>
        <div style={cover ? { padding: "26px 24px 20px" } : undefined}>
          <h1 style={{
            fontSize: 40, lineHeight: 1.1, margin: "0 0 10px", fontWeight: 600,
            color: cover ? "#fff" : "var(--w-ink)",
          }}>
            {campaign.name}
          </h1>
          {campaign.blurb && (
            <p style={{
              fontSize: 18, lineHeight: 1.6, margin: "0 0 10px",
              color: cover ? "rgba(255,255,255,0.86)" : "var(--w-ink-2)",
            }}>
              {campaign.blurb}
            </p>
          )}
          <p style={{
            fontFamily: "ui-monospace, monospace", fontSize: 12, margin: 0,
            color: cover ? "rgba(255,255,255,0.66)" : "var(--w-muted)",
          }}>
            {items.length} entr{items.length === 1 ? "y" : "ies"}
          </p>
        </div>
      </header>

      <CodexFilter total={items.length} />

      {items.length === 0 ? (
        <p style={{ color: "var(--w-muted)", fontSize: 15 }}>
          Nothing has been published here yet.
        </p>
      ) : (
        SECTIONS.map((sec) => {
          const rows = items
            .filter((i) => matchesSection(i, sec))
            .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
            .slice(0, 6);
          if (!rows.length) return null;
          return (
            <section key={sec.slug} id={sec.slug} style={{ marginBottom: 34 }} data-section>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                gap: 10, borderBottom: "1px solid var(--w-line)", paddingBottom: 8,
              }}>
                <h2 style={{ fontSize: 24, margin: 0, fontWeight: 600 }}>{sec.label}</h2>
                <a href={`/c/${slug}/${sec.slug}`} style={{
                  fontFamily: "ui-monospace, monospace", fontSize: 11.5,
                  color: "var(--w-accent)", textDecoration: "none",
                }}>
                  all {counts[sec.slug] ?? 0} &rarr;
                </a>
              </div>
              <p style={{ fontSize: 14, color: "var(--w-muted)", margin: "6px 0 12px" }}>
                {sec.blurb}
              </p>
              {rows.map((it: Item) => (
                <a key={it.id} href={`/c/${slug}/${sec.slug}/${it.slug || it.id}`}
                  data-item
                  data-search={`${it.title || ""} ${it.body || ""}`.toLowerCase()}
                  style={{
                    display: "block", padding: "12px 0",
                    borderBottom: "1px solid var(--w-line)",
                    textDecoration: "none", color: "inherit",
                  }}>
                  <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 3 }}>{it.title}</div>
                  {it.body ? (
                    <p style={{
                      fontSize: 15, lineHeight: 1.6, margin: 0, color: "var(--w-ink-2)",
                      display: "-webkit-box", WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical" as const, overflow: "hidden",
                    }}>
                      {it.body}
                    </p>
                  ) : (
                    <p style={{ fontSize: 14, color: "var(--w-muted)", margin: 0 }}>
                      Not yet described.
                    </p>
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
