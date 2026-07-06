"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";

const C = { surface: SAX.slateBg, line: SAX.line, text: SAX.text, muted: SAX.muted, sun: SAX.sun, plum: SAX.plum, good: SAX.good, warn: SAX.warn };

type Content = {
  campaign: string;
  chronicle: string;
  arcs: { title: string; status: string }[];
  loot: { character: string; items: string[] }[];
  dice: { character: string; nat20: number; nat1: number }[];
  cast: { name: string; description: string | null }[];
  sessions: number;
  generated_at: string;
};

export default function CampaignJournalPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams();
  const share = (Array.isArray(params?.share) ? params.share[0] : params?.share) as string | undefined;
  const [content, setContent] = useState<Content | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "invalid">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      if (!share) { if (active) setStatus("invalid"); return; }
      const { data } = await supabase.rpc("journal_for_share", { p_share: share });
      if (!active) return;
      const c = (data as Content | null) || null;
      if (c && c.chronicle) { setContent(c); setStatus("ready"); }
      else setStatus("empty");
    })();
    return () => { active = false; };
  }, [supabase, share]);

  const eyebrow = { fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase" as const, color: C.muted };
  const sectionTitle = { fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 20, fontWeight: 700, color: C.text, margin: "32px 0 12px" };
  const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 18px", marginBottom: 10 };

  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 680, margin: "0 auto" }}>
        {status === "loading" && <p style={{ textAlign: "center", color: C.muted, fontSize: 14 }}>Loading&hellip;</p>}
        {status === "invalid" && <p style={{ textAlign: "center", color: C.muted, fontSize: 14 }}>This link looks broken.</p>}
        {status === "empty" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            No chronicle yet. Once the GM assembles the journal, the tale of the campaign will live here.
          </p>
        )}

        {status === "ready" && content && (
          <>
            <div style={{ textAlign: "center", marginBottom: 4 }}>
              <span style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 30, fontWeight: 700 }}>{content.campaign}</span>
            </div>
            <div style={{ ...eyebrow, textAlign: "center", marginBottom: 18 }}>A CHRONICLE {"\u00b7"} {content.sessions} SESSION{content.sessions === 1 ? "" : "S"}</div>
            <div style={{ height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${C.sun}, ${C.plum})`, marginBottom: 28 }} />

            {content.chronicle.split(/\n{2,}/).map((para, i) => (
              <p key={i} style={{ fontSize: 16, lineHeight: 1.8, color: C.text, margin: "0 0 16px", whiteSpace: "pre-wrap" }}>{para.trim()}</p>
            ))}

            {content.arcs.length > 0 && (
              <>
                <div style={sectionTitle}>Story arcs</div>
                {content.arcs.map((a, i) => (
                  <div key={i} style={card}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{a.title}</span>
                    <span style={{ fontSize: 12, color: a.status === "resolved" ? C.good : C.muted, marginLeft: 10, fontFamily: "ui-monospace, monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>{a.status}</span>
                  </div>
                ))}
              </>
            )}

            {content.dice.length > 0 && (
              <>
                <div style={sectionTitle}>Legends of the dice</div>
                {content.dice.map((d, i) => (
                  <div key={i} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{d.character}</span>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                      <span style={{ color: C.good }}>{d.nat20} nat 20{d.nat20 === 1 ? "" : "s"}</span>
                      <span style={{ color: C.muted }}>{"  \u00b7  "}</span>
                      <span style={{ color: C.warn }}>{d.nat1} nat 1{d.nat1 === 1 ? "" : "s"}</span>
                    </span>
                  </div>
                ))}
              </>
            )}

            {content.loot.length > 0 && (
              <>
                <div style={sectionTitle}>The ledger</div>
                {content.loot.map((l, i) => (
                  <div key={i} style={card}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>{l.character}</div>
                    <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6 }}>{l.items.join(", ")}</div>
                  </div>
                ))}
              </>
            )}

            {content.cast.length > 0 && (
              <>
                <div style={sectionTitle}>The cast</div>
                {content.cast.map((n, i) => (
                  <div key={i} style={card}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: n.description ? 4 : 0 }}>{n.name}</div>
                    {n.description && <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{n.description}</div>}
                  </div>
                ))}
              </>
            )}

            <div style={{ ...eyebrow, textAlign: "center", marginTop: 36, opacity: 0.7 }}>ASSEMBLED BY SIX AXES</div>
          </>
        )}
      </div>
    </PageShell>
  );
}
