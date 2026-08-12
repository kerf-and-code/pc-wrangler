"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C } from "@/lib/forge-theme";

// Phase 4c: edit placed POIs. Rename, set visibility, link a codex entry (pick an existing one or
// mint a new location entry from the marker, the same reverse the regions have), give it an inline
// note for when there is no linked entry, and delete it. The NPC link is added once the characters
// table shape is confirmed. The page owns the POI rows (the canvas needs them); this panel calls
// onPatch/onRemove and the page persists.

type Poi = { id: string; name: string; visibility: string; note: string | null; entry_id: string | null };
type EntryOpt = { id: string; title: string | null };
type PoiPatch = Partial<Pick<Poi, "name" | "visibility" | "note" | "entry_id">>;
const VIS = ["common", "player", "gm", "private"];

export default function PoiPanel({ campaignId, pois, onPatch, onRemove }: {
  campaignId: string;
  pois: Poi[];
  onPatch: (id: string, patch: PoiPatch) => void;
  onRemove: (id: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState<EntryOpt[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let off = false;
    (async () => {
      const { data } = await supabase.from("entries").select("id, title").eq("campaign_id", campaignId).in("type", ["location", "lore"]).order("title", { ascending: true });
      if (!off) setEntries((data as EntryOpt[]) || []);
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
      <div style={{ display: "grid", gap: 8 }}>
        {pois.map((p) => (
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
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {!p.entry_id && <button type="button" onClick={() => createEntry(p)} style={mini}>+ Add to codex</button>}
              <button type="button" onClick={() => onRemove(p.id)} style={mini}>Delete</button>
            </div>
            {!p.entry_id && (
              <textarea value={p.note || ""} onChange={(e) => onPatch(p.id, { note: e.target.value })} placeholder="Short note (shown if there is no linked entry)" rows={2} style={{ ...field, width: "100%", resize: "vertical" }} />
            )}
          </div>
        ))}
      </div>
      {status && <p style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>{status}</p>}
    </div>
  );
}
