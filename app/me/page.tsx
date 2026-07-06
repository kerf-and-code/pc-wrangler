"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";

const C = { surface: SAX.slateBg, line: SAX.line, text: SAX.text, muted: SAX.muted, sun: SAX.sun, plum: SAX.plum, good: SAX.good };

const AXES = ["N", "T", "O", "S", "E", "I"] as const;
type Axis = typeof AXES[number];
const TAVERN: Record<Axis, string> = { N: "Voice", T: "Tactics", O: "Arcana", S: "Rapport", E: "Exploration", I: "Nerve" };
const AXIS_COLOR: Record<Axis, string> = { N: "#B7615A", T: "#C8A24B", O: "#4E8077", S: "#CE8A42", E: "#6C76B0", I: "#9A93B0" };

type Journal = {
  character: { id: string; name: string } | null;
  posterior: Partial<Record<Axis, number>> | null;
  beats: { n: number | null; summary: string; kind: string; who: string }[];
};
type LoreItem = { item_kind: string; item_type: string; id: string; title: string; body: string | null };

export default function PlayerJournalPage() {
  const supabase = useMemo(() => createClient(), []);
  const [journal, setJournal] = useState<Journal | null>(null);
  const [lore, setLore] = useState<LoreItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unclaimed" | "invalid">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      const share = new URLSearchParams(window.location.search).get("share");
      if (!share) { if (active) setStatus("invalid"); return; }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) { if (active) setStatus("invalid"); return; }
      }

      const [{ data: j }, { data: l }] = await Promise.all([
        supabase.rpc("player_journal", { p_share: share }),
        supabase.rpc("codex_for_player", { p_share: share }),
      ]);
      if (!active) return;
      const jj = (j as Journal | null) || null;
      setLore((l as LoreItem[]) || []);
      if (!jj || !jj.character) { setStatus("unclaimed"); return; }
      setJournal(jj);
      setStatus("ready");
    })();
    return () => { active = false; };
  }, [supabase]);

  const eyebrow = { fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase" as const, color: C.muted };
  const sectionTitle = { fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 20, fontWeight: 700, color: C.text, margin: "32px 0 12px" };
  const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 18px", marginBottom: 10 };

  const post = journal?.posterior || null;
  const hasPost = post && AXES.some((a) => typeof post[a] === "number");
  const learned = lore.filter((it) => it.item_type !== "note");

  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 640, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <span style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 26, fontWeight: 700 }}>
            {journal?.character ? journal.character.name : "Your journal"}
          </span>
        </div>
        <div style={{ ...eyebrow, textAlign: "center", marginBottom: 18 }}>YOUR STORY SO FAR</div>
        <div style={{ height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${C.sun}, ${C.plum})`, marginBottom: 24 }} />

        {status === "loading" && <p style={{ textAlign: "center", color: C.muted, fontSize: 14 }}>Loading&hellip;</p>}
        {status === "invalid" && <p style={{ textAlign: "center", color: C.muted, fontSize: 14 }}>This link looks broken. Ask your GM for your invite link.</p>}
        {status === "unclaimed" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            Claim your character with the personal invite link your GM sent, and your story will gather here.
          </p>
        )}

        {status === "ready" && journal && (
          <>
            {/* how you actually play — the posterior */}
            <div style={sectionTitle}>How you actually play</div>
            {hasPost ? (
              <div style={card}>
                <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
                  Drawn from your logged sessions, not your inventory answers. This is how you show up at the table.
                </div>
                {AXES.map((ax) => {
                  const v = typeof post![ax] === "number" ? (post![ax] as number) : null;
                  return (
                    <div key={ax} style={{ marginBottom: 9 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                        <span style={{ color: C.text }}>{TAVERN[ax]}</span>
                        <span style={{ fontFamily: "ui-monospace, monospace", color: C.muted }}>{v == null ? "—" : `${Math.round(v * 100)}`}</span>
                      </div>
                      <div style={{ height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(v ?? 0) * 100}%`, background: AXIS_COLOR[ax], transition: "width .3s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ ...card, color: C.muted, fontSize: 13.5, lineHeight: 1.6 }}>
                Not enough logged play yet to read how you play. After a session or two, your six axes will appear here.
              </div>
            )}

            {/* your moments */}
            <div style={sectionTitle}>Your moments</div>
            {journal.beats.length === 0 ? (
              <div style={{ ...card, color: C.muted, fontSize: 13.5 }}>Nothing logged yet. Your beats will gather here as you play.</div>
            ) : (
              journal.beats.map((b, i) => (
                <div key={i} style={{ ...card, display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: C.muted, whiteSpace: "nowrap", marginTop: 2 }}>
                    {b.n != null ? `S${b.n}` : "—"}
                  </span>
                  <span style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>{b.summary}</span>
                </div>
              ))
            )}

            {/* what you've learned */}
            {learned.length > 0 && (
              <>
                <div style={sectionTitle}>What you&rsquo;ve learned</div>
                {learned.map((it) => (
                  <div key={it.id} style={card}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: it.body ? 5 : 0 }}>{it.title}</div>
                    {it.body && <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{it.body}</div>}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
