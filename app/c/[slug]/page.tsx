import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import CodexFilter from "./codex-filter";

// app/c/[slug]/page.tsx
//
// The public face of a campaign. Anyone can read it, no account, no login.
//
// WHY THIS IS A SERVER COMPONENT AND EVERY OTHER PUBLIC PAGE HERE IS NOT
//   /journal/[share] fetches on the client, which is fine for a link you hand to your own players.
//   This page exists to be FOUND. A crawler that receives an empty shell and a spinner indexes an
//   empty shell, and half the value of publishing a codex is that a search for a campaign or an NPC
//   can land on it. So the content is rendered on the server, in the HTML, with real metadata.
//
//   The interactive filter is a small client island on top. Rendering the content twice - once for
//   readers, once for machines - would be the usual way to get both, and it is the usual way to
//   have them drift apart. One list, filtered in place.
//
// SECURITY IS NOT THIS FILE'S JOB
//   public_codex() decides what a stranger may read: the campaign must be published AND each item
//   marked public, and it is SECURITY DEFINER so anon holds no rights of its own. This page cannot
//   widen that by accident because it has nothing else to ask.

// No route-segment revalidate: this project runs with cacheComponents enabled, which rejects it in
// favour of the "use cache" directive. Rendering dynamically per request is fine here and costs two
// cheap RPCs - what SEO needs is full HTML from the SERVER, which this still produces. If these
// pages ever get real traffic, caching the loader is the optimisation, not a correctness fix.

type Item = {
  item_kind: "entry" | "npc";
  item_type: string;
  id: string;
  title: string | null;
  body: string | null;
  tags: string[] | null;
};

const SECTIONS: { type: string; label: string; blurb: string }[] = [
  { type: "location", label: "Places", blurb: "Where the story has been." },
  { type: "npc", label: "The cast", blurb: "Who the party has met." },
  { type: "lore", label: "Lore", blurb: "What is known about the world." },
  { type: "note", label: "Notes", blurb: "Everything else worth keeping." },
];

// A PLAIN anon client, not @/lib/supabase/server.
//
// That helper builds a session-aware client by reading cookies(), and cookies() is dynamic data
// access. generateMetadata runs outside any Suspense boundary to produce <title>, so calling it
// there made the whole route "uncached data outside <Suspense>" no matter how the body was
// arranged - which is why adding the boundary alone did not fix the build.
//
// It is also the wrong client for the job. This page is anonymous by definition: nothing it shows
// depends on who is looking, and a public codex has no business reading a visitor's session. The
// anon key is already public by design, and public_codex() is SECURITY DEFINER, so the gate is
// unchanged - this simply stops asking a question whose answer was never used.
function anon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function load(slug: string) {
  const supabase = anon();
  const [{ data: head }, { data: items }, { data: listed }] = await Promise.all([
    supabase.rpc("public_campaign", { p_slug: slug }),
    supabase.rpc("public_codex", { p_slug: slug }),
    supabase.rpc("public_campaign_listing", { p_slug: slug }),
  ]);
  const campaign = Array.isArray(head) ? head[0] : head;
  return {
    campaign: campaign ?? null,
    items: (items as Item[]) ?? [],
    listed: listed === true,
  };
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const { campaign, listed } = await load(slug);
  if (!campaign) return { title: "Campaign not found" };
  const title = `${campaign.name} — campaign codex`;
  const description =
    campaign.blurb ||
    `The places, cast and lore of ${campaign.name}, drawn from what was actually said at the table.`;
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

// The shell renders immediately; the codex streams into the Suspense boundary below.
//
// cacheComponents refuses an uncached await at the top of a route, and it is right to: awaiting
// there holds back the ENTIRE document, so a reader stares at nothing until two database round
// trips finish. Splitting the fetch into a boundary means the page frame ships first.
//
// This does NOT cost the SEO the page exists for. Streamed HTML arrives in the same response, so a
// crawler receives the finished document; it is the browser that gets to paint sooner. The one real
// consequence is that <title> comes from generateMetadata, which runs its own fetch - that is why
// load() stayed a plain shared function rather than moving inside the component.
// NOT async, and it does NOT await params.
//
// Under cacheComponents, `params` is itself uncached request data: awaiting it at the top of the
// component IS the blocking access the build complains about, whatever sits below. Three attempts
// went past this because the message points at the component and the obvious suspects are the
// database calls - but the slug arrives per request too, and reading it is what pins the route.
//
// So the promise is passed down UNAWAITED and unwrapped inside the boundary. The shell is then
// genuinely static and can be prerendered; everything request-shaped happens in one place.
export default function PublicCodexPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  return (
    <main style={page}>
      <article style={sheet}>
        <Suspense fallback={<p style={{ ...meta, padding: "40px 0" }}>Opening the codex…</p>}>
          <Codex params={params} />
        </Suspense>
      </article>
    </main>
  );
}

