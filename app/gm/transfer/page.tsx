"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

// app/gm/transfer/page.tsx (2026-11-09)
//
// Audit F2: where the recipient of a campaign handover accepts it (/gm/transfer?t=<token>). Under /gm,
// so the pilot gate already asks for GM access first. The rules live in accept_campaign_transfer (p140):
// signed in as the address it was sent to, with GM access, within 7 days, not cancelled or trashed.
// Reads the token from the address after load rather than useSearchParams, so the page needs no Suspense.

type Info = { campaignName: string; fromName: string; forYou: boolean; state: "open" | "accepted" | "cancelled" | "expired" | "trashed" };

export default function TransferPage() {
  const supabase = useMemo(() => createClient(), []);
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const t = new URLSearchParams(window.location.search).get("t");
    setToken(t);
    if (!t) { setStatus("missing"); return; }
    (async () => {
      const { data, error } = await supabase.rpc("campaign_transfer_info", { p_token: t });
      if (!live) return;
      if (error) { setStatus("error"); return; }
      if (!data) { setStatus("missing"); return; }
      setInfo(data as Info);
      setStatus("ready");
    })();
    return () => { live = false; };
  }, [supabase]);

  async function accept() {
    if (!token) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("accept_campaign_transfer", { p_token: token });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    window.location.href = `/gm?campaign=${encodeURIComponent(String(data))}`;
  }

  const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 22, maxWidth: 560 } as const;
  return (
    <PageShell>
      <div style={card}>
        <div style={{ fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: C.brass, marginBottom: 8 }}>Campaign handover</div>
        {status === "loading" && <p style={{ color: C.muted }}>Loading&hellip;</p>}
        {status === "missing" && <p style={{ color: C.muted }}>This handover link is not valid. Ask the GM to send a new one.</p>}
        {status === "error" && <p style={{ color: C.warn }}>Could not load this handover. Reload to try again.</p>}
        {status === "ready" && info && (
          <>
            <h1 style={{ fontSize: 22, margin: "0 0 10px", color: C.text }}>{info.fromName} wants you to run {info.campaignName}</h1>
            {info.state === "open" && info.forYou && (
              <>
                <p style={{ color: C.muted, lineHeight: 1.6, margin: "0 0 16px" }}>
                  Accepting makes you this campaign&rsquo;s GM: its sessions, recaps, codex, maps and table. {info.fromName} stays in the
                  campaign as a player.
                </p>
                <button type="button" onClick={accept} disabled={busy}
                  style={{ background: C.brass, color: C.ink, border: "none", borderRadius: FORGE_RADIUS, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  {busy ? "Accepting..." : `Accept and run ${info.campaignName}`}
                </button>
              </>
            )}
            {info.state === "open" && !info.forYou && <p style={{ color: C.warn, lineHeight: 1.6 }}>This handover was sent to a different email address. Sign in with that address to accept it.</p>}
            {info.state === "accepted" && <p style={{ color: C.muted }}>This handover has already been accepted.</p>}
            {info.state === "cancelled" && <p style={{ color: C.muted }}>{info.fromName} cancelled this handover.</p>}
            {info.state === "expired" && <p style={{ color: C.muted }}>This link has expired. Ask {info.fromName} to send a new one.</p>}
            {info.state === "trashed" && <p style={{ color: C.muted }}>This campaign is in the trash, so it cannot be handed over right now.</p>}
            {msg && <p role="alert" style={{ color: C.warn, margin: "12px 0 0" }}>{msg}</p>}
          </>
        )}
      </div>
    </PageShell>
  );
}
