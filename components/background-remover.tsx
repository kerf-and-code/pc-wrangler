"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { HANDOFF_KEY, applyMask, autoMask, keepLargest, keptShare, paintMask, tightenEdge, wandRemove } from "@/lib/tabletop/cutout";

// components/background-remover.tsx (2026-11-08)
//
// The free background remover (/tools/background-remover). Same engine as the token maker
// (lib/tabletop/cutout.ts): an automatic pass from the picture's edge colours, a click-to-remove tool
// for background trapped inside the subject, erase and restore brushes, keep-the-largest-piece and
// tighten-edge clean-ups. Editing happens on a copy at most EDIT_SIDE pixels across; the download
// applies the mask to the ORIGINAL picture at full resolution. Nothing leaves the browser.
//
// "Make a token from this" hands the cut-out to the token maker through sessionStorage.

const EDIT_SIDE = 1600;
const ui = { text: "#f2e6c9", muted: "#a89a84", line: "rgba(255,255,255,0.16)", surface: "#1e1a16", sun: "#d9a43a", warn: "#e07a70" };
const sectionH: React.CSSProperties = { fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: ui.muted, margin: "16px 0 6px" };
const btn = (on = false): React.CSSProperties => ({ padding: "6px 11px", borderRadius: 8, border: `1px solid ${on ? ui.sun : ui.line}`, background: on ? "rgba(217,164,58,0.16)" : "transparent", color: on ? ui.sun : ui.text, fontSize: 13, cursor: "pointer" });
const primary: React.CSSProperties = { padding: "9px 16px", borderRadius: 8, border: `1px solid ${ui.sun}`, background: ui.sun, color: "#1a1410", fontWeight: 700, fontSize: 14, cursor: "pointer" };
const field: React.CSSProperties = { padding: "6px 8px", borderRadius: 7, border: `1px solid ${ui.line}`, background: ui.surface, color: ui.text, fontSize: 13 };
const rowS: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" };
const lab: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: ui.text };

type Pic = { w: number; h: number; rgba: Uint8ClampedArray; orig: HTMLImageElement; name: string };
type Tool = "move" | "wand" | "erase" | "restore";
type Backdrop = "checker" | "white" | "black" | "colour";

