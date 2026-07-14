"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { UpgradeAccount } from "@/components/upgrade-account";
import { Header } from "@/app/me/campaigns/page";

const C = { surface: SAX.slateBg, line: SAX.line, text: SAX.text, muted: SAX.muted };

// The stable: every character this person owns, across every campaign.
//
// This is the payoff of durable identity, and the thing that makes the two-level
// disposition model possible: one player, many characters, one evolving sense of
// how that person plays underneath all of them.
type Char = {
  character_id: string;
  name: string;
  campaign_id: string;
  campaign_name: string;
  species: string | null;
  class: string | null;
  subclass: string | null;
  level: number | null;
  alignment: string | null;
  kind: string;
  active: boolean;
};

export default function MyCharactersPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Char[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setStatus("empty"); return; }

      const { data, error } = await supabase.rpc("my_characters");
      if (!active) return;
      if (error) { setStatus("error"); return; }

      const list = ((data as Char[]) || []).filter((c) => c.kind === "pc");
      setRows(list);
      setStatus(list.length ? "ready" : "empty");
    })();
    return () => { active = false; };
  }, [supabase]);

  // Group by campaign, so the stable reads as "who I am at each table" rather than
  // as an undifferentiated list.
  const byCampaign = rows.reduce<Record<string, { name: string; chars: Char[] }>>((acc, c) => {
    (acc[c.campaign_id] ||= { name: c.campaign_name, chars: [] }).chars.push(c);
    return acc;
  }, {});

  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 700, margin: "0 auto" }}>
        <Header title="Your characters" sub="EVERYONE YOU HAVE BEEN" />

        <UpgradeAccount variant="card" next="/me/characters" />

        {status === "loading" && <Muted>Loading&hellip;</Muted>}
        {status === "error" && <Muted>Something went wrong loading your characters. Please refresh.</Muted>}
        {status === "empty" && (
          <Muted>
            No characters yet. Claim one with the personal invite link your GM sent,
            and it will appear here alongside every other character you play.
          </Muted>
        )}

        {status === "ready" && Object.entries(byCampaign).map(([cid, group]) => (
          <div key={cid} style={{ marginBottom: 26 }}>
            <div style={{
              fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.18em",
              textTransform: "uppercase", color: C.muted, marginBottom: 10,
            }}>
              {group.name}
            </div>

            {group.chars.map((c) => (
              <div
                key={c.character_id}
                style={{
                  background: C.surface, border: `1px solid ${C.line}`,
                  borderRadius: 12, padding: "14px 18px", marginBottom: 10,
                  opacity: c.active ? 1 : 0.55,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: SAX.serif, fontSize: 18, fontWeight: 700, color: C.text }}>
                    {c.name}
                  </span>
                  {!c.active && (
                    <span style={{ fontFamily: SAX.mono, fontSize: 10.5, letterSpacing: "0.1em", color: C.muted, textTransform: "uppercase" }}>
                      retired
                    </span>
                  )}
                </div>

                <div style={{ color: C.muted, fontSize: 13, marginTop: 5, lineHeight: 1.5 }}>
                  {[
                    c.level ? `Level ${c.level}` : null,
                    c.species,
                    c.subclass ? `${c.subclass} ${c.class ?? ""}`.trim() : c.class,
                    c.alignment,
                  ].filter(Boolean).join(" · ") || "No details recorded yet."}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </PageShell>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ textAlign: "center", color: SAX.muted, fontSize: 14, lineHeight: 1.65 }}>{children}</p>;
}
