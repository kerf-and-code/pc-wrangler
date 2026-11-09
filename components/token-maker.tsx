"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_FRAME, FRAME_DESIGNS, FRAME_EFFECTS, FRAME_MOTIONS, SHAPES,
  clipToShape, designDefaults, drawFrame, frameMoves, frameReach, normFrame,
  type Frame, type Shape,
} from "@/lib/tabletop/frames";
import { HANDOFF_KEY, applyMask, autoMask, keptShare, paintMask, wandRemove } from "@/lib/tabletop/cutout";
import { GifEncoder } from "@/lib/tabletop/gif";

// components/token-maker.tsx (2026-11-08)
//
// The token maker: take a picture, remove its background, cut it to a shape, and give it a border
// (a plain band or a design inspired by a class or subclass), an animated effect themed on a damage
// type, a motion style, or an imported border image. Used in two places:
//   - the free tool at /tools/token-maker (mode "free"): everything stays in the browser and the
//     visitor downloads a PNG (still), the picture alone, an animated GIF (lib/tabletop/gif.ts), or a
//     short WebM video of the animation. The background remover (/tools/background-remover) can hand a
//     cut-out picture over through sessionStorage (HANDOFF_KEY);
//   - the tabletop (mode "app"): "Use on this token" hands back the cut-out picture and the frame
//     settings; the caller uploads the picture and stores the frame on the token, where it is drawn
//     live, so the animation runs at the table.
// Nothing here talks to a server.

type Mode = "free" | "app";
export type TokenMakerResult = { portrait: Blob; frame: Frame; border: Blob | null; clearFrame: boolean };

const MAX_SIDE = 900;
const PREVIEW = 360;

const ui = {
  text: "#f2e6c9", muted: "#a89a84", line: "rgba(255,255,255,0.16)", surface: "#1e1a16", sun: "#d9a43a", warn: "#e07a70",
};
const sectionH: React.CSSProperties = { fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: ui.muted, margin: "16px 0 6px" };
const btn = (on = false): React.CSSProperties => ({ padding: "6px 11px", borderRadius: 8, border: `1px solid ${on ? ui.sun : ui.line}`, background: on ? "rgba(217,164,58,0.16)" : "transparent", color: on ? ui.sun : ui.text, fontSize: 13, cursor: "pointer" });
const primary: React.CSSProperties = { padding: "9px 16px", borderRadius: 8, border: `1px solid ${ui.sun}`, background: ui.sun, color: "#1a1410", fontWeight: 700, fontSize: 14, cursor: "pointer" };
const field: React.CSSProperties = { padding: "6px 8px", borderRadius: 7, border: `1px solid ${ui.line}`, background: ui.surface, color: ui.text, fontSize: 13 };
const rowS: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" };
const lab: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: ui.text };

type Pic = { w: number; h: number; rgba: Uint8ClampedArray };

function loadImage(src: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    if (cors) im.crossOrigin = "anonymous";
    im.onload = () => res(im); im.onerror = () => rej(new Error("That picture could not be opened."));
    im.src = src;
  });
}

function picFrom(im: HTMLImageElement): Pic {
  const k = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const c = cv.getContext("2d")!; c.drawImage(im, 0, 0, w, h);
  return { w, h, rgba: c.getImageData(0, 0, w, h).data };
}

function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "token"; }

