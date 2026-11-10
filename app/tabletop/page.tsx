"use client";

// app/tabletop/page.tsx (push 12, audit U5 and G13)
//
// A plain address for the tabletop, so the nav can link to it. The table itself lives at
// /tabletop/<campaign>; this page works out which campaign is meant and goes there.
//   - A player's link (?share=<code>): the campaign whose share code it is, among the campaigns this
//     account plays in (my_campaigns). A guest who has not claimed a character yet is told how to.
//   - No share code: the campaign the GM was last working in (lib/active-campaign).
// It reads the address in an effect, not with useSearchParams, so it needs no Suspense boundary.

import { useEffect, useState } from "react";
import PageShell from "@/components/page-shell";
import { createClient } from "@/lib/supabase/client";
import { C } from "@/lib/forge-theme";
import { getActiveCampaign } from "@/lib/active-campaign";
import { tabletopUrl } from "@/lib/tabletop/open";
import { ConnectProblem } from "@/components/load-problem";

type State = "loading" | "offline" | "pick-gm" | "claim" | "not-yours";

export default function TabletopEntryPage() {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      const share = new URLSearchParams(window.location.search).get("share");
      if (!share) {
        const c = getActiveCampaign();
        if (c?.id) { window.location.replace(tabletopUrl(c.id)); return; }
        if (active) setState("pick-gm");
        return;
      }
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || user.is_anonymous) { if (active) setState("claim"); return; }
      const { data, error } = await supabase.rpc("my_campaigns");
      if (!active) return;
      if (error) { setState("offline"); return; }
      const hit = ((data as { campaign_id: string; share_code: string | null }[]) || []).find((r) => r.share_code === share);
      if (hit) { window.location.replace(tabletopUrl(hit.campaign_id)); return; }
      setState("not-yours");
    })();
    return () => { active = false; };
  }, []);

  const p = { color: C.muted, fontSize: 14.5, lineHeight: 1.6, textAlign: "center" as const, margin: "0 0 10px" };
  const a = { color: C.sun };

  return (
    <PageShell width={720}>
      <div style={{ width: "100%", maxWidth: 560, margin: "40px auto 0" }}>
        {state === "loading" && <p style={p}>Opening the tabletop&hellip;</p>}
        {state === "offline" && <ConnectProblem />}
        {state === "pick-gm" && (
          <>
            <p style={p}>Pick a campaign first, then open the tabletop from there.</p>
            <p style={p}>GMs: open <a href="/gm/tonight" style={a}>Tonight</a> and press Open the tabletop. Players: open it from <a href="/me/campaigns" style={a}>Your campaigns</a>.</p>
          </>
        )}
        {state === "claim" && (
          <>
            <p style={p}>The tabletop opens once you have claimed a character in this campaign and signed in.</p>
            <p style={p}>Use the invite link your GM sent you, then open the tabletop from <a href="/me/campaigns" style={a}>Your campaigns</a>.</p>
          </>
        )}
        {state === "not-yours" && (
          <p style={p}>None of your characters is in this campaign yet. Ask your GM for an invite link, or open the tabletop from <a href="/me/campaigns" style={a}>Your campaigns</a>.</p>
        )}
      </div>
    </PageShell>
  );
}
