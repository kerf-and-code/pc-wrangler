"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { UpgradeAccount } from "@/components/upgrade-account";
import { Header } from "@/app/me/campaigns/page";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { askConfirm } from "@/lib/confirm";
import { friendlyError } from "@/lib/friendly-error";

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
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  // Audit F6: a player can retire a character themselves. Same as the GM's remove on the roster
  // (active = false): it leaves the party everywhere, and its story stays with the campaign. Bringing it
  // back is the GM's call, so there is no un-retire here.
  async function retire(c: Char) {
    if (!await askConfirm(`Retire ${c.name} from ${c.campaign_name}? They leave the party there: Tonight, check-ins, encounters and the roll list. Their story stays with the campaign, and only your GM can bring them back.`, { confirmLabel: "Retire" })) return;
    setNote(null);
    const { data, error } = await supabase.from("characters").update({ active: false }).eq("id", c.character_id).select("id");
    if (error) { setNote({ text: friendlyError(error, "retire them"), bad: true }); return; }
    if (!data || data.length === 0) { setNote({ text: `${c.name} could not be retired from here. Ask your GM.`, bad: true }); return; }
    setRows((rs) => rs.map((r) => (r.character_id === c.character_id ? { ...r, active: false } : r)));
    setNote({ text: `${c.name} is retired from ${c.campaign_name}.`, bad: false });
  }

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

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, margin: "4px 0 18px", flexWrap: "wrap" }}>
          <span style={{ color: C.muted, fontSize: 13 }}>Open a character&rsquo;s page to write its story, or jump to the Forge to build.</span>
          <a href="/me/forge" style={{
            textDecoration: "none", fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.1em",
            textTransform: "uppercase", color: C.ink, background: SAX.brass,
            borderRadius: 999, padding: "9px 18px", fontWeight: 600,
          }}>
            + New character
          </a>
        </div>
        <p style={{ color: C.muted, fontSize: 13, margin: "-8px 0 18px", textAlign: "right" }}>
          New to D&amp;D? The <a href="/me/quick-build" style={{ color: C.sun }}>quick build</a> makes a level 1 character in three steps.
        </p>

        {note && <p role={note.bad ? "alert" : "status"} style={{ color: note.bad ? C.warn : C.muted, fontSize: 13.5, margin: "0 0 14px" }}>{note.text}</p>}
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
                  borderRadius: FORGE_RADIUS, padding: "14px 18px", marginBottom: 10,
                  opacity: c.active ? 1 : 0.55,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <a href={`/me/characters/${c.character_id}`} style={{ fontFamily: SAX.serif, fontSize: 18, fontWeight: 700, color: C.text, textDecoration: "none" }}>
                    {c.name}
                  </a>
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

                <div style={{ display: "flex", gap: 16, marginTop: 11 }}>
                  <a href={`/me/characters/${c.character_id}`} style={{ fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: SAX.brass, textDecoration: "none" }}>
                    Character page
                  </a>
                  <a href={`/me/sheet?c=${c.character_id}`} style={{ fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: SAX.brass, textDecoration: "none" }}>
                    Sheet
                  </a>
                  <a href={`/me/forge?c=${c.character_id}`} style={{ fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, textDecoration: "none" }}>
                    Forge
                  </a>
                  {c.active && (
                    <button type="button" onClick={() => void retire(c)} style={{ marginLeft: "auto", background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, minHeight: "var(--sax-tap, 0px)" }}>
                      Retire
                    </button>
                  )}
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
  return <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.65 }}>{children}</p>;
}