export default function BackgroundRemover() {
  const [pic, setPic] = useState<Pic | null>(null);
  const [mask, setMask] = useState<Uint8ClampedArray | null>(null);
  const [history, setHistory] = useState<Uint8ClampedArray[]>([]);
  const [tolerance, setTolerance] = useState(35);
  const [autoOn, setAutoOn] = useState(false);
  const [tool, setTool] = useState<Tool>("wand");
  const [brush, setBrush] = useState(24);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [backdrop, setBackdrop] = useState<Backdrop>("checker");
  const [colour, setColour] = useState("#ffffff");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cutRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; painting: boolean } | null>(null);
  const hoverAt = useRef<{ x: number; y: number } | null>(null);
  const strokeMask = useRef<Uint8ClampedArray | null>(null);
  const [, setFrameTick] = useState(0);

  const refreshCut = useCallback((p: Pic | null, m: Uint8ClampedArray | null) => {
    if (!p) { cutRef.current = null; return; }
    const cv = cutRef.current ?? document.createElement("canvas");
    cv.width = p.w; cv.height = p.h;
    cv.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(m ? applyMask(p.rgba, m) : p.rgba), p.w, p.h), 0, 0);
    cutRef.current = cv;
    setFrameTick((v) => v + 1);
  }, []);
  useEffect(() => { refreshCut(pic, mask); }, [pic, mask, refreshCut]);

  const openFile = useCallback((f: File | undefined | null) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) { setMsg("Choose an image file (PNG, JPEG, WebP or GIF)."); return; }
    setMsg(null);
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, EDIT_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
      const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const c = cv.getContext("2d")!; c.drawImage(im, 0, 0, w, h);
      const p: Pic = { w, h, rgba: c.getImageData(0, 0, w, h).data, orig: im, name: f.name.replace(/\.[^.]+$/, "") || "picture" };
      setPic(p); setMask(new Uint8ClampedArray(w * h).fill(255)); setHistory([]); setAutoOn(false); setZoom(1); setPan({ x: 0, y: 0 });
    };
    im.onerror = () => setMsg("That picture could not be opened.");
    im.src = url;
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) { const f = item.getAsFile(); if (f) { e.preventDefault(); openFile(f); } }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [openFile]);

  // view geometry: the picture fits the canvas at zoom 1
  const geom = () => {
    const cv = canvasRef.current, cut = cutRef.current;
    if (!cv || !cut) return null;
    const W = cv.clientWidth, H = cv.clientHeight;
    const fit = Math.min(W / cut.width, H / cut.height) * 0.94, k = fit * zoom;
    return { W, H, k, x0: W / 2 + pan.x * W - (cut.width * k) / 2, y0: H / 2 + pan.y * H - (cut.height * k) / 2 };
  };

  // draw
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext("2d")!; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const g = geom(), cut = cutRef.current;
    if (!g || !cut) {
      c.fillStyle = "#24201b"; c.fillRect(0, 0, W, H);
      c.fillStyle = ui.muted; c.font = "600 15px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("Choose, drop or paste a picture", W / 2, H / 2);
      return;
    }
    if (backdrop === "checker") { const sq = 12; for (let y = 0; y < H; y += sq) for (let x = 0; x < W; x += sq) { c.fillStyle = ((x + y) / sq) % 2 ? "#2b2622" : "#3a342d"; c.fillRect(x, y, sq, sq); } }
    else { c.fillStyle = backdrop === "white" ? "#ffffff" : backdrop === "black" ? "#000000" : colour; c.fillRect(0, 0, W, H); }
    c.imageSmoothingQuality = "high";
    c.drawImage(cut, g.x0, g.y0, cut.width * g.k, cut.height * g.k);
    const hv = hoverAt.current;
    if (hv && (tool === "erase" || tool === "restore")) { c.beginPath(); c.arc(hv.x, hv.y, brush / 2, 0, Math.PI * 2); c.strokeStyle = tool === "erase" ? ui.warn : "#8fd18a"; c.lineWidth = 1.5; c.stroke(); }
  });

  const local = (e: React.PointerEvent) => { const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const toImage = (x: number, y: number) => { const g = geom(); return g ? { x: (x - g.x0) / g.k, y: (y - g.y0) / g.k, k: g.k } : null; };
  const pushHistory = (m: Uint8ClampedArray) => setHistory((h) => [...h.slice(-14), new Uint8ClampedArray(m)]);

  const paintAt = (x: number, y: number) => {
    if (!pic || !strokeMask.current) return;
    const q = toImage(x, y); if (!q) return;
    paintMask(strokeMask.current, pic.w, pic.h, q.x, q.y, brush / 2 / q.k, tool === "erase" ? 0 : 255);
    refreshCut(pic, strokeMask.current);
  };
  const onDown = (e: React.PointerEvent) => {
    if (!pic || !mask) { fileRef.current?.click(); return; }
    const p = local(e);
    if (tool === "wand") {
      const q = toImage(p.x, p.y); if (!q) return;
      const m = new Uint8ClampedArray(mask); pushHistory(mask);
      const n = wandRemove(pic.rgba, m, pic.w, pic.h, q.x, q.y, tolerance);
      setMask(m); setMsg(n ? null : "Nothing there to remove. Click on a patch of the background colour.");
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const painting = tool === "erase" || tool === "restore";
    drag.current = { x: p.x, y: p.y, px: pan.x, py: pan.y, painting };
    if (painting) { pushHistory(mask); strokeMask.current = new Uint8ClampedArray(mask); paintAt(p.x, p.y); }
  };
  const onMove = (e: React.PointerEvent) => {
    const p = local(e); hoverAt.current = p;
    if (!drag.current) { if (tool === "erase" || tool === "restore") setFrameTick((v) => v + 1); return; }
    if (drag.current.painting) { paintAt(p.x, p.y); return; }
    const cv = canvasRef.current; if (!cv) return;
    setPan({ x: drag.current.px + (p.x - drag.current.x) / cv.clientWidth, y: drag.current.py + (p.y - drag.current.y) / cv.clientHeight });
  };
  const onUp = () => {
    if (drag.current?.painting && strokeMask.current) setMask(strokeMask.current);
    strokeMask.current = null; drag.current = null;
  };
  const onLeave = () => { hoverAt.current = null; setFrameTick((v) => v + 1); };
  const onWheel = (e: React.WheelEvent) => { if (pic) setZoom((z) => Math.max(0.5, Math.min(8, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))); };

  const runAuto = () => {
    if (!pic || !mask) return;
    pushHistory(mask);
    const m = autoMask(pic.rgba, pic.w, pic.h, tolerance);
    setMask(m); setAutoOn(true);
    const k = keptShare(m);
    setMsg(k > 0.985 ? "No background was found at the edges. Raise the tolerance, or click the background to remove it." : k < 0.04 ? "That removed almost everything. Lower the tolerance, or undo." : null);
  };
  const apply = (fn: (m: Uint8ClampedArray) => Uint8ClampedArray) => { if (!pic || !mask) return; pushHistory(mask); setMask(fn(mask)); };
  const undo = () => setHistory((h) => { if (!h.length) return h; setMask(h[h.length - 1]); return h.slice(0, -1); });

  /** The result at the original picture's full size, the mask scaled up to match. */
  const fullSize = (fill: string | null): HTMLCanvasElement | null => {
    if (!pic || !mask) return null;
    const W = pic.orig.naturalWidth, H = pic.orig.naturalHeight;
    const out = document.createElement("canvas"); out.width = W; out.height = H;
    const oc = out.getContext("2d")!;
    oc.drawImage(pic.orig, 0, 0);
    const mc = document.createElement("canvas"); mc.width = pic.w; mc.height = pic.h;
    const md = new ImageData(pic.w, pic.h); for (let p = 0; p < mask.length; p++) md.data[p * 4 + 3] = mask[p];
    mc.getContext("2d")!.putImageData(md, 0, 0);
    oc.globalCompositeOperation = "destination-in"; oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = "high";
    oc.drawImage(mc, 0, 0, W, H);
    if (fill) { oc.globalCompositeOperation = "destination-over"; oc.fillStyle = fill; oc.fillRect(0, 0, W, H); }
    return out;
  };
  const fillColour = () => (backdrop === "white" ? "#ffffff" : backdrop === "black" ? "#000000" : backdrop === "colour" ? colour : null);

  const download = async (withFill: boolean) => {
    const cv = fullSize(withFill ? fillColour() : null); if (!cv || !pic) return;
    setBusy(true);
    cv.toBlob((b) => {
      setBusy(false);
      if (!b) { setMsg("Could not make the image."); return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${pic.name}-${withFill ? "background" : "cutout"}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  };

  const toTokenMaker = () => {
    const cv = fullSize(null); if (!cv) return;
    // a token never needs more than about 1000 px, and sessionStorage holds a few megabytes
    const k = Math.min(1, 1000 / Math.max(cv.width, cv.height));
    const small = document.createElement("canvas"); small.width = Math.round(cv.width * k); small.height = Math.round(cv.height * k);
    small.getContext("2d")!.drawImage(cv, 0, 0, small.width, small.height);
    try { window.sessionStorage.setItem(HANDOFF_KEY, small.toDataURL("image/png")); window.location.href = "/tools/token-maker"; }
    catch { setMsg("Your browser would not hand the picture over. Download it, then open it in the token maker."); }
  };

  const kept = mask ? keptShare(mask) : 1;

  return (
    <div style={{ color: ui.text }}>
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); openFile(e.dataTransfer.files?.[0]); }}
        style={{ position: "relative", width: "100%", height: "min(62vh, 560px)", minHeight: 300, borderRadius: 12, overflow: "hidden", border: `1px solid ${ui.line}` }}>
        <canvas ref={canvasRef} role="img" aria-label="Picture with its background removed" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave} onWheel={onWheel}
          style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: !pic ? "pointer" : tool === "move" ? "grab" : "crosshair" }} />
      </div>
      <p style={{ fontSize: 12, color: ui.muted, margin: "6px 0 0" }}>
        {!pic ? "Your picture stays on your device: nothing is uploaded."
          : tool === "wand" ? "Click a patch of background to remove it. Scroll to zoom."
            : tool === "move" ? "Drag to move, scroll to zoom."
              : tool === "erase" ? "Paint over what you want gone." : "Paint over what you want back."}
        {pic && ` ${pic.orig.naturalWidth} by ${pic.orig.naturalHeight} px, ${Math.round(kept * 100)}% kept.`}
      </p>
      {msg && <p role="status" style={{ fontSize: 13, color: ui.warn, margin: "8px 0 0" }}>{msg}</p>}

      <div style={sectionH}>Picture</div>
      <div style={rowS}>
        <button type="button" style={pic ? btn() : primary} onClick={() => fileRef.current?.click()}>{pic ? "Choose another picture" : "Choose a picture"}</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      <div style={sectionH}>Remove</div>
      <div style={rowS}>
        <button type="button" style={btn(autoOn)} disabled={!pic} onClick={runAuto}>Remove background automatically</button>
        <label style={lab}>Tolerance
          <input type="range" min={0} max={100} value={tolerance} disabled={!pic}
            onChange={(e) => { const v = Number(e.target.value); setTolerance(v); if (autoOn && pic) setMask(autoMask(pic.rgba, pic.w, pic.h, v)); }} />
        </label>
      </div>
      <div style={{ ...rowS, marginTop: 6 }} role="group" aria-label="Tool">
        {([["wand", "Remove by click"], ["erase", "Erase brush"], ["restore", "Restore brush"], ["move", "Move"]] as [Tool, string][]).map(([k, l]) => (
          <button key={k} type="button" style={btn(tool === k)} aria-pressed={tool === k} disabled={!pic} onClick={() => setTool(k)}>{l}</button>
        ))}
        {(tool === "erase" || tool === "restore") && <label style={lab}>Size<input type="range" min={4} max={120} value={brush} onChange={(e) => setBrush(Number(e.target.value))} /></label>}
      </div>
      <div style={{ ...rowS, marginTop: 6 }}>
        <button type="button" style={btn()} disabled={!pic} onClick={() => pic && apply((m) => keepLargest(m, pic.w, pic.h))}>Keep the largest piece</button>
        <button type="button" style={btn()} disabled={!pic} onClick={() => pic && apply((m) => tightenEdge(m, pic.w, pic.h))}>Tighten the edge</button>
        <button type="button" style={btn()} disabled={!history.length} onClick={undo}>Undo</button>
        <button type="button" style={btn()} disabled={!pic} onClick={() => pic && apply(() => new Uint8ClampedArray(pic.w * pic.h).fill(255))}>Bring everything back</button>
      </div>

      <div style={sectionH}>View and background</div>
      <div style={rowS}>
        <label style={lab}>Zoom<input type="range" min={50} max={800} value={Math.round(zoom * 100)} disabled={!pic} onChange={(e) => setZoom(Number(e.target.value) / 100)} /></label>
        <button type="button" style={btn()} disabled={!pic} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit</button>
        <label style={lab}>Behind it
          <select aria-label="Background behind the picture" value={backdrop} onChange={(e) => setBackdrop(e.target.value as Backdrop)} style={field}>
            <option value="checker">Transparent</option>
            <option value="white">White</option>
            <option value="black">Black</option>
            <option value="colour">A colour</option>
          </select>
        </label>
        {backdrop === "colour" && <input type="color" aria-label="Background colour" value={colour} onChange={(e) => setColour(e.target.value)} />}
      </div>

      <div style={sectionH}>Download</div>
      <div style={rowS}>
        <button type="button" style={primary} disabled={!pic || busy} onClick={() => void download(false)}>Download transparent PNG</button>
        {backdrop !== "checker" && <button type="button" style={btn()} disabled={!pic || busy} onClick={() => void download(true)}>Download with this background</button>}
        <button type="button" style={btn()} disabled={!pic} onClick={toTokenMaker}>Make a token from this</button>
      </div>
      <p style={{ fontSize: 12, color: ui.muted, margin: "6px 0 0" }}>Downloads are full size, the same width and height as your picture.</p>
    </div>
  );
}
