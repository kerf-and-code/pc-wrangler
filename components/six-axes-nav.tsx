"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { SAX } from "@/lib/theme";
import LogoutButton from "@/components/logout-button";
import { getModule } from "@/lib/systems/registry";
import { getActiveCampaign, onActiveCampaignChange } from "@/lib/active-campaign";
import CommandPalette, { OPEN_PALETTE, type PalettePage } from "@/components/command-palette";
import { createClient } from "@/lib/supabase/client";

/* Six Axes navigation.

   GM side, regrouped November 2026 in the order a GM's week runs (Home, Prep, Session, After, World,
   Insight), 4 to 6 pages a group. "Play" had grown to 14 pages that mixed before, during and after
   the session, and only the current group was ever visible, so reaching a page in another group
   meant loading that group's first page just to see its list.

   Wide screens (>=1024px): a left sidebar. Every group is listed; a group heading is a button that
   folds the group open or shut (remembered per browser) and never navigates. The group holding the
   current page is always open. The active campaign is named at the top, so it is never a guess which
   campaign a page is acting on. Help sits in the list, not inside the account menu.

   Narrow screens (tablet and phone): a compact top bar, the current group's pages as one scrolling
   row, and labeled bottom tabs, one per group (GM: Prep, Session, After, World, More). A tab opens a
   sheet listing that group's pages, so any page is two taps away and every control has a word.

   The player portal (opened through a ?share link, or a /me dossier page) uses the same shell with
   its own three groups. */

type Leaf = { href: string; label: string; needs?: "character" | "adversary" };
type Group = { label: string; children: Leaf[] };

const GM_GROUPS: Group[] = [
  { label: "Home", children: [
    { href: "/gm/start", label: "Start here" },
    { href: "/gm", label: "Workspace" },
    { href: "/gm/roster", label: "Roster" },
    // The play-style questionnaire, taken by the GM. It used to sit alone as "Profile".
    { href: "/play", label: "Your play style" },
  ] },
  { label: "Prep", children: [
    { href: "/gm/prep", label: "Prep" },
    { href: "/gm/encounters", label: "Encounters", needs: "adversary" },
    { href: "/gm/statblock", label: "Monster Maker", needs: "adversary" },
    { href: "/gm/timeline", label: "Timeline" },
  ] },
  { label: "Session", children: [
    { href: "/gm/tonight", label: "Tonight" },
    { href: "/gm/combat", label: "Combat", needs: "adversary" },
    { href: "/gm/roll", label: "Roll" },
    { href: "/gm/compendium", label: "Compendium" },
    { href: "/gm/screen", label: "DM Screen" },
    { href: "/gm/record", label: "Record in person" },
  ] },
  { label: "After", children: [
    { href: "/gm/review", label: "Review" },
    { href: "/gm/speakers", label: "Speakers" },
    { href: "/gm/transcripts", label: "Transcripts" },
    { href: "/gm/sessions", label: "Sessions" },
    // Was "Check-in", the same word as the player's post-session survey. It is where the GM reads
    // those check-ins (and party chat); attendance itself now lives on Tonight.
    { href: "/gm/table", label: "Player check-ins" },
    { href: "/gm/capture", label: "Capture" },
  ] },
  { label: "World", children: [
    { href: "/gm/codex", label: "Codex" },
    { href: "/gm/map", label: "Image Maps" },
    { href: "/gm/world", label: "World Builder" },
    { href: "/gm/import", label: "Import" },
    { href: "/gm/publish", label: "Publish" },
    { href: "/gm/search", label: "Search" },
  ] },
  { label: "Insight", children: [
    { href: "/gm/dispositions", label: "Dispositions" },
    { href: "/gm/mechanics", label: "Mechanics" },
    { href: "/gm/dashboard", label: "Dashboard" },
    { href: "/gm/reliability", label: "Reliability" },
  ] },
];

