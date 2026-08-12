"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C } from "@/lib/forge-theme";
import HexCanvas from "@/components/worldmap/HexCanvas";
import { type Terrain, createTerrain, decodeTerrain, base64ToBytes } from "@/lib/worldmap/hex";
import { POI_ICON_SVG } from "@/lib/worldmap/poi-icons";

// Phase 5a: the read-only member viewer. It calls world_map_read (the security-definer RPC that
// applies visibility server-side) and renders the returned bundle through the same HexCanvas the GM
// uses, minus every editing affordance: pan, zoom, the layer slider, POI hover tooltips, and click
// popups, nothing else. A member who is not permitted gets null from the RPC and a plain message.
// Route-agnostic: give it a campaignId. Editing when the GM opens the map is a later phase.

const POI_COLOR = "#e6d8b5";

type MapRow = { id: string; width: number; height: number; origin_col: number; origin_row: number; terrain: string | null; editable_by?: string | null };
type Biome = { id: number; color: string };
type ImageRow = { id: string; url: string; x: number; y: number; scale: number; z: number };
type Layer = { id: string; name: string; ord: number };
type Region = { id: string; layer_id: string; name: string; parent_region_id: string | null; tint: string | null };
type Hex = { col: number; row: number; region_id: string };
type Poi = { id: string; x: number; y: number; name: string; icon_key: string | null; icon_id: string | null; color: string | null; entry_id: string | null; character_id: string | null };
type Bundle = {
  map: MapRow | null; biomes: Biome[]; images: ImageRow[]; icons: { id: string; url: string }[];
  layers: Layer[]; regions: Region[]; hexes: Hex[]; pois: Poi[];
};