async function Codex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { campaign, items } = await load(slug);

  // An unpublished or unknown slug is a 404, not an error page. There is no difference from outside
  // between "never existed" and "was taken down", and there should not be: a GM who unpublishes has
  // withdrawn the page, and confirming it once existed leaks the thing they withdrew.
  if (!campaign) notFound();

  const sections = SECTIONS
    .map((s) => ({ ...s, rows: items.filter((i) => i.item_type === s.type) }))
    .filter((s) => s.rows.length > 0);

  const other = items.filter((i) => !SECTIONS.some((s) => s.type === i.item_type));
  if (other.length) sections.push({ type: "other", label: "Other", blurb: "", rows: other });

  const cover = (campaign as { codex_cover_url?: string | null }).codex_cover_url;

  return (
    <>
        <style dangerouslySetInnerHTML={{ __html: `
          .cdx-cols { display: grid; gap: 26px; align-items: start;
                      grid-template-columns: minmax(0, 1fr); }
          .cdx-rail { display: flex; flex-wrap: wrap; gap: 4px; }
          .cdx-link { text-decoration: none; }
          .cdx-link:hover { background: rgba(0,0,0,0.05); }
          /* Below this width a side rail would eat half the screen, so the sections become a row of
             links above the content instead. */
          @media (min-width: 860px) {
            .cdx-cols { grid-template-columns: 190px minmax(0, 1fr); }
            .cdx-rail { flex-direction: column; flex-wrap: nowrap;
                        position: sticky; top: 16px;
                        border-right: 1px solid rgba(0,0,0,0.08); padding-right: 12px; }
          }
        ` }} />

        {/* The cover is a BACKDROP for the title and the search, not a banner above them. A visitor
            arriving from a share link should see the campaign's own image with the one control that
            matters on top of it, rather than scrolling past a picture to reach a text box.
            Absent by design when no image is set: an empty frame looks broken, no frame does not. */}
        <header style={cover ? coverHeader(cover) : { marginBottom: 26 }}>
          <div style={cover ? coverInner : undefined}>
            <p style={cover ? { ...eyebrow, color: "rgba(255,255,255,0.72)" } : eyebrow}>Campaign codex</p>
            <h1 style={cover ? { ...h1, color: "#fff" } : h1}>{campaign.name}</h1>
            {campaign.blurb && (
              <p style={cover ? { ...lede, color: "rgba(255,255,255,0.86)" } : lede}>{campaign.blurb}</p>
            )}
            <p style={cover ? { ...meta, color: "rgba(255,255,255,0.66)" } : meta}>
              {items.length} entr{items.length === 1 ? "y" : "ies"}
              {sections.length ? ` across ${sections.length} section${sections.length === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </header>

        {items.length === 0 ? (
          <p style={body}>
            This campaign has been published but nothing has been added to the public page yet.
          </p>
        ) : (
          <>
            <CodexFilter total={items.length} />

            {/* Sections down the SIDE rather than as chips above the fold. A codex with five
                sections and eighty entries is a reference document, and a reference document wants
                its contents visible while you read rather than scrolled away. Collapses to a row
                on a narrow screen, where a side rail would eat half the width. */}
            <div className="cdx-cols">
              <nav className="cdx-rail" aria-label="Sections">
                {sections.map((s) => (
                  <a key={s.type} href={`#${s.type}`} className="cdx-link" style={railLink}>
                    <span>{s.label}</span>
                    <span style={railCount}>{s.rows.length}</span>
                  </a>
                ))}
              </nav>

              <div>
            {sections.map((s) => (
              <section key={s.type} id={s.type} style={{ marginBottom: 34 }} data-section>
                <h2 style={h2}>{s.label}</h2>
                {s.blurb && <p style={sectionBlurb}>{s.blurb}</p>}
                {s.rows.map((it) => (
                  // data-title and data-body are what the filter reads. Kept on the rendered
                  // element rather than duplicated into a script tag, so there is one copy of the
                  // text and it is the one a reader and a crawler both see.
                  <div
                    key={it.id}
                    data-item
                    data-search={`${it.title ?? ""} ${it.body ?? ""} ${(it.tags ?? []).join(" ")}`.toLowerCase()}
                    style={card}
                  >
                    <h3 style={h3}>{it.title}</h3>
                    {it.body
                      ? <p style={body}>{it.body}</p>
                      : <p style={{ ...body, opacity: 0.55, fontStyle: "italic" }}>No description yet.</p>}
                    {it.tags && it.tags.length > 0 && (
                      <p style={{ marginTop: 8, marginBottom: 0 }}>
                        {it.tags.map((t) => <span key={t} style={tag}>{t}</span>)}
                      </p>
                    )}
                  </div>
                ))}
              </section>
            ))}
              </div>
            </div>
          </>
        )}

        <footer style={footer}>
          <p style={{ margin: 0 }}>
            Written from what was said at the table, not typed up afterwards. Made with{" "}
            <a href="/" style={{ color: "#8a6a2f" }}>Six Axes</a>.
          </p>
        </footer>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Deliberately NOT the app's dungeon theme. A stranger arriving from a search
   result is reading, not playing: this is a document, so it is set like one -
   light, high contrast, generous measure. The app's stone-and-brass chrome is
   for people inside a campaign.
