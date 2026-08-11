"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { surfaces, ui } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import HexCanvas from "@/components/worldmap/HexCanvas";
import {
  type Terrain, createTerrain, decodeTerrain, encodeTerrain, base64ToBytes, bytesToBase64, expandTerrain, BIOME_UNSET,
} from "@/lib/worldmap/hex";

// The GM's world map, in paint mode, with an optional uploaded background image and a settable grid
// size in hex units. Loads (or creates) the one world_maps row for the selected campaign, shows the
// 28 biomes as a palette, decodes the terrain blob into the shared canvas, and saves the re-encoded
// blob (debounced) as the GM paints. Sits beside /gm/map, the image-and-pins tactical map.

type Campaign = { id: string; name: string };
type Biome = { id: number; key: string; label: string; category: string; color: string };
type MapRow = {
  id: string; name: string; width: number; height: number;
  origin_col: number; origin_row: number; format_version: number; terrain: string | null; image_url: string | null;
};

const MAP_COLS = "id, name, width, height, origin_col, origin_row, format_version, terrain, image_url";
const IMG_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMG_BYTES = 8 * 1024 * 1024;
const MAX_DIM = 250;
const CATEGORY_ORDER = ["terrestrial", "wetland", "water", "geologic", "fantasy"];
const CATEGORY_LABEL: Record<string, string> = {
  terrestrial: "Terrestrial", wetland: "Wetland", water: "Water", geologic: "Mountain & geologic", fantasy: "Fantasy",
};

export default function WorldMapPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [biomes, setBiomes] = useState<Biome[]>([]);
  const [mapRow, setMapRow] = useState<MapRow | null>(null);
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
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
      setImageUrl(null);
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
      setImageUrl(row?.image_url ?? null);
      if (row) { setSizeW(String(row.width)); setSizeH(String(row.height)); }
      setTerrain(row
        ? (row.terrain ? decodeTerrain(base64ToBytes(row.terrain)) : createTerrain(row.width, row.height, row.origin_col, row.origin_row))
        : null);
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
    // Upload through a server route (service role): storage RLS does not authenticate the browser
    // session here, so a client upload is denied. Then set image_url client-side (the DB does auth).
    const form = new FormData();
    form.append("campaignId", campaignId);
    form.append("file", file);
    const res = await fetch("/api/world-map/image", { method: "POST", body: form });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) { setStatus(`Upload failed: ${data.error || "unknown error"}`); return; }
    const { error } = await supabase.from("world_maps").update({ image_url: data.url }).eq("id", mapRow.id);
    if (error) { setStatus(`Save failed: ${error.message}`); return; }
    setImageUrl(data.url);
    setStatus("Map image set");
  }, [supabase, mapRow, campaignId]);

  const removeImage = useCallback(async () => {
    if (!mapRow) return;
    const { error } = await supabase.from("world_maps").update({ image_url: null }).eq("id", mapRow.id);
    if (error) { setStatus(`Failed: ${error.message}`); return; }
    setImageUrl(null);
    setStatus("Map image removed");
  }, [supabase, mapRow]);

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

  return (
    <PageShell width={1200}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>World map</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 16px" }}>
        Paint biomes across the world, or upload your own map and designate areas over it. Pick a biome and drag to paint, Erase to clear a mis-painted hex, or Pan to move the view. Scroll to zoom.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
          style={{ background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", fontSize: 14 }}>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span style={{ fontSize: 12.5, color: C.muted }}>{status}</span>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ ...surfaces.slate, padding: 12, flex: "0 0 220px", maxHeight: "72vh", overflowY: "auto" }}>
          <div style={{ marginBottom: 14 }}>
            <div style={secLabel}>MAP SIZE (HEXES)</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" min={1} max={MAX_DIM} value={sizeW} onChange={(e) => setSizeW(e.target.value)} style={numInput} />
              <span style={{ color: C.muted, fontSize: 13 }}>x</span>
              <input type="number" min={1} max={MAX_DIM} value={sizeH} onChange={(e) => setSizeH(e.target.value)} style={numInput} />
              <button type="button" onClick={applyResize} style={smallBtn}>Resize</button>
            </div>
            <p style={{ fontSize: 11, color: C.muted, margin: "6px 0 0", lineHeight: 1.4 }}>
              1 to 250 each. Match an uploaded map&apos;s aspect so the grid is not too fine. Shrinking drops hexes outside the new area, kept centred.
            </p>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={secLabel}>MAP BACKGROUND</div>
            <label style={{
              display: "block", textAlign: "center", padding: "7px 9px", borderRadius: 7, cursor: "pointer",
              border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 12.5, fontWeight: 600,
            }}>
              {imageUrl ? "Replace image" : "Upload an image"}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} style={{ display: "none" }} />
            </label>
            {imageUrl && (
              <button type="button" onClick={removeImage}
                style={{ marginTop: 6, width: "100%", background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 9px", fontSize: 12, cursor: "pointer" }}>
                Remove image
              </button>
            )}
            <p style={{ fontSize: 11, color: C.muted, margin: "6px 0 0", lineHeight: 1.4 }}>
              PNG, JPG or WebP, under 8 MB. With an image, biome art turns off and painted hexes show as a faint tint.
            </p>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button type="button" onClick={() => setSelected(null)}
              style={{
                flex: 1, textAlign: "center", padding: "7px 9px", borderRadius: 7, cursor: "pointer",
                border: `1px solid ${selected === null ? C.sun : C.line}`, background: selected === null ? "rgba(200,162,75,0.14)" : C.surface2,
                color: C.text, fontSize: 12.5, fontWeight: 600,
              }}>
              Pan
            </button>
            <button type="button" onClick={() => setSelected(BIOME_UNSET)}
              style={{
                flex: 1, textAlign: "center", padding: "7px 9px", borderRadius: 7, cursor: "pointer",
                border: `1px solid ${selected === BIOME_UNSET ? C.sun : C.line}`, background: selected === BIOME_UNSET ? "rgba(200,162,75,0.14)" : C.surface2,
                color: C.text, fontSize: 12.5, fontWeight: 600,
              }}>
              Erase
            </button>
          </div>
          {grouped.map((g) => (
            <div key={g.category} style={{ marginBottom: 12 }}>
              <div style={secLabel}>{(CATEGORY_LABEL[g.category] || g.category).toUpperCase()}</div>
              <div style={{ display: "grid", gap: 5 }}>{g.items.map(swatch)}</div>
            </div>
          ))}
        </div>

        <div style={{ ...surfaces.slate, padding: 0, flex: "1 1 520px", minWidth: 320, height: "72vh", position: "relative", overflow: "hidden", borderRadius: FORGE_RADIUS }}>
          {loading ? (
            <p style={{ color: C.muted, fontSize: 14, padding: 16 }}>Loading\u2026</p>
          ) : terrain ? (
            <HexCanvas terrain={terrain} colors={colors} selectedBiome={selected} onPaint={onPaint} backgroundImageUrl={imageUrl} />
          ) : (
            <p style={{ color: C.muted, fontSize: 14, padding: 16 }}>Pick a campaign to start its world map.</p>
          )}
        </div>
      </div>
    </PageShell>
  );
}
