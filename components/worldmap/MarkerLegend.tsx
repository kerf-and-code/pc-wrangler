"use client";

import React, { useState } from "react";

type Marker = { id: string; name: string };
export type MarkerGroup = { category: string; markers: Marker[] };

// A grouped, collapsible legend of the map's markers. A master toggle hides every marker; each
// category has its own show/hide toggle and a count, and expands to list its markers (click to jump).
export default function MarkerLegend({
  groups,
  markersHidden,
  hiddenCategories,
  onToggleAll,
  onToggleCategory,
  onSelectMarker,
  c,
}: {
  groups: MarkerGroup[];
  markersHidden: boolean;
  hiddenCategories: Set<string>;
  onToggleAll: () => void;
  onToggleCategory: (category: string) => void;
  onSelectMarker?: (id: string) => void;
  c: { sun: string; line: string; surface2: string; text: string; muted: string };
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const total = groups.reduce((n, g) => n + g.markers.length, 0);
  const toggleExpand = (cat: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(cat)) s.delete(cat); else s.add(cat);
      return s;
    });

  if (!groups.length) return <p style={{ fontSize: 11.5, color: c.muted, margin: "10px 0 0" }}>No markers yet.</p>;

  return (
    <div style={{ fontSize: 12, color: c.text, marginTop: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.5, color: c.muted, marginBottom: 6 }}>MARKERS</div>
      <button
        type="button"
        onClick={onToggleAll}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
          padding: "6px 9px", borderRadius: 7, cursor: "pointer", fontWeight: 700,
          border: `1px solid ${markersHidden ? c.line : c.sun}`,
          background: markersHidden ? c.surface2 : "rgba(200,162,75,0.14)", color: c.text,
        }}
      >
        <span>All markers ({total})</span>
        <span style={{ color: markersHidden ? c.muted : c.sun }}>{markersHidden ? "Hidden" : "Shown"}</span>
      </button>

      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
        {groups.map((g) => {
          const hidden = markersHidden || hiddenCategories.has(g.category);
          const isOpen = expanded.has(g.category);
          return (
            <div key={g.category} style={{ border: `1px solid ${c.line}`, borderRadius: 7, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", background: c.surface2 }}>
                <button
                  type="button"
                  onClick={() => toggleExpand(g.category)}
                  aria-label={isOpen ? "Collapse" : "Expand"}
                  style={{ background: "none", border: "none", color: c.muted, cursor: "pointer", padding: 0, width: 14, fontSize: 11 }}
                >
                  {isOpen ? "\u25be" : "\u25b8"}
                </button>
                <span style={{ flex: 1, opacity: hidden ? 0.5 : 1 }}>{g.category}</span>
                <span style={{ color: c.muted, fontVariantNumeric: "tabular-nums" }}>{g.markers.length}</span>
                <button
                  type="button"
                  onClick={() => onToggleCategory(g.category)}
                  disabled={markersHidden}
                  title={hidden ? "Show this category" : "Hide this category"}
                  style={{
                    border: `1px solid ${hidden ? c.line : c.sun}`, borderRadius: 5, padding: "1px 8px", fontSize: 11,
                    cursor: markersHidden ? "default" : "pointer", opacity: markersHidden ? 0.4 : 1,
                    background: hidden ? "transparent" : "rgba(200,162,75,0.14)", color: c.text,
                  }}
                >
                  {hidden ? "Off" : "On"}
                </button>
              </div>
              {isOpen && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {g.markers.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelectMarker?.(m.id)}
                      style={{
                        textAlign: "left", padding: "3px 8px 3px 28px", background: "none", border: "none",
                        borderTop: `1px solid ${c.line}`, color: c.text, cursor: onSelectMarker ? "pointer" : "default",
                        fontSize: 11, opacity: hidden ? 0.5 : 0.85,
                      }}
                    >
                      {m.name || "(unnamed)"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
