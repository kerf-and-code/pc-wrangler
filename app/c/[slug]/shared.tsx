// Everything the three wiki routes share: the loader, the theme, and the page chrome.
//
// REDESIGN NOTE (Six Axes look): the DATA layer below (load, SECTIONS, matchesSection, countsOf, the
// RPCs, the anon client) is unchanged. What changed is the chrome and the stylesheet: the left rail
// became a top bar with a native <details> dropdown (no client JS, links stay in the HTML so crawlers
// still see them), the content is a centered column, and the styles carry the dark-and-gold treatment.
// Server-render, SEO, and the light/dark toggle are all preserved.

import React from "react";
import { createClient } from "@supabase/supabase-js";
import ThemeToggle from "./theme-toggle";

export type WikiBlock =
  | { id: string; type: "text"; text: string; width?: "full" | "half" }
  | { id: string; type: "header"; text: string; width?: "full" | "half" }
  | { id: string; type: "image"; url: string; caption: string; align: "left" | "center" | "right" | "full"; width?: "full" | "half" };

export type Item = {
  item_kind: "entry" | "npc";
  item_type: string;
  id: string;
  title: string | null;
  body: string | null;
  tags: string[] | null;
  slug: string | null;
  image_url: string | null;
  summary: string | null;
  blocks: WikiBlock[] | null;
};

export type Campaign = {
  name: string;
  blurb: string | null;
  items: number;
  codex_cover_url?: string | null;
};

// A public connection between two codex items. entity_links types are "entry" | "character";
// a "character" endpoint is one of the item_kind='npc' rows public_codex returns.
export type Link = {
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relation: string | null;
};

// FIVE SECTIONS, tag-aware. Lore, factions and items are all stored as type='lore', split only by a
// reserved tag, exactly like the GM codex tabs. matchesSection() checks the tag so every entry lands
// in exactly one place; the Lore section (no tag) takes lore carrying NEITHER reserved tag.
export const SECTIONS: { type: string; slug: string; label: string; blurb: string; tag?: string }[] = [
  { type: "location", slug: "places", label: "Places", blurb: "Where the story has been." },
  { type: "npc", slug: "cast", label: "The cast", blurb: "Who the party has met." },
  { type: "lore", slug: "factions", label: "Factions", blurb: "The powers and groups in play.", tag: "faction" },
  { type: "lore", slug: "items", label: "Items", blurb: "The objects that matter.", tag: "item" },
  { type: "lore", slug: "lore", label: "Lore", blurb: "History, rumours, and the world itself." },
];

export const RESERVED_TAGS = new Set(SECTIONS.map((s) => s.tag).filter((t): t is string => !!t));

export const sectionBySlug = (s: string) => SECTIONS.find((x) => x.slug === s);
export const sectionByType = (t: string) => SECTIONS.find((x) => x.type === t);

export function matchesSection(item: { item_type: string; tags: string[] | null }, sec: { type: string; tag?: string }): boolean {
  if (item.item_type !== sec.type) return false;
  const tags = item.tags || [];
  if (sec.tag) return tags.includes(sec.tag);
  return !tags.some((t) => RESERVED_TAGS.has(t));
}

// A PLAIN anon client, not @/lib/supabase/server: these pages are read by strangers with no session.
function anon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function load(slug: string) {
  const supabase = anon();
  const [{ data: head }, { data: items }, { data: listed }, { data: snapshot }, { data: links }] = await Promise.all([
    supabase.rpc("public_campaign", { p_slug: slug }),
    supabase.rpc("public_codex", { p_slug: slug }),
    supabase.rpc("public_campaign_listing", { p_slug: slug }),
    supabase.rpc("public_world_snapshot", { p_slug: slug }),
    supabase.rpc("public_codex_links", { p_slug: slug }),
  ]);
  const campaign = (Array.isArray(head) ? head[0] : head) as Campaign | null;
  const all = ((items as Item[]) ?? []).filter((i) => SECTIONS.some((s) => s.type === i.item_type));
  return {
    campaign: campaign ?? null,
    items: all,
    listed: listed === true,
    snapshotUrl: typeof snapshot === "string" ? snapshot : null,
    links: (links as Link[]) ?? [],
  };
}

// Given the loaded items, resolve the public entries connected to one item, ready to link.
// entity_links types map to item_kind: "entry" -> "entry", "character" -> "npc".
export function relatedTo(item: Item, links: Link[], items: Item[]): { item: Item; relation: string | null }[] {
  const selfType = item.item_kind === "npc" ? "character" : "entry";
  const byId = new Map(items.map((i) => [i.id, i]));
  const kindOf = (t: string) => (t === "character" ? "npc" : "entry");
  const out: { item: Item; relation: string | null }[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    let otherType: string | null = null, otherId: string | null = null;
    if (l.source_type === selfType && l.source_id === item.id) { otherType = l.target_type; otherId = l.target_id; }
    else if (l.target_type === selfType && l.target_id === item.id) { otherType = l.source_type; otherId = l.source_id; }
    if (!otherId || !otherType) continue;
    const found = byId.get(otherId);
    if (!found || found.item_kind !== kindOf(otherType) || seen.has(found.id)) continue;
    seen.add(found.id);
    out.push({ item: found, relation: l.relation });
  }
  return out;
}

