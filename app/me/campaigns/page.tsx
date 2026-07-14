"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { UpgradeAccount } from "@/components/upgrade-account";

const C = { surface: SAX.slateBg, panel: SAX.panelBg, line: SAX.line, text: SAX.text, muted: SAX.muted, sun: SAX.sun, plum: SAX.plum, good: SAX.good };

// Every campaign this player has a character in, across all of them.
//
// Reads my_campaigns(), which derives membership from characters you OWN rather
// than from the memberships table (players never get membership rows in this app;
// see p3-dossier-rpcs.sql). It also returns the GM's display name, because the
// client can no longer read profiles for anyone but itself.
type Campaign = {
  campaign_id: string;
  campaign_name: string;
  system: string | null;
  share_code: string | null;
  gm_name: string | null;
  my_characters: number;
  last_session_at: string | null;
};

export default function MyCampaignsPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Campaign[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // A guest who has never touched the app has nothing here, and signing them
        // in anonymously would create an empty account for no reason. The claim
        // link is what starts a player's life in the product.
        if (active) setStatus("empty");
        return;
      }

      const { data, error } = await supabase.rpc("my_campaigns");
      if (!active) return;
      if (error) { setStatus("error"); return; }

      const list = (data as Campaign[]) || [];
      setRows(list);
      setStatus(list.length ? "ready" : "empty");
    })();
    return () => { active = false; };
  }, [supabase]);

  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 700, margin: "0 auto" }}>
        <Header title="Your campaigns" sub="EVERY TABLE YOU PLAY AT" />

        <UpgradeAccount variant="card" next="/me/campaigns" />

        {status === "loading" && <Muted>Loading&hellip;</Muted>}
        {status === "error" && <Muted>Something went wrong loading your campaigns. Please refresh.</Muted>}

        {status === "empty" && (
          <Muted>
            You are not in any campaigns yet. When your GM sends you a personal invite
            link, claim your character and the campaign will appear here.
          </Muted>
        )}

        {status === "ready" && rows.map((c) => (
          <div
            key={c.campaign_id}
            style={{
              background: C.surface, border: `1px solid ${C.line}`,
              borderRadius: 12, padding: "16px 18px", marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontFamily: SAX.serif, fontSize: 19, fontWeight: 700, color: C.text }}>
                {c.campaign_name}
              </span>
              <span style={{ fontFamily: SAX.mono, fontSize: 11.5, color: C.muted, letterSpacing: "0.06em" }}>
                {c.system ? c.system.toUpperCase() : ""}
              </span>
            </div>

            <div style={{ color: C.muted, fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
              Run by {c.gm_name}. You play{" "}
              {c.my_characters === 1 ? "one character" : `${c.my_characters} characters`} here.
              {c.last_session_at && (
                <> Last session {new Date(c.last_session_at).toLocaleDateString()}.</>
              )}
            </div>

            {c.share_code && (
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <A href={`/me?share=${c.share_code}`}>Journal</A>
                <A href={`/recaps?share=${c.share_code}`}>Recaps</A>
                <A href={`/lore?share=${c.share_code}`}>Lore</A>
                <A href={`/record?share=${c.share_code}`}>Record</A>
              </div>
            )}
          </div>
        ))}
      </div>
    </PageShell>
  );
}

export function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <span style={{ fontFamily: SAX.serif, fontSize: 26, fontWeight: 700, color: SAX.text }}>{title}</span>
      </div>
      <div style={{
        fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.22em",
        textTransform: "uppercase", color: SAX.muted, textAlign: "center", marginBottom: 18,
      }}>
        {sub}
      </div>
      <div style={{ height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${SAX.sun}, ${SAX.plum})`, marginBottom: 24 }} />
    </>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ textAlign: "center", color: SAX.muted, fontSize: 14, lineHeight: 1.65 }}>{children}</p>;
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        background: "transparent", color: SAX.text,
        border: `1px solid ${SAX.line}`, borderRadius: 8,
        padding: "6px 12px", fontSize: 12.5, fontWeight: 700,
        fontFamily: SAX.mono, letterSpacing: "0.04em", textDecoration: "none",
      }}
    >
      {children}
    </a>
  );
}
