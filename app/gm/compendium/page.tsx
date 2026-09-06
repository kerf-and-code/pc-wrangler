"use client";

import PageShell from "@/components/page-shell";
import CompendiumTool from "@/components/compendium-tool";
import { SAX, STONE } from "@/lib/theme";

// app/gm/compendium/page.tsx
//
// The offline rules compendium, now inside the GM tools. It began as a public free tool at
// /tools/compendium; it was moved here so it sits with the rest of the at-the-table kit and is gated to
// signed-in GMs by lib/supabase/proxy.ts (/gm requires an authenticated user with access_role "gm").
// The tool itself is unchanged: the same self-contained client component. Type OR speak a spell, item,
// or condition and get an instant SRD 5.1 card. On-device (Vosk), nothing leaves the browser.

export default function GmCompendiumPage() {
  return (
    <PageShell>
      <header style={{ marginBottom: 22 }}>
        <h1
          style={{
            fontFamily: "var(--forge-display, 'Cinzel', serif)",
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: "0.03em",
            color: STONE.ink,
            margin: "0 0 6px",
          }}
        >
          Rules compendium
        </h1>
        <p
          style={{
            fontFamily: SAX.serif,
            fontSize: 15.5,
            lineHeight: 1.6,
            color: STONE.inkDim,
            margin: 0,
            maxWidth: 640,
          }}
        >
          Type or speak a spell, item, or condition and get an instant card. Runs on-device, nothing
          leaves the browser.
        </p>
      </header>
      <CompendiumTool />
    </PageShell>
  );
}
