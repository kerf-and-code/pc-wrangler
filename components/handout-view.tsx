"use client";

// components/handout-view.tsx (2026-11-07)
//
// Phase 4d: a handout on the tabletop. A handout is a wiki entry the GM showed from the table
// (tabletop_show_handout, p113), so this draws an entry the way the wiki does in brief: its title, its
// image, the summary, and the blocks (text, headings, images), or the plain body when the entry has no
// blocks yet. It pops up when the GM shows it and opens again from the Handouts tab.

import React, { useEffect, useRef } from "react";
import { C } from "@/lib/forge-theme";

export type HandoutBlock =
  | { id?: string; type: "text"; text: string }
  | { id?: string; type: "header"; text: string }
  | { id?: string; type: "image"; url: string; caption?: string };

export type Handout = {
  id: string; entryId: string; title: string; type?: string | null; summary?: string | null; body?: string | null;
  blocks?: HandoutBlock[] | null; imageUrl?: string | null; shownAt: string; shownTo?: string[] | null;
};

export function HandoutBody({ h }: { h: Handout }) {
  const blocks = Array.isArray(h.blocks) ? h.blocks.filter((b) => b && typeof b === "object") : [];
  const serif = "'EB Garamond','Iowan Old Style',Georgia,serif";
  return (
    <div style={{ fontFamily: serif, color: "#ece4d6", fontSize: 17, lineHeight: 1.7 }}>
      {h.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={h.imageUrl} alt="" style={{ display: "block", maxWidth: "100%", maxHeight: 360, margin: "0 auto 14px", borderRadius: 8, border: "1px solid #3a332a" }} />
      )}
      {h.summary && <p style={{ fontStyle: "italic", color: "#cbbfa6", margin: "0 0 12px" }}>{h.summary}</p>}
      {blocks.length ? blocks.map((b, i) => {
        if (b.type === "header") return <h3 key={b.id ?? i} style={{ fontFamily: "'Cinzel','EB Garamond',serif", fontSize: 20, margin: "14px 0 6px", fontWeight: 600 }}>{b.text}</h3>;
        if (b.type === "image") return (
          <figure key={b.id ?? i} style={{ margin: "10px 0" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.url} alt={b.caption ?? ""} style={{ display: "block", maxWidth: "100%", borderRadius: 8, border: "1px solid #3a332a" }} />
            {b.caption && <figcaption style={{ fontSize: 13, color: "#a99e86", fontStyle: "italic", marginTop: 4 }}>{b.caption}</figcaption>}
          </figure>
        );
        return <p key={b.id ?? i} style={{ margin: "0 0 10px", whiteSpace: "pre-wrap" }}>{b.text}</p>;
      }) : h.body ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{h.body}</p> : null}
    </div>
  );
}

export default function HandoutView({ h, onClose }: { h: Handout; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { closeRef.current?.focus(); }, [h.id]);
  return (
    <div role="dialog" aria-modal="true" aria-label={`Handout: ${h.title}`} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(8,6,4,0.72)", display: "grid", placeItems: "center", zIndex: 60, padding: 16 }}>
      <div style={{ background: "#1f1a15", border: "1px solid #3a332a", borderRadius: 12, width: "min(680px, 100%)", maxHeight: "100%", overflow: "auto", padding: "18px 22px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
          <span style={{ fontFamily: "'IBM Plex Mono',ui-monospace,monospace", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "#8a7038" }}>Handout</span>
          <span style={{ flex: 1 }} />
          <button ref={closeRef} type="button" onClick={onClose} style={{ padding: "4px 10px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Close</button>
        </div>
        <h2 style={{ fontFamily: "'Cinzel','EB Garamond',serif", fontSize: 28, lineHeight: 1.15, margin: "0 0 12px", color: "#ece4d6", fontWeight: 600 }}>{h.title}</h2>
        <HandoutBody h={h} />
      </div>
    </div>
  );
}
