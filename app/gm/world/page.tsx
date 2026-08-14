"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { surfaces, ui } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import HexCanvas, { type MapFeature } from "@/components/worldmap/HexCanvas";
import RegionsPanel from "@/components/worldmap/RegionsPanel";
import IconLibrary from "@/components/worldmap/IconLibrary";
import { POI_ICON_SVG, poiIconCategory, POI_ICON_CATEGORIES } from "@/lib/worldmap/poi-icons";
import MarkerLegend, { type MarkerGroup } from "@/components/worldmap/MarkerLegend";
import RiverLabels from "@/components/worldmap/RiverLabels";
import LabelPanel, { type LabelRow, type LabelPatch } from "@/components/worldmap/LabelPanel";
import { renderWorldSnapshot } from "@/lib/worldmap/snapshot";
import GenPanel from "@/components/worldmap/GenPanel";
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
  origin_col: number; origin_row: number; format_version: number; terrain: string | null; editable_by: string; snapshot_url: string | null; published: boolean; ai_image_url: string | null;
};

const MAP_COLS = "id, name, width, height, origin_col, origin_row, format_version, terrain, editable_by, snapshot_url, published, ai_image_url";
// icon_keys the world generator emits. A marker on open water with one of these is a spurious
// auto-placed pin (cohesion flooded its hex); a hand-placed sea marker uses a different icon and is
// exempt. Kept in sync with bake.ts SETTLE_ICON + POI_ICON + bridge/ford.
const GEN_ICON_KEYS = new Set(["city_walled", "town", "village", "mine_generic", "gem_mine", "lumber_camp", "farmland", "fishing_spot", "herb_node", "cave_entrance", "dungeon_entrance", "unstable_ground", "holy_spring", "bridge", "ford"]);
const IMG_COLS = "id, url, x, y, scale, z";
const IMG_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMG_BYTES = 8 * 1024 * 1024;
const MAX_DIM = 250;
const CATEGORY_ORDER = ["terrestrial", "wetland", "water", "geologic", "fantasy"];
// Hand-placeable special-terrain tiles: each sets a flag on the clicked hex. iceberg/shallows only
// render over sea, so they also set the sea biome. salt/snow/glacier render over any biome.
// Special-terrain flag bits, as literals mirroring feature-tiles FL_* (shallows 1, frozen 16,
// saltpan 32, glacier 64, snowcap 128) - kept independent of which FLAG_* hex.ts exports.
const SPECIAL_TERRAIN: { key: string; label: string; flag: number; biome: number | null }[] = [
  { key: "saltpan", label: "Salt flat", flag: 32, biome: null },
  { key: "snowcap", label: "Snowcap", flag: 128, biome: null },
  { key: "glacier", label: "Glacier", flag: 64, biome: null },
  { key: "iceberg", label: "Iceberg", flag: 16, biome: 17 },
  { key: "shallows", label: "Shallows", flag: 1, biome: 17 },
];
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
type PoiRow = { id: string; x: number; y: number; name: string; icon_key: string | null; icon_id: string | null; visibility: string; note: string | null; entry_id: string | null; character_id: string | null; color: string | null; locked: boolean };
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
  const [artEnabled, setArtEnabled] = useState(false);
  const [stamp, setStamp] = useState<{ flag: number; biome: number | null } | null>(null);
  const [fantasyView, setFantasyView] = useState(false);
  const [imagining, setImagining] = useState(false);
  const [imagineMsg, setImagineMsg] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [mapRow, setMapRow] = useState<MapRow | null>(null);
  const mapRowId = mapRow?.id ?? null;
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [images, setImages] = useState<PlacedImage[]>([]);
  const [positionId, setPositionId] = useState<string | null>(null);
  const [mode, setMode] = useState<"terrain" | "regions" | "pois">("terrain");
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
  const [selectedPoi, setSelectedPoi] = useState<{ id: string; sx: number; sy: number } | null>(null);
  const [markersHidden, setMarkersHidden] = useState(false);
  const [labelRows, setLabelRows] = useState<LabelRow[]>([]);
  const [labelPlacing, setLabelPlacing] = useState(false);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [selectedEntry, setSelectedEntry] = useState<{ title: string | null; body: string | null } | null>(null);
  const [selectedChar, setSelectedChar] = useState<{ name: string } | null>(null);
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

  const biomeArt = useMemo(() => {
    const arr: (string | null)[] = [];
    for (const b of biomes) arr[b.id] = `/worldmap/biomes/${b.key}.png`;
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
          setSelectedLayerId("");
          setHexesVersion((v) => v + 1);
        }
        const [{ data: poiData }, { data: iconData }, { data: labelData }] = await Promise.all([
          supabase.from("map_pois").select("id, x, y, name, icon_key, icon_id, visibility, note, entry_id, character_id, color, locked").eq("world_map_id", row.id),
          supabase.from("map_icons").select("id, url").eq("campaign_id", campaignId),
          supabase.from("map_labels").select("id, x, y, text, size, color, locked").eq("world_map_id", row.id),
        ]);
        if (!cancelled) {
          setPoiRows((poiData as PoiRow[]) || []);
          const um = new Map<string, string>();
          for (const ic of (iconData as { id: string; url: string }[]) || []) um.set(ic.id, ic.url);
          setIconUrlById(um);
          setLabelRows((labelData as LabelRow[]) || []);
        }
      } else {
        setTerrain(null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, campaignId]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waterCleanupRef = useRef<string | null>(null);
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
    const out: { id: string; x: number; y: number; name: string; iconId: string; iconSrc: string; locked: boolean }[] = [];
    if (markersHidden) return out;
    for (const r of poiRows) {
      if (hiddenCategories.has(poiIconCategory(r.icon_key))) continue;
      const src = poiIconSrc(r.icon_key, r.icon_id, r.color, iconUrlById) || poiIconSrc("unknown_poi", null, r.color, iconUrlById);
      if (!src) continue;
      out.push({ id: r.id, x: r.x, y: r.y, name: r.name, iconId: src.iconId, iconSrc: src.iconSrc, locked: r.locked });
    }
    return out;
  }, [poiRows, iconUrlById, markersHidden, hiddenCategories]);

  const markerGroups = useMemo<MarkerGroup[]>(() => {
    const byCat = new Map<string, { id: string; name: string }[]>();
    for (const r of poiRows) {
      const cat = poiIconCategory(r.icon_key);
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push({ id: r.id, name: r.name });
    }
    const order = [...POI_ICON_CATEGORIES, "Other"];
    return [...byCat.entries()]
      .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
      .map(([category, markers]) => ({ category, markers: markers.sort((x, y) => (x.name || "").localeCompare(y.name || "")) }));
  }, [poiRows]);

  const toggleCategory = useCallback((cat: string) => {
    setHiddenCategories((prev) => { const s = new Set(prev); if (s.has(cat)) s.delete(cat); else s.add(cat); return s; });
  }, []);

  const namedRivers = useMemo(() => {
    const seen = new Set<string>();
    for (const f of features) if (f.kind === "river" && f.name) seen.add(f.name);
    return [...seen];
  }, [features]);

  const renameRiver = useCallback(async (oldName: string, newName: string) => {
    if (!mapRow) return;
    const { error } = await supabase.from("map_features").update({ name: newName }).eq("world_map_id", mapRow.id).eq("name", oldName);
    if (error) { setStatus(error.message); return; }
    setFeatures((prev) => prev.map((f) => (f.name === oldName ? { ...f, name: newName } : f)));
  }, [supabase, mapRow]);

  const armLabel = useCallback(() => { setLabelPlacing(true); setArmedIcon(null); }, []);
  const placeLabel = useCallback(async (x: number, y: number) => {
    if (!mapRow) { setLabelPlacing(false); return; }
    const ins = await supabase.from("map_labels").insert({ world_map_id: mapRow.id, x, y, text: "New label", size: 18, visibility: "common", locked: false })
      .select("id, x, y, text, size, color, locked").single();
    setLabelPlacing(false);
    if (ins.error || !ins.data) { setStatus(ins.error?.message || "Could not add label."); return; }
    setLabelRows((prev) => [...prev, ins.data as LabelRow]);
  }, [supabase, mapRow]);
  const moveLabel = useCallback(async (id: string, x: number, y: number) => {
    setLabelRows((prev) => prev.map((l) => (l.id === id ? { ...l, x, y } : l)));
    await supabase.from("map_labels").update({ x, y }).eq("id", id);
  }, [supabase]);
  const patchLabel = useCallback(async (id: string, patch: LabelPatch) => {
    setLabelRows((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    await supabase.from("map_labels").update(patch).eq("id", id);
  }, [supabase]);
  const removeLabel = useCallback(async (id: string) => {
    const { error } = await supabase.from("map_labels").delete().eq("id", id);
    if (error) { setStatus(error.message); return; }
    setLabelRows((prev) => prev.filter((l) => l.id !== id));
  }, [supabase]);

  const clearAll = useCallback(async () => {
    if (!mapRow) return;
    const n = poiRows.length;
    if (!window.confirm(`Delete all ${n} marker${n === 1 ? "" : "s"}, every river name, and every area label on this map? Terrain, regions, and layers are kept. This cannot be undone.`)) return;
    const [poiRes, featRes, lblRes] = await Promise.all([
      supabase.from("map_pois").delete().eq("world_map_id", mapRow.id),
      supabase.from("map_features").update({ name: null }).eq("world_map_id", mapRow.id).not("name", "is", null),
      supabase.from("map_labels").delete().eq("world_map_id", mapRow.id),
    ]);
    if (poiRes.error) { setStatus(poiRes.error.message); return; }
    if (featRes.error) { setStatus(featRes.error.message); return; }
    if (lblRes.error) { setStatus(lblRes.error.message); return; }
    setPoiRows([]);
    setFeatures((prev) => prev.map((f) => (f.name ? { ...f, name: null } : f)));
    setLabelRows([]);
    setStatus("Cleared all markers, river names, and area labels.");
  }, [supabase, mapRow, poiRows.length]);

  // One-time per map: delete auto-generated pins that cohesion stranded on open water, so they leave
  // the map AND the marker list. Hand-placed markers (non-generator icons) are never touched.
  useEffect(() => {
    if (!terrain || !mapRow || !poiRows.length) return;
    if (waterCleanupRef.current === mapRow.id) return;
    waterCleanupRef.current = mapRow.id;
    const tw = terrain.meta.width, th = terrain.meta.height;
    const doomed: string[] = [];
    for (const r of poiRows) {
      if (!r.icon_key || !GEN_ICON_KEYS.has(r.icon_key)) continue;
      const { col, row } = pixelToHex(r.x, r.y, BASE_SIZE);
      if (col < 0 || row < 0 || col >= tw || row >= th) continue;
      const b = terrain.biome[row * tw + col];
      if (b === 16 || b === 17 || b === 19) doomed.push(r.id);
    }
    if (!doomed.length) return;
    (async () => {
      const { error } = await supabase.from("map_pois").delete().in("id", doomed);
      if (!error) setPoiRows((prev) => prev.filter((r) => !doomed.includes(r.id)));
    })();
  }, [terrain, mapRow, poiRows, supabase]);

  const onPlacePoi = useCallback(async (x: number, y: number) => {
    if (!mapRow || !armedIcon) { setStatus("Pick an icon first."); return; }
    const { col, row } = pixelToHex(x, y, BASE_SIZE);
    const iconCols = "key" in armedIcon ? { icon_key: armedIcon.key } : { icon_id: armedIcon.iconId };
    const ins = await supabase.from("map_pois")
      .insert({ world_map_id: mapRow.id, x, y, col, row, name: "New marker", visibility: "common", ...iconCols })
      .select("id, x, y, name, icon_key, icon_id, visibility, note, entry_id, character_id, color, locked").single();
    if (ins.error || !ins.data) { setStatus(`Failed: ${ins.error?.message || "unknown"}`); return; }
    setPoiRows((prev) => [...prev, ins.data as PoiRow]);
    setStatus("Marker placed");
  }, [supabase, mapRow, armedIcon]);

  const onPoiHover = useCallback((h: { names: string[]; sx: number; sy: number } | null) => {
    setPoiTooltip(h ? { names: h.names, x: h.sx, y: h.sy } : null);
  }, []);

  const onPoiClick = useCallback((id: string, sx: number, sy: number) => {
    setSelectedPoi({ id, sx, sy });
  }, []);

  useEffect(() => {
    if (!selectedPoi) { setSelectedEntry(null); setSelectedChar(null); return; }
    const poi = poiRows.find((r) => r.id === selectedPoi.id);
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
  }, [selectedPoi, poiRows, supabase]);

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

  const togglePlayerEdit = useCallback(async () => {
    if (!mapRow) return;
    const next = mapRow.editable_by === "party" ? "gm" : "party";
    const { error } = await supabase.from("world_maps").update({ editable_by: next }).eq("id", mapRow.id);
    if (error) { setStatus(error.message); return; }
    setMapRow({ ...mapRow, editable_by: next });
    setStatus(next === "party" ? "Players can now edit the map" : "Editing locked to you");
  }, [supabase, mapRow]);

  const publishSnapshot = useCallback(async () => {
    if (!mapRow || !terrain) return;
    setPublishing(true);
    setStatus("Rendering snapshot\u2026");
    try {
      const blob = await renderWorldSnapshot({
        terrain, colors, biomeArt, images, features,
        pois: pois.map((p) => ({ x: p.x, y: p.y, iconSrc: p.iconSrc })),
      });
      const fd = new FormData();
      fd.append("campaignId", campaignId);
      fd.append("file", new File([blob], "snapshot.png", { type: "image/png" }));
      const res = await fetch("/api/world-map/snapshot", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) { setStatus(json.error || "Publish failed."); return; }
      setMapRow({ ...mapRow, snapshot_url: json.url, published: true });
      setStatus("Published to the wiki");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }, [mapRow, terrain, colors, biomeArt, images, pois, campaignId]);

  const generateFantasyView = useCallback(async () => {
    if (!campaignId || !terrain) return;
    setImagining(true);
    setImagineMsg("Painting the world\u2026 this can take up to a minute.");
    try {
      const blob = await renderWorldSnapshot({ terrain, colors, biomeArt, features, pois: [], images: [], maxPx: 1280, mime: "image/jpeg", quality: 0.8, smooth: true });
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onloadend = () => res(String(r.result));
        r.onerror = () => rej(new Error("Could not read the control image."));
        r.readAsDataURL(blob);
      });
      const resp = await fetch("/api/world-map/imagine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, controlImage: dataUrl }),
      });
      const json = await resp.json();
      if (!resp.ok) { setImagineMsg(json.error || "Generation failed."); return; }
      setMapRow((prev) => (prev ? { ...prev, ai_image_url: json.url as string } : prev));
      setFantasyView(true);
      setImagineMsg(typeof json.remaining === "number" ? `Done. ${json.remaining} left today.` : "Done.");
    } catch (e) {
      setImagineMsg(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setImagining(false);
    }
  }, [campaignId, terrain, colors, biomeArt, images, features]);

  useEffect(() => {
    if (!mapRowId) { setFeatures([]); return; }
    let cancelled = false;
    supabase.from("map_features").select("kind, class, path, name").eq("world_map_id", mapRowId).then(({ data }) => {
      if (cancelled) return;
      const rows = (data ?? []) as { kind: "river" | "road"; class: number; path: [number, number][]; name: string | null }[];
      setFeatures(rows.map((r) => ({ kind: r.kind, klass: r.class, path: r.path, name: r.name })));
    });
    return () => { cancelled = true; };
  }, [mapRowId, supabase]);

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
      <button key={b.id} type="button" onClick={() => { setSelected(on ? null : b.id); setStamp(null); }} title={b.label}
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
        {mapRow && (
          <button type="button" onClick={togglePlayerEdit} title="Let party members add to this map"
            style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, cursor: "pointer",
              border: `1px solid ${mapRow.editable_by === "party" ? C.sun : C.line}`,
              background: mapRow.editable_by === "party" ? "rgba(200,162,75,0.14)" : C.surface2,
              color: C.text, fontWeight: 600 }}>
            Player editing: {mapRow.editable_by === "party" ? "On" : "Off"}
          </button>
        )}
        <button type="button" onClick={() => setArtEnabled((v) => !v)} title="Show the hand-painted terrain art"
          style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, cursor: "pointer",
            border: `1px solid ${artEnabled ? C.sun : C.line}`,
            background: artEnabled ? "rgba(200,162,75,0.14)" : C.surface2,
            color: C.text, fontWeight: 600 }}>
          Terrain art: {artEnabled ? "On" : "Off"}
        </button>
        {mapRow?.ai_image_url && (
          <button type="button" onClick={() => setFantasyView((v) => !v)} title="Show the AI-painted fantasy map under the grid"
            style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, cursor: "pointer",
              border: `1px solid ${fantasyView ? C.sun : C.line}`,
              background: fantasyView ? "rgba(200,162,75,0.14)" : C.surface2, color: C.text, fontWeight: 600 }}>
            Fantasy view: {fantasyView ? "On" : "Off"}
          </button>
        )}
        {mapRow && (
          <button type="button" onClick={generateFantasyView} disabled={imagining} title="Repaint the current world as a fantasy map (AI)"
            style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, cursor: imagining ? "default" : "pointer",
              border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontWeight: 600, opacity: imagining ? 0.6 : 1 }}>
            {imagining ? "Painting\u2026" : mapRow.ai_image_url ? "Regenerate fantasy view" : "Generate fantasy view"}
          </button>
        )}
        {imagineMsg && <span style={{ fontSize: 11, color: C.muted, alignSelf: "center" }}>{imagineMsg}</span>}
        {mapRow && (
          <button type="button" onClick={publishSnapshot} disabled={publishing}
            title="Render the world without hex lines and show it on the wiki"
            style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, cursor: publishing ? "default" : "pointer",
              border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontWeight: 600, opacity: publishing ? 0.6 : 1 }}>
            {publishing ? "Publishing\u2026" : mapRow.published ? "Update wiki snapshot" : "Publish to wiki"}
          </button>
        )}
        {campaignId && (
          <button type="button" onClick={() => setShowGen(true)} title="Generate a random world"
            style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, cursor: "pointer",
              border: `1px solid ${C.sun}`, background: "rgba(200,162,75,0.14)", color: C.text, fontWeight: 600 }}>
            Generate world
          </button>
        )}
        {showGen && campaignId && (
          <GenPanel campaignId={campaignId} onClose={() => setShowGen(false)} onAccepted={() => window.location.reload()} />
        )}
        {layerRows.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }} title="Step through the region tiers to see their names on the map">
            <span style={{ fontSize: 12, color: C.muted }}>View layer</span>
            <input type="range" min={-1} max={layerRows.length - 1}
              value={selectedLayerId ? layerRows.findIndex((l) => l.id === selectedLayerId) : -1}
              onChange={(e) => { const i = Number(e.target.value); setSelectedLayerId(i < 0 ? "" : (layerRows[i]?.id || "")); }} />
            <span style={{ fontSize: 12.5, color: selectedLayerId ? C.text : C.muted }}>{selectedLayerId ? (layerRows.find((l) => l.id === selectedLayerId)?.name || "") : "Off"}</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ ...surfaces.slate, padding: 12, flex: "0 0 230px", maxHeight: "72vh", overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {modeChip("Terrain", mode === "terrain", () => { setMode("terrain"); setPaintRegionId(null); })}
            {modeChip("Regions", mode === "regions", () => { setMode("regions"); setSelected(null); if (!selectedLayerId) setSelectedLayerId(layerRows[0]?.id || ""); })}
            {modeChip("Markers", mode === "pois", () => { setMode("pois"); setSelected(null); setPaintRegionId(null); })}
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
            {modeChip("Pan", selected === null && !stamp, () => { setSelected(null); setStamp(null); })}
            {modeChip("Erase", selected === BIOME_UNSET, () => { setSelected(BIOME_UNSET); setStamp(null); })}
          </div>
          {grouped.map((g) => (
            <div key={g.category} style={{ marginBottom: 12 }}>
              <div style={secLabel}>{(CATEGORY_LABEL[g.category] || g.category).toUpperCase()}</div>
              <div style={{ display: "grid", gap: 5 }}>{g.items.map(swatch)}</div>
            </div>
          ))}
          <div style={{ marginBottom: 12 }}>
            <div style={secLabel}>SPECIAL TERRAIN</div>
            <div style={{ fontSize: 11, color: C.muted, margin: "0 0 6px", lineHeight: 1.4 }}>Pick one, then click or drag hexes. Shows with Terrain art on.</div>
            <div style={{ display: "grid", gap: 5 }}>
              {SPECIAL_TERRAIN.map((sp) => {
                const on = stamp?.flag === sp.flag;
                return (
                  <button key={sp.key} type="button"
                    onClick={() => { if (on) { setStamp(null); } else { setStamp({ flag: sp.flag, biome: sp.biome }); setSelected(null); setArtEnabled(true); } }}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 7, cursor: "pointer",
                      border: `1px solid ${on ? C.sun : C.line}`, background: on ? "rgba(200,162,75,0.14)" : C.surface2, color: C.text }}>
                    <span style={{ fontSize: 12.5 }}>{sp.label}</span>
                  </button>
                );
              })}
              <button type="button"
                onClick={() => { if (stamp?.flag === 0) { setStamp(null); } else { setStamp({ flag: 0, biome: null }); setSelected(null); } }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 7, cursor: "pointer",
                  border: `1px solid ${stamp?.flag === 0 ? C.sun : C.line}`, background: stamp?.flag === 0 ? "rgba(200,162,75,0.14)" : C.surface2, color: C.muted }}>
                <span style={{ fontSize: 12.5 }}>Erase special</span>
              </button>
            </div>
          </div>
          </>)}
          {mode === "regions" && mapRow && (
            <RegionsPanel worldMapId={mapRow.id} campaignId={campaignId} onPaintState={onPaintState} onChanged={reloadRegions} />
          )}
          {mode === "pois" && campaignId && (
            <div>
              <div style={{ fontSize: 12.5, color: C.text, marginBottom: 8, lineHeight: 1.4 }}>
                {armedIcon ? "Click the map to place this marker. Pick another icon to switch." : "Pick or upload an icon below, then click the map to place a marker."}
              </div>
              <IconLibrary campaignId={campaignId} onPick={setArmedIcon} />
              <PoiPanel campaignId={campaignId} pois={poiRows} onPatch={patchPoi} onRemove={removePoi} />
              <MarkerLegend
                groups={markerGroups}
                markersHidden={markersHidden}
                hiddenCategories={hiddenCategories}
                onToggleAll={() => setMarkersHidden((v) => !v)}
                onToggleCategory={toggleCategory}
                c={C}
              />
              <RiverLabels rivers={namedRivers} onRename={renameRiver} c={C} />
              <LabelPanel labels={labelRows} placing={labelPlacing} onArm={armLabel} onPatch={patchLabel} onRemove={removeLabel} c={C} />
              <button type="button" onClick={clearAll}
                style={{ marginTop: 16, width: "100%", padding: "7px 9px", borderRadius: 7, cursor: "pointer", border: "1px solid #7a3b2f", background: "rgba(150,60,45,0.14)", color: "#e6b3a3", fontSize: 12.5, fontWeight: 600 }}>
                Clear all markers &amp; river names
              </button>
            </div>
          )}
        </div>

        <div style={{ ...surfaces.slate, padding: 0, flex: "1 1 520px", minWidth: 320, height: "72vh", position: "relative", overflow: "hidden", borderRadius: FORGE_RADIUS }}>
          {loading ? (
            <p style={{ color: C.muted, fontSize: 14, padding: 16 }}>Loading\u2026</p>
          ) : terrain ? (
            <HexCanvas
              terrain={terrain} colors={colors} biomeArt={biomeArt} artEnabled={artEnabled} features={features} baseImage={mapRow?.ai_image_url ?? null} showBaseImage={fantasyView} selectedBiome={selected} onPaint={onPaint} stampFlag={stamp?.flag ?? null} stampBiome={stamp?.biome ?? null} onStampFlag={onPaint}
              images={images} positionImageId={positionId} onImageMove={onImageMove} onImageScale={onImageScale}
              paintRegionId={paintRegionId} regionCells={regionCells} regionErase={regionErase} onRegionPaint={onRegionPaint}
              regionRender={selectedLayerId ? regionRender : undefined}
              pois={pois} poiPlaceActive={mode === "pois" && !!armedIcon} onPlacePoi={onPlacePoi} onPoiClick={onPoiClick} onPoiHover={onPoiHover} onMovePoi={onMovePoi}
              labels={labelRows} labelPlaceActive={mode === "pois" && labelPlacing} onPlaceLabel={placeLabel} onMoveLabel={moveLabel}
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
          {selectedPoi && (() => {
            const poi = poiRows.find((r) => r.id === selectedPoi.id);
            if (!poi) return null;
            const resolved = pois.find((pp) => pp.id === selectedPoi.id);
            const title = selectedEntry?.title || poi.name;
            const desc = selectedEntry?.body || poi.note || "";
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
                  <div style={{ fontSize: 12, color: C.muted, fontStyle: "italic" }}>No description yet.</div>
                )}
                {selectedChar && <div style={{ fontSize: 12, color: C.sun, marginTop: 8 }}>Linked character: {selectedChar.name}</div>}
              </div>
            );
          })()}
        </div>
      </div>
    </PageShell>
  );
}
