"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C } from "@/lib/forge-theme";
import { POI_ICONS, POI_ICON_SVG, POI_ICON_CATEGORIES, type PoiIcon } from "@/lib/worldmap/poi-icons";

// Phase 4 icons: browse the 169 built-in POI icons (searchable; rendered inline so they tint) and
// upload/manage personal SVG icons against a ~1 MB per-campaign budget. Personal icons render as
// <img> for safety. This is the library; placing an icon as a POI on the map is the next step.

type PersonalIcon = { id: string; key: string; label: string; url: string; bytes: number };
const BUDGET = 1024 * 1024;

export default function IconLibrary({ campaignId, onPick, builtinOnly }: { campaignId: string; onPick?: (icon: { key: string } | { iconId: string; url: string }) => void; builtinOnly?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [personal, setPersonal] = useState<PersonalIcon[]>([]);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleCat = useCallback((c: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(c)) n.delete(c); else n.add(c); return n; }), []);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    if (!campaignId || builtinOnly) return;
    const { data } = await supabase.from("map_icons").select("id, key, label, url, bytes").eq("campaign_id", campaignId).order("created_at", { ascending: true });
    setPersonal((data as PersonalIcon[]) || []);
  }, [supabase, campaignId, builtinOnly]);
  useEffect(() => { void load(); }, [load]);

  const used = useMemo(() => personal.reduce((a, i) => a + (i.bytes || 0), 0), [personal]);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const byCat = new Map<string, PoiIcon[]>();
    for (const i of POI_ICONS) {
      if (s && !(i.label.toLowerCase().includes(s) || i.key.includes(s))) continue;
      const arr = byCat.get(i.category); if (arr) arr.push(i); else byCat.set(i.category, [i]);
    }
    return POI_ICON_CATEGORIES.map((c) => ({ cat: c, icons: byCat.get(c) || [] })).filter((g) => g.icons.length);
  }, [q]);
  const totalShown = useMemo(() => groups.reduce((n, g) => n + g.icons.length, 0), [groups]);

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !campaignId) return;
    setStatus("Uploading\u2026");
    const form = new FormData();
    form.append("campaignId", campaignId);
    form.append("file", f);
    const res = await fetch("/api/world-map/icon", { method: "POST", body: form });
    const data = (await res.json().catch(() => ({}))) as { icon?: PersonalIcon; error?: string };
    if (!res.ok || !data.icon) { setStatus(data.error || "Upload failed."); return; }
    setPersonal((prev) => [...prev, data.icon as PersonalIcon]);
    setStatus("Icon added");
  }, [campaignId]);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("map_icons").delete().eq("id", id);
    if (error) { setStatus(error.message); return; }
    setPersonal((prev) => prev.filter((i) => i.id !== id));
  }, [supabase]);

  const secLabel: React.CSSProperties = { fontSize: 11, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em", marginBottom: 6 };
  const cell: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", aspectRatio: "1", border: `1px solid ${C.line}`, borderRadius: 7, background: C.surface2, color: "#f2e9d6", padding: 6 };

  return (
    <div>
      <style>{`.poi-ico svg { width: 100%; height: 100%; display: block; }`}</style>

      {!builtinOnly && (<>
      <div style={secLabel}>YOUR ICONS</div>
      <div style={{ height: 6, borderRadius: 3, background: C.surface2, border: `1px solid ${C.line}`, overflow: "hidden", marginBottom: 4 }}>
        <div style={{ width: `${Math.min(100, (used / BUDGET) * 100)}%`, height: "100%", background: used > BUDGET * 0.9 ? "#b4552f" : C.sun }} />
      </div>
      <p style={{ fontSize: 11, color: C.muted, margin: "0 0 8px" }}>{Math.round(used / 1024)} KB of 1 MB used</p>
      <label style={{ display: "block", textAlign: "center", padding: "7px 9px", borderRadius: 7, cursor: "pointer", border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 12.5, fontWeight: 600 }}>
        Upload an SVG icon
        <input type="file" accept="image/svg+xml,.svg" onChange={onFile} style={{ display: "none" }} />
      </label>
      {personal.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 8 }}>
          {personal.map((i) => (
            <div key={i.id} style={{ position: "relative" }} title={i.label}>
              <div style={{ ...cell, cursor: onPick ? "pointer" : "default" }} onClick={() => onPick?.({ iconId: i.id, url: i.url })}><img src={i.url} alt={i.label} style={{ width: "100%", height: "100%", objectFit: "contain" }} /></div>
              <button type="button" onClick={() => remove(i.id)} title="Remove"
                style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, color: C.muted, fontSize: 11, lineHeight: "16px", cursor: "pointer", padding: 0 }}>x</button>
            </div>
          ))}
        </div>
      )}
      {status && <p style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>{status}</p>}
      </>)}

      <div style={{ ...secLabel, marginTop: 16 }}>BUILT-IN ICONS ({totalShown})</div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons\u2026"
        style={{ width: "100%", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 8px", fontSize: 12.5, marginBottom: 8, boxSizing: "border-box" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {groups.map(({ cat: c, icons }) => {
          const open = !!q.trim() || expanded.has(c); // a search auto-expands every matching category
          return (
            <div key={c}>
              <button type="button" onClick={() => toggleCat(c)}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "5px 8px", borderRadius: 7, cursor: "pointer", border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 12 }}>
                <span style={{ color: C.muted, width: 12, fontSize: 11 }}>{open ? "\u25be" : "\u25b8"}</span>
                <span style={{ flex: 1 }}>{c}</span>
                <span style={{ color: C.muted, fontVariantNumeric: "tabular-nums" }}>{icons.length}</span>
              </button>
              {open && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, margin: "6px 0 4px" }}>
                  {icons.map((i) => (
                    <div key={i.key} className="poi-ico" style={{ ...cell, cursor: onPick ? "pointer" : "default" }} title={i.label} onClick={() => onPick?.({ key: i.key })} dangerouslySetInnerHTML={{ __html: POI_ICON_SVG[i.key] || "" }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {groups.length === 0 && <p style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>No icons match.</p>}
    </div>
  );
}
