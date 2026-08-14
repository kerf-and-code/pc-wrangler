"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C } from "@/lib/forge-theme";
import { poiIconCategory, POI_ICON_CATEGORIES } from "@/lib/worldmap/poi-icons";

// Phase 4c: edit placed POIs. Rename, set visibility, link a codex entry (pick an existing one or
// mint a new location entry from the marker, the same reverse the regions have), give it an inline
// note for when there is no linked entry, and delete it. The NPC link is added once the characters
// table shape is confirmed. The page owns the POI rows (the canvas needs them); this panel calls
// onPatch/onRemove and the page persists.

type Poi = { id: string; name: string; visibility: string; note: string | null; entry_id: string | null; color: string | null; icon_key: string | null; character_id: string | null; locked: boolean };
type EntryOpt = { id: string; title: string | null };
type PoiPatch = Partial<Pick<Poi, "name" | "visibility" | "note" | "entry_id" | "color" | "character_id" | "locked">>;
const VIS = ["common", "player", "gm", "private"];

export default function PoiPanel({ campaignId, pois, onPatch, onRemove }: {
  campaignId: string;
  pois: Poi[];
  onPatch: (id: string, patch: PoiPatch) => void;
  onRemove: (id: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState<EntryOpt[]>([]);
  const [chars, setChars] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleCat = useCallback((c: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(c)) n.delete(c); else n.add(c); return n; }), []);
  const groups = useMemo(() => {
    const byCat = new Map<string, Poi[]>();
    for (const p of pois) { const cat = poiIconCategory(p.icon_key); const arr = byCat.get(cat); if (arr) arr.push(p); else byCat.set(cat, [p]); }
    const order = [...POI_ICON_CATEGORIES, "Other"];
    return [...byCat.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99)).map(([cat, items]) => ({ cat, items }));
  }, [pois]);

  useEffect(() => {
    let off = false;
    (async () => {
      const [{ data: es }, { data: cs }] = await Promise.all([
        supabase.from("entries").select("id, title").eq("campaign_id", campaignId).in("type", ["location", "lore"]).order("title", { ascending: true }),
        supabase.from("characters").select("id, name").eq("campaign_id", campaignId).order("name", { ascending: true }),
      ]);
      if (!off) { setEntries((es as EntryOpt[]) || []); setChars((cs as { id: string; name: string }[]) || []); }
    })();
    return () => { off = true; };
  }, [supabase, campaignId]);

  const createEntry = useCallback(async (poi: Poi) => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) { setStatus("Not signed in."); return; }
    const ins = await supabase.from("entries").insert({ campaign_id: campaignId, created_by: uid, type: "location", title: poi.name, body: poi.note || "", visibility: "gm" }).select("id, title").single();
    if (ins.error || !ins.data) { setStatus(`Could not create entry: ${ins.error?.message || "unknown"}`); return; }
    const e = ins.data as EntryOpt;
    setEntries((prev) => [...prev, e]);
    onPatch(poi.id, { entry_id: e.id });
    setStatus("Codex entry created and linked");
  }, [supabase, campaignId, onPatch]);

  const field: React.CSSProperties = { background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 6, padding: "5px 7px", fontSize: 12.5, outline: "none", boxSizing: "border-box" };
  const mini: React.CSSProperties = { background: "transparent", border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 8px", fontSize: 11.5, cursor: "pointer", color: C.muted };
  const secLabel: React.CSSProperties = { fontSize: 11, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em", marginBottom: 6 };

  if (pois.length === 0) return <p style={{ fontSize: 12.5, color: C.muted, marginTop: 12 }}>No markers yet. Pick an icon and click the map.</p>;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={secLabel}>MARKERS ({pois.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {groups.map(({ cat, items }) => {
          const open = expanded.has(cat);
          return (
            <div key={cat}>
              <button type="button" onClick={() => toggleCat(cat)}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "5px 8px", borderRadius: 7, cursor: "pointer", border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 12 }}>
                <span style={{ color: C.muted, width: 12, fontSize: 11 }}>{open ? "\u25be" : "\u25b8"}</span>
                <span style={{ flex: 1 }}>{cat}</span>
                <span style={{ color: C.muted, fontVariantNumeric: "tabular-nums" }}>{items.length}</span>
              </button>
              {open && (
                <div style={{ display: "grid", gap: 8, margin: "6px 0 4px" }}>
                  {items.map((p) => (
          <div key={p.id} style={{ border: `1px solid ${C.line}`, borderRadius: 7, padding: 8, background: C.surface2, display: "grid", gap: 6 }}>
            <input value={p.name} onChange={(e) => onPatch(p.id, { name: e.target.value })} style={{ ...field, width: "100%" }} />
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select value={p.visibility} onChange={(e) => onPatch(p.id, { visibility: e.target.value })} style={{ ...field, flex: "0 0 auto" }}>
                {VIS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={p.entry_id || ""} onChange={(e) => onPatch(p.id, { entry_id: e.target.value || null })} style={{ ...field, flex: "1 1 130px" }}>
                <option value="">No codex entry</option>
                {entries.map((en) => <option key={en.id} value={en.id}>{en.title || "(untitled)"}</option>)}
              </select>
              <select value={p.character_id || ""} onChange={(e) => onPatch(p.id, { character_id: e.target.value || null })} style={{ ...field, flex: "1 1 130px" }}>
                <option value="">No linked character</option>
                {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {p.icon_key && (
                <>
                  <input type="color" value={p.color || "#e6d8b5"} onChange={(e) => onPatch(p.id, { color: e.target.value })} title="Marker colour"
                    style={{ width: 30, height: 28, padding: 0, border: `1px solid ${C.line}`, borderRadius: 6, background: C.surface2, cursor: "pointer", flex: "0 0 auto" }} />
                  {p.color && <button type="button" onClick={() => onPatch(p.id, { color: null })} style={mini}>auto</button>}
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {!p.entry_id && <button type="button" onClick={() => createEntry(p)} style={mini}>+ Add to codex</button>}
              <button type="button" onClick={() => onPatch(p.id, { locked: !p.locked })} title={p.locked ? "Unlock to move" : "Lock so it won't drag"}
                style={{ ...mini, borderColor: p.locked ? C.sun : C.line, color: p.locked ? C.sun : C.muted }}>{p.locked ? "Locked" : "Lock"}</button>
              <button type="button" onClick={() => onRemove(p.id)} style={mini}>Delete</button>
            </div>
            {!p.entry_id && (
              <textarea value={p.note || ""} onChange={(e) => onPatch(p.id, { note: e.target.value })} placeholder="Short note (shown if there is no linked entry)" rows={2} style={{ ...field, width: "100%", resize: "vertical" }} />
            )}
          </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {status && <p style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>{status}</p>}
    </div>
  );
}
