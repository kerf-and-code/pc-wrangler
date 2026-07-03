"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SAX } from "@/lib/theme";
import LogoutButton from "@/components/logout-button";

/* Six Axes — top navigation.
   GM side is grouped into five sections plus standalone Power and Inventory.
   The active group reveals its sub-tabs on a second row. Player side (opened via
   a ?share link) stays flat. */

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
    { href: "/gm/table", label: "Check-in" },
  ] },
  { label: "Story", href: "/gm/codex", children: [
    { href: "/gm/codex", label: "Codex" },
    { href: "/gm/timeline", label: "Timeline" },
    { href: "/gm/search", label: "Search" },
  ] },
  { label: "Insight", href: "/gm/dispositions", children: [
    { href: "/gm/dispositions", label: "Dispositions" },
    { href: "/gm/reliability", label: "Reliability" },
    { href: "/gm/dashboard", label: "Dashboard" },
    { href: "/gm/mechanics", label: "Mechanics" },
  ] },
  { label: "Power", href: "/gm/power" },
  { label: "Inventory", href: "/play" },
];

const PLAYER: Leaf[] = [
  { href: "/play", label: "Inventory" },
  { href: "/schedule", label: "Schedule" },
  { href: "/recaps", label: "Recaps" },
  { href: "/vibe", label: "Check-in" },
  { href: "/chat", label: "Chat" },
  { href: "/record", label: "Record" },
];

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
.sax-nav a:focus-visible{outline:2px solid ${SAX.brass};outline-offset:2px;}
`;

export default function SixAxesNav() {
  const pathname = usePathname() || "";
  const [share, setShare] = useState<{ on: boolean; qs: string }>({ on: false, qs: "" });

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has("share")) setShare({ on: true, qs: window.location.search });
    } catch {
      /* no window */
    }
  }, []);

  // player portal: flat
  if (share.on) {
    return (
      <header className="sax-nav">
        <style>{NAV_CSS}</style>
        <div className="sax-top">
          <a className="sax-brand" href={`/play${share.qs}`}>
            <img className="sax-mark" src="/astrolabe.png" alt="" />
            <span><span className="sax-word">Six Axes</span><span className="sax-tag">run the table</span></span>
          </a>
          <nav className="sax-grp">
            {PLAYER.map((l) => (
              <a key={l.href} className={`sax-glink${pathname === l.href ? " on" : ""}`} href={`${l.href}${share.qs}`}>
                {l.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
    );
  }

  const active = GROUPS.find((g) => hrefs(g).includes(pathname));

  return (
    <header className="sax-nav">
      <style>{NAV_CSS}</style>
      <div className="sax-top">
        <a className="sax-brand" href="/">
          <img className="sax-mark" src="/astrolabe.png" alt="" />
          <span><span className="sax-word">Six Axes</span><span className="sax-tag">run the table</span></span>
        </a>
        <div className="sax-right">
          <nav className="sax-grp">
            {GROUPS.map((g) => {
              const on = active?.label === g.label;
              return (
                <a key={g.label} className={`sax-glink${on ? " on" : ""}`} href={g.href}>{g.label}</a>
              );
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
  );
}