// The SECTIONS entry an item belongs to, for building its /c/[slug]/[section]/[entry] href.
export function sectionForItem(item: Item): { slug: string; label: string } | undefined {
  return SECTIONS.find((s) => matchesSection(item, s));
}

/**
 * The theme layer and the shared stylesheet. The script runs BEFORE first paint so a reader who chose
 * dark never gets a white flash. Dark is the default and the Six Axes forge palette.
 */
export function WikiHead() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){try{
          // Default to the Six Axes dark theme. A reader can still switch, and the choice persists;
          // only the FIRST visit ignores the OS preference, because beige-by-default was the complaint.
          var t = localStorage.getItem('sixaxes-wiki-theme') || 'dark';
          document.documentElement.dataset.wiki = t;
        }catch(e){document.documentElement.dataset.wiki='dark';}})();
      ` }} />
      <style dangerouslySetInnerHTML={{ __html: `
        /* ROLE NAMES, not hue names. Dark is default and the forge palette; light stays a warm reading
           tone rather than flat beige. --w-deep is the page ground, one step under the panel. */
        :root, [data-wiki="dark"] {
          --w-deep: #14110d; --w-bg: #171310; --w-panel: #1f1a15; --w-panel-2: #251f18;
          --w-ink: #ece4d6; --w-ink-2: #cbbfa6; --w-muted: #a99e86;
          --w-accent: #c9a24b; --w-accent-dim: #8a7038; --w-line: #3a332a;
          --w-tag-bg: rgba(201,162,75,0.12); --w-hover: rgba(255,255,255,0.05);
        }
        [data-wiki="light"] {
          --w-deep: #efe7d6; --w-bg: #f5efe2; --w-panel: #fffdf8; --w-panel-2: #fbf6ea;
          --w-ink: #241f18; --w-ink-2: #4a4236; --w-muted: #857a63;
          --w-accent: #97701f; --w-accent-dim: #b08a3e; --w-line: #ddd2ba;
          --w-tag-bg: #ece1c8; --w-hover: rgba(0,0,0,0.045);
        }
        html { background: var(--w-deep); }
        * { box-sizing: border-box; }

        .w-shell { min-height: 100vh; background: var(--w-deep); color: var(--w-ink);
          font-family: 'EB Garamond', 'Iowan Old Style', Georgia, serif; font-size: 18px; line-height: 1.72; }
        .w-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
        .w-serif-d { font-family: 'Cinzel', 'EB Garamond', serif; }

        /* ---- top bar: dropdown nav + brand ---- */
        .w-topbar { position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 14px;
          padding: 10px 20px; background: linear-gradient(180deg,#171310,#141009);
          border-bottom: 1px solid var(--w-line); }
        [data-wiki="light"] .w-topbar { background: linear-gradient(180deg,#fbf6ea,#f3ecdc); }

        .w-dd { position: relative; }
        .w-dd > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 10px;
          padding: 9px 14px; border: 1px solid var(--w-line); border-radius: 9px; background: var(--w-panel-2);
          color: var(--w-ink); font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px;
          letter-spacing: 0.06em; text-transform: uppercase; }
        .w-dd > summary::-webkit-details-marker { display: none; }
        .w-dd > summary:hover { border-color: var(--w-accent-dim); }
        .w-dd .bars { display: inline-flex; flex-direction: column; gap: 3px; }
        .w-dd .bars i { width: 16px; height: 2px; background: var(--w-accent); border-radius: 2px; }
        .w-dd-menu { position: absolute; top: 48px; left: 0; width: 260px; background: var(--w-panel);
          border: 1px solid var(--w-line); border-radius: 12px; padding: 10px; z-index: 50;
          box-shadow: 0 24px 60px rgba(0,0,0,.5); }
        .w-dd-menu .ey { margin: 6px 6px 8px; }
        .w-dd-menu a { display: flex; justify-content: space-between; gap: 10px; padding: 8px 9px;
          border-radius: 8px; text-decoration: none; color: var(--w-ink-2); font-size: 15px; }
        .w-dd-menu a:hover { background: var(--w-hover); color: var(--w-ink); }
        .w-dd-menu a[aria-current="page"] { color: var(--w-accent); background: var(--w-hover); }
        .w-count { color: var(--w-muted); font-variant-numeric: tabular-nums; }

        .w-brand { flex: 1; text-align: center; min-width: 0; }
        .w-brand a { text-decoration: none; color: var(--w-ink); }
        .w-brand .nm { font-family: 'Cinzel','EB Garamond',serif; font-weight: 600; letter-spacing: 0.14em;
          font-size: 14px; text-transform: uppercase; color: var(--w-accent); white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis; display: block; }
        .w-mark { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.2em;
          text-transform: uppercase; color: var(--w-muted); text-decoration: none; white-space: nowrap; }
        .w-mark:hover { color: var(--w-accent); }
        @media (max-width: 720px) { .w-mark { display: none; } }

        /* ---- content column ---- */
        .w-main { max-width: 820px; margin: 0 auto; width: 100%; padding: 40px 24px 90px; position: relative; }
        .ey { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: 0.2em;
          text-transform: uppercase; color: var(--w-accent-dim); }

        /* section headings on category/index pages get the dagger + hairline */
        .w-main h2 { font-family: 'Cinzel','EB Garamond',serif; }
        .w-sec-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
          border-bottom: 1px solid var(--w-line); padding-bottom: 8px; }
        .w-sec-head h2 { font-size: 24px; margin: 0; font-weight: 600; display: flex; align-items: center; gap: 11px; }
        .w-sec-head h2::before { content: "\\2726"; color: var(--w-accent); font-size: 14px; }
        .w-all { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11.5px; color: var(--w-accent);
          text-decoration: none; }

        /* rows and cards */
        .w-item { display: block; padding: 13px 0; border-bottom: 1px solid var(--w-line);
          text-decoration: none; color: inherit; }
        .w-item:hover .w-item-t { color: var(--w-accent); }
        .w-item-t { font-size: 18px; font-weight: 600; margin-bottom: 3px; transition: color .12s; }
        .w-row { display: flex; gap: 14px; align-items: flex-start; }
        .w-thumb { width: 60px; height: 60px; flex-shrink: 0; border-radius: 6px; object-fit: cover;
          background: var(--w-panel); border: 1px solid var(--w-line); }
        .w-hero { width: 100%; max-height: 360px; object-fit: cover; border-radius: 8px;
          margin-bottom: 20px; display: block; border: 1px solid var(--w-line); }

        .w-tag { display: inline-block; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px;
          color: var(--w-accent); background: var(--w-tag-bg); border: 1px solid var(--w-line);
          border-radius: 999px; padding: 3px 9px; margin-right: 6px; }

        .w-search { width: 100%; padding: 12px 15px; font-size: 16px; font-family: inherit;
          color: var(--w-ink); background: var(--w-panel); border: 1px solid var(--w-line); border-radius: 9px; outline: none; }
        .w-search:focus { border-color: var(--w-accent-dim); box-shadow: 0 0 0 3px var(--w-tag-bg); }
        .w-search::placeholder { color: var(--w-muted); font-style: italic; }

        .w-theme { position: absolute; top: 12px; right: 16px; z-index: 60;
          font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--w-muted); background: transparent;
          border: 1px solid var(--w-line); border-radius: 8px; padding: 6px 11px; cursor: pointer; }
        .w-theme:hover { color: var(--w-ink); border-color: var(--w-accent-dim); }

        /* ---- entry page: wide variant + right rail ---- */
        .w-main-wide { max-width: 1080px; margin: 0 auto; width: 100%; padding: 40px 24px 90px; position: relative; }
        .w-entry { display: grid; grid-template-columns: 240px minmax(0,1fr); gap: 40px; align-items: start; }
        @media (max-width: 900px) { .w-entry { grid-template-columns: 1fr; } .w-rail-r, .w-rail-l { position: static; } }
        .w-rail-r { position: sticky; top: 78px; }
        .w-rail-l { position: sticky; top: 78px; }
        .w-h2 { font-family: 'Cinzel','EB Garamond',serif; font-size: 24px; font-weight: 600; margin: 8px 0 12px;
          scroll-margin-top: 80px; display: flex; align-items: center; gap: 10px; }
        .w-h2::before { content: "\\2726"; color: var(--w-accent); font-size: 13px; }
        .w-toc a { display: block; padding: 5px 8px; margin-left: -2px; border-left: 2px solid transparent;
          color: var(--w-muted); font-size: 14px; text-decoration: none; border-radius: 6px; line-height: 1.4; }
        .w-toc a:hover { color: var(--w-ink); background: var(--w-hover); border-left-color: var(--w-accent-dim); }
        .w-card { background: var(--w-panel); border: 1px solid var(--w-line); border-radius: 12px; padding: 15px 15px 12px; }
        .w-title { font-family: 'Cinzel','EB Garamond',serif; font-size: 38px; line-height: 1.12; margin: 12px 0 14px; font-weight: 600; }
        .w-back { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: 0.14em;
          text-transform: uppercase; color: var(--w-muted); text-decoration: none; }
        .w-back:hover { color: var(--w-accent); }
        .w-body { font-size: 17.5px; line-height: 1.78; color: var(--w-ink); white-space: pre-wrap; }
        .w-rel { display: flex; align-items: center; gap: 11px; padding: 8px; border-radius: 8px; text-decoration: none; color: var(--w-ink); }
        .w-rel:hover { background: var(--w-hover); }
        .w-rel .k { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9px; letter-spacing: 0.1em;
          text-transform: uppercase; color: #15110b; background: var(--w-accent-dim); border-radius: 4px; padding: 2px 5px; flex: none; }
        .w-rel .t { font-size: 15px; line-height: 1.25; }
        .w-rel .t small { display: block; color: var(--w-muted); font-size: 12px; font-style: italic; }

        /* ---- index banner + crest ---- */
        .w-banner { position: relative; border-radius: 10px; margin-bottom: 26px; overflow: hidden;
          border: 1px solid var(--w-line); }
        .w-banner.cover { min-height: 250px; display: flex; align-items: flex-end; background-size: cover; background-position: center; }
        .w-banner-in { padding: 26px 24px 22px; position: relative; z-index: 2; }
        .w-banner h1 { font-family: 'Cinzel','EB Garamond',serif; font-size: 40px; line-height: 1.1;
          margin: 0 0 10px; font-weight: 600; }
        .w-crest { position: absolute; top: 22px; left: 50%; transform: translateX(-50%); z-index: 3;
          width: 84px; height: 84px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          border: 2px solid var(--w-accent); box-shadow: 0 0 0 5px var(--w-tag-bg), inset 0 0 22px rgba(0,0,0,.45);
          background: radial-gradient(circle at 50% 35%, var(--w-panel-2), var(--w-deep));
          font-family: 'Cinzel','EB Garamond',serif; font-size: 34px; color: var(--w-accent); }
        .w-sec { margin-bottom: 34px; }
        .w-sec-blurb { font-size: 14px; color: var(--w-muted); margin: 6px 0 12px; }
        .w-empty { color: var(--w-muted); font-size: 15px; }
      ` }} />
    </>
  );
}

/**
 * The top bar. Six Axes mark, campaign name centered, and a native <details> dropdown for the sections.
 * No client JS: the dropdown is a real element, its links live in the HTML, so a crawler indexes them.
 */
export function TopNav({ slug, campaign, counts, current }: {
  slug: string; campaign: Campaign; counts: Record<string, number>; current?: string;
}) {
  return (
    <div className="w-topbar">
      <details className="w-dd">
        <summary aria-label="Browse the codex">
          <span className="bars"><i /><i /><i /></span> Codex
        </summary>
        <nav className="w-dd-menu" aria-label="Sections">
          <div className="ey">Sections</div>
          {SECTIONS.map((s) => (
            <a key={s.slug} href={`/c/${slug}/${s.slug}`} aria-current={current === s.slug ? "page" : undefined}>
              <span>{s.label}</span><span className="w-count">{counts[s.slug] ?? 0}</span>
            </a>
          ))}
        </nav>
      </details>
      <div className="w-brand">
        <a href={`/c/${slug}`}><span className="nm">{campaign.name}</span></a>
      </div>
      <a className="w-mark" href="https://www.six-axes.com" target="_blank" rel="noreferrer">Six Axes</a>
    </div>
  );
}

/**
 * The outer frame: background, theme + toggle, and a Suspense boundary for everything awaited.
 * The theme deliberately stays outside the boundary so the no-flash script's variables are present
 * before the fallback paints.
 */
export function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-shell">
      <WikiHead />
      <ThemeToggle />
      <React.Suspense fallback={<FrameFallback />}>{children}</React.Suspense>
    </div>
  );
}

// Deliberately almost empty: a fake skeleton would guess the entry count and reflow when the real
// rows arrive.
function FrameFallback() {
  return <main className="w-main" />;
}

export function Shell({ slug, campaign, counts, current, wide, children }: {
  slug: string;
  campaign: Campaign;
  counts: Record<string, number>;
  current?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <TopNav slug={slug} campaign={campaign} counts={counts} current={current} />
      <main className={wide ? "w-main-wide" : "w-main"}>{children}</main>
    </>
  );
}

// Keyed by section SLUG: three sections share type='lore', so a per-type count could not tell Factions
// from Lore. Each section counts the items that matchesSection it.
export const countsOf = (items: Item[]): Record<string, number> =>
  SECTIONS.reduce((acc, sec) => {
    acc[sec.slug] = items.filter((i) => matchesSection(i, sec)).length;
    return acc;
  }, {} as Record<string, number>);
