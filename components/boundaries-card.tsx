"use client";

// GM boundaries card. Aggregates the table's lines and veils from tpdi_responses
// for one campaign. Lines/veils are pooled and de-duplicated (the GM sees the
// combined list, not who said what); free-text notes are shown with the player's
// name because acting on them usually needs to know who to talk to.

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SAX } from "@/lib/theme";

const C = {
  surface: SAX.slateBg, surface2: "rgba(11,7,18,0.6)", line: SAX.line,
  text: SAX.text, muted: SAX.muted, brass: SAX.brass, plum: "#6C76B0", warn: SAX.warn,
};

type SafetyRow = { player_name: string | null; safety: { lines?: string[]; veils?: string[]; note?: string | null } | null };

function pool(rows: SafetyRow[], key: "lines" | "veils"): { item: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const items = r.safety?.[key];
    if (!Array.isArray(items)) continue;
    for (const raw of items) {
      const item = String(raw).trim();
      if (!item) continue;
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([item, count]) => ({ item, count }))
    .sort((a, b) => b.count - a.count || a.item.localeCompare(b.item));
}

export default function BoundariesCard({ campaignId }: { campaignId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SafetyRow[] | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("tpdi_responses")
        .select("player_name, safety")
        .eq("campaign_id", campaignId);
      if (!active) return;
      setRows(((data as SafetyRow[]) || []).filter((r) => r.safety));
    })();
    return () => { active = false; };
  }, [campaignId, supabase]);

  const lines = rows ? pool(rows, "lines") : [];
  const veils = rows ? pool(rows, "veils") : [];
  const notes = (rows ?? []).filter((r) => r.safety?.note && r.safety.note.trim());
  const responded = rows?.length ?? 0;

  const chip = (item: string, count: number, accent: string) => (
    <span key={item} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, background: C.surface2, border: `1px solid ${accent}55`, borderRadius: 999, padding: "6px 12px" }}>
      {item}
      {count > 1 && <span style={{ fontSize: 11, color: C.muted, fontFamily: "ui-monospace, monospace" }}>x{count}</span>}
    </span>
  );

  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ color: C.brass, fontSize: 16, margin: 0 }}>Table boundaries</h2>
        <span style={{ fontSize: 12, color: C.muted }}>{responded} response{responded === 1 ? "" : "s"}</span>
      </div>
      <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.5, margin: "6px 0 14px" }}>
        The table&apos;s combined lines and veils, pooled so you see the boundaries without who set them. Keep this in view when you prep and when you run.
      </p>

      {rows === null ? (
        <div style={{ color: C.muted, fontSize: 13 }}>Loading...</div>
      ) : responded === 0 ? (
        <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
          No safety responses yet. Players set their lines and veils when they take the TAVERN inventory from their session link.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.warn, marginBottom: 3 }}>Lines</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>hard no, never at the table</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {lines.length ? lines.map((l) => chip(l.item, l.count, C.warn)) : <span style={{ color: C.muted, fontSize: 13 }}>None set.</span>}
            </div>
          </div>

          <div style={{ marginBottom: notes.length ? 14 : 0 }}>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.plum, marginBottom: 3 }}>Veils</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>allowed, but off screen</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {veils.length ? veils.map((v) => chip(v.item, v.count, C.plum)) : <span style={{ color: C.muted, fontSize: 13 }}>None set.</span>}
            </div>
          </div>

          {notes.length > 0 && (
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, marginBottom: 8 }}>
                Notes to you (private)
              </div>
              {notes.map((n, i) => (
                <div key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.5, marginBottom: 8 }}>
                  <span style={{ color: C.brass, fontWeight: 600 }}>{n.player_name?.trim() || "A player"}:</span>{" "}
                  {n.safety?.note}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
