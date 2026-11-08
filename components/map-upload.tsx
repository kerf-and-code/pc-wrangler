"use client";

// components/map-upload.tsx (2026-11-07)
//
// Phase 4d: put a map image from a published module or campaign on the tabletop. The GM picks the image,
// lines the table's grid up with the map (squares across, square size, and a drag to shift the grid
// onto the map's own lines), and the map becomes an ordinary battle map and scene:
//
//   * the browser crops the image to the grid the GM lined up, scales it to the size the tabletop draws
//     a square at (no more pixels than the table will ever show), and pads it to a square, because a
//     battle map is n by n squares everywhere (fog, sight, token bounds). The padding is dark and sits
//     on the right or the bottom, outside the map;
//   * the result goes straight to storage through a signed upload URL (app/api/tabletop/map-upload), so
//     a large map never passes through a serverless request body;
//   * a battle_maps row is made like the map maker makes one (blankMap, toRow): open ground, with the
//     image as its painting at full opacity, and a scene for it is put on the table.
//
// Nothing is sent anywhere until the GM presses "Put it on the table".
//
// Phase 5j: the Battle Map editor opens the same dialog for two more jobs (the `dest` prop):
//   * "map": make a new battle map from the image, without putting it on the table (onDone gets the
//     map's id, and the editor opens it, ready for doors and sight walls);
//   * "level": use the image as the painting of a level of the map being edited. The grid is that map's,
//     so the squares across start at its size and the image may not cover more than it (onDone gets the
//     image's URL).
// An uploaded image is saved as an overlay with style "upload", so the editor never calls it out of date.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C } from "@/lib/forge-theme";
import { blankMap, levelSig, toRow } from "@/lib/dungeon/battle";

const MAX_FILE = 60 * 1024 * 1024;          // a browser can decode this; bigger maps are usually print scans
const MIN_SQ = 4;                            // squares per side, at least (battle_maps allows 5 to 200)
const MAX_SQ = 200;

type Calib = { px: number; ox: number; oy: number };

// The size the tabletop draws one square at for a map n squares across (TabletopClient renderBase).
export const tableCell = (n: number) => Math.max(16, Math.min(64, Math.floor(4096 / n)));

// How many whole squares fit from the offset to the edge (a sliver under a fifth of a square is dropped).
export function squaresIn(len: number, off: number, px: number): number {
  if (!(px > 0)) return 0;
  return Math.max(0, Math.floor((len - off) / px + 0.2));
}

// The square image the tabletop gets: the grid region of the source, scaled so a square is `cell` pixels.
// nFixed: the grid is an existing map's (n squares a side) rather than one sized to the image.
export function squareUp(img: CanvasImageSource, iw: number, ih: number, c: Calib, cols: number, rows: number, nFixed?: number): { canvas: HTMLCanvasElement; n: number; cell: number } {
  const n = nFixed ?? Math.max(5, Math.max(cols, rows));
  const cell = Math.max(8, Math.min(tableCell(n), Math.round(c.px)));
  const cv = document.createElement("canvas");
  cv.width = n * cell; cv.height = n * cell;
  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#15120f"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingQuality = "high";
    const sw = Math.min(cols * c.px, iw - c.ox), sh = Math.min(rows * c.px, ih - c.oy);
    ctx.drawImage(img, c.ox, c.oy, sw, sh, 0, 0, (sw / c.px) * cell, (sh / c.px) * cell);
  }
  return { canvas: cv, n, cell };
}

