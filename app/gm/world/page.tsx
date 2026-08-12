"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { surfaces, ui } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import HexCanvas from "@/components/worldmap/HexCanvas";
import RegionsPanel from "@/components/worldmap/RegionsPanel";
import IconLibrary from "@/components/worldmap/IconLibrary";
import { POI_ICON_SVG } from "@/lib/worldmap/poi-icons";
import PoiPanel from "@/components/worldmap/PoiPanel";
import {
  type Terrain, createTerrain, decodeTerrain, encodeTerrain, base64ToBytes, bytesToBase64, expandTerrain, BIOME_UNSET,
} from "@/lib/worldmap/hex";
import { fitImageToGrid, pixelToHex, BASE_SIZE, type PlacedImage } from "@/lib/worldmap/layout";

// The GM's world map. Paint biomes (Erase clears a hex), set the grid size in hex units, and place
// one or more uploaded map images that you can move (drag) and scale (scroll) to line up or stitch
// into a larger world. Terrain is a packed blob on world_maps; images are rows in map_images with a
// world-space transform. Uploads go through /api/world-map/image (service role), because storage RLS
// does not authenticate the browser session. Sits beside /gm/map, the tactical image-and-pins map.

type Campaign = { id: string; name: string };
type Biome = { id: number; key: string; label: string; category: string; color: string };
type MapRow = {
  id: string; name: string; width: number; height: number;
  origin_col: number; origin_row: number; format_version: number; terrain: string | null;
};

const MAP_COLS = "id, name, width, height, origin_col, origin_row, format_version, terrain";
const IMG_COLS = "id, url, x, y, scale, z";
const IMG_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMG_BYTES = 8 * 1024 * 1024;
const MAX_DIM = 250;
const CATEGORY_ORDER = ["terrestrial", "wetland", "water", "geologic", "fantasy"];
const CATEGORY_LABEL: Record<string, string> = {
  terrestrial: "Terrestrial", wetland: "Wetland", water: "Water", geologic: "Mountain & geologic", fantasy: "Fantasy",
};

function loadImageWidth(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth || 1);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

