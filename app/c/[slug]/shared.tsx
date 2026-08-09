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
};

export type Campaign = {
  name: string;
  blurb: string | null;
  items: number;
  codex_cover_url?: string | null;
};

// PHASE 1 IS LOCATIONS AND NPCS ONLY, and that is a measured decision rather than a simplification:
// of 122 lore entries, 102 have a whole sentence as their title because they were minted from
// session beats, and none has ever been published. A thing with a NAME is a page; a sentence is
// not. Lore joins this list when the generator that creates it attaches beats to entries instead of
// turning each one into its own entry.
export const SECTIONS: { type: string; slug: string; label: string; blurb: string }[] = [
  { type: "location", slug: "places", label: "Places", blurb: "Where the story has been." },
  { type: "npc", slug: "cast", label: "The cast", blurb: "Who the party has met." },
];

export const sectionBySlug = (s: string) => SECTIONS.find((x) => x.slug === s);
export const sectionByType = (t: string) => SECTIONS.find((x) => x.type === t);

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
  const [{ data: head }, { data: items }, { data: listed }] = await Promise.all([
    supabase.rpc("public_campaign", { p_slug: slug }),
    supabase.rpc("public_codex", { p_slug: slug }),
    supabase.rpc("public_campaign_listing", { p_slug: slug }),
  ]);
  const campaign = (Array.isArray(head) ? head[0] : head) as Campaign | null;
  const all = ((items as Item[]) ?? []).filter((i) => SECTIONS.some((s) => s.type === i.item_type));
  return { campaign: campaign ?? null, items: all, listed: listed === true };
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
            <span className="w-count">{counts[s.type] ?? 0}</span>
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

export const countsOf = (items: Item[]): Record<string, number> =>
  items.reduce((acc, i) => {
    acc[i.item_type] = (acc[i.item_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
