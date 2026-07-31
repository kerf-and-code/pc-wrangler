"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

type Recap = { session_id: string; session_number: number | null; recap: string };

export default function PlayerRecapsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaignName, setCampaignName] = useState<string | null>(null);
  const [recaps, setRecaps] = useState<Recap[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "invalid">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const shareCode = params.get("share");
      if (!shareCode) { if (active) setStatus("invalid"); return; }

      let { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { error: signErr } = await supabase.auth.signInAnonymously();
        if (signErr) { if (active) setStatus("invalid"); return; }
      }

      const [{ data: rows }, { data: ctx }] = await Promise.all([
        supabase.rpc("recaps_for_share", { code: shareCode }),
        supabase.rpc("chat_context", { code: shareCode }),
      ]);
      if (!active) return;
      if (ctx && ctx.length) setCampaignName(ctx[0].campaign_name);
      if (rows && rows.length) { setRecaps(rows as Recap[]); setStatus("ready"); }
      else setStatus("empty");
    })();
    return () => { active = false; };
  }, [supabase]);

  const eyebrow = {
    fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.22em",
    textTransform: "uppercase" as const, color: C.muted,
  };

  const recapCard = {
    background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
    padding: "20px 24px", marginBottom: 16, textAlign: "left" as const,
  };

  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 640, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <span style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 26, fontWeight: 700 }}>
            Session recaps
          </span>
        </div>
        <div style={{ ...eyebrow, textAlign: "center", marginBottom: 18 }}>
          {campaignName ? campaignName.toUpperCase() : "SIX AXES"}
        </div>
        <div style={{ height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${C.sun}, ${C.plum})`, marginBottom: 24 }} />

        {status === "loading" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 14 }}>Loading…</p>
        )}

        {status === "invalid" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            This link looks broken. Ask your GM for the campaign link.
          </p>
        )}

        {status === "empty" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            No recaps yet. Once your GM wraps a session and writes its recap, the &ldquo;previously on…&rdquo; will show up here.
          </p>
        )}

        {status === "ready" && recaps.map((r) => (
          <div key={r.session_id} style={recapCard}>
            <div style={{ ...eyebrow, marginBottom: 10, color: C.sun }}>
              Session {r.session_number ?? "?"}
            </div>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 15, color: C.text }}>
              {r.recap}
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
