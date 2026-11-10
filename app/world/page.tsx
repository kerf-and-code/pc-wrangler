"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import WorldMapViewer from "@/components/worldmap/WorldMapViewer";
import PageShell from "@/components/page-shell";
import { C } from "@/lib/forge-theme";
import { ConnectProblem, LinkInvalid } from "@/components/load-problem";

// Player World map: the ?share= entry point (This table, then World map, in the player nav).
// Mirrors the Lore page's auth: read the share code, sign in anonymously, then hands the
// code to the viewer, which reads through the share-scoped *_for_player RPCs. Read-only.
export default function PlayerWorldMapPage() {
  const supabase = useMemo(() => createClient(), []);
  const [shareCode, setShareCode] = useState<string | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const code = new URLSearchParams(window.location.search).get("share");
      if (!code) { if (active) setShareCode(null); return; }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) { if (active) setOffline(true); return; } // audit U9: sign-in failure is not a bad link
      }

      if (active) setShareCode(code);
    })();
    return () => { active = false; };
  }, [supabase]);

  // Audit U27: inside PageShell with the menu, like every other table page.
  return (
    <PageShell width={1600}>
      <h1 className="sr-only">World map</h1>
      {offline ? <ConnectProblem />
        : shareCode === undefined ? <p role="status" style={{ color: C.muted, fontSize: 14 }}>Loading the world map&hellip;</p>
        : shareCode === null ? <LinkInvalid />
        : <WorldMapViewer shareCode={shareCode} inShell />}
    </PageShell>
  );
}