function autoTint(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 55%)`;
}
function poiIconSrc(iconKey: string | null, iconId: string | null, color: string | null, urlById: Map<string, string>): { iconId: string; iconSrc: string } | null {
  if (iconKey) {
    const svg = POI_ICON_SVG[iconKey];
    if (!svg) return null;
    const c = color || POI_COLOR;
    return { iconId: `${iconKey}:${c}`, iconSrc: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/currentColor/g, c)) };
  }
  if (iconId) {
    const url = urlById.get(iconId);
    if (!url) return null;
    return { iconId, iconSrc: url };
  }
  return null;
}

export default function WorldMapViewer({ campaignId }: { campaignId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [bundle, setBundle] = useState<Bundle | null | undefined>(undefined);
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string>("");
  const [regionRender, setRegionRender] = useState<{ id: string; name: string; tint: string; cells: Set<string> }[]>([]);
  const [poiTooltip, setPoiTooltip] = useState<{ names: string[]; x: number; y: number } | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<{ id: string; sx: number; sy: number } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<{ title: string | null; body: string | null } | null>(null);
  const [selectedChar, setSelectedChar] = useState<{ name: string } | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      const { data, error } = await supabase.rpc("world_map_read", { p_campaign: campaignId });
      if (off) return;
      if (error || !data) { setBundle(null); return; }
      const b = data as Bundle;
      setBundle(b);
      if (b.map) {
        setTerrain(b.map.terrain ? decodeTerrain(base64ToBytes(b.map.terrain)) : createTerrain(b.map.width, b.map.height, b.map.origin_col, b.map.origin_row));
      }
      setSelectedLayerId(b.layers[0]?.id || "");
    })();
    return () => { off = true; };
  }, [supabase, campaignId]);

  const colors = useMemo(() => {
    const arr: string[] = [];
    for (const b of bundle?.biomes || []) arr[b.id] = b.color;
    return arr;
  }, [bundle]);

  const iconUrlById = useMemo(() => {
    const m = new Map<string, string>();
    for (const ic of bundle?.icons || []) m.set(ic.id, ic.url);
    return m;
  }, [bundle]);

  const pois = useMemo(() => {
    const out: { id: string; x: number; y: number; name: string; iconId: string; iconSrc: string }[] = [];
    for (const r of bundle?.pois || []) {
      const src = poiIconSrc(r.icon_key, r.icon_id, r.color, iconUrlById) || poiIconSrc("unknown_poi", null, r.color, iconUrlById);
      if (!src) continue;
      out.push({ id: r.id, x: r.x, y: r.y, name: r.name, iconId: src.iconId, iconSrc: src.iconSrc });
    }
    return out;
  }, [bundle, iconUrlById]);

  useEffect(() => {
    if (!bundle || !selectedLayerId || bundle.regions.length === 0) { setRegionRender([]); return; }
    const byId = new Map(bundle.regions.map((r) => [r.id, r]));
    const ancestorAt = (baseId: string): string | null => {
      let cur = byId.get(baseId);
      let guard = 0;
      while (cur && guard++ < 20) {
        if (cur.layer_id === selectedLayerId) return cur.id;
        if (!cur.parent_region_id) return null;
        cur = byId.get(cur.parent_region_id);
      }
      return null;
    };
    const groups = new Map<string, Set<string>>();
    for (const h of bundle.hexes) {
      const tierId = ancestorAt(h.region_id);
      if (!tierId) continue;
      let set = groups.get(tierId);
      if (!set) { set = new Set(); groups.set(tierId, set); }
      set.add(`${h.col},${h.row}`);
    }
    setRegionRender([...groups.entries()].map(([rid, cells]) => {
      const r = byId.get(rid);
      return { id: rid, name: r?.name || "", tint: r?.tint || autoTint(rid), cells };
    }));
  }, [bundle, selectedLayerId]);

  const onPoiHover = useCallback((h: { names: string[]; sx: number; sy: number } | null) => {
    setPoiTooltip(h ? { names: h.names, x: h.sx, y: h.sy } : null);
  }, []);
  const onPoiClick = useCallback((id: string, sx: number, sy: number) => {
    setSelectedPoi({ id, sx, sy });
  }, []);

  const poiRowsRef = useRef<Poi[]>([]);
  poiRowsRef.current = bundle?.pois || [];
  useEffect(() => {
    if (!selectedPoi) { setSelectedEntry(null); setSelectedChar(null); return; }
    const poi = poiRowsRef.current.find((r) => r.id === selectedPoi.id);
    if (!poi) { setSelectedEntry(null); setSelectedChar(null); return; }
    let off = false;
    (async () => {
      if (poi.entry_id) {
        const { data } = await supabase.from("entries").select("title, body").eq("id", poi.entry_id).single();
        if (!off) setSelectedEntry((data as { title: string | null; body: string | null }) || null);
      } else if (!off) { setSelectedEntry(null); }
      if (poi.character_id) {
        const { data } = await supabase.from("characters").select("name").eq("id", poi.character_id).single();
        if (!off) setSelectedChar((data as { name: string }) || null);
      } else if (!off) { setSelectedChar(null); }
    })();
    return () => { off = true; };
  }, [selectedPoi, supabase]);

  if (bundle === undefined) {
    return <p style={{ color: C.muted, fontSize: 14, padding: 24 }}>Loading the world map\u2026</p>;
  }
  if (bundle === null || !bundle.map || !terrain) {
    return <p style={{ color: C.muted, fontSize: 14, padding: 24 }}>This world map is not available to you.</p>;
  }

  const layers = bundle.layers;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#171310" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${C.line}` }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>World map</span>
        {layers.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
            <span style={{ fontSize: 12, color: C.muted }}>Layer</span>
            <input type="range" min={0} max={layers.length - 1}
              value={Math.max(0, layers.findIndex((l) => l.id === selectedLayerId))}
              onChange={(e) => setSelectedLayerId(layers[Number(e.target.value)]?.id || "")} />
            <span style={{ fontSize: 12.5, color: C.text }}>{layers.find((l) => l.id === selectedLayerId)?.name || ""}</span>
          </div>
        )}
      </div>

      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <HexCanvas
          terrain={terrain}
          colors={colors}
          selectedBiome={null}
          images={bundle.images}
          regionRender={regionRender}
          pois={pois}
          onPoiHover={onPoiHover}
          onPoiClick={onPoiClick}
        />
        {poiTooltip && (
          <div style={{ position: "absolute", left: poiTooltip.x, top: poiTooltip.y - 14, transform: "translate(-50%, -100%)", background: "rgba(20,16,12,0.96)", border: `1px solid ${C.line}`, borderRadius: 6, padding: "4px 8px", pointerEvents: "none", zIndex: 5, maxWidth: 220 }}>
            {poiTooltip.names.slice(0, 8).map((n, i) => (
              <div key={i} style={{ fontSize: 12, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n}</div>
            ))}
            {poiTooltip.names.length > 8 && <div style={{ fontSize: 11, color: C.muted }}>+{poiTooltip.names.length - 8} more</div>}
          </div>
        )}
        {selectedPoi && (() => {
          const poi = poiRowsRef.current.find((r) => r.id === selectedPoi.id);
          if (!poi) return null;
          const resolved = pois.find((pp) => pp.id === selectedPoi.id);
          const title = selectedEntry?.title || poi.name;
          const desc = selectedEntry?.body || "";
          return (
            <div style={{ position: "absolute", left: selectedPoi.sx, top: selectedPoi.sy - 16, transform: "translate(-50%, -100%)", width: 240, maxHeight: 260, overflowY: "auto", background: "rgba(20,16,12,0.98)", border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, zIndex: 6, boxShadow: "0 6px 20px rgba(0,0,0,0.5)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                {resolved && <img src={resolved.iconSrc} alt="" style={{ width: 24, height: 24, objectFit: "contain", flex: "0 0 auto" }} />}
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
                <button type="button" onClick={() => setSelectedPoi(null)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>{"\u00d7"}</button>
              </div>
              {desc ? (
                <div style={{ fontSize: 12.5, color: C.muted, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{desc}</div>
              ) : (
                <div style={{ fontSize: 12, color: C.muted, fontStyle: "italic" }}>No description.</div>
              )}
              {selectedChar && <div style={{ fontSize: 12, color: C.sun, marginTop: 8 }}>Linked character: {selectedChar.name}</div>}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
