"use client";

import React, { useEffect, useState } from "react";
import { SAX } from "@/lib/theme";
import LogoutButton from "@/components/logout-button";

/* Six Axes — navigation.
   Wide screens (>=1024px): a left sidebar. Logo, an account popup (Help + Sign
   out), then the groups stacked, the active group expands its children beneath
   it. Narrow screens: the original top bar (groups row + sub-row). The player
   portal (opened via a ?share link) stays flat in both. One shell, no drift. */

type Leaf = { href: string; label: string };
type Group = { label: string; href: string; children?: Leaf[] };

const GROUPS: Group[] = [
  { label: "Table", href: "/gm", children: [
    { href: "/gm/start", label: "Start here" },
    { href: "/gm", label: "Workspace" },
    { href: "/gm/roster", label: "Roster" },
  ] },
  { label: "Play", href: "/gm/sessions", children: [
    { href: "/gm/sessions", label: "Sessions" },
    { href: "/gm/capture", label: "Capture" },
    { href: "/gm/review", label: "Review" },
    { href: "/gm/encounters", label: "Encounters" },
    { href: "/gm/table", label: "Check-in" },
  ] },
  { label: "Story", href: "/gm/codex", children: [
    { href: "/gm/codex", label: "Codex" },
    { href: "/gm/prep", label: "Prep" },
    { href: "/gm/timeline", label: "Timeline" },
    { href: "/gm/map", label: "Map" },
    { href: "/gm/search", label: "Search" },
  ] },
  { label: "Insight", href: "/gm/dispositions", children: [
    { href: "/gm/dispositions", label: "Dispositions" },
    { href: "/gm/reliability", label: "Reliability" },
    { href: "/gm/dashboard", label: "Dashboard" },
    { href: "/gm/mechanics", label: "Mechanics" },
  ] },
  { label: "Profile", href: "/play" },
  { label: "Help", href: "/gm/help" },
];

// Sidebar omits Help (it lives in the account popup).
const SIDE_GROUPS = GROUPS.filter((g) => g.label !== "Help");

// The player navigation, grouped.
//
// It used to be a FLAT list of nine share-scoped links. Then the account-based
// dossier added six more, and a player looking at a sidebar of fifteen undifferentiated
// items has to read all fifteen every time. Grouped, the same surface is three choices.
//
// TWO KINDS OF LINK, AND THE DISTINCTION IS LOAD-BEARING:
//
//   SHARE-SCOPED  (?share=<code>) belong to ONE campaign. Meaningless without a share
//                 code, so they are hidden when there is not one.
//   ACCOUNT-SCOPED (/me/*) span EVERY campaign you play in. They must never carry a
//                 ?share=, because pinning a cross-campaign page to one campaign is
//                 simply wrong.
//
// Mixing those two was the bug in the screenshots: on a dossier page the share-scoped
// links vanished entirely, because they had nothing to point at.
type PGroup = { label: string; href: string; scoped: boolean; children: Leaf[] };

// "This table": everything about the ONE campaign you arrived through.
const PLAYER_TABLE: PGroup = {
  label: "This table", href: "/play", scoped: true,
  children: [
    { href: "/play", label: "Inventory" },
    { href: "/me", label: "Journal" },
    { href: "/recaps", label: "Recaps" },
    { href: "/lore", label: "Lore" },
    { href: "/map", label: "Map" },
    { href: "/chat", label: "Chat" },
  ],
};

// "Session": the things you do around a game actually happening.
const PLAYER_SESSION: PGroup = {
  label: "Session", href: "/schedule", scoped: true,
  children: [
    { href: "/schedule", label: "Schedule" },
    { href: "/record", label: "Record" },
    { href: "/vibe", label: "Check-in" },
  ],
};

// "You": the account-based dossier. Spans every campaign. Never share-scoped.
const PLAYER_YOU: PGroup = {
  label: "You", href: "/me/campaigns", scoped: false,
  children: [
    { href: "/me/campaigns", label: "Campaigns" },
    { href: "/me/characters", label: "Characters" },
    { href: "/me/threads", label: "Threads" },
    { href: "/me/codex", label: "Codex" },
    { href: "/me/profile", label: "Your profile" },
    { href: "/me/settings", label: "Settings" },
  ],
};

const hrefs = (g: Group) => (g.children ? g.children.map((c) => c.href) : [g.href]);

