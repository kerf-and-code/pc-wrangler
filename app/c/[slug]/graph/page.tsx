import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { load, Shell, Frame, countsOf, sectionForItem } from "../shared";
import CodexGraph from "@/components/codex-graph";
import { buildGraph } from "@/lib/codex-graph";

// /c/[slug]/graph (2026-11-11, push 33, audit P3): how a published campaign's places, cast and lore
// connect. Only what public_codex and public_codex_links already let a stranger read is drawn, so this
// page shows nothing the codex pages do not. Each item links to its own page.

type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug } = await params;
  const { campaign, listed } = await load(slug);
  if (!campaign) return { title: "Campaign not found" };
  const title = `${campaign.name}: how it all connects`;
  const description = `The places, cast and lore of ${campaign.name}, and how they are tied together.`;
  return {
    title, description,
    openGraph: { title, description, type: "article" },
    robots: listed ? undefined : { index: false, follow: false },
  };
}

export default function GraphPage({ params }: P) {
  return <Frame><GraphBody params={params} /></Frame>;
}

async function GraphBody({ params }: P) {
  const { slug } = await params;
  const { campaign, items, links } = await load(slug);
  if (!campaign) notFound();

  const entries = items.filter((i) => i.item_kind === "entry").map((i) => ({ id: i.id, type: i.item_type, title: i.title, tags: i.tags }));
  const chars = items.filter((i) => i.item_kind !== "entry").map((i) => ({ id: i.id, name: i.title ?? "", kind: i.item_kind }));
  const g = buildGraph(entries, chars, links, { includeUnlinked: true });
  const hrefs: Record<string, string> = {};
  for (const it of items) {
    const sec = sectionForItem(it);
    if (sec) hrefs[it.id] = `/c/${slug}/${sec.slug}/${it.slug || it.id}`;
  }

  return (
    <Shell slug={slug} campaign={campaign} counts={countsOf(items)} wide>
      <a className="w-back" href={`/c/${slug}`}>&larr; {campaign.name}</a>
      <h1 className="w-h2" style={{ fontSize: 30, margin: "10px 0 6px" }}>How it all connects</h1>
      <p style={{ color: "var(--w-ink-2)", fontSize: 16, lineHeight: 1.6, margin: "0 0 18px" }}>
        Every place, person and piece of lore in this codex, and the ties between them.
      </p>
      <CodexGraph nodes={g.nodes} edges={g.edges} hrefs={hrefs}
        colors={{ text: "var(--w-ink)", muted: "var(--w-muted)", line: "var(--w-line)", panel: "var(--w-panel)", accent: "var(--w-accent)" }}
        emptyText="Nothing in this codex is connected yet." />
    </Shell>
  );
}
