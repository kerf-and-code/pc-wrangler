"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import WorldMapViewer from "@/components/worldmap/WorldMapViewer";
import { C } from "@/lib/forge-theme";

// Player World Map: the ?share= entry point (Story -> World Map in the player nav).
// Mirrors the Lore page's auth -- read the share code, sign in anonymously -- then hands the
// code to the viewer, which reads through the share-scoped *_for_player RPCs. Read-only.
export default function PlayerWorldMapPage() {
  const supabase = useMemo(() => createClient(), []);
  const [shareCode, setShareCode] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      const code = new URLSearchParams(window.location.search).get("share");
      if (!code) { if (active) setShareCode(null); return; }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) { if (active) setShareCode(null); return; }
      }

      if (active) setShareCode(code);
    })();
    return () => { active = false; };
  }, [supabase]);

  if (shareCode === undefined) {
    return <p style={{ color: C.muted, fontSize: 14, padding: 24 }}>Loading the world map&hellip;</p>;
  }
  if (shareCode === null) {
    return <p style={{ color: C.muted, fontSize: 14, padding: 24 }}>This link looks broken. Ask your GM for the campaign link.</p>;
  }
  return <WorldMapViewer shareCode={shareCode} />;
}
