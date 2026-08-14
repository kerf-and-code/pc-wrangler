"use client";

import React from "react";

export type LabelRow = { id: string; x: number; y: number; text: string; size: number; color: string | null };
export type LabelPatch = Partial<Pick<LabelRow, "text" | "size" | "color">>;

// Free-floating text labels the GM places to name areas (mountain ranges, seas, deserts). Independent
// of regions and POIs: place one, then drag it on the map and edit its text/size/colour here.
export default function LabelPanel({
  labels,
  placing,
  onArm,
  onPatch,
  onRemove,
  c,
}: {
  labels: LabelRow[];
  placing: boolean;
  onArm: () => void;
  onPatch: (id: string, patch: LabelPatch) => void;
  onRemove: (id: string) => void;
  c: { sun: string; line: string; surface2: string; text: string; muted: string };
}) {
  const field: React.CSSProperties = {
    background: c.surface2, color: c.text, border: `1px solid ${c.line}`, borderRadius: 6,
    padding: "5px 7px", fontSize: 12.5, outline: "none", boxSizing: "border-box",
  };
  const mini: React.CSSProperties = {
    background: "transparent", border: `1px solid ${c.line}`, borderRadius: 6, padding: "3px 8px",
    fontSize: 11.5, cursor: "pointer", color: c.muted,
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.5, color: c.muted, marginBottom: 6 }}>AREA LABELS ({labels.length})</div>
      <button
        type="button"
        onClick={onArm}
        style={{
          display: "block", width: "100%", textAlign: "center", padding: "7px 9px", borderRadius: 7,
          cursor: "pointer", fontSize: 12.5, fontWeight: 600,
          border: `1px solid ${placing ? c.sun : c.line}`,
          background: placing ? "rgba(200,162,75,0.16)" : c.surface2, color: c.text,
        }}
      >
        {placing ? "Click the map to place the label\u2026" : "+ Add area label"}
      </button>

      {labels.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {labels.map((lb) => (
            <div key={lb.id} style={{ border: `1px solid ${c.line}`, borderRadius: 7, padding: 8, background: c.surface2, display: "grid", gap: 6 }}>
              <input
                value={lb.text}
                onChange={(e) => onPatch(lb.id, { text: e.target.value })}
                placeholder="Area name"
                style={{ ...field, width: "100%" }}
              />
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 11.5, color: c.muted }}>Size</label>
                <select value={lb.size} onChange={(e) => onPatch(lb.id, { size: Number(e.target.value) })} style={{ ...field, flex: "0 0 auto" }}>
                  {[14, 18, 24, 32, 44, 60].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <input type="color" value={lb.color || "#f2e9d6"} onChange={(e) => onPatch(lb.id, { color: e.target.value })} title="Label colour"
                  style={{ width: 30, height: 28, padding: 0, border: `1px solid ${c.line}`, borderRadius: 6, background: c.surface2, cursor: "pointer", flex: "0 0 auto" }} />
                {lb.color && <button type="button" onClick={() => onPatch(lb.id, { color: null })} style={mini}>auto</button>}
                <button type="button" onClick={() => onRemove(lb.id)} style={{ ...mini, marginLeft: "auto" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
