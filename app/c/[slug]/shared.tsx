// Everything the three wiki routes share: the loader, the theme, and the page chrome.
//
// WHY EXTRACT IT
//   The index, a category page and an entry page all need the same campaign header, the same left
//   rail, the same theme variables and the same data. Three copies would drift - and the one that
//   drifts first is always the theme, because it is the part nobody re-reads.

import React from "react";
import { createClient } from "@supabase/supabase-js";
import ThemeToggle from "./theme-toggle";

export type Item = {
  item_kind: "entry" | "npc";
  item_type: string;
  id: string;
  title: string | null;
  body: string | null;
  tags: string[] | null;
  slug: string | null;
  image_url: string | null;
};

export type Campaign = {
  name: string;
  blurb: string | null;
  items: number;
  codex_cover_url?: string | null;
};

// FIVE SECTIONS, tag-aware. Lore, factions and items are all stored as type='lore', split only by a
// reserved tag, exactly like the GM codex tabs. So a section cannot match on type alone: a faction
// would fall into Factions, Items and Lore at once. matchesSection() below checks the tag too, and
// the Lore section (no tag) takes only lore carrying NEITHER reserved tag, so every entry lands in
// exactly one place. Notes and PCs stay off the wiki on purpose: notes default to GM-secret, and
// PCs are not returned by public_codex at all.
export const SECTIONS: { type: string; slug: string; label: string; blurb: string; tag?: string }[] = [
  { type: "location", slug: "places", label: "Places", blurb: "Where the story has been." },
  { type: "npc", slug: "cast", label: "The cast", blurb: "Who the party has met." },
  { type: "lore", slug: "factions", label: "Factions", blurb: "The powers and groups in play.", tag: "faction" },
  { type: "lore", slug: "items", label: "Items", blurb: "The objects that matter.", tag: "item" },
  { type: "lore", slug: "lore", label: "Lore", blurb: "History, rumours, and the world itself." },
];

// The tags that promote a lore entry into its own section. A section with a tag matches only entries
// carrying it; a section without one matches entries carrying none of these.
export const RESERVED_TAGS = new Set(SECTIONS.map((s) => s.tag).filter((t): t is string => !!t));

export const sectionBySlug = (s: string) => SECTIONS.find((x) => x.slug === s);
export const sectionByType = (t: string) => SECTIONS.find((x) => x.type === t);

// The one place section membership is decided. Type first, then the tag: a tagged section wants that
// exact tag, an untagged one wants none of the reserved tags. Everything that used to compare
// item_type === sec.type must call this instead, or lore, factions and items collapse into one list.
export function matchesSection(item: { item_type: string; tags: string[] | null }, sec: { type: string; tag?: string }): boolean {
  if (item.item_type !== sec.type) return false;
  const tags = item.tags || [];
  if (sec.tag) return tags.includes(sec.tag);
  return !tags.some((t) => RESERVED_TAGS.has(t));
}

// A PLAIN anon client, not @/lib/supabase/server: these pages are read by strangers with no session
// and must never carry one.
function anon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function load(slug: string) {
  const supabase = anon();
  const [{ data: head }, { data: items }, { data: listed }, { data: snapshot }] = await Promise.all([
    supabase.rpc("public_campaign", { p_slug: slug }),
    supabase.rpc("public_codex", { p_slug: slug }),
    supabase.rpc("public_campaign_listing", { p_slug: slug }),
    supabase.rpc("public_world_snapshot", { p_slug: slug }),
  ]);
  const campaign = (Array.isArray(head) ? head[0] : head) as Campaign | null;
  const all = ((items as Item[]) ?? []).filter((i) => SECTIONS.some((s) => s.type === i.item_type));
  return { campaign: campaign ?? null, items: all, listed: listed === true, snapshotUrl: typeof snapshot === "string" ? snapshot : null };
}

/**
 * The theme layer and the shared stylesheet.
 *
 * The script runs BEFORE first paint. The page is server-rendered and cached, so without it every
 * reader who chose dark gets a white flash on every load - worse than not offering the choice.
 */
