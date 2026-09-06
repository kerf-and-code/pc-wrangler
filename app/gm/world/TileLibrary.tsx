"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import {
  cropTile, pathHex, listCustomTiles, createCustomTile, deleteCustomTile,
  type CustomTile, type TileScope, type CropView,
} from "@/lib/tiles/custom";

// The GM's global custom-tile library, scoped to one map kind. Upload an image, pan/zoom to frame it,
// and crop to a hexagon (world) or square (dungeon); the saved tile joins the painter's palette. The
// parent owns nothing here except the onChange callback that hands it the current tile list, so the
// dungeon and world painters can add the tiles as brushes/hex types. Cropping + colour math live in
// lib/tiles/custom; persistence goes through /api/custom-tiles.

const V = 300;              // cropper viewport side (px)
const CLIP_HEX = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

export default function TileLibrary({ scope, onChange }: { scope: TileScope; onChange?: (tiles: CustomTile[]) => void }) {
  const isHex = scope === "world";
  const [tiles, setTiles] = useState<CustomTile[]>([]);
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState<CropView>({ scale: 1, ox: 0, oy: 0 });
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fitRef = useRef(1);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const publish = useCallback((next: CustomTile[]) => { setTiles(next); onChange?.(next); }, [onChange]);

  useEffect(() => { let off = false; (async () => { const t = await listCustomTiles(scope); if (!off) publish(t); })(); return () => { off = true; }; }, [scope, publish]);

  // ---- cropper preview ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, V, V);
    ctx.fillStyle = "#0e0b08"; ctx.fillRect(0, 0, V, V);
    if (img) ctx.drawImage(img, view.ox, view.oy, img.naturalWidth * view.scale, img.naturalHeight * view.scale);
    // dim everything outside the tile shape
    ctx.fillStyle = "rgba(8,6,5,0.6)";
    ctx.beginPath(); ctx.rect(0, 0, V, V);
    if (isHex) pathHex(ctx, V / 2, V / 2, V / 2); else ctx.rect(1, 1, V - 2, V - 2);
    ctx.fill("evenodd");
    // shape outline
    ctx.strokeStyle = C.sun; ctx.lineWidth = 2; ctx.beginPath();
    if (isHex) pathHex(ctx, V / 2, V / 2, V / 2 - 1); else ctx.rect(1, 1, V - 2, V - 2);
    ctx.stroke();
  }, [img, view, isHex]);
  useEffect(() => { draw(); }, [draw]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setMsg(null);
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const fit = Math.max(V / image.naturalWidth, V / image.naturalHeight);
      fitRef.current = fit;
      setImg(image);
      setView({ scale: fit, ox: (V - image.naturalWidth * fit) / 2, oy: (V - image.naturalHeight * fit) / 2 });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => { setMsg("Could not read that image."); URL.revokeObjectURL(url); };
    image.src = url;
  };

  const at = (e: React.PointerEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) * (V / r.width), y: (e.clientY - r.top) * (V / r.height) }; };
  const onDown = (e: React.PointerEvent) => { if (!img) return; dragRef.current = at(e); canvasRef.current?.setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { if (!dragRef.current) return; const p = at(e); setView((v) => ({ ...v, ox: v.ox + (p.x - dragRef.current!.x), oy: v.oy + (p.y - dragRef.current!.y) })); dragRef.current = p; };
  const onUp = () => { dragRef.current = null; };
  const zoom = (mult: number) => setView((v) => {
    const s = Math.max(fitRef.current * 0.4, Math.min(fitRef.current * 6, v.scale * mult));
    // keep the viewport centre anchored while zooming
    const cx = V / 2, cy = V / 2, f = s / v.scale;
    return { scale: s, ox: cx - (cx - v.ox) * f, oy: cy - (cy - v.oy) * f };
  });

  const save = async () => {
    if (!img) return;
    setBusy(true); setMsg(null);
    try {
      const { dataUrl, color } = cropTile(img, view, { viewport: V, out: 256, scope });
      if (!dataUrl) { setMsg("Could not crop that image."); return; }
      const tile = await createCustomTile({ scope, label: label.trim() || "Custom tile", dataUrl, color });
      if (!tile) { setMsg("Saving the tile failed. Try again."); return; }
      publish([tile, ...tiles]);
      setImg(null); setLabel(""); setOpen(false);
    } catch { setMsg("Something went wrong saving the tile."); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    const prev = tiles; publish(tiles.filter((t) => t.id !== id));
    const ok = await deleteCustomTile(id);
    if (!ok) { publish(prev); setMsg("Could not delete that tile."); }
  };

  const label3: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, margin: "0 0 8px" };
  const btn = (bg: string, fg: string): React.CSSProperties => ({ padding: "8px 12px", background: bg, color: fg, border: bg === "transparent" ? `1px solid ${C.line}` : "none", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 });
  const thumbClip = useMemo(() => (isHex ? { clipPath: CLIP_HEX } : { borderRadius: 6 }), [isHex]);

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={label3}>Custom {isHex ? "hex" : "square"} tiles ({tiles.length})</span>
        <button type="button" onClick={() => { setOpen((o) => !o); setMsg(null); }} style={btn(open ? "transparent" : C.sun, open ? C.text : "#1b1712")}>{open ? "Close" : "Add tile"}</button>
      </div>

      {open && (
        <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div>
            <canvas ref={canvasRef} width={V} height={V} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
              style={{ display: "block", width: V, maxWidth: "80vw", height: "auto", aspectRatio: "1 / 1", borderRadius: 8, background: "#0e0b08", cursor: img ? "grab" : "default", touchAction: "none" }} />
            {img && <p style={{ color: C.muted, fontSize: 12, margin: "6px 2px 0" }}>Drag to position &middot; zoom to frame the {isHex ? "hex" : "square"}.</p>}
          </div>
          <div style={{ minWidth: 180, flex: 1 }}>
            <label style={label3}>1 &middot; Choose an image</label>
            <label style={{ ...btn(C.surface2, C.text), display: "inline-block" }}>
              {img ? "Change image" : "Upload image"}
              <input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
            </label>
            {img && (
              <>
                <label style={{ ...label3, marginTop: 14 }}>2 &middot; Zoom</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => zoom(1 / 1.2)} style={btn("transparent", C.text)}>&minus;</button>
                  <button type="button" onClick={() => zoom(1.2)} style={btn("transparent", C.text)}>+</button>
                  <button type="button" onClick={() => { const f = fitRef.current; setView({ scale: f, ox: (V - img.naturalWidth * f) / 2, oy: (V - img.naturalHeight * f) / 2 }); }} style={btn("transparent", C.muted)}>Reset</button>
                </div>
                <label style={{ ...label3, marginTop: 14 }}>3 &middot; Name</label>
                <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Mushroom grotto"
                  style={{ width: "100%", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 13 }} />
                <div style={{ marginTop: 14 }}><button type="button" onClick={save} disabled={busy} style={{ ...btn(C.sun, "#1b1712"), width: "100%" }}>{busy ? "Saving…" : "Save tile to library"}</button></div>
              </>
            )}
          </div>
        </div>
      )}

      {tiles.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {tiles.map((t) => (
            <div key={t.id} style={{ width: 72, textAlign: "center" }}>
              <div style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.imageUrl} alt={t.label} style={{ width: 72, height: 72, objectFit: "cover", background: t.color, ...thumbClip }} />
                <button type="button" onClick={() => remove(t.id)} title="Delete tile"
                  style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 999, background: C.surface2, color: C.muted, border: `1px solid ${C.line}`, fontSize: 12, cursor: "pointer", lineHeight: "18px" }}>&times;</button>
              </div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {msg && <p style={{ color: "#c98a7a", fontSize: 12, marginTop: 10 }}>{msg}</p>}
    </div>
  );
}