const toBlob = (cv: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((res) => cv.toBlob(res, type, q));

export type UploadDest = { kind: "table" } | { kind: "map" } | { kind: "level"; n: number; levelName: string };

export default function MapUpload({ campaignId, onClose, onDone, dest = { kind: "table" } }: {
  campaignId: string; onClose: () => void;
  /** table: the new scene's id; map: the new battle map's id; level: the uploaded image's URL */
  onDone: (result: string) => void;
  dest?: UploadDest;
}) {
  const fixedN = dest.kind === "level" ? dest.n : undefined;
  const supabase = useMemo(() => createClient(), []);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [name, setName] = useState("");
  const [cal, setCal] = useState<Calib>({ px: 70, ox: 0, oy: 0 });
  const [across, setAcross] = useState("");
  const [fps, setFps] = useState("5");
  const [gridOver, setGridOver] = useState(true);
  const [zoom, setZoom] = useState<"fit" | "1">("fit");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const urlRef = useRef<string | null>(null);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const iw = img?.naturalWidth ?? 0, ih = img?.naturalHeight ?? 0;
  const cols = squaresIn(iw, cal.ox, cal.px), rows = squaresIn(ih, cal.oy, cal.px);
  const view = zoom === "fit" && iw ? Math.min(1, 860 / iw, 520 / ih) : 1;

  const pick = (f: File | null | undefined) => {
    setErr(null);
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { setErr("Use a PNG, JPEG, WebP or GIF image."); return; }
    if (f.size > MAX_FILE) { setErr("That image is over 60 MB. Export it smaller first."); return; }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(f); urlRef.current = url;
    const im = new Image();
    im.onload = () => {
      setImg(im);
      setName((n) => n || f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 80));
      // a common size for module maps is 70 or 140 pixels a square; start from 70 and let the GM correct it
      // onto an existing map, start from the image spanning that map's whole grid
      if (fixedN) { setCal({ px: im.naturalWidth / fixedN, ox: 0, oy: 0 }); setAcross(String(fixedN)); return; }
      const guess = im.naturalWidth >= 2800 && im.naturalWidth % 140 < 6 ? 140 : 70;
      setCal({ px: guess, ox: 0, oy: 0 }); setAcross(String(squaresIn(im.naturalWidth, 0, guess)));
    };
    im.onerror = () => setErr("Could not read that image.");
    im.src = url;
  };

  // the preview: the map, the grid as the table will lay it, and the region that will be kept
  const draw = useCallback(() => {
    const cv = cvRef.current; if (!cv || !img) return;
    cv.width = Math.round(iw * view); cv.height = Math.round(ih * view);
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const s = view, x0 = cal.ox * s, y0 = cal.oy * s, w = cols * cal.px * s, h = rows * cal.px * s;
    ctx.fillStyle = "rgba(10,8,6,0.55)";
    ctx.fillRect(0, 0, cv.width, y0); ctx.fillRect(0, y0 + h, cv.width, cv.height - y0 - h);
    ctx.fillRect(0, y0, x0, h); ctx.fillRect(x0 + w, y0, cv.width - x0 - w, h);
    ctx.strokeStyle = "rgba(255,80,60,0.9)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) { const x = Math.round(x0 + c * cal.px * s) + 0.5; ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h); }
    for (let r = 0; r <= rows; r++) { const y = Math.round(y0 + r * cal.px * s) + 0.5; ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); }
    ctx.stroke();
    ctx.strokeStyle = "#d9a43a"; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, w, h);
  }, [img, iw, ih, view, cal, cols, rows]);
  useEffect(() => { draw(); }, [draw]);

  const setPx = (px: number) => setCal((c) => ({ ...c, px: Math.max(4, Math.min(2000, px)), ox: c.ox % Math.max(4, px), oy: c.oy % Math.max(4, px) }));
  const fitAcross = (v: string) => {
    setAcross(v);
    const a = parseInt(v, 10);
    if (a >= 1 && iw) setPx((iw - cal.ox) / a);
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: cal.ox, oy: cal.oy };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current; if (!d) return;
    const wrap = (v: number) => ((v % cal.px) + cal.px) % cal.px;
    setCal((c) => ({ ...c, ox: wrap(d.ox + (e.clientX - d.x) / view), oy: wrap(d.oy + (e.clientY - d.y) / view) }));
  };
  const onUp = () => { dragRef.current = null; };

  const tooSmall = cols < MIN_SQ || rows < MIN_SQ, tooBig = Math.max(cols, rows) > (fixedN ?? MAX_SQ);
  const feet = Math.max(1, Math.min(1000, parseInt(fps, 10) || 5));

  const save = async () => {
    if (!img || tooSmall || tooBig) return;
    setErr(null);
    try {
      setBusy("Preparing the image");
      const { canvas, n } = squareUp(img, iw, ih, cal, cols, rows, fixedN);
      let blob = await toBlob(canvas, "image/webp", 0.9);
      if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", 0.9);
      if (!blob) throw new Error("This browser could not export the image.");
      setBusy("Uploading");
      const res = await fetch("/api/tabletop/map-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, type: blob.type }) });
      const j = await res.json().catch(() => ({})) as { error?: string; path?: string; token?: string; url?: string };
      if (!res.ok || !j.path || !j.token || !j.url) throw new Error(j.error ?? "Could not start the upload.");
      const up = await supabase.storage.from("campaign-maps").uploadToSignedUrl(j.path, j.token, blob, { contentType: blob.type });
      if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
      if (dest.kind === "level") { onDone(j.url); return; }

      setBusy("Making the map");
      const title = name.trim() || "Uploaded map";
      const m = blankMap("", title, "outdoor", n);
      m.feetPerSquare = feet;
      m.meta.topGrid = { show: gridOver, opacity: 0.35 };
      m.meta.overlays[0] = { url: j.url, at: new Date().toISOString(), sig: levelSig(m, 0), style: "upload", show: true, opacity: 1, inkOnTop: false, piecesOnTop: false };
      const { data: bm, error: e1 } = await supabase.from("battle_maps").insert({ campaign_id: campaignId, ...toRow(m) }).select("id").single();
      if (e1 || !bm) throw new Error(`Could not save the map: ${e1?.message ?? "no row"}`);
      if (dest.kind === "map") { onDone((bm as { id: string }).id); return; }
      const { data: sc, error: e2 } = await supabase.from("vtt_scenes").insert({ campaign_id: campaignId, battle_map_id: (bm as { id: string }).id, level: 0, name: title, settings: {} }).select("id").single();
      if (e2 || !sc) throw new Error(`Could not make the scene: ${e2?.message ?? "no row"}`);
      const { error: e3 } = await supabase.rpc("tabletop_activate_scene", { p_scene: (sc as { id: string }).id });
      if (e3) throw new Error(e3.message);
      onDone((sc as { id: string }).id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally { setBusy(null); }
  };

  const field: React.CSSProperties = { padding: "6px 8px", borderRadius: 7, border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontSize: 13 };
  const small: React.CSSProperties = { padding: "5px 10px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" };
  const label: React.CSSProperties = { fontSize: 12, color: C.muted, display: "grid", gap: 3 };
  return (
    <div role="dialog" aria-modal="true" aria-label="Upload a map image" onKeyDown={(e) => { if (e.key === "Escape" && !busy) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(8,6,4,0.72)", display: "grid", placeItems: "center", zIndex: 60, padding: 16 }}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, width: "min(940px, 100%)", maxHeight: "100%", overflow: "auto", padding: 16, color: C.text }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <strong style={{ fontSize: 16 }}>Upload a map image</strong>
          <span style={{ color: C.muted, fontSize: 12.5 }}>
            {dest.kind === "level" ? `Your own image for ${dest.levelName}, lined up with this map's ${dest.n} by ${dest.n} grid.` : "A battle map from a module or campaign, lined up with the table's grid."}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" disabled={!!busy} onClick={onClose} style={small}>Close</button>
        </div>
        {!img ? (
          <label style={{ display: "grid", placeItems: "center", gap: 8, marginTop: 14, padding: "40px 16px", border: `2px dashed ${C.line}`, borderRadius: 10, cursor: "pointer", textAlign: "center" }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}>
            <span style={{ fontSize: 14 }}>Choose a map image, or drop one here</span>
            <span style={{ fontSize: 12, color: C.muted }}>PNG, JPEG, WebP or GIF. Only use maps you own or have the right to use at your table.</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => pick(e.target.files?.[0])} style={{ fontSize: 12.5 }} />
          </label>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: C.muted, margin: "10px 0 8px" }}>
              Set how many squares the map is across, then drag the red grid until it sits on the map&apos;s own lines. Fine-tune the square size if the lines drift
              toward the far edge. The gold box is what goes on the table.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
              {!fixedN && <label style={label}>Name<input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} style={{ ...field, width: 200 }} /></label>}
              <label style={label}>Squares across<input aria-label="Squares across" value={across} inputMode="numeric" onChange={(e) => fitAcross(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} style={{ ...field, width: 70 }} /></label>
              <label style={label}>Square size (px)
                <span style={{ display: "flex", gap: 4 }}>
                  <button type="button" aria-label="Smaller squares" onClick={() => setPx(cal.px - 0.25)} style={small}>-</button>
                  <input aria-label="Square size in pixels" value={Math.round(cal.px * 100) / 100} inputMode="decimal"
                    onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) setPx(v); }} style={{ ...field, width: 72 }} />
                  <button type="button" aria-label="Larger squares" onClick={() => setPx(cal.px + 0.25)} style={small}>+</button>
                </span>
              </label>
              {!fixedN && <label style={label}>Feet per square<input aria-label="Feet per square" value={fps} inputMode="numeric" onChange={(e) => setFps(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} style={{ ...field, width: 60 }} /></label>}
              {!fixedN && <label style={{ ...label, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={gridOver} onChange={(e) => setGridOver(e.target.checked)} />Table grid over the map</label>}
              <span style={{ flex: 1 }} />
              <span role="group" aria-label="Preview zoom" style={{ display: "flex", gap: 4 }}>
                <button type="button" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")} style={{ ...small, color: zoom === "fit" ? C.sun : C.muted }}>Fit</button>
                <button type="button" aria-pressed={zoom === "1"} onClick={() => setZoom("1")} style={{ ...small, color: zoom === "1" ? C.sun : C.muted }}>Actual size</button>
              </span>
            </div>
            <div style={{ marginTop: 10, maxHeight: 540, overflow: "auto", border: `1px solid ${C.line}`, borderRadius: 8, background: "#0e0c0a" }}>
              <canvas ref={cvRef} aria-label="Map preview with the grid; drag to shift the grid" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                style={{ display: "block", cursor: "move", touchAction: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
              <span style={{ fontSize: 13 }} role="status">
                {fixedN
                  ? `${cols} by ${rows} squares of this map's ${fixedN} by ${fixedN}${cols < fixedN || rows < fixedN ? ", from the top-left corner; the rest of the grid stays dark." : "."}`
                  : <>{cols} by {rows} squares ({cols * feet} by {rows * feet} ft){cols !== rows && !tooSmall && !tooBig ? `. The table is square, so it gets ${Math.max(cols, rows) - Math.min(cols, rows)} empty ${cols > rows ? "rows" : "columns"} past the map's edge.` : "."}</>}
              </span>
              {tooSmall && <span style={{ fontSize: 12.5, color: "#e07a70" }}>That is under {MIN_SQ} squares a side: make the squares smaller.</span>}
              {tooBig && <span style={{ fontSize: 12.5, color: "#e07a70" }}>{fixedN ? `This map is ${fixedN} squares a side: make the squares larger, or change the map's grid size first.` : `The table holds up to ${MAX_SQ} squares a side: make the squares larger.`}</span>}
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => { setImg(null); setErr(null); }} disabled={!!busy} style={small}>Choose another</button>
              <button type="button" disabled={!!busy || tooSmall || tooBig} onClick={() => void save()}
                style={{ ...small, border: "none", background: tooSmall || tooBig ? C.line : C.sun, color: "#1b1712", fontWeight: 700, padding: "8px 16px" }}>
                {busy ? `${busy}…` : dest.kind === "level" ? "Use it on this level" : dest.kind === "map" ? "Make the map" : "Put it on the table"}
              </button>
            </div>
          </>
        )}
        {err && <p role="alert" style={{ color: "#e07a70", fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}
      </div>
    </div>
  );
}