--------------------------------------------------------------------------- */

const page: React.CSSProperties = {
  minHeight: "100vh", background: "#f6f2e9", color: "#2a2620",
  padding: "48px 20px 64px",
  fontFamily: "'Iowan Old Style', Georgia, 'Times New Roman', serif",
};
const sheet: React.CSSProperties = { maxWidth: 720, margin: "0 auto" };
const eyebrow: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11,
  letterSpacing: "0.22em", textTransform: "uppercase", color: "#8a7a55", margin: "0 0 6px",
};
const h1: React.CSSProperties = { fontSize: 40, lineHeight: 1.1, margin: "0 0 10px", fontWeight: 600 };
const lede: React.CSSProperties = { fontSize: 18, lineHeight: 1.6, color: "#4a443a", margin: "0 0 10px" };
const meta: React.CSSProperties = {
  fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#8a8069", margin: 0,
};
const h2: React.CSSProperties = {
  fontSize: 26, margin: "0 0 4px", fontWeight: 600,
  borderBottom: "1px solid #ddd4c2", paddingBottom: 8,
};
const coverHeader = (url: string): React.CSSProperties => ({
  // The gradient is what makes white type legible over an image nobody has vetted. Without it a
  // pale photograph would render the campaign name invisible, and the GM would have no way to know.
  backgroundImage: `linear-gradient(rgba(20,14,8,0.30), rgba(20,14,8,0.78)), url(${JSON.stringify(url)})`,
  backgroundSize: "cover",
  backgroundPosition: "center",
  borderRadius: 6,
  marginBottom: 26,
  minHeight: 220,
  display: "flex",
  alignItems: "flex-end",
});
const coverInner: React.CSSProperties = { padding: "26px 24px 20px" };

const railLink: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", gap: 10,
  padding: "7px 10px", borderRadius: 4, textDecoration: "none",
  color: "#4a4235", fontSize: 14, minWidth: 128,
};
const railCount: React.CSSProperties = { color: "#9a9081", fontVariantNumeric: "tabular-nums" };

const sectionBlurb: React.CSSProperties = { fontSize: 14, color: "#7a7060", margin: "6px 0 16px" };
const card: React.CSSProperties = {
  padding: "14px 0", borderBottom: "1px solid #e6ddcb",
};
const h3: React.CSSProperties = { fontSize: 19, margin: "0 0 6px", fontWeight: 600 };
const body: React.CSSProperties = { fontSize: 16, lineHeight: 1.7, margin: 0, color: "#3a352c" };
const tag: React.CSSProperties = {
  display: "inline-block", fontFamily: "ui-monospace, monospace", fontSize: 11,
  color: "#7a6a45", background: "#ece4d2", borderRadius: 3, padding: "2px 7px", marginRight: 6,
};
const chip: React.CSSProperties = {
  display: "inline-block", marginRight: 8, marginBottom: 8, padding: "5px 11px",
  border: "1px solid #ddd4c2", borderRadius: 3, color: "#5a5245",
  textDecoration: "none", fontSize: 13,
};
const footer: React.CSSProperties = {
  marginTop: 40, paddingTop: 18, borderTop: "1px solid #ddd4c2",
  fontSize: 13, color: "#8a8069",
};
