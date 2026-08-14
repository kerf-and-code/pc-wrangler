"use client";

import React, { useMemo, useState } from "react";

// Rename the generator's river labels. Each named river maps to one map_features row (the trunk of its
// system), and names are unique per map, so a rename matches on the current name. Saving updates
// map_features.name and refreshes the label drawn on the map.
export default function RiverLabels({
  rivers,
  onRename,
  c,
}: {
  rivers: string[];
  onRename: (oldName: string, newName: string) => void | Promise<void>;
  c: { sun: string; line: string; surface2: string; text: string; muted: string };
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const sorted = useMemo(() => [...rivers].sort((a, b) => a.localeCompare(b)), [rivers]);

  if (!rivers.length) return null;

  const save = async (name: string) => {
    const next = (drafts[name] ?? name).trim();
    if (!next || next === name) return;
    setBusy(name);
    await onRename(name, next);
    setBusy(null);
    setDrafts((d) => { const n = { ...d }; delete n[name]; return n; });
  };

  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, background: c.surface2, color: c.text, border: `1px solid ${c.line}`,
    borderRadius: 6, padding: "4px 7px", fontSize: 12, boxSizing: "border-box",
  };

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
          padding: "5px 8px", borderRadius: 7, cursor: "pointer", border: `1px solid ${c.line}`,
          background: c.surface2, color: c.text, fontSize: 12,
        }}
      >
        <span style={{ color: c.muted, width: 12, fontSize: 11 }}>{open ? "\u25be" : "\u25b8"}</span>
        <span style={{ flex: 1 }}>Rivers</span>
        <span style={{ color: c.muted, fontVariantNumeric: "tabular-nums" }}>{rivers.length}</span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
          {sorted.map((name) => {
            const val = drafts[name] ?? name;
            const changed = !!val.trim() && val.trim() !== name;
            return (
              <div key={name} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  value={val}
                  onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") void save(name); }}
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => void save(name)}
                  disabled={!changed || busy === name}
                  style={{
                    border: `1px solid ${changed ? c.sun : c.line}`, borderRadius: 6, padding: "4px 9px",
                    fontSize: 11.5, cursor: changed && busy !== name ? "pointer" : "default",
                    opacity: changed && busy !== name ? 1 : 0.5,
                    background: changed ? "rgba(200,162,75,0.14)" : "transparent", color: c.text,
                  }}
                >
                  {busy === name ? "\u2026" : "Save"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