const NAV_CSS = `
.sax-nav{padding-bottom:14px;margin-bottom:26px;border-bottom:1px solid ${SAX.line};
  font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;}
.sax-top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.sax-right{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.sax-brand{display:flex;align-items:center;gap:10px;text-decoration:none;}
.sax-mark{width:30px;height:30px;opacity:.92;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));}
.sax-word{font-family:${SAX.serif};font-size:23px;font-weight:600;color:${SAX.text};letter-spacing:-0.01em;line-height:1;}
.sax-tag{font-family:${SAX.mono};font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:${SAX.muted};display:block;margin-top:3px;}
.sax-grp{display:flex;gap:4px;flex-wrap:wrap;}
.sax-glink{font-size:13.5px;color:${SAX.muted};text-decoration:none;padding:7px 15px;border-radius:999px;
  transition:color .15s,background .15s;border:1px solid transparent;}
.sax-glink:hover{color:${SAX.text};background:rgba(255,255,255,0.05);}
.sax-glink.on{color:${SAX.inkDeep};background:${SAX.brass};font-weight:600;}
.sax-sub{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;padding-left:2px;}
.sax-slink{font-family:${SAX.mono};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;
  color:${SAX.muted};text-decoration:none;padding:5px 11px;border-radius:7px;border:1px solid ${SAX.line};
  transition:color .15s,border-color .15s,background .15s;}
.sax-slink:hover{color:${SAX.text};border-color:${SAX.brassDim};}
.sax-slink.on{color:${SAX.brass};border-color:${SAX.brass};background:rgba(200,162,75,0.08);}
.sax-nav a:focus-visible,.sax-side a:focus-visible,.sax-side summary:focus-visible{outline:2px solid ${SAX.brass};outline-offset:2px;}

/* sidebar (hidden until wide) */
.sax-side{display:none;}
.sax-side .sax-word{font-size:20px;}
.sax-vnav{display:flex;flex-direction:column;gap:2px;margin-top:4px;}
.sax-vgroup{display:flex;flex-direction:column;}
.sax-vlink{font-size:14.5px;color:${SAX.muted};text-decoration:none;padding:9px 12px;border-radius:9px;
  transition:color .15s,background .15s;}
.sax-vlink:hover{color:${SAX.text};background:rgba(255,255,255,0.05);}
.sax-vlink.on{color:${SAX.inkDeep};background:${SAX.brass};font-weight:600;}
.sax-vsub{display:flex;flex-direction:column;gap:1px;margin:2px 0 8px 12px;padding-left:9px;border-left:1px solid ${SAX.line};}
.sax-vslink{font-family:${SAX.mono};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;
  color:${SAX.muted};text-decoration:none;padding:6px 10px;border-radius:6px;transition:color .15s;}
.sax-vslink:hover{color:${SAX.text};}
.sax-vslink.on{color:${SAX.brass};}
.sax-acct{position:relative;}
.sax-acct>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;}
.sax-acct>summary::-webkit-details-marker{display:none;}
.sax-acct>summary:hover{background:rgba(255,255,255,0.05);}
.sax-avatar{width:26px;height:26px;border-radius:50%;background:${SAX.slateBg};border:1px solid ${SAX.line};
  display:flex;align-items:center;justify-content:center;color:${SAX.brass};font-size:12px;flex-shrink:0;}
.sax-acct-label{font-size:13.5px;color:${SAX.muted};}
.sax-acct-menu{position:absolute;left:6px;right:6px;top:100%;margin-top:4px;background:${SAX.inkDeep};
  border:1px solid ${SAX.line};border-radius:10px;padding:6px;z-index:20;display:flex;flex-direction:column;gap:2px;
  box-shadow:0 14px 30px rgba(0,0,0,0.55);}
.sax-acct-item{font-size:13.5px;color:${SAX.muted};text-decoration:none;padding:8px 10px;border-radius:7px;}
.sax-acct-item:hover{background:rgba(255,255,255,0.05);color:${SAX.text};}

@media (min-width:1024px){
  .sax-nav{display:none;}
  .sax-side{display:flex;flex-direction:column;gap:16px;position:fixed;left:0;top:0;bottom:0;width:220px;
    padding:22px 14px;overflow-y:auto;background:rgba(6,3,10,0.82);border-right:1px solid ${SAX.line};z-index:10;}
}
`;

