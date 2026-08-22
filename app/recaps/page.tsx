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
  // Which sessions are collapsed. Default is expanded (empty set), so the page reads top to bottom;
  // a reader collapses the ones they have already read to find a particular session faster.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const shareCode = params.get("share");
      if (!shareCode) { if (active) setStatus("invalid"); return; }

      const { data: { user } } = await supabase.auth.getUser();
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

  // Session 1 at the top, then 2, 3... regardless of the order the RPC returns. Unnumbered sessions
  // sort to the end rather than jumping to the front.
  const ordered = useMemo(
    () => [...recaps].sort((a, b) => (a.session_number ?? Infinity) - (b.session_number ?? Infinity)),
    [recaps],
  );

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(ordered.map((r) => r.session_id)));

  const eyebrow = {
    fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.22em",
    textTransform: "uppercase" as const, color: C.muted,
  };

  const recapCard = {
    background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
    marginBottom: 16, textAlign: "left" as const, overflow: "hidden" as const,
  };
  const headerBtn: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%",
    background: "transparent", border: "none", cursor: "pointer", padding: "16px 24px", textAlign: "left",
  };
  const miniBtn: React.CSSProperties = {
    background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: 7,
    padding: "5px 10px", fontSize: 11.5, cursor: "pointer", fontFamily: "ui-monospace, monospace",
    letterSpacing: "0.06em", textTransform: "uppercase",
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

        {status === "ready" && (
          <>
            {ordered.length > 1 && (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12 }}>
                <button type="button" onClick={expandAll} style={miniBtn}>Expand all</button>
                <button type="button" onClick={collapseAll} style={miniBtn}>Collapse all</button>
              </div>
            )}

            {ordered.map((r) => {
              const isCollapsed = collapsed.has(r.session_id);
              const bodyId = `recap-body-${r.session_id}`;
              return (
                <div key={r.session_id} style={recapCard}>
                  <button
                    type="button"
                    onClick={() => toggle(r.session_id)}
                    aria-expanded={!isCollapsed}
                    aria-controls={bodyId}
                    style={headerBtn}
                  >
                    <span style={{ ...eyebrow, color: C.sun }}>Session {r.session_number ?? "?"}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      {isCollapsed && (
                        <span style={{
                          color: C.muted, fontSize: 13, maxWidth: 320, whiteSpace: "nowrap",
                          overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {r.recap}
                        </span>
                      )}
                      <span aria-hidden style={{ color: C.muted, fontSize: 13, flexShrink: 0 }}>
                        {isCollapsed ? "▸" : "▾"}
                      </span>
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div id={bodyId} style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 15, color: C.text, padding: "0 24px 20px" }}>
                      {r.recap}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </PageShell>
  );
}