export function WikiHead() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){try{
          var t = localStorage.getItem('sixaxes-wiki-theme');
          if (!t) t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
          document.documentElement.dataset.wiki = t;
        }catch(e){document.documentElement.dataset.wiki='dark';}})();
      ` }} />
      <style dangerouslySetInnerHTML={{ __html: `
        /* ROLE NAMES, not hue names: --w-ink means body text, so the dark palette can invert it
           without every variable name becoming a lie. Dark is the default and is where an unset or
           failed script lands. */
        :root, [data-wiki="dark"] {
          --w-bg: #171310; --w-panel: #221c17; --w-ink: #e8dcc4; --w-ink-2: #cbbfa6;
          --w-muted: #a99e86; --w-accent: #c8a24b; --w-line: #3a332a;
          --w-tag-bg: rgba(200,162,75,0.14); --w-hover: rgba(255,255,255,0.06);
          --w-rail-edge: rgba(255,255,255,0.10);
        }
        [data-wiki="light"] {
          --w-bg: #f6f2e9; --w-panel: #fffdf8; --w-ink: #2a2620; --w-ink-2: #4a443a;
          --w-muted: #8a8069; --w-accent: #8a6a2f; --w-line: #ddd4c2;
          --w-tag-bg: #ece4d2; --w-hover: rgba(0,0,0,0.05);
          --w-rail-edge: rgba(0,0,0,0.08);
        }
        html { background: var(--w-bg); }

        .w-shell { min-height: 100vh; background: var(--w-bg); color: var(--w-ink);
          font-family: 'Iowan Old Style', Georgia, 'Times New Roman', serif; }
        .w-cols { display: grid; grid-template-columns: minmax(0,1fr); }
        .w-main { padding: 34px 20px 64px; max-width: 760px; margin: 0 auto; width: 100%; }

        /* The rail is CHROME on every page, not a table of contents on one. Below 900px it becomes
           a strip across the top, because a side column on a phone eats half the width. */
        .w-rail { background: var(--w-panel); border-bottom: 1px solid var(--w-rail-edge);
          padding: 16px 18px; }
        .w-brand { display: flex; align-items: baseline; gap: 8px; margin-bottom: 14px;
          font-family: ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.18em;
          text-transform: uppercase; color: var(--w-muted); text-decoration: none; }
        .w-brand:hover { color: var(--w-accent); }
        .w-nav { display: flex; flex-wrap: wrap; gap: 4px; }
        .w-nav a { display: flex; justify-content: space-between; gap: 10px; min-width: 132px;
          padding: 7px 10px; border-radius: 4px; text-decoration: none;
          color: var(--w-ink-2); font-size: 14px; }
        .w-nav a:hover { background: var(--w-hover); }
        .w-nav a[aria-current="page"] { background: var(--w-hover); color: var(--w-accent); }
        .w-count { color: var(--w-muted); font-variant-numeric: tabular-nums; }

        @media (min-width: 900px) {
          .w-cols { grid-template-columns: 236px minmax(0,1fr); }
          .w-rail { position: sticky; top: 0; align-self: start; height: 100vh;
            border-bottom: none; border-right: 1px solid var(--w-rail-edge); padding: 22px 18px; }
          .w-main { padding: 40px 30px 72px; }
        }

        .w-theme { position: absolute; top: 14px; right: 14px;
          font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--w-muted); background: transparent;
          border: 1px solid var(--w-line); border-radius: 3px; padding: 5px 10px; cursor: pointer; }
        .w-theme:hover { color: var(--w-ink); }

        /* A thumbnail is a fixed square so a list of mixed portraits and landscapes still reads as
           a column. object-fit crops rather than distorts - a squashed face is worse than a
           cropped one. */
        .w-thumb { width: 56px; height: 56px; flex-shrink: 0; border-radius: 4px;
          object-fit: cover; background: var(--w-panel); }
        .w-row { display: flex; gap: 14px; align-items: flex-start; }
        .w-hero { width: 100%; max-height: 340px; object-fit: cover;
          border-radius: 6px; margin-bottom: 18px; display: block; }
      ` }} />
    </>
  );
}

/**
 * The left rail. Six Axes mark, campaign name, one link per section.
 *
 * THE MARK IS DISCREET ON PURPOSE. This is the GM's page made with Six Axes, not a Six Axes page
 * with a GM's content on it - a GM who feels the product is advertising in their world shares it
 * less. Anyone curious can still click it.
 */
export function Rail({ slug, campaign, counts, current }: {
  slug: string;
  campaign: Campaign;
  counts: Record<string, number>;
  current?: string;
}) {
  return (
    <nav className="w-rail" aria-label="Sections">
      <a className="w-brand" href="https://www.six-axes.com" target="_blank" rel="noreferrer">
        Six Axes
      </a>
      <a href={`/c/${slug}`} style={{
        display: "block", fontSize: 20, lineHeight: 1.2, marginBottom: 16,
        color: "var(--w-ink)", textDecoration: "none", fontWeight: 600,
      }}>
        {campaign.name}
      </a>
      <div className="w-nav">
        {SECTIONS.map((s) => (
          <a key={s.slug} href={`/c/${slug}/${s.slug}`}
            aria-current={current === s.slug ? "page" : undefined}>
            <span>{s.label}</span>
            <span className="w-count">{counts[s.slug] ?? 0}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}

/**
 * The outer frame: background, theme and toggle, with a Suspense boundary for everything that has
 * to be awaited.
 *
 * WHY IT IS SPLIT FROM Shell
 *   This project runs with cacheComponents, which rejects any uncached await outside a Suspense
 *   boundary - including `await params`. So nothing above the boundary may await, which means the
 *   frame cannot know the campaign name and the rail has to live inside.
 *
 *   The THEME deliberately stays outside it. If the variables loaded with the content, the fallback
 *   would paint on an unstyled page and every reader would get a white flash before their chosen
 *   theme arrived - which is the exact thing the no-flash script exists to prevent.
 */
export function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-shell" style={{ position: "relative" }}>
      <WikiHead />
      <ThemeToggle />
      <React.Suspense fallback={<FrameFallback />}>{children}</React.Suspense>
    </div>
  );
}

// Deliberately almost empty. A skeleton of fake rows would be guessing at how many entries a
// campaign has, and a wrong guess reflows the moment the real ones arrive.
function FrameFallback() {
  return (
    <div className="w-cols">
      <nav className="w-rail" aria-hidden />
      <main className="w-main" />
    </div>
  );
}

export function Shell({ slug, campaign, counts, current, children }: {
  slug: string;
  campaign: Campaign;
  counts: Record<string, number>;
  current?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-cols">
      <Rail slug={slug} campaign={campaign} counts={counts} current={current} />
      <main className="w-main">{children}</main>
    </div>
  );
}

// Keyed by section SLUG, not entry type: three sections share type='lore', so a per-type count
// could not tell Factions from Lore. Each section counts the items that matchesSection it.
export const countsOf = (items: Item[]): Record<string, number> =>
  SECTIONS.reduce((acc, sec) => {
    acc[sec.slug] = items.filter((i) => matchesSection(i, sec)).length;
    return acc;
  }, {} as Record<string, number>);