export default function SixAxesNav() {
  const [pathname, setPathname] = useState<string>("");
  const [share, setShare] = useState<{ on: boolean; qs: string }>({ on: false, qs: "" });

  useEffect(() => {
    try {
      setPathname(window.location.pathname);
      const sp = new URLSearchParams(window.location.search);
      if (sp.has("share")) setShare({ on: true, qs: window.location.search });
    } catch {
      /* no window */
    }
  }, []);

  const brand = (href: string) => (
    <a className="sax-brand" href={href}>
      <img className="sax-mark" src="/astrolabe.png" alt="" />
      <span><span className="sax-word">Six Axes</span><span className="sax-tag">run the table</span></span>
    </a>
  );

  // ---- PLAYER NAVIGATION -----------------------------------------------------
  //
  // Shown when we have a share code (arrived through a campaign link) OR when we are
  // on an account-scoped dossier page. The second condition is the fix for the bug in
  // the screenshots: /me/* pages carry no ?share=, so without it a player on
  // /me/characters was shown the GM navigation.
  const onDossier = pathname.startsWith("/me");
  const isPlayer  = share.on || onDossier;

  if (isPlayer) {
    // A share-scoped group is meaningless without a share code, so it is hidden rather
    // than rendered as a set of dead links. "You" is always available: it is the
    // account, and the account exists regardless of which door you came in through.
    const groups: PGroup[] = share.on
      ? [PLAYER_TABLE, PLAYER_SESSION, PLAYER_YOU]
      : [PLAYER_YOU];

    // Share-scoped links carry the ?share=. Account-scoped ones MUST NOT: they span
    // every campaign, and pinning them to one would be wrong.
    const hrefFor = (g: PGroup, l: Leaf) => (g.scoped ? `${l.href}${share.qs}` : l.href);

    const activeP =
      groups.find((g) => g.children.some((c) => c.href === pathname)) ??
      (onDossier ? PLAYER_YOU : groups[0]);

    const home = share.on ? `/play${share.qs}` : "/me/campaigns";

    return (
      <>
        <style>{NAV_CSS}</style>

        {/* wide: left sidebar, grouped with the active group expanded */}
        <aside className="sax-side">
          {brand(home)}
          <nav className="sax-vnav">
            {groups.map((g) => {
              const on = activeP?.label === g.label;
              return (
                <div key={g.label} className="sax-vgroup">
                  <a
                    className={`sax-vlink${on ? " on" : ""}`}
                    href={g.scoped ? `${g.href}${share.qs}` : g.href}
                  >
                    {g.label}
                  </a>
                  {on && (
                    <div className="sax-vsub">
                      {g.children.map((c) => (
                        <a
                          key={c.href}
                          className={`sax-vslink${pathname === c.href ? " on" : ""}`}
                          href={hrefFor(g, c)}
                        >
                          {c.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* narrow: top bar with a sub-row for the active group */}
        <header className="sax-nav">
          <div className="sax-top">
            {brand(home)}
            <nav className="sax-grp">
              {groups.map((g) => {
                const on = activeP?.label === g.label;
                return (
                  <a
                    key={g.label}
                    className={`sax-glink${on ? " on" : ""}`}
                    href={g.scoped ? `${g.href}${share.qs}` : g.href}
                  >
                    {g.label}
                  </a>
                );
              })}
            </nav>
          </div>

          {activeP && (
            <nav className="sax-sub">
              {activeP.children.map((c) => (
                <a
                  key={c.href}
                  className={`sax-slink${pathname === c.href ? " on" : ""}`}
                  href={hrefFor(activeP, c)}
                >
                  {c.label}
                </a>
              ))}
            </nav>
          )}
        </header>
      </>
    );
  }

  const active = GROUPS.find((g) => hrefs(g).includes(pathname));

  return (
    <>
      <style>{NAV_CSS}</style>

      {/* wide: left sidebar */}
      <aside className="sax-side">
        {brand("/")}
        <details className="sax-acct">
          <summary aria-label="Account menu">
            <span className="sax-avatar" aria-hidden="true">{"\u25C6"}</span>
            <span className="sax-acct-label">Account</span>
          </summary>
          <div className="sax-acct-menu">
            <a className="sax-acct-item" href="/gm/help">Help</a>
            <div className="sax-acct-item"><LogoutButton /></div>
          </div>
        </details>
        <nav className="sax-vnav">
          {SIDE_GROUPS.map((g) => {
            const on = active?.label === g.label;
            return (
              <div key={g.label} className="sax-vgroup">
                <a className={`sax-vlink${on ? " on" : ""}`} href={g.href}>{g.label}</a>
                {on && g.children && (
                  <div className="sax-vsub">
                    {g.children.map((c) => (
                      <a key={c.href} className={`sax-vslink${pathname === c.href ? " on" : ""}`} href={c.href}>{c.label}</a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* narrow: original top bar */}
      <header className="sax-nav">
        <div className="sax-top">
          {brand("/")}
          <div className="sax-right">
            <nav className="sax-grp">
              {GROUPS.map((g) => {
                const on = active?.label === g.label;
                return <a key={g.label} className={`sax-glink${on ? " on" : ""}`} href={g.href}>{g.label}</a>;
              })}
            </nav>
            <LogoutButton />
          </div>
        </div>

        {active?.children && (
          <nav className="sax-sub">
            {active.children.map((c) => (
              <a key={c.href} className={`sax-slink${pathname === c.href ? " on" : ""}`} href={c.href}>{c.label}</a>
            ))}
          </nav>
        )}
      </header>
    </>
  );
}
