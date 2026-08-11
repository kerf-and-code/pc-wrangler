"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C } from "@/lib/forge-theme";

// Phase 2b: define the tiers (map_layers) and CRUD the regions. A region sits at one tier, may nest
// inside a parent one tier UP, points at a codex entry (pick an existing one, or mint a new location
// entry from here), and carries visibility. Painting hexes into a region is 2c; drawing them is 2d.
// Concrete supabase access throughout (the shape that builds green). GM-owned by the p47 RLS.

type Layer = { id: string; name: string; ord: number };
type EntryOpt = { id: string; title: string | null };
type Region = {
  id: string; layer_id: string; name: string;
  parent_region_id: string | null; entry_id: string | null; visibility: string; tint: string | null;
};
type RegionPatch = Partial<Pick<Region, "name" | "parent_region_id" | "entry_id" | "visibility" | "tint">>;

const LAYER_COLS = "id, name, ord";
const REGION_COLS = "id, layer_id, name, parent_region_id, entry_id, visibility, tint";
const VIS = ["common", "player", "gm", "private"];

export default function RegionsPanel({ worldMapId, campaignId, onChanged, onPaintState }: {
  worldMapId: string;
  campaignId: string;
  onChanged?: () => void;
  onPaintState?: (regionId: string | null, erase: boolean) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [entries, setEntries] = useState<EntryOpt[]>([]);
  const [status, setStatus] = useState<string>("");
  const [paintId, setPaintId] = useState<string | null>(null);
  const [erase, setErase] = useState<boolean>(false);

  const load = useCallback(async () => {
    if (!worldMapId) return;
    const [{ data: ls }, { data: rs }, { data: es }] = await Promise.all([
      supabase.from("map_layers").select(LAYER_COLS).eq("world_map_id", worldMapId).order("ord", { ascending: true }),
      supabase.from("regions").select(REGION_COLS).eq("world_map_id", worldMapId),
      supabase.from("entries").select("id, title").eq("campaign_id", campaignId).in("type", ["location", "lore"]).order("title", { ascending: true }),
    ]);
    setLayers((ls as Layer[]) || []);
    setRegions((rs as Region[]) || []);
    setEntries((es as EntryOpt[]) || []);
  }, [supabase, worldMapId, campaignId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onPaintState?.(paintId, erase); }, [paintId, erase, onPaintState]);

  const sortedLayers = useMemo(() => [...layers].sort((a, b) => a.ord - b.ord), [layers]);
  const baseLayerId = sortedLayers[0]?.id;

  // ---- layer ops ----
  const addLayer = useCallback(async () => {
    const ord = layers.length ? Math.max(...layers.map((l) => l.ord)) + 1 : 1;
    const ins = await supabase.from("map_layers").insert({ world_map_id: worldMapId, name: "New tier", ord }).select(LAYER_COLS).single();
    if (ins.error || !ins.data) { setStatus(ins.error?.message || "Could not add tier."); return; }
    setLayers((prev) => [...prev, ins.data as Layer]);
  }, [supabase, worldMapId, layers]);

  const renameLayer = useCallback((id: string, name: string) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
    void supabase.from("map_layers").update({ name }).eq("id", id);
  }, [supabase]);

  const deleteLayer = useCallback(async (id: string) => {
    const { error } = await supabase.from("map_layers").delete().eq("id", id);
    if (error) { setStatus(error.code === "23503" ? "Remove this tier's regions first." : error.message); return; }
    setLayers((prev) => prev.filter((l) => l.id !== id));
  }, [supabase]);

  const moveLayer = useCallback(async (id: string, dir: number) => {
    const s = [...layers].sort((a, b) => a.ord - b.ord);
    const i = s.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.length) return;
    const a = s[i], b = s[j];
    setLayers((prev) => prev.map((l) => (l.id === a.id ? { ...l, ord: b.ord } : l.id === b.id ? { ...l, ord: a.ord } : l)));
    await Promise.all([
      supabase.from("map_layers").update({ ord: b.ord }).eq("id", a.id),
      supabase.from("map_layers").update({ ord: a.ord }).eq("id", b.id),
    ]);
  }, [supabase, layers]);

  // ---- region ops ----
  const addRegion = useCallback(async (layerId: string) => {
    const ins = await supabase.from("regions").insert({ world_map_id: worldMapId, layer_id: layerId, name: "New region", visibility: "common" }).select(REGION_COLS).single();
    if (ins.error || !ins.data) { setStatus(ins.error?.message || "Could not add region."); return; }
    setRegions((prev) => [...prev, ins.data as Region]);
    onChanged?.();
  }, [supabase, worldMapId, onChanged]);

  const patchRegion = useCallback(async (id: string, patch: RegionPatch) => {
    setRegions((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("regions").update(patch).eq("id", id);
    if (error) setStatus(error.message);
    onChanged?.();
  }, [supabase, onChanged]);

  const deleteRegion = useCallback(async (id: string) => {
    const { error } = await supabase.from("regions").delete().eq("id", id);
    if (error) { setStatus(error.message); return; }
    setRegions((prev) => prev.filter((r) => r.id !== id));
    setPaintId((pv) => (pv === id ? null : pv));
    onChanged?.();
  }, [supabase, onChanged]);

  const createEntry = useCallback(async (region: Region) => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) { setStatus("Not signed in."); return; }
    const ins = await supabase.from("entries").insert({ campaign_id: campaignId, created_by: uid, type: "location", title: region.name, visibility: "gm" }).select("id, title").single();
    if (ins.error || !ins.data) { setStatus(`Could not create entry: ${ins.error?.message || "unknown"}`); return; }
    const e = ins.data as EntryOpt;
    setEntries((prev) => [...prev, e]);
    await patchRegion(region.id, { entry_id: e.id });
    setStatus("Codex entry created and linked");
  }, [supabase, campaignId, patchRegion]);

  const parentOptions = useCallback((region: Region): Region[] => {
    const myLayer = layers.find((l) => l.id === region.layer_id);
    if (!myLayer) return [];
    const higher = [...layers].filter((l) => l.ord > myLayer.ord).sort((a, b) => a.ord - b.ord)[0];
    if (!higher) return [];
    return regions.filter((r) => r.layer_id === higher.id);
  }, [layers, regions]);

  const field: React.CSSProperties = { background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 6, padding: "5px 7px", fontSize: 12.5, outline: "none" };
  const mini: React.CSSProperties = { background: "transparent", border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 7px", fontSize: 11.5, cursor: "pointer", color: C.muted };
  const secLabel: React.CSSProperties = { fontSize: 11, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em", marginBottom: 8 };

  return (
    <div>
      <div style={secLabel}>TIERS</div>
      <p style={{ fontSize: 11, color: C.muted, margin: "0 0 8px", lineHeight: 1.4 }}>
        Low to high. Hexes attach at the lowest tier; each tier above nests the one below.
      </p>
      <div style={{ display: "grid", gap: 5, marginBottom: 8 }}>
        {sortedLayers.map((l, i) => (
          <div key={l.id} style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <input value={l.name} onChange={(e) => renameLayer(l.id, e.target.value)} style={{ ...field, flex: 1, minWidth: 0 }} />
            <button type="button" onClick={() => moveLayer(l.id, -1)} disabled={i === 0} style={{ ...mini, opacity: i === 0 ? 0.4 : 1 }}>up</button>
            <button type="button" onClick={() => moveLayer(l.id, 1)} disabled={i === sortedLayers.length - 1} style={{ ...mini, opacity: i === sortedLayers.length - 1 ? 0.4 : 1 }}>dn</button>
            <button type="button" onClick={() => deleteLayer(l.id)} style={mini}>x</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addLayer} style={{ ...mini, width: "100%", padding: "6px 9px", marginBottom: 16 }}>+ Add tier</button>

      <div style={secLabel}>REGIONS</div>
      {sortedLayers.length === 0 ? (
        <p style={{ fontSize: 12.5, color: C.muted }}>Add a tier first.</p>
      ) : (
        sortedLayers.map((layer) => {
          const inLayer = regions.filter((r) => r.layer_id === layer.id);
          return (
            <div key={layer.id} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 6 }}>{layer.name}</div>
              <div style={{ display: "grid", gap: 8 }}>
                {inLayer.map((r) => {
                  const parents = parentOptions(r);
                  return (
                    <div key={r.id} style={{ border: `1px solid ${C.line}`, borderRadius: 7, padding: 8, background: C.surface2, display: "grid", gap: 6 }}>
                      <input value={r.name} onChange={(e) => patchRegion(r.id, { name: e.target.value })} style={{ ...field }} />
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {parents.length > 0 && (
                          <select value={r.parent_region_id || ""} onChange={(e) => patchRegion(r.id, { parent_region_id: e.target.value || null })} style={{ ...field, flex: "1 1 120px" }}>
                            <option value="">No parent</option>
                            {parents.map((p) => <option key={p.id} value={p.id}>in: {p.name}</option>)}
                          </select>
                        )}
                        <select value={r.visibility} onChange={(e) => patchRegion(r.id, { visibility: e.target.value })} style={{ ...field, flex: "0 0 auto" }}>
                          {VIS.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <select value={r.entry_id || ""} onChange={(e) => patchRegion(r.id, { entry_id: e.target.value || null })} style={{ ...field, flex: "1 1 140px" }}>
                          <option value="">No codex entry</option>
                          {entries.map((en) => <option key={en.id} value={en.id}>{en.title || "(untitled)"}</option>)}
                        </select>
                        {!r.entry_id && <button type="button" onClick={() => createEntry(r)} style={mini}>+ Add to codex</button>}
                        <button type="button" onClick={() => deleteRegion(r.id)} style={mini}>Delete</button>
                      </div>
                      {layer.id === baseLayerId && (paintId === r.id ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: C.sun, fontWeight: 600 }}>Painting</span>
                          <button type="button" onClick={() => setErase(false)} style={{ ...mini, color: !erase ? C.sun : C.muted, borderColor: !erase ? C.sun : C.line }}>Paint</button>
                          <button type="button" onClick={() => setErase(true)} style={{ ...mini, color: erase ? C.sun : C.muted, borderColor: erase ? C.sun : C.line }}>Erase</button>
                          <button type="button" onClick={() => setPaintId(null)} style={mini}>Done</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => { setPaintId(r.id); setErase(false); }} style={{ ...mini, alignSelf: "flex-start" }}>Paint hexes</button>
                      ))}
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={() => addRegion(layer.id)} style={{ ...mini, width: "100%", padding: "6px 9px", marginTop: 6 }}>+ New region in {layer.name}</button>
            </div>
          );
        })
      )}
      {status && <p style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>{status}</p>}
    </div>
  );
}