// Phone and tablet tabs: the four groups used most, plus More (Home, Insight, Help, Sign out).
const GM_TABS = ["Prep", "Session", "After", "World"];

// The player navigation, grouped.
//
// TWO KINDS OF LINK, AND THE DISTINCTION IS LOAD-BEARING:
//   SHARE-SCOPED  (?share=<code>) belong to ONE campaign. Meaningless without a share code, so
//                 they are hidden when there is not one.
//   ACCOUNT-SCOPED (/me/*) span EVERY campaign you play in. They must never carry a ?share=,
//                 because pinning a cross-campaign page to one campaign is simply wrong.
type PGroup = Group & { scoped: boolean };

const PLAYER_TABLE: PGroup = {
  label: "This table", scoped: true,
  children: [
    // The Player Disposition Inventory. Labeled "Inventory" until November 2026, which in a D&D
    // app reads as the character's gear.
    { href: "/play", label: "Play style" },
    { href: "/me", label: "Journal" },
    { href: "/recaps", label: "Recaps" },
    { href: "/lore", label: "Lore" },
    { href: "/map", label: "Map" },
    { href: "/world", label: "World Map" },
    { href: "/chat", label: "Chat" },
  ],
};
const PLAYER_SESSION: PGroup = {
  label: "Session", scoped: true,
  children: [
    { href: "/schedule", label: "Schedule" },
    { href: "/initiative", label: "Initiative" },
    { href: "/record", label: "Record" },
    { href: "/vibe", label: "Check-in" },
  ],
};
const PLAYER_YOU: PGroup = {
  label: "You", scoped: false,
  children: [
    { href: "/me/campaigns", label: "Campaigns" },
    { href: "/me/characters", label: "Characters" },
    { href: "/me/library", label: "Library" },
    { href: "/me/threads", label: "Threads" },
    { href: "/me/codex", label: "Codex" },
    { href: "/me/notes", label: "Notes" },
    { href: "/me/profile", label: "Your profile" },
    { href: "/me/settings", label: "Settings" },
  ],
};

// Routes that only exist for players. Known from the path alone, so the server renders the right
// menu: deciding after mount meant players first saw the GM menu, which then swapped and pushed the
// page down (measured layout shift 0.28 on a phone). /play is the one shared route (the GM's "Your
// play style" too), so it is a player page only when it carries a ?share=.
const PLAYER_ROUTES = ["/recaps", "/lore", "/map", "/world", "/chat", "/schedule", "/initiative", "/record", "/vibe"];
const onRoute = (pathname: string, r: string) => pathname === r || pathname.startsWith(r + "/");

/** The leaf for a path: an exact match, else the longest leaf the path sits under (so
    /gm/import/review still marks Import). "/gm" and "/me" only ever match exactly, since every
    page sits under them. */
function findLeaf(groups: Group[], pathname: string): { g: Group; l: Leaf } | null {
  let best: { g: Group; l: Leaf } | null = null;
  for (const g of groups) for (const l of g.children) {
    const exact = pathname === l.href;
    const under = l.href !== "/gm" && l.href !== "/me" && pathname.startsWith(l.href + "/");
    if (exact) return { g, l };
    if (under && (!best || l.href.length > best.l.href.length)) best = { g, l };
  }
  return best;
}

