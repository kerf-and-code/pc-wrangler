"use client";

import PageShell from "@/components/page-shell";
import DmScreen from "@/components/dm-screen";
import { SAX, STONE } from "@/lib/theme";

// app/gm/screen/page.tsx
//
// The DM Screen: free-form boards of compendium cards the GM sends over from the Rules compendium
// ("To DM Screen"). Gated to signed-in GMs by lib/supabase/proxy.ts like the rest of /gm. Cards are
// snapshots stored per GM in dm_boards (migration p92); this page arranges and persists them.

export default function GmScreenPage() {
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
          DM Screen
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
          Your at-the-table board. Send cards here from the Rules compendium, then drag and resize them
          however you like. Cards are snapshots, so they stay put even if the source changes.
        </p>
      </header>
      <DmScreen />
    </PageShell>
  );
}
