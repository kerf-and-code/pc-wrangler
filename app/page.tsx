"use client";

import React, { useState } from "react";
import PageShell from "@/components/page-shell";
import EnterSplash from "@/components/enter-splash";
import { SAX, surfaces, ui } from "@/lib/theme";

const SURFACES = [
  { href: "/play", title: "Player Disposition Inventory", blurb: "The onboarding questionnaire. Public, no login.", tag: "public" },
  { href: "/gm", title: "GM Workspace", blurb: "Create a campaign, build the roster, run coverage analysis.", tag: "gm" },
  { href: "/gm/sessions", title: "Session Log", blurb: "Run a session and log events to the spine.", tag: "gm" },
  { href: "/gm/dashboard", title: "Dashboard", blurb: "Spotlight balance, arcs, loot, and table-health flags.", tag: "gm" },
];

export default function Home() {
  // Pull the breaker to enter, then the landing menu is revealed. Swap this for
  // a router.push("/gm") in onEnter if you'd rather drop straight into the app.
  const [entered, setEntered] = useState(false);

  if (!entered) return <EnterSplash onEnter={() => setEntered(true)} />;

  return (
    <PageShell width={720}>
      <h1 style={{ ...ui.h1, fontSize: 38, lineHeight: 1.1, margin: "8px 0 12px", maxWidth: 560 }}>
        A tool for running the table, not the world.
      </h1>
      <p style={{ color: SAX.muted, fontSize: 16, lineHeight: 1.6, maxWidth: 540, marginBottom: 36 }}>
        In development. The surfaces below are live as they get built.
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        {SURFACES.map((s) => (
          <a key={s.href} href={s.href} style={{ textDecoration: "none" }}>
            <div style={{ ...surfaces.panel, padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
              <div>
                <div style={{ color: SAX.text, fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{s.title}</div>
                <div style={{ color: SAX.muted, fontSize: 13.5 }}>{s.blurb}</div>
              </div>
              <span style={{ fontFamily: SAX.mono, fontSize: 10.5, color: s.tag === "public" ? SAX.good : SAX.brass, border: `1px solid ${s.tag === "public" ? SAX.good : SAX.brass}`, borderRadius: 999, padding: "3px 9px", textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
                {s.tag}
              </span>
            </div>
          </a>
        ))}
      </div>
    </PageShell>
  );
}