function autoTint(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 55%)`;
}

type LayerRow = { id: string; name: string; ord: number };
type RegionRow = { id: string; layer_id: string; name: string; parent_region_id: string | null; tint: string | null };
type RegionRender = { id: string; name: string; tint: string; cells: Set<string> };
type PoiRow = { id: string; x: number; y: number; name: string; icon_key: string | null; icon_id: string | null; visibility: string; note: string | null; entry_id: string | null; character_id: string | null; color: string | null };
type ArmedIcon = { key: string } | { iconId: string; url: string };
const POI_COLOR = "#e6d8b5";
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

export default function WorldMapPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [biomes, setBiomes] = useState<Biome[]>([]);
  const [mapRow, setMapRow] = useState<MapRow | null>(null);
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [images, setImages] = useState<PlacedImage[]>([]);
  const [positionId, setPositionId] = useState<string | null>(null);
  const [mode, setMode] = useState<"terrain" | "regions" | "icons" | "pois">("terrain");
  const [paintRegionId, setPaintRegionId] = useState<string | null>(null);
  const [regionErase, setRegionErase] = useState<boolean>(false);
  const [regionCells, setRegionCells] = useState<Set<string>>(new Set());
  const worldHexesRef = useRef<Map<string, string>>(new Map());
  const [layerRows, setLayerRows] = useState<LayerRow[]>([]);
  const [regionRows, setRegionRows] = useState<RegionRow[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string>("");
  const [hexesVersion, setHexesVersion] = useState<number>(0);
  const [regionRender, setRegionRender] = useState<RegionRender[]>([]);
  const [armedIcon, setArmedIcon] = useState<ArmedIcon | null>(null);
  const [poiRows, setPoiRows] = useState<PoiRow[]>([]);
  const [iconUrlById, setIconUrlById] = useState<Map<string, string>>(new Map());
  const [poiTooltip, setPoiTooltip] = useState<{ names: string[]; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [sizeW, setSizeW] = useState<string>("100");
  const [sizeH, setSizeH] = useState<string>("100");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  const colors = useMemo(() => {
    const arr: string[] = [];
    for (const b of biomes) arr[b.id] = b.color;
    return arr;
  }, [biomes]);

  const grouped = useMemo(() => {
    const by: Record<string, Biome[]> = {};
    for (const b of biomes) (by[b.category] ||= []).push(b);
    return CATEGORY_ORDER.filter((c) => by[c]?.length).map((c) => ({ category: c, items: by[c] }));
  }, [biomes]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: camps }, { data: bs }] = await Promise.all([
        supabase.from("campaigns").select("id, name").order("created_at", { ascending: true }),
        supabase.from("biomes").select("id, key, label, category, color").order("sort", { ascending: true }),
      ]);
      if (cancelled) return;
      const cs = (camps as Campaign[]) || [];
      setCampaigns(cs);
      setBiomes((bs as Biome[]) || []);
      if (cs[0]) setCampaignId(cs[0].id);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setStatus("");
      setTerrain(null);
      setImages([]);
      setPositionId(null);
      const { data, error } = await supabase.from("world_maps").select(MAP_COLS).eq("campaign_id", campaignId).maybeSingle();
      let row = data as MapRow | null;
      if (error) {
        setStatus(error.message);
      } else if (!row) {
        const ins = await supabase.from("world_maps").insert({ campaign_id: campaignId }).select(MAP_COLS).single();
        row = ins.data as MapRow | null;
        if (ins.error) setStatus(ins.error.message);
      }
      if (cancelled) return;
      setMapRow(row);
      if (row) {
        setSizeW(String(row.width));
        setSizeH(String(row.height));
        setTerrain(row.terrain ? decodeTerrain(base64ToBytes(row.terrain)) : createTerrain(row.width, row.height, row.origin_col, row.origin_row));
        const { data: imgs } = await supabase.from("map_images").select(IMG_COLS).eq("world_map_id", row.id).order("z", { ascending: true });
        if (!cancelled) setImages((imgs as PlacedImage[]) || []);
        const { data: whx } = await supabase.from("world_hexes").select("col, row, region_id").eq("world_map_id", row.id);
        const wm = new Map<string, string>();
        for (const h of (whx as { col: number; row: number; region_id: string }[]) || []) wm.set(`${h.col},${h.row}`, h.region_id);
        if (!cancelled) { worldHexesRef.current = wm; setPaintRegionId(null); setRegionCells(new Set()); }
        const [{ data: ls }, { data: rs }] = await Promise.all([
          supabase.from("map_layers").select("id, name, ord").eq("world_map_id", row.id).order("ord", { ascending: true }),
          supabase.from("regions").select("id, layer_id, name, parent_region_id, tint").eq("world_map_id", row.id),
        ]);
        if (!cancelled) {
          const lyrs = (ls as LayerRow[]) || [];
          setLayerRows(lyrs);
          setRegionRows((rs as RegionRow[]) || []);
          setSelectedLayerId(lyrs[0]?.id || "");
          setHexesVersion((v) => v + 1);
        }
        const [{ data: poiData }, { data: iconData }] = await Promise.all([
          supabase.from("map_pois").select("id, x, y, name, icon_key, icon_id, visibility, note, entry_id, character_id, color").eq("world_map_id", row.id),
          supabase.from("map_icons").select("id, url").eq("campaign_id", campaignId),
        ]);
        if (!cancelled) {
          setPoiRows((poiData as PoiRow[]) || []);
          const um = new Map<string, string>();
          for (const ic of (iconData as { id: string; url: string }[]) || []) um.set(ic.id, ic.url);
          setIconUrlById(um);
        }
      } else {
        setTerrain(null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, campaignId]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(() => {
    if (!mapRow || !terrain) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus("Saving\u2026");
    saveTimer.current = setTimeout(async () => {
      const b64 = bytesToBase64(encodeTerrain(terrain));
      const { error } = await supabase.from("world_maps").update({ terrain: b64 }).eq("id", mapRow.id);
      setStatus(error ? `Save failed: ${error.message}` : "Saved");
    }, 800);
  }, [supabase, mapRow, terrain]);

  const onPaint = useCallback(() => { scheduleSave(); }, [scheduleSave]);

  useEffect(() => {
    if (!paintRegionId) { setRegionCells(new Set()); return; }
    const cells = new Set<string>();
    for (const [k, rid] of worldHexesRef.current) if (rid === paintRegionId) cells.add(k);
    setRegionCells(cells);
  }, [paintRegionId]);

  const rgUp = useRef<Map<string, { col: number; row: number }>>(new Map());
  const rgDel = useRef<Map<string, { col: number; row: number }>>(new Map());
  const rgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRegionPaint = useCallback((col: number, row: number) => {
    if (!mapRow || !paintRegionId) return;
    const key = `${col},${row}`;
    if (regionErase) {
      worldHexesRef.current.delete(key);
      rgDel.current.set(key, { col, row });
      rgUp.current.delete(key);
    } else {
      worldHexesRef.current.set(key, paintRegionId);
      rgUp.current.set(key, { col, row });
      rgDel.current.delete(key);
    }
    if (rgTimer.current) clearTimeout(rgTimer.current);
    setStatus("Saving\u2026");
    const wmId = mapRow.id;
    const rid = paintRegionId;
    rgTimer.current = setTimeout(async () => {
      const ups = [...rgUp.current.values()].map((c) => ({ world_map_id: wmId, col: c.col, row: c.row, region_id: rid }));
      const dels = [...rgDel.current.values()];
      rgUp.current.clear();
      rgDel.current.clear();
      let err: string | null = null;
      if (ups.length) {
        const { error } = await supabase.from("world_hexes").upsert(ups, { onConflict: "world_map_id,col,row" });
        if (error) err = error.message;
      }
      for (const c of dels) {
        const { error } = await supabase.from("world_hexes").delete().eq("world_map_id", wmId).eq("col", c.col).eq("row", c.row);
        if (error) err = error.message;
      }
      setStatus(err ? `Save failed: ${err}` : "Saved");
      setHexesVersion((v) => v + 1);
    }, 600);
  }, [supabase, mapRow, paintRegionId, regionErase]);

  const onPaintState = useCallback((regionId: string | null, erase: boolean) => {
    setPaintRegionId(regionId);
    setRegionErase(erase);
  }, []);

  const reloadRegions = useCallback(async () => {
    if (!mapRow) return;
    const [{ data: ls }, { data: rs }] = await Promise.all([
      supabase.from("map_layers").select("id, name, ord").eq("world_map_id", mapRow.id).order("ord", { ascending: true }),
      supabase.from("regions").select("id, layer_id, name, parent_region_id, tint").eq("world_map_id", mapRow.id),
    ]);
    setLayerRows((ls as LayerRow[]) || []);
    setRegionRows((rs as RegionRow[]) || []);
    setHexesVersion((v) => v + 1);
  }, [supabase, mapRow]);

  useEffect(() => {
    if (!selectedLayerId || regionRows.length === 0) { setRegionRender([]); return; }
    const byId = new Map(regionRows.map((r) => [r.id, r]));
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
    for (const [cell, baseRegionId] of worldHexesRef.current) {
      const tierId = ancestorAt(baseRegionId);
      if (!tierId) continue;
      let set = groups.get(tierId);
      if (!set) { set = new Set(); groups.set(tierId, set); }
      set.add(cell);
    }
    setRegionRender([...groups.entries()].map(([rid, cells]) => {
      const r = byId.get(rid);
      return { id: rid, name: r?.name || "", tint: r?.tint || autoTint(rid), cells };
    }));
  }, [regionRows, selectedLayerId, hexesVersion]);

  const pois = useMemo(() => {
    const out: { id: string; x: number; y: number; name: string; iconId: string; iconSrc: string }[] = [];
    for (const r of poiRows) {
      const src = poiIconSrc(r.icon_key, r.icon_id, r.color, iconUrlById) || poiIconSrc("unknown_poi", null, r.color, iconUrlById);
      if (!src) continue;
      out.push({ id: r.id, x: r.x, y: r.y, name: r.name, iconId: src.iconId, iconSrc: src.iconSrc });
    }
    return out;
  }, [poiRows, iconUrlById]);

  const onPlacePoi = useCallback(async (x: number, y: number) => {
    if (!mapRow || !armedIcon) { setStatus("Pick an icon first."); return; }
    const { col, row } = pixelToHex(x, y, BASE_SIZE);
    const iconCols = "key" in armedIcon ? { icon_key: armedIcon.key } : { icon_id: armedIcon.iconId };
    const ins = await supabase.from("map_pois")
      .insert({ world_map_id: mapRow.id, x, y, col, row, name: "New marker", visibility: "common", ...iconCols })
      .select("id, x, y, name, icon_key, icon_id, visibility, note, entry_id, character_id, color").single();
    if (ins.error || !ins.data) { setStatus(`Failed: ${ins.error?.message || "unknown"}`); return; }
    setPoiRows((prev) => [...prev, ins.data as PoiRow]);
    setStatus("Marker placed");
  }, [supabase, mapRow, armedIcon]);

  const onPoiHover = useCallback((h: { names: string[]; sx: number; sy: number } | null) => {
    setPoiTooltip(h ? { names: h.names, x: h.sx, y: h.sy } : null);
  }, []);

  const onPoiClick = useCallback((id: string) => {
    const p = poiRows.find((r) => r.id === id);
    if (p) setStatus(p.name);
  }, [poiRows]);

  const removePoi = useCallback(async (id: string) => {
    const { error } = await supabase.from("map_pois").delete().eq("id", id);
    if (error) { setStatus(error.message); return; }
    setPoiRows((prev) => prev.filter((r) => r.id !== id));
  }, [supabase]);

  const onMovePoi = useCallback(async (id: string, x: number, y: number) => {
    const { col, row } = pixelToHex(x, y, BASE_SIZE);
    setPoiRows((prev) => prev.map((r) => (r.id === id ? { ...r, x, y } : r)));
    const { error } = await supabase.from("map_pois").update({ x, y, col, row }).eq("id", id);
    if (error) setStatus(error.message);
  }, [supabase]);

  const patchPoi = useCallback(async (id: string, patch: Partial<PoiRow>) => {
    setPoiRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("map_pois").update(patch).eq("id", id);
    if (error) setStatus(error.message);
  }, [supabase]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const applyResize = useCallback(async () => {
    if (!mapRow || !terrain) return;
    const nw = Math.max(1, Math.min(MAX_DIM, Math.round(Number(sizeW) || 0)));
    const nh = Math.max(1, Math.min(MAX_DIM, Math.round(Number(sizeH) || 0)));
    if (!nw || !nh) { setStatus("Enter a size between 1 and 250."); return; }
    if (nw === terrain.meta.width && nh === terrain.meta.height) { setStatus("Size unchanged."); return; }
    const oc = -Math.floor(nw / 2);
    const or = -Math.floor(nh / 2);
    const nt = expandTerrain(terrain, nw, nh, oc, or);
    setStatus("Resizing\u2026");
    const b64 = bytesToBase64(encodeTerrain(nt));
    const { error } = await supabase.from("world_maps").update({ width: nw, height: nh, origin_col: oc, origin_row: or, terrain: b64 }).eq("id", mapRow.id);
    if (error) { setStatus(`Resize failed: ${error.message}`); return; }
    setMapRow({ ...mapRow, width: nw, height: nh, origin_col: oc, origin_row: or });
    setTerrain(nt);
    setSizeW(String(nw));
    setSizeH(String(nh));
    setStatus(`Resized to ${nw} x ${nh}`);
  }, [supabase, mapRow, terrain, sizeW, sizeH]);

  const uploadImage = useCallback(async (file: File) => {
    if (!mapRow || !campaignId) return;
    if (!IMG_TYPES.includes(file.type)) { setStatus("Use a PNG, JPG, or WebP image."); return; }
    if (file.size > MAX_IMG_BYTES) { setStatus("Image must be under 8 MB."); return; }
    setStatus("Uploading\u2026");
    const form = new FormData();
    form.append("campaignId", campaignId);
    form.append("file", file);
    const res = await fetch("/api/world-map/image", { method: "POST", body: form });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) { setStatus(`Upload failed: ${data.error || "unknown error"}`); return; }
    let naturalW = 1000;
    try { naturalW = await loadImageWidth(data.url); } catch { /* fall back */ }
    const fit = fitImageToGrid(mapRow.width, mapRow.height, naturalW);
    const z = images.length ? Math.max(...images.map((i) => i.z)) + 1 : 0;
    const ins = await supabase.from("map_images")
      .insert({ world_map_id: mapRow.id, url: data.url, x: fit.x, y: fit.y, scale: fit.scale, z })
      .select(IMG_COLS).single();
    if (ins.error || !ins.data) { setStatus(`Save failed: ${ins.error?.message || "unknown"}`); return; }
    const added = ins.data as PlacedImage;
    setImages((prev) => [...prev, added]);
    setPositionId(added.id);
    setStatus("Image added, drag on the map to place it");
  }, [supabase, mapRow, campaignId, images]);

  const onImageMove = useCallback((id: string, x: number, y: number) => {
    setImages((prev) => prev.map((i) => (i.id === id ? { ...i, x, y } : i)));
    void supabase.from("map_images").update({ x, y }).eq("id", id);
  }, [supabase]);

  const scaleTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const onImageScale = useCallback((id: string, scale: number) => {
    setImages((prev) => prev.map((i) => (i.id === id ? { ...i, scale } : i)));
    const prev = scaleTimers.current.get(id);
    if (prev) clearTimeout(prev);
    scaleTimers.current.set(id, setTimeout(() => {
      void supabase.from("map_images").update({ scale }).eq("id", id);
    }, 500));
  }, [supabase]);

  const removeImage = useCallback(async (id: string) => {
    const { error } = await supabase.from("map_images").delete().eq("id", id);
    if (error) { setStatus(`Failed: ${error.message}`); return; }
    setImages((prev) => prev.filter((i) => i.id !== id));
    setPositionId((p) => (p === id ? null : p));
    setStatus("Image removed");
  }, [supabase]);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void uploadImage(f);
  }, [uploadImage]);

  const swatch = (b: Biome) => {
    const on = selected === b.id;
    return (
      <button key={b.id} type="button" onClick={() => setSelected(on ? null : b.id)} title={b.label}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
          padding: "6px 8px", borderRadius: 7, cursor: "pointer",
          border: `1px solid ${on ? C.sun : C.line}`, background: on ? "rgba(200,162,75,0.14)" : C.surface2, color: C.text,
        }}>
        <span style={{ width: 16, height: 16, borderRadius: 3, background: b.color, border: `1px solid ${C.line}`, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5 }}>{b.label}</span>
      </button>
    );
  };

  const secLabel: React.CSSProperties = { fontSize: 11, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em", marginBottom: 6 };
  const numInput: React.CSSProperties = { width: 58, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 8px", fontSize: 13 };
  const smallBtn: React.CSSProperties = { background: C.sun, color: "#171310", border: "none", borderRadius: 7, padding: "6px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" };
  const uploadBtn: React.CSSProperties = { display: "block", textAlign: "center", padding: "7px 9px", borderRadius: 7, cursor: "pointer", border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 12.5, fontWeight: 600 };
  const miniBtn: React.CSSProperties = { background: "transparent", border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 8px", fontSize: 11.5, cursor: "pointer", color: C.muted };
  const modeChip = (label: string, on: boolean, onClick: () => void): React.ReactElement => (
    <button type="button" onClick={onClick}
      style={{
        flex: 1, textAlign: "center", padding: "7px 9px", borderRadius: 7, cursor: "pointer",
        border: `1px solid ${on ? C.sun : C.line}`, background: on ? "rgba(200,162,75,0.14)" : C.surface2,
        color: C.text, fontSize: 12.5, fontWeight: 600,
      }}>
      {label}
    </button>
  );

  return (
    <PageShell width={1200}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>World map</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 16px" }}>
        Paint biomes across the world, or upload one or more maps and place them. Pick a biome and drag to paint, Erase to clear, or Pan to move the view. Scroll to zoom.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
          style={{ background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", fontSize: 14 }}>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span style={{ fontSize: 12.5, color: C.muted }}>{status}</span>
        {mode === "regions" && layerRows.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: C.muted }}>Layer</span>
            <input type="range" min={0} max={layerRows.length - 1}
              value={Math.max(0, layerRows.findIndex((l) => l.id === selectedLayerId))}
              onChange={(e) => setSelectedLayerId(layerRows[Number(e.target.value)]?.id || "")} />
            <span style={{ fontSize: 12.5, color: C.text }}>{layerRows.find((l) => l.id === selectedLayerId)?.name || ""}</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ ...surfaces.slate, padding: 12, flex: "0 0 230px", maxHeight: "72vh", overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {modeChip("Terrain", mode === "terrain", () => { setMode("terrain"); setPaintRegionId(null); })}
            {modeChip("Regions", mode === "regions", () => { setMode("regions"); setSelected(null); })}
            {modeChip("Icons", mode === "icons", () => { setMode("icons"); setSelected(null); setPaintRegionId(null); })}
            {modeChip("POIs", mode === "pois", () => { setMode("pois"); setSelected(null); setPaintRegionId(null); })}
          </div>
          {mode === "terrain" && (<>
          <div style={{ marginBottom: 14 }}>
            <div style={secLabel}>MAP SIZE (HEXES)</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" min={1} max={MAX_DIM} value={sizeW} onChange={(e) => setSizeW(e.target.value)} style={numInput} />
              <span style={{ color: C.muted, fontSize: 13 }}>x</span>
              <input type="number" min={1} max={MAX_DIM} value={sizeH} onChange={(e) => setSizeH(e.target.value)} style={numInput} />
              <button type="button" onClick={applyResize} style={smallBtn}>Resize</button>
            </div>
            <p style={{ fontSize: 11, color: C.muted, margin: "6px 0 0", lineHeight: 1.4 }}>
              1 to 250 each. Make it large and place a small map inside if you like. Shrinking drops hexes outside the new area, kept centred.
            </p>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={secLabel}>MAP IMAGES</div>
            <label style={uploadBtn}>
              Upload an image
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} style={{ display: "none" }} />
            </label>
            {images.length > 0 && (
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {images.map((im, idx) => {
                  const active = positionId === im.id;
                  return (
                    <div key={im.id} style={{ border: `1px solid ${active ? C.sun : C.line}`, borderRadius: 7, padding: 7, background: C.surface2 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12.5, color: C.text }}>Image {idx + 1}</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" onClick={() => setPositionId(active ? null : im.id)} style={{ ...miniBtn, borderColor: active ? C.sun : C.line, color: active ? C.sun : C.muted }}>
                            {active ? "Done" : "Position"}
                          </button>
                          <button type="button" onClick={() => removeImage(im.id)} style={miniBtn}>Remove</button>
                        </div>
                      </div>
                      {active && <p style={{ fontSize: 11, color: C.muted, margin: "6px 0 0", lineHeight: 1.4 }}>Drag on the map to move it, scroll to resize it.</p>}
                    </div>
                  );
                })}
              </div>
            )}
            <p style={{ fontSize: 11, color: C.muted, margin: "6px 0 0", lineHeight: 1.4 }}>
              PNG, JPG or WebP, under 8 MB. Place several to stitch a larger world. With an image, biome art turns off and painted hexes show as a faint tint.
            </p>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {modeChip("Pan", selected === null, () => setSelected(null))}
            {modeChip("Erase", selected === BIOME_UNSET, () => setSelected(BIOME_UNSET))}
          </div>
          {grouped.map((g) => (
            <div key={g.category} style={{ marginBottom: 12 }}>
              <div style={secLabel}>{(CATEGORY_LABEL[g.category] || g.category).toUpperCase()}</div>
              <div style={{ display: "grid", gap: 5 }}>{g.items.map(swatch)}</div>
            </div>
          ))}
          </>)}
          {mode === "regions" && mapRow && (
            <RegionsPanel worldMapId={mapRow.id} campaignId={campaignId} onPaintState={onPaintState} onChanged={reloadRegions} />
          )}
          {mode === "icons" && campaignId && (
            <IconLibrary campaignId={campaignId} />
          )}
          {mode === "pois" && campaignId && (
            <div>
              <div style={{ fontSize: 12.5, color: C.text, marginBottom: 8, lineHeight: 1.4 }}>
                {armedIcon ? "Click the map to place this marker. Pick another icon to switch." : "Pick an icon below, then click the map to place a marker."}
              </div>
              <IconLibrary campaignId={campaignId} onPick={setArmedIcon} />
              <PoiPanel campaignId={campaignId} pois={poiRows} onPatch={patchPoi} onRemove={removePoi} />
            </div>
          )}
        </div>

        <div style={{ ...surfaces.slate, padding: 0, flex: "1 1 520px", minWidth: 320, height: "72vh", position: "relative", overflow: "hidden", borderRadius: FORGE_RADIUS }}>
          {loading ? (
            <p style={{ color: C.muted, fontSize: 14, padding: 16 }}>Loading\u2026</p>
          ) : terrain ? (
            <HexCanvas
              terrain={terrain} colors={colors} selectedBiome={selected} onPaint={onPaint}
              images={images} positionImageId={positionId} onImageMove={onImageMove} onImageScale={onImageScale}
              paintRegionId={paintRegionId} regionCells={regionCells} regionErase={regionErase} onRegionPaint={onRegionPaint}
              regionRender={mode === "regions" ? regionRender : undefined}
              pois={pois} poiPlaceActive={mode === "pois" && !!armedIcon} onPlacePoi={onPlacePoi} onPoiClick={onPoiClick} onPoiHover={onPoiHover} onMovePoi={onMovePoi}
            />
          ) : (
            <p style={{ color: C.muted, fontSize: 14, padding: 16 }}>Pick a campaign to start its world map.</p>
          )}
          {poiTooltip && (
            <div style={{ position: "absolute", left: poiTooltip.x, top: poiTooltip.y - 14, transform: "translate(-50%, -100%)", background: "rgba(20,16,12,0.96)", border: `1px solid ${C.line}`, borderRadius: 6, padding: "4px 8px", pointerEvents: "none", zIndex: 5, maxWidth: 220 }}>
              {poiTooltip.names.slice(0, 8).map((n, i) => (
                <div key={i} style={{ fontSize: 12, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n}</div>
              ))}
              {poiTooltip.names.length > 8 && <div style={{ fontSize: 11, color: C.muted }}>+{poiTooltip.names.length - 8} more</div>}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