export default function TokenMaker({ mode, initialImage, initialFrame, name, onSave, onCancel }: {
  mode: Mode;
  initialImage?: string | null;
  initialFrame?: unknown;
  name?: string;
  onSave?: (r: TokenMakerResult) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [frame, setFrame] = useState<Frame>(() => normFrame(initialFrame) ?? DEFAULT_FRAME);
  const [hadFrame] = useState(() => !!normFrame(initialFrame));
  const [pic, setPic] = useState<Pic | null>(null);
  const [mask, setMask] = useState<Uint8ClampedArray | null>(null);
  const [history, setHistory] = useState<Uint8ClampedArray[]>([]);
  const [tolerance, setTolerance] = useState(35);
  const [autoOn, setAutoOn] = useState(false);
  const [tool, setTool] = useState<"move" | "wand" | "erase" | "restore">("move");
  const [gifClear, setGifClear] = useState(true);
  const [gifProgress, setGifProgress] = useState<number | null>(null);
  const [brush, setBrush] = useState(18);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [paused, setPaused] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [border, setBorder] = useState<{ url: string; blob: Blob } | null>(null);
  const [exportSize, setExportSize] = useState(512);
  const [recording, setRecording] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cutRef = useRef<HTMLCanvasElement | null>(null);
  const borderImg = useRef<HTMLImageElement | null>(null);
  const remoteBorder = useRef<Map<string, HTMLImageElement | "loading" | "bad">>(new Map());
  const view = useRef({ zoom, pan, frame, paused, tool, brush });
  view.current = { zoom, pan, frame, paused, tool, brush };
  const reduced = useRef(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number; painting: boolean } | null>(null);
  const strokeMask = useRef<Uint8ClampedArray | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const borderRef = useRef<HTMLInputElement | null>(null);

  const patch = (p: Partial<Frame>) => setFrame((f) => ({ ...f, ...p }));

  // the masked picture, redrawn when the mask changes
  const refreshCut = useCallback((p: Pic | null, m: Uint8ClampedArray | null) => {
    if (!p) { cutRef.current = null; return; }
    const cv = cutRef.current ?? document.createElement("canvas");
    cv.width = p.w; cv.height = p.h;
    const data = m ? applyMask(p.rgba, m) : p.rgba;
    cv.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), p.w, p.h), 0, 0);
    cutRef.current = cv;
  }, []);
  useEffect(() => { refreshCut(pic, mask); }, [pic, mask, refreshCut]);

  const openPicture = useCallback(async (src: string, cors: boolean) => {
    setMsg(null);
    try {
      const im = await loadImage(src, cors);
      const p = picFrom(im);
      setPic(p); setMask(new Uint8ClampedArray(p.w * p.h).fill(255)); setHistory([]); setAutoOn(false);
      setZoom(1); setPan({ x: 0, y: 0 });
    } catch (e) {
      setMsg(cors ? "That picture could not be read here (the site it is on does not allow it). Download it and choose the file instead." : (e as Error).message);
    }
  }, []);

  useEffect(() => { if (initialImage) void openPicture(initialImage, true); }, [initialImage, openPicture]);

  // a picture handed over from the background remover
  useEffect(() => {
    if (mode !== "free") return;
    try {
      const url = window.sessionStorage.getItem(HANDOFF_KEY);
      if (url && url.startsWith("data:image/")) { window.sessionStorage.removeItem(HANDOFF_KEY); void openPicture(url, false); }
    } catch { /* storage unavailable: start empty */ }
  }, [mode, openPicture]);

  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : null;
    reduced.current = !!mq?.matches;
    if (reduced.current) setPaused(true);
  }, []);

  const onFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) { setMsg("Choose an image file (PNG, JPEG, WebP or GIF)."); return; }
    const url = URL.createObjectURL(f);
    void openPicture(url, false).finally(() => URL.revokeObjectURL(url));
  };

  // paste a picture from the clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) { const f = item.getAsFile(); if (f) { e.preventDefault(); onFile(f); } }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const pushHistory = (m: Uint8ClampedArray) => setHistory((h) => [...h.slice(-11), new Uint8ClampedArray(m)]);
  const runAuto = (tol = tolerance) => {
    if (!pic || !mask) return;
    pushHistory(mask);
    const m = autoMask(pic.rgba, pic.w, pic.h, tol);
    setMask(m); setAutoOn(true);
    const k = keptShare(m);
    setMsg(k > 0.985 ? "No background to remove was found at the edges. Try a higher tolerance, or erase by hand." : k < 0.05 ? "That removed almost everything. Lower the tolerance, or undo." : null);
  };
  const undo = () => setHistory((h) => { if (!h.length) return h; setMask(h[h.length - 1]); return h.slice(0, -1); });
  const resetMask = () => { if (!pic || !mask) return; pushHistory(mask); setMask(new Uint8ClampedArray(pic.w * pic.h).fill(255)); setAutoOn(false); };

  const imgBorder = useCallback((url: string): CanvasImageSource | null => {
    if (border && url === border.url) return borderImg.current;
    const got = remoteBorder.current.get(url);
    if (got && got !== "loading" && got !== "bad") return got;
    if (!got) {
      remoteBorder.current.set(url, "loading");
      loadImage(url, true).then((im) => remoteBorder.current.set(url, im)).catch(() => remoteBorder.current.set(url, "bad"));
    }
    return null;
  }, [border]);

  /** Draws the portrait cut to the shape at radius r, centred on the origin. */
  const drawPortrait = useCallback((c: CanvasRenderingContext2D, r: number) => {
    const cut = cutRef.current, v = view.current;
    c.save(); clipToShape(c, v.frame.shape, r);
    if (cut) {
      const k = ((2 * r) / Math.min(cut.width, cut.height)) * v.zoom;
      c.drawImage(cut, v.pan.x * 2 * r - (cut.width * k) / 2, v.pan.y * 2 * r - (cut.height * k) / 2, cut.width * k, cut.height * k);
    } else {
      c.fillStyle = "#2a241d"; c.fillRect(-r * 2, -r * 2, r * 4, r * 4);
      c.fillStyle = ui.muted; c.font = `600 ${r * 0.16}px system-ui, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("Choose a picture", 0, 0);
    }
    c.restore();
  }, []);

  // the live preview
  useEffect(() => {
    let raf = 0, stopped = false;
    const t0 = performance.now();
    const tick = () => {
      if (stopped) return;
      const cv = canvasRef.current;
      if (cv) {
        const dpr = Math.min(2, window.devicePixelRatio || 1), S = PREVIEW;
        if (cv.width !== S * dpr) { cv.width = S * dpr; cv.height = S * dpr; }
        const c = cv.getContext("2d")!;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, S, S);
        // checkerboard so the cut-out reads as transparent
        const sq = 12;
        for (let y = 0; y < S; y += sq) for (let x = 0; x < S; x += sq) { c.fillStyle = ((x + y) / sq) % 2 ? "#2b2622" : "#35302a"; c.fillRect(x, y, sq, sq); }
        const v = view.current, r = S * 0.3;
        c.save(); c.translate(S / 2, S / 2);
        drawPortrait(c, r);
        const t = v.paused ? 0 : (performance.now() - t0) / 1000;
        drawFrame(c, v.frame, r, t, imgBorder);
        if ((v.tool === "erase" || v.tool === "restore") && drag.current) {
          c.beginPath(); c.arc(drag.current.x - S / 2, drag.current.y - S / 2, v.brush / 2, 0, Math.PI * 2);
          c.strokeStyle = v.tool === "erase" ? ui.warn : "#8fd18a"; c.lineWidth = 1.5; c.stroke();
        }
        c.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [drawPortrait, imgBorder]);

  // pointer: move the picture, or paint the mask
  const toImage = (px: number, py: number) => {
    const cut = cutRef.current; if (!cut) return null;
    const r = PREVIEW * 0.3, k = ((2 * r) / Math.min(cut.width, cut.height)) * zoom;
    const cx = PREVIEW / 2 + pan.x * 2 * r, cy = PREVIEW / 2 + pan.y * 2 * r;
    return { x: (px - cx) / k + cut.width / 2, y: (py - cy) / k + cut.height / 2, k };
  };
  const local = (e: React.PointerEvent) => { const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width) * PREVIEW, y: ((e.clientY - b.top) / b.height) * PREVIEW }; };
  const paintAt = (x: number, y: number) => {
    if (!pic || !strokeMask.current) return;
    const q = toImage(x, y); if (!q) return;
    paintMask(strokeMask.current, pic.w, pic.h, q.x, q.y, brush / 2 / q.k, tool === "erase" ? 0 : 255);
    refreshCut(pic, strokeMask.current);
  };
  const onDown = (e: React.PointerEvent) => {
    if (!pic) { fileRef.current?.click(); return; }
    const p = local(e);
    if (tool === "wand") {
      const q = toImage(p.x, p.y); if (!q || !mask) return;
      const m = new Uint8ClampedArray(mask); pushHistory(mask);
      const n = wandRemove(pic.rgba, m, pic.w, pic.h, q.x, q.y, tolerance);
      setMask(m); setMsg(n ? null : "Nothing there to remove. Click on the background colour you want gone.");
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const painting = tool === "erase" || tool === "restore";
    drag.current = { x: p.x, y: p.y, px: pan.x, py: pan.y, painting };
    if (painting && mask) { pushHistory(mask); strokeMask.current = new Uint8ClampedArray(mask); paintAt(p.x, p.y); }
  };
  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (!drag.current) return;
    if (drag.current.painting) { paintAt(p.x, p.y); drag.current.x = p.x; drag.current.y = p.y; return; }
    const r = PREVIEW * 0.3;
    setPan({ x: drag.current.px + (p.x - drag.current.x) / (2 * r), y: drag.current.py + (p.y - drag.current.y) / (2 * r) });
  };
  const onUp = () => {
    if (drag.current?.painting && strokeMask.current) setMask(strokeMask.current);
    strokeMask.current = null; drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => { if (!pic) return; setZoom((z) => Math.max(0.3, Math.min(5, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))); };

  // ---- exports ----

  const renderCanvas = (size: number, withFrame: boolean, t: number, bg?: string) => {
    const cv = document.createElement("canvas"); cv.width = size; cv.height = size;
    const c = cv.getContext("2d")!;
    if (bg) { c.fillStyle = bg; c.fillRect(0, 0, size, size); }
    c.translate(size / 2, size / 2);
    const r = withFrame ? size / 2 / frameReach(frame) : size / 2;
    drawPortrait(c, r);
    if (withFrame) drawFrame(c, frame, r, t, imgBorder);
    return cv;
  };
  const download = (blob: Blob, file: string) => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const toBlob = (cv: HTMLCanvasElement) => new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("Could not make the image."))), "image/png"));
  const base = slug(name ?? "token");

  const savePng = async (withFrame: boolean) => {
    try { download(await toBlob(renderCanvas(exportSize, withFrame, 0.8)), `${base}${withFrame ? "" : "-picture"}.png`); }
    catch { setMsg("That picture could not be exported (it came from a site that does not allow it). Choose the file from your computer instead."); }
  };

  const canRecord = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;
  const saveVideo = async () => {
    if (!canRecord) return;
    const size = Math.min(exportSize, 720), cv = document.createElement("canvas"); cv.width = size; cv.height = size;
    const c = cv.getContext("2d")!;
    const stream = (cv as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(30);
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((x) => MediaRecorder.isTypeSupported(x));
    if (!type) { setMsg("This browser cannot record video. Try Chrome, Edge or Firefox."); return; }
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    setRecording(true);
    const done = new Promise<void>((res) => { rec.onstop = () => res(); });
    rec.start();
    const t0 = performance.now(), secs = 4;
    await new Promise<void>((res) => {
      const step = () => {
        const t = (performance.now() - t0) / 1000;
        c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = "#15120f"; c.fillRect(0, 0, size, size);
        c.translate(size / 2, size / 2);
        const r = size / 2 / frameReach(frame);
        drawPortrait(c, r); drawFrame(c, frame, r, t, imgBorder);
        if (t < secs) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    rec.stop(); await done; setRecording(false);
    download(new Blob(chunks, { type: "video/webm" }), `${base}-animated.webm`);
  };

  const saveGif = async () => {
    const size = Math.min(exportSize, 512), fps = 20, n = fps * 3;
    const cv = document.createElement("canvas"); cv.width = size; cv.height = size;
    const c = cv.getContext("2d", { willReadFrequently: true })!;
    const r = size / 2 / frameReach(frame);
    const draw = (t: number) => {
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, size, size); c.translate(size / 2, size / 2);
      drawPortrait(c, r); drawFrame(c, frame, r, t, imgBorder);
      return c.getImageData(0, 0, size, size).data;
    };
    try {
      setGifProgress(0);
      const enc = new GifEncoder(size, size, { transparent: gifClear });
      for (let i = 0; i < n; i += 5) enc.addPaletteSample(draw(i / fps));
      enc.buildPalette();
      for (let i = 0; i < n; i++) {
        enc.addFrame(draw(i / fps), 1000 / fps);
        if (i % 3 === 0) { setGifProgress(i / n); await new Promise((res) => setTimeout(res, 0)); }
      }
      download(new Blob([enc.finish().buffer as ArrayBuffer], { type: "image/gif" }), `${base}-animated.gif`);
    } catch {
      setMsg("That picture could not be exported (it came from a site that does not allow it). Choose the file from your computer instead.");
    } finally { setGifProgress(null); }
  };

  const saveToToken = async (clearFrame = false) => {
    if (!onSave) return;
    if (!pic && !initialImage) { setMsg("Choose a picture first."); return; }
    setBusy(true); setMsg(null);
    try {
      const portrait = await toBlob(renderCanvas(512, false, 0));
      const err = await onSave({ portrait, frame, border: border?.blob ?? null, clearFrame });
      if (err) setMsg(err);
    } catch {
      setMsg("That picture could not be saved (it came from a site that does not allow it). Choose the file from your computer instead.");
    } finally { setBusy(false); }
  };

  const onBorderFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!/^image\/(png|webp|gif)$/.test(f.type)) { setMsg("Use a PNG, WebP or GIF border with a clear (transparent) middle."); return; }
    const url = URL.createObjectURL(f);
    loadImage(url, false).then((im) => { borderImg.current = im; setBorder({ url, blob: f }); patch({ importUrl: url }); }).catch(() => setMsg("That border could not be opened."));
  };
  const clearBorder = () => { setBorder(null); borderImg.current = null; patch({ importUrl: null }); };

  const pickDesign = (id: string) => { const d = designDefaults(id); patch(d ? { design: id, ...d } : { design: id }); };
  const groups: { key: string; label: string }[] = [{ key: "simple", label: "Simple" }, { key: "class", label: "Inspired by a class" }, { key: "subclass", label: "Inspired by a subclass" }];
  const moving = frameMoves(frame);

  return (
    <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start", color: ui.text }}>
      {/* preview */}
      <div style={{ flex: "0 1 360px", minWidth: 260, maxWidth: 400 }}>
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
          style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden", border: `1px solid ${ui.line}` }}>
          <canvas ref={canvasRef} role="img" aria-label="Token preview" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
            style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: !pic ? "pointer" : tool === "move" ? "grab" : "crosshair" }} />
        </div>
        <p style={{ fontSize: 12, color: ui.muted, margin: "6px 0 0" }}>
          {!pic ? "Choose, drop or paste a picture." : tool === "move" ? "Drag to move the picture, scroll to zoom." : tool === "wand" ? "Click a patch of background to remove it (uses the tolerance)." : tool === "erase" ? "Paint over what you want gone." : "Paint over what you want back."}
        </p>
        <div style={{ ...rowS, marginTop: 8 }}>
          <button type="button" style={btn(paused)} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>{paused ? "Play animation" : "Pause animation"}</button>
        </div>
        {msg && <p role="status" style={{ fontSize: 13, color: ui.warn, margin: "10px 0 0" }}>{msg}</p>}
      </div>

      {/* controls */}
      <div style={{ flex: "1 1 340px", minWidth: 280 }}>
        <div style={{ ...sectionH, marginTop: 0 }}>1. Picture</div>
        <div style={rowS}>
          <button type="button" style={btn()} onClick={() => fileRef.current?.click()}>{pic ? "Choose another picture" : "Choose a picture"}</button>
          {initialImage && <button type="button" style={btn()} onClick={() => void openPicture(initialImage, true)}>Use the current picture</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        <div style={sectionH}>2. Background</div>
        <div style={rowS}>
          <button type="button" style={btn(autoOn)} disabled={!pic} onClick={() => runAuto()}>Remove background</button>
          <label style={lab}>Tolerance
            <input type="range" min={0} max={100} value={tolerance} disabled={!pic}
              onChange={(e) => { const v = Number(e.target.value); setTolerance(v); if (autoOn && pic) { setMask(autoMask(pic.rgba, pic.w, pic.h, v)); } }} />
          </label>
        </div>
        <div style={{ ...rowS, marginTop: 6 }} role="group" aria-label="Brush">
          {(["move", "wand", "erase", "restore"] as const).map((k) => (
            <button key={k} type="button" style={btn(tool === k)} aria-pressed={tool === k} disabled={!pic} onClick={() => setTool(k)}>{k === "move" ? "Move" : k === "wand" ? "Remove by click" : k === "erase" ? "Erase brush" : "Restore brush"}</button>
          ))}
          {(tool === "erase" || tool === "restore") && <label style={lab}>Size<input type="range" min={4} max={80} value={brush} onChange={(e) => setBrush(Number(e.target.value))} /></label>}
        </div>
        <div style={{ ...rowS, marginTop: 6 }}>
          <button type="button" style={btn()} disabled={!history.length} onClick={undo}>Undo</button>
          <button type="button" style={btn()} disabled={!pic} onClick={resetMask}>Bring everything back</button>
        </div>

        <div style={sectionH}>3. Shape and fit</div>
        <div style={rowS} role="group" aria-label="Shape">
          {SHAPES.map((s) => <button key={s.key} type="button" style={btn(frame.shape === s.key)} aria-pressed={frame.shape === s.key} onClick={() => patch({ shape: s.key as Shape })}>{s.label}</button>)}
        </div>
        <div style={{ ...rowS, marginTop: 6 }}>
          <label style={lab}>Zoom<input type="range" min={30} max={500} value={Math.round(zoom * 100)} disabled={!pic} onChange={(e) => setZoom(Number(e.target.value) / 100)} /></label>
          <button type="button" style={btn()} disabled={!pic} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Centre</button>
        </div>

        <div style={sectionH}>4. Border</div>
        <div style={rowS}>
          <select aria-label="Border design" value={frame.design} onChange={(e) => pickDesign(e.target.value)} style={{ ...field, minWidth: 220 }}>
            <option value="none">No border</option>
            {groups.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {FRAME_DESIGNS.filter((d) => d.group === g.key).map((d) => <option key={d.id} value={d.id}>{d.inspired ? `${d.label} (${d.inspired})` : d.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div style={{ ...rowS, marginTop: 6 }}>
          <label style={lab}>Main<input type="color" value={frame.color} onChange={(e) => patch({ color: e.target.value })} /></label>
          <label style={lab}>Accent<input type="color" value={frame.color2} onChange={(e) => patch({ color2: e.target.value })} /></label>
          <button type="button" style={btn()} onClick={() => { const d = designDefaults(frame.design); if (d) patch(d); }}>Design colours</button>
        </div>
        <label style={{ ...lab, marginTop: 6 }}>Thickness<input type="range" min={4} max={30} value={Math.round(frame.width * 100)} onChange={(e) => patch({ width: Number(e.target.value) / 100 })} /></label>

        <div style={sectionH}>5. Animation</div>
        <div style={rowS}>
          <label style={lab}>Effect
            <select aria-label="Animated effect" value={frame.effect} onChange={(e) => patch({ effect: e.target.value })} style={field}>
              <option value="">None</option>
              {FRAME_EFFECTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          <label style={lab}>Motion
            <select aria-label="Motion style" value={frame.motion} onChange={(e) => patch({ motion: e.target.value })} style={field}>
              <option value="">None</option>
              {FRAME_MOTIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        </div>
        {frame.effect && (
          <div style={{ ...rowS, marginTop: 6 }}>
            <label style={lab}><input type="checkbox" checked={!!frame.effectColor} onChange={(e) => patch({ effectColor: e.target.checked ? (FRAME_EFFECTS.find((x) => x.id === frame.effect)?.colors[1] ?? "#d9a43a") : null })} />Own effect colour</label>
            {frame.effectColor && <input type="color" aria-label="Effect colour" value={frame.effectColor} onChange={(e) => patch({ effectColor: e.target.value })} />}
          </div>
        )}
        {moving && (
          <div style={{ ...rowS, marginTop: 6 }}>
            <label style={lab}>Speed<input type="range" min={25} max={300} value={Math.round(frame.speed * 100)} onChange={(e) => patch({ speed: Number(e.target.value) / 100 })} /></label>
            <label style={lab}>Intensity<input type="range" min={0} max={100} value={Math.round(frame.intensity * 100)} onChange={(e) => patch({ intensity: Number(e.target.value) / 100 })} /></label>
          </div>
        )}

        <div style={sectionH}>6. Your own border (optional)</div>
        <div style={rowS}>
          <button type="button" style={btn(!!border)} onClick={() => borderRef.current?.click()}>{border ? "Choose another border" : "Import a border image"}</button>
          {(border || frame.importUrl) && <button type="button" style={btn()} onClick={clearBorder}>Remove it</button>}
          <input ref={borderRef} type="file" accept="image/png,image/webp,image/gif" hidden onChange={(e) => { onBorderFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <p style={{ fontSize: 12, color: ui.muted, margin: "4px 0 0" }}>A square PNG with a transparent middle. It is drawn over the design and effects, so pick &ldquo;No border&rdquo; above to use it alone.</p>

        <div style={sectionH}>{mode === "app" ? "7. Save" : "7. Download"}</div>
        {mode === "app" && (
          <div style={rowS}>
            <button type="button" style={primary} disabled={busy} onClick={() => void saveToToken(false)}>{busy ? "Saving..." : "Use on this token"}</button>
            {hadFrame && <button type="button" style={btn()} disabled={busy} onClick={() => void saveToToken(true)}>Use the picture, no frame</button>}
            {onCancel && <button type="button" style={btn()} disabled={busy} onClick={onCancel}>Cancel</button>}
          </div>
        )}
        <div style={{ ...rowS, marginTop: mode === "app" ? 10 : 0 }}>
          <label style={lab}>Size
            <select aria-label="Export size" value={exportSize} onChange={(e) => setExportSize(Number(e.target.value))} style={field}>
              {[256, 512, 1024].map((s) => <option key={s} value={s}>{s} px</option>)}
            </select>
          </label>
          <button type="button" style={mode === "free" ? primary : btn()} disabled={!pic} onClick={() => void savePng(true)}>Download token (PNG)</button>
          <button type="button" style={btn()} disabled={!pic} onClick={() => void savePng(false)}>Picture only</button>
          {moving && canRecord && <button type="button" style={btn(recording)} disabled={!pic || recording} onClick={() => void saveVideo()}>{recording ? "Recording 4 seconds..." : "Animated (WebM video)"}</button>}
        </div>
        {moving && (
          <div style={{ ...rowS, marginTop: 8 }}>
            <button type="button" style={btn(gifProgress != null)} disabled={!pic || gifProgress != null} onClick={() => void saveGif()}>
              {gifProgress != null ? `Making the GIF... ${Math.round(gifProgress * 100)}%` : "Animated GIF"}
            </button>
            <label style={lab}>GIF background
              <select aria-label="GIF background" value={gifClear ? "clear" : "dark"} onChange={(e) => setGifClear(e.target.value === "clear")} style={field}>
                <option value="clear">Transparent</option>
                <option value="dark">Dark (smoother edges)</option>
              </select>
            </label>
          </div>
        )}
        <p style={{ fontSize: 12, color: ui.muted, margin: "6px 0 0" }}>
          The PNG is a still with a transparent background. {moving ? "The GIF loops 3 seconds of the animation (up to 512 px) and works on most virtual tabletops; GIF edges are crisp, not soft. The video loops it on a dark background. " : ""}
          {mode === "app" ? "On the tabletop the frame is drawn live, so the animation plays at the table." : "Everything happens in your browser: nothing is uploaded."}
        </p>
      </div>
    </div>
  );
}