const NAV_CSS = `
.sax-navroot{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;}
.sax-navroot a:focus-visible,.sax-navroot button:focus-visible{outline:2px solid ${SAX.brass};outline-offset:2px;}
.sax-navroot .sax-brand{display:flex;align-items:center;gap:10px;text-decoration:none;}
.sax-navroot .sax-mark{width:30px;height:30px;opacity:.92;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));}
.sax-navroot .sax-word{font-family:${SAX.serif};font-size:21px;font-weight:600;color:${SAX.text};letter-spacing:-0.01em;line-height:1;}
.sax-navroot .sax-tag{font-family:${SAX.mono};font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:${SAX.muted};display:block;margin-top:3px;}
/* Menu buttons opt out of PageShell's carved-button shadow and press. */
.sax-navroot button.sax-plain:not(:disabled){box-shadow:none;transform:none;filter:none;}
.sax-navroot .sax-camp{border:1px solid ${SAX.line};border-radius:9px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;}
.sax-navroot .sax-camp-k{font-family:${SAX.mono};font-size:9.5px;letter-spacing:0.16em;text-transform:uppercase;color:${SAX.muted};}
.sax-navroot .sax-camp-n{font-size:14px;color:${SAX.text};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sax-navroot a.sax-camp-sw{font-size:12px;color:${SAX.muted};text-decoration:underline;text-underline-offset:2px;display:inline-flex;align-items:center;min-height:24px;}
.sax-navroot a.sax-camp-sw:hover{color:${SAX.text};}
.sax-navroot .sax-find{display:flex;align-items:center;justify-content:space-between;gap:10px;background:transparent;cursor:pointer;
  border:1px solid ${SAX.line};border-radius:9px;padding:7px 10px;color:${SAX.muted};font-size:13px;font-family:inherit;}
.sax-navroot .sax-find:hover{color:${SAX.text};border-color:${SAX.brassDim};}
.sax-navroot .sax-find kbd{font-family:${SAX.mono};font-size:10.5px;border:1px solid ${SAX.line};border-radius:5px;padding:1px 6px;color:${SAX.muted};}

/* sidebar (wide only) */
.sax-navroot .sax-side{display:none;}
.sax-navroot .sax-groups{display:flex;flex-direction:column;gap:2px;}
.sax-navroot .sax-ghead{display:flex;align-items:center;justify-content:space-between;width:100%;background:transparent;border:none;cursor:pointer;
  font-family:${SAX.mono};font-size:10.5px;letter-spacing:0.16em;text-transform:uppercase;color:${SAX.muted};padding:8px 8px 4px;border-radius:6px;text-align:left;}
.sax-navroot .sax-ghead:hover{color:${SAX.text};}
.sax-navroot .sax-ghead.on{color:${SAX.brass};}
.sax-navroot .sax-chev{font-size:10px;transition:transform .15s;}
.sax-navroot .sax-ghead[aria-expanded="false"] .sax-chev{transform:rotate(-90deg);}
.sax-navroot .sax-glist{display:flex;flex-direction:column;gap:1px;margin:0 0 6px;}
.sax-navroot a.sax-item{font-size:13.5px;color:${SAX.muted};text-decoration:none;padding:4px 10px 4px 12px;border-radius:7px;border-left:2px solid transparent;}
.sax-navroot a.sax-item:hover{color:${SAX.text};background:rgba(255,255,255,0.05);}
/* Current page: weight and a left bar as well as colour, so it never relies on colour alone. */
.sax-navroot a.sax-item[aria-current="page"]{color:${SAX.text};font-weight:700;border-left-color:${SAX.brass};background:rgba(200,162,75,0.10);}
.sax-navroot .sax-foot{display:flex;flex-direction:column;gap:2px;margin-top:auto;padding-top:10px;border-top:1px solid ${SAX.line};}
.sax-navroot .sax-foot .sax-out{padding:4px 12px;}

/* narrow: top bar, current group's row, bottom tabs */
.sax-navroot .sax-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;}
.sax-navroot .sax-top-r{display:flex;align-items:center;gap:8px;min-width:0;}
.sax-navroot .sax-top-camp{font-size:12.5px;color:${SAX.muted};max-width:38vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none;}
.sax-navroot .sax-row{display:flex;gap:6px;overflow-x:auto;white-space:nowrap;padding:2px 0 8px;margin-bottom:18px;border-bottom:1px solid ${SAX.line};scrollbar-width:thin;}
.sax-navroot .sax-row-k{font-family:${SAX.mono};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${SAX.muted};align-self:stretch;display:flex;align-items:center;margin-right:2px;flex:none;
  position:sticky;left:0;z-index:1;padding-right:8px;background:linear-gradient(90deg, rgba(10,6,14,0.96) 80%, rgba(10,6,14,0));}
.sax-navroot a.sax-chip{flex:none;font-size:13.5px;color:${SAX.muted};text-decoration:none;padding:9px 12px;border-radius:999px;border:1px solid ${SAX.line};min-height:44px;box-sizing:border-box;display:inline-flex;align-items:center;}
.sax-navroot a.sax-chip[aria-current="page"]{color:${SAX.inkDeep};background:${SAX.brass};border-color:${SAX.brass};font-weight:700;}
.sax-navroot .sax-tabs{position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;background:rgba(10,6,14,0.97);border-top:1px solid ${SAX.line};
  padding-bottom:env(safe-area-inset-bottom);}
.sax-navroot .sax-tab{flex:1 1 0;min-height:56px;background:transparent;border:none;border-top:3px solid transparent;cursor:pointer;
  color:${SAX.muted};font-size:12.5px;font-family:inherit;letter-spacing:0.02em;text-decoration:none;display:flex;align-items:center;justify-content:center;}
.sax-navroot a.sax-tab:hover{color:${SAX.text};}
.sax-navroot a.sax-tab.on{color:${SAX.text};font-weight:700;border-top-color:${SAX.brass};}
.sax-navroot .sax-sheet-bg{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;}
.sax-navroot .sax-sheet{width:100%;max-height:75vh;overflow-y:auto;background:${SAX.inkDeep};border-top:1px solid ${SAX.line};border-radius:14px 14px 0 0;
  padding:14px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -14px 30px rgba(0,0,0,0.55);}
.sax-navroot .sax-sheet-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.sax-navroot .sax-sheet-t{font-family:${SAX.serif};font-size:20px;color:${SAX.text};}
.sax-navroot .sax-sheet-k{font-family:${SAX.mono};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${SAX.muted};margin:12px 0 4px;}
.sax-navroot a.sax-sheet-a{display:flex;align-items:center;min-height:48px;font-size:16px;color:${SAX.text};text-decoration:none;padding:0 10px;border-radius:8px;border-left:3px solid transparent;}
.sax-navroot a.sax-sheet-a[aria-current="page"]{border-left-color:${SAX.brass};font-weight:700;background:rgba(200,162,75,0.10);}
.sax-navroot .sax-sheet-out{margin-top:14px;padding:10px;border-top:1px solid ${SAX.line};}
.sax-navroot .sax-x{background:transparent;border:1px solid ${SAX.line};color:${SAX.muted};border-radius:8px;min-height:44px;padding:0 12px;cursor:pointer;font-family:inherit;font-size:13px;}

@media (max-width:1023px){
  body{padding-bottom:calc(64px + env(safe-area-inset-bottom));}
  .sax-navroot .sax-narrow .sax-find,.sax-navroot .sax-narrow .sax-brand,.sax-navroot .sax-top-camp{min-height:44px;box-sizing:border-box;display:inline-flex;align-items:center;}
}
@media (min-width:1024px){
  .sax-navroot .sax-narrow{display:none;}
  .sax-navroot .sax-side{display:flex;flex-direction:column;gap:12px;position:fixed;left:0;top:0;bottom:0;width:220px;
    padding:20px 12px 14px;overflow-y:auto;background:rgba(6,3,10,0.82);border-right:1px solid ${SAX.line};z-index:10;}
}
`;

