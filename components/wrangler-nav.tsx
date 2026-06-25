"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const GM_LINKS = [
  { href: "/play", label: "Inventory" },
  { href: "/gm", label: "Workspace" },
  { href: "/gm/roster", label: "Roster" },
  { href: "/gm/sessions", label: "Sessions" },
  { href: "/gm/codex", label: "Codex" },
  { href: "/gm/timeline", label: "Timeline" },
  { href: "/gm/search", label: "Search" },
  { href: "/gm/table", label: "Check-in" },
  { href: "/gm/capture", label: "Capture" },
  { href: "/gm/review", label: "Review" },
  { href: "/gm/reliability", label: "Reliability" },
  { href: "/gm/dashboard", label: "Dashboard" },
];

// Player portal: one share link, three tabs.
const PLAYER_LINKS = [
  { href: "/play", label: "Inventory" },
  { href: "/vibe", label: "Check-in" },
  { href: "/chat", label: "Chat" },
  { href: "/record", label: "Record" },
];

const NAV_CSS = `
.wgn{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  padding-bottom:16px;margin-bottom:26px;border-bottom:1px solid #3D2F52;
  font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;}
.wgn-brand{display:flex;align-items:baseline;gap:11px;text-decoration:none;}
.wgn-mark{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-size:23px;font-weight:600;color:#F4EEFA;letter-spacing:-0.01em;}
.wgn-tag{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#A597BD;}
.wgn-links{display:flex;gap:4px;flex-wrap:wrap;}
.wgn-link{font-size:13.5px;color:#A597BD;text-decoration:none;padding:7px 14px;border-radius:999px;transition:color .15s,background .15s;}
.wgn-link:hover{color:#F4EEFA;background:#251B33;}
.wgn-link.on{color:#1B1426;background:#F4C430;font-weight:600;}
.wgn a:focus-visible{outline:2px solid #F4C430;outline-offset:2px;}
`;

export default function WranglerNav() {
  const pathname = usePathname();
  const [share, setShare] = useState<{ on: boolean; qs: string }>({ on: false, qs: "" });

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has("share")) setShare({ on: true, qs: window.location.search });
    } catch {
      /* no window */
    }
  }, []);

  const links = share.on ? PLAYER_LINKS : GM_LINKS;
  const home = share.on ? `/play${share.qs}` : "/";

  return (
    <header className="wgn">
      <style>{NAV_CSS}</style>
      <a className="wgn-brand" href={home}>
        <span className="wgn-mark">Wrangler</span>
        <span className="wgn-tag">run the table</span>
      </a>
      <nav className="wgn-links">
        {links.map((l) => {
          const active = pathname === l.href;
          const href = share.on ? `${l.href}${share.qs}` : l.href;
          return (
            <a key={l.href} className={`wgn-link${active ? " on" : ""}`} href={href}>{l.label}</a>
          );
        })}
      </nav>
    </header>
  );
}