// Persist the last share code we saw, so the dossier can still link back to the table.
// Session-scoped on purpose (sessionStorage, not localStorage): a player who closes the tab and
// comes back through a DIFFERENT campaign's link should not be silently routed into the old one.
function rememberShare(code: string | null): string | null {
  if (typeof window === "undefined") return null;
  try {
    if (code) {
      window.sessionStorage.setItem("sixaxes.share", code);
      return code;
    }
    return window.sessionStorage.getItem("sixaxes.share");
  } catch {
    return null;
  }
}

const FOLD_KEY = "sax_nav_folded";
function readFolded(): string[] {
  try { const v = JSON.parse(window.localStorage.getItem(FOLD_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** A bottom sheet listing pages. role=dialog, Escape and the backdrop close it, focus moves in on
    open and back to the tab that opened it on close. */
function Sheet({ title, sections, current, onClose, extra }: {
  title: string;
  sections: { label?: string; links: { href: string; label: string }[] }[];
  current: string | null;
  onClose: () => void;
  extra?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [onClose]);
  return (
    <div className="sax-sheet-bg" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sax-sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sax-sheet-h">
          <span className="sax-sheet-t">{title}</span>
          <button type="button" className="sax-x sax-plain" onClick={onClose}>Close</button>
        </div>
        {sections.map((s, i) => (
          <div key={s.label ?? i}>
            {s.label && <div className="sax-sheet-k">{s.label}</div>}
            {s.links.map((l) => (
              <a key={l.href + l.label} className="sax-sheet-a" href={l.href} aria-current={current === l.href.split("?")[0] ? "page" : undefined}>{l.label}</a>
            ))}
          </div>
        ))}
        {extra}
      </div>
    </div>
  );
}

export default function SixAxesNav() {
  const pathname = usePathname() || "";
  // The remembered share code is read from sessionStorage after mount, never during render, so the
  // server HTML and the first client render agree.
  const [remembered, setRemembered] = useState<string | null>(null);
  const [activeSystem, setActiveSystem] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState<string | null>(null);
  // What the campaign box may say when no page has named a campaign yet. "checking" until we know
  // whether the GM has any campaigns; "loading" while a page may still be about to name one; "none"
  // only when the GM truly has none; "unchosen" if nothing named one after a few seconds. It used to
  // say "None picked yet, pick one in the Workspace" during every first load.
  const [campState, setCampState] = useState<"checking" | "loading" | "none" | "unchosen">("checking");
  const [share, setShare] = useState<{ on: boolean; qs: string; code: string | null }>({ on: false, qs: "", code: null });
  const [folded, setFolded] = useState<string[]>([]);
  const [sheet, setSheet] = useState<string | null>(null);
  // Six open groups are taller than a laptop screen, so the sidebar scrolls; bring the current page
  // into view on load or a World or Insight page opens with its highlight below the fold.
  const sideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!pathname) return;
    sideRef.current?.querySelector<HTMLElement>('a[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
    // Same on phone and tablet for the one-line row of the group's pages (Chat is the seventh chip).
    document.querySelector<HTMLElement>('.sax-navroot .sax-row a[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  // The table's name for the player menu (the player-side twin of the GM's campaign box). Read once
  // per share code through chat_context, the same call the Recaps page uses, and kept for the visit.
  const [tableName, setTableName] = useState<string | null>(null);
  const tableCode = share.code || remembered;
  useEffect(() => {
    if (!tableCode) return;
    const key = `sax_table_name:${tableCode}`;
    try { const hit = window.sessionStorage.getItem(key); if (hit) { setTableName(hit); return; } } catch { /* storage blocked */ }
    let off = false;
    (async () => {
      const { data } = await createClient().rpc("chat_context", { code: tableCode });
      const name = (data as { campaign_name?: string }[] | null)?.[0]?.campaign_name ?? null;
      if (off || !name) return;
      setTableName(name);
      try { window.sessionStorage.setItem(key, name); } catch { /* storage blocked */ }
    })();
    return () => { off = true; };
  }, [tableCode]);
  // Decided after mount: reading navigator during render would differ between server and client.
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const code = sp.get("share");
      if (code) setShare({ on: true, qs: window.location.search, code });
      setRemembered(rememberShare(code));
      setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    } catch { /* no window */ }
    setFolded(readFolded());
  }, []);

  useEffect(() => {
    const read = () => { const c = getActiveCampaign(); setActiveSystem(c?.system ?? null); setCampaignName(c?.name ?? null); };
    read();
    return onActiveCampaignChange(read);
  }, []);

  useEffect(() => {
    if (campaignName || share.on || pathname.startsWith("/me") || !pathname.startsWith("/gm")) return;
    let off = false;
    let timer: number | undefined;
    (async () => {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (off || !user) return;
      const { count } = await sb.from("campaigns").select("id", { count: "exact", head: true }).eq("gm_id", user.id);
      if (off) return;
      if (!count) { setCampState("none"); return; }
      setCampState("loading");
      timer = window.setTimeout(() => { if (!off) setCampState("unchosen"); }, 6000);
    })();
    return () => { off = true; if (timer) window.clearTimeout(timer); };
  }, [campaignName, share.on, pathname]);

  const toggleFold = useCallback((label: string) => {
    setFolded((prev) => {
      const next = prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label];
      try { window.localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* storage blocked: fold for this visit only */ }
      return next;
    });
  }, []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const brand = (href: string) => (
    <a className="sax-brand" href={href}>
      <img className="sax-mark" src="/six-axes-logo.png" alt="" aria-hidden="true" />
      <span><span className="sax-word">Six Axes</span><span className="sax-tag">run the table</span></span>
    </a>
  );

  // ---- shared renderers ----
  const sidebarGroups = (groups: Group[], hrefFor: (g: Group, l: Leaf) => string, activeGroup: string | null, current: string | null) => (
    <nav className="sax-groups" aria-label="Main">
      {groups.map((g) => {
        const isActive = g.label === activeGroup;
        const open = isActive || !folded.includes(g.label);
        const id = `sax-g-${g.label.replace(/\s+/g, "-").toLowerCase()}`;
        return (
          <div key={g.label}>
            <button type="button" className={`sax-ghead sax-plain${isActive ? " on" : ""}`} aria-expanded={open} aria-controls={id}
              onClick={() => { if (!isActive) toggleFold(g.label); }}
              title={isActive ? "The group you are in stays open" : open ? `Fold ${g.label}` : `Show ${g.label}`}>
              <span>{g.label}</span><span className="sax-chev" aria-hidden="true">{"▾"}</span>
            </button>
            {open && (
              <div className="sax-glist" id={id}>
                {g.children.map((l) => (
                  <a key={l.href} className="sax-item" href={hrefFor(g, l)} aria-current={current === l.href ? "page" : undefined}>{l.label}</a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  const narrowRow = (g: Group | null, hrefFor: (g: Group, l: Leaf) => string, current: string | null) =>
    g ? (
      <nav className="sax-row" aria-label={`${g.label} pages`}>
        <span className="sax-row-k">{g.label}</span>
        {g.children.map((l) => (
          <a key={l.href} className="sax-chip" href={hrefFor(g, l)} aria-current={current === l.href ? "page" : undefined}>{l.label}</a>
        ))}
      </nav>
    ) : null;

  // Each tab is a real link to its group's first page, so a tap goes somewhere even before the
  // page's script has loaded (on a slow connection the old buttons did nothing until then). Once
  // the script runs, a tap opens the group's sheet instead.
  const tabBar = (tabs: { key: string; label: string; href: string }[], activeTab: string | null) => (
    <nav className="sax-tabs" aria-label="Sections">
      {tabs.map((t) => (
        <a key={t.key} href={t.href} className={`sax-tab${activeTab === t.key ? " on" : ""}`}
          aria-haspopup="dialog" aria-expanded={sheet === t.key}
          onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); setSheet(t.key); }}>
          {t.label}
        </a>
      ))}
    </nav>
  );

  // ---- PLAYER NAVIGATION ----
  // Shown when we have a share code (arrived through a campaign link) OR when we are on an
  // account-scoped dossier page (/me/* carries no ?share=).
  const onDossier = onRoute(pathname, "/me");
  const onTableRoute = pathname === "/me" || PLAYER_ROUTES.some((r) => onRoute(pathname, r));
  const isPlayer = share.on || onDossier || onTableRoute;

  if (isPlayer) {
    // Remember the share code whenever we see one, so a player on a dossier page keeps their way
    // back to their table. A player who has never opened a campaign link sees only "You".
    const qs = share.qs || (remembered ? `?share=${remembered}` : "");
    // A share-scoped page (Recaps, Lore...) always belongs to a table, even before the code is read.
    const haveTable = share.on || Boolean(remembered) || onTableRoute;
    const groups: PGroup[] = haveTable ? [PLAYER_TABLE, PLAYER_SESSION, PLAYER_YOU] : [PLAYER_YOU];
    const hrefFor = (g: Group, l: Leaf) => ((g as PGroup).scoped ? `${l.href}${qs}` : l.href);
    const hit = findLeaf(groups, pathname);
    const activeP = hit?.g ?? (onDossier ? PLAYER_YOU : groups[0]);
    const current = hit?.l.href ?? null;
    // The table's home is the Journal, the same place the campaigns list opens.
    const home = haveTable ? `/me${qs}` : "/me/campaigns";
    const sheetGroup = groups.find((g) => g.label === sheet);
    const tableBlock = (
      <div className="sax-camp">
        <span className="sax-camp-k">Table</span>
        <span className="sax-camp-n" title={tableName ?? undefined}>{haveTable ? (tableName ?? "\u00A0") : "None open"}</span>
        <a className="sax-camp-sw" href="/me/campaigns">{haveTable ? "Switch table" : "Your campaigns"}</a>
      </div>
    );

    return (
      <div className="sax-navroot">
        <style>{NAV_CSS}</style>
        <aside className="sax-side" ref={sideRef}>
          {brand(home)}
          {tableBlock}
          {sidebarGroups(groups, hrefFor, activeP.label, current)}
          <div className="sax-foot">
            <a className="sax-item" href="/faq">Help</a>
            <div className="sax-out"><LogoutButton /></div>
          </div>
        </aside>

        <div className="sax-narrow">
          <div className="sax-top">
            {brand(home)}
            <div className="sax-top-r">
              <a className="sax-top-camp" href="/me/campaigns" title="Table: switch on your campaigns list">{haveTable ? (tableName ?? "Your table") : "Your campaigns"}</a>
            </div>
          </div>
          {narrowRow(activeP, hrefFor, current)}
          {groups.length > 1 && tabBar(groups.map((g) => ({ key: g.label, label: g.label, href: hrefFor(g, g.children[0]) })), activeP.label)}
          {sheetGroup && (
            <Sheet title={sheetGroup.label} current={current} onClose={closeSheet}
              sections={[
                { links: sheetGroup.children.map((l) => ({ href: hrefFor(sheetGroup, l), label: l.label })) },
                ...(sheetGroup.label === PLAYER_YOU.label ? [{ label: "Help", links: [{ href: "/faq", label: "Help and FAQ" }] }] : []),
              ]}
              extra={sheetGroup.label === PLAYER_YOU.label ? <div className="sax-sheet-out"><LogoutButton /></div> : null} />
          )}
        </div>
      </div>
    );
  }

  // ---- GM NAVIGATION ----
  const mod = getModule(activeSystem);
  // A leaf shows unless it declares a capability the active campaign's system lacks.
  const groups: Group[] = GM_GROUPS.map((g) => ({
    ...g,
    children: g.children.filter((c) =>
      c.needs === "adversary" ? Boolean(mod.adversary) : c.needs === "character" ? Boolean(mod.character) : true),
  }));
  const hit = findLeaf(groups, pathname);
  const current = hit?.l.href ?? (pathname === "/gm/help" ? "/gm/help" : null);
  const activeGroup = hit?.g.label ?? null;
  const plain = (_g: Group, l: Leaf) => l.href;
  const onGm = pathname.startsWith("/gm");

  // Every visible GM page, for the command palette (Ctrl+K).
  const palettePages: PalettePage[] = [
    ...groups.flatMap((g) => g.children.map((c) => ({ href: c.href, label: c.label, group: g.label }))),
    { href: "/gm/help", label: "Help", group: "" },
  ];
  const openPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE));
  const shortcut = isMac ? "⌘K" : "Ctrl K";

  const firstOf = (label: string) => groups.find((g) => g.label === label)?.children[0]?.href ?? "/gm";
  const tabs = [...GM_TABS.map((t) => ({ key: t, label: t, href: firstOf(t) })), { key: "More", label: "More", href: "/gm/start" }];
  const activeTab = activeGroup && GM_TABS.includes(activeGroup) ? activeGroup : (activeGroup || current === "/gm/help") ? "More" : null;
  const sheetSections = sheet === "More"
    ? [
        ...groups.filter((g) => !GM_TABS.includes(g.label)).map((g) => ({ label: g.label, links: g.children.map((l) => ({ href: l.href, label: l.label })) })),
        { label: "Help", links: [{ href: "/gm/help", label: "Help and guide" }] },
      ]
    : (() => { const g = groups.find((x) => x.label === sheet); return g ? [{ links: g.children.map((l) => ({ href: l.href, label: l.label })) }] : []; })();

  const campLabel = campaignName
    ?? (campState === "none" ? "None yet" : campState === "unchosen" ? "Not chosen yet" : "Loading\u2026");
  const campLink = campaignName ? "Switch in the Workspace"
    : campState === "none" ? "Create one in the Workspace"
    : campState === "unchosen" ? "Pick one in the Workspace" : null;
  const campaignBlock = (
    <div className="sax-camp">
      <span className="sax-camp-k">Campaign</span>
      <span className="sax-camp-n" title={campaignName ?? undefined} aria-live="polite">{campLabel}</span>
      {campLink && <a className="sax-camp-sw" href="/gm">{campLink}</a>}
    </div>
  );

  return (
    <div className="sax-navroot">
      <style>{NAV_CSS}</style>
      {onGm && <CommandPalette pages={palettePages} />}

      <aside className="sax-side" ref={sideRef}>
        {brand("/")}
        {campaignBlock}
        {onGm && (
          <button type="button" className="sax-find sax-plain" onClick={openPalette} aria-label="Find or jump (command palette)">
            <span>Find or jump</span><kbd>{shortcut}</kbd>
          </button>
        )}
        {sidebarGroups(groups, plain, activeGroup, current)}
        <div className="sax-foot">
          <a className="sax-item" href="/gm/help" aria-current={current === "/gm/help" ? "page" : undefined}>Help</a>
          <div className="sax-out"><LogoutButton /></div>
        </div>
      </aside>

      <div className="sax-narrow">
        <div className="sax-top">
          {brand("/")}
          <div className="sax-top-r">
            <a className="sax-top-camp" href="/gm" title="Campaign: switch in the Workspace">{campaignName ?? (campState === "none" ? "No campaign yet" : campState === "unchosen" ? "Pick a campaign" : "Loading\u2026")}</a>
            {onGm && (
              <button type="button" className="sax-find sax-plain" onClick={openPalette} aria-label="Find or jump (command palette)">
                <span>Find</span>
              </button>
            )}
          </div>
        </div>
        {narrowRow(hit?.g ?? null, plain, current)}
        {tabBar(tabs, activeTab)}
        {sheet && (
          <Sheet title={sheet} current={current} onClose={closeSheet} sections={sheetSections}
            extra={sheet === "More" ? <div className="sax-sheet-out"><LogoutButton /></div> : null} />
        )}
      </div>
    </div>
  );
}
