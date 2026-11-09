"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_FRAME, FRAME_DESIGNS, FRAME_EFFECTS, FRAME_MOTIONS, SHAPES,
  clipToShape, designDefaults, drawFrame, frameMoves, frameReach, normFrame,
  type Frame, type Shape,
} from "@/lib/tabletop/frames";
import { applyMask, autoMask, keptShare, paintMask, stampSeed, strokeOverlay, wandRemove } from "@/lib/tabletop/cutout";
import { guidedCut } from "@/lib/tabletop/guided-cut";
import { GifEncoder } from "@/lib/tabletop/gif";

// components/token-maker.tsx (2026-11-08)
//
// The token maker: take a picture, remove its background (the guided cut in lib/tabletop/guided-cut.ts:
// scribble "keep" over the subject and "remove" over the background), cut it to a shape, and give it a border
// (a plain band or a design inspired by a class or subclass), an animated effect themed on a damage
// type, a motion style, or an imported border image. Used in two places:
//   - the free tool at /tools/token-maker (mode "free"): everything stays in the browser and the
//     visitor downloads a PNG (still), the picture alone, an animated GIF (lib/tabletop/gif.ts), or a
//     short WebM video of the animation;
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
type Tool = "move" | "keep" | "drop" | "wand" | "erase" | "restore";
type Snap = { mask: Uint8ClampedArray; keep: Uint8Array; drop: Uint8Array };
const MARKS: Tool[] = ["keep", "drop"];

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
  const [history, setHistory] = useState<Snap[]>([]);
  const [cutting, setCutting] = useState(false);
  const [tolerance, setTolerance] = useState(35);
  const [autoOn, setAutoOn] = useState(false);
  const [tool, setTool] = useState<Tool>("move");
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
  // guided-cut strokes at the picture's size, the translucent picture of them, and the unmasked picture
  const keepRef = useRef<Uint8Array | null>(null);
  const dropRef = useRef<Uint8Array | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const origRef = useRef<HTMLCanvasElement | null>(null);
  const markLast = useRef<{ x: number; y: number } | null>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
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
  const redrawOverlay = useCallback((p: Pic) => {
    const ov = overlayRef.current; if (!ov || !keepRef.current || !dropRef.current) return;
    ov.getContext("2d")!.putImageData(strokeOverlay(keepRef.current, dropRef.current, p.w, p.h), 0, 0);
  }, []);
  useEffect(() => { refreshCut(pic, mask); }, [pic, mask, refreshCut]);

  const openPicture = useCallback(async (src: string, cors: boolean) => {
    setMsg(null);
    try {
      const im = await loadImage(src, cors);
      const p = picFrom(im);
      keepRef.current = new Uint8Array(p.w * p.h); dropRef.current = new Uint8Array(p.w * p.h);
      const ov = document.createElement("canvas"); ov.width = p.w; ov.height = p.h; overlayRef.current = ov;
      const og = document.createElement("canvas"); og.width = p.w; og.height = p.h;
      og.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.w, p.h), 0, 0); origRef.current = og;
      setPic(p); setMask(new Uint8ClampedArray(p.w * p.h).fill(255)); setHistory([]); setAutoOn(false);
      // a tall picture opens framed from the top, where a face usually is, not cropped through the middle
      setZoom(1); setPan({ x: 0, y: p.h > p.w * 1.1 ? Math.min(0.5, (p.h / p.w - 1) / 2) * 0.9 : 0 });
    } catch (e) {
      setMsg(cors ? "That picture could not be read here (the site it is on does not allow it). Download it and choose the file instead." : (e as Error).message);
    }
  }, []);

  useEffect(() => { if (initialImage) void openPicture(initialImage, true); }, [initialImage, openPicture]);

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

  const pushHistory = (m: Uint8ClampedArray) => {
    const keep = keepRef.current ? new Uint8Array(keepRef.current) : new Uint8Array(0), drop = dropRef.current ? new Uint8Array(dropRef.current) : new Uint8Array(0);
    setHistory((h) => [...h.slice(-11), { mask: new Uint8ClampedArray(m), keep, drop }]);
  };
  const runAuto = (tol = tolerance) => {
    if (!pic || !mask) return;
    pushHistory(mask);
    const m = autoMask(pic.rgba, pic.w, pic.h, tol);
    setMask(m); setAutoOn(true);
    const k = keptShare(m);
    setMsg(k > 0.985 ? "No background to remove was found at the edges. Try a higher tolerance, or erase by hand." : k < 0.05 ? "That removed almost everything. Lower the tolerance, or undo." : null);
  };
  const undo = () => {
    const last = history[history.length - 1]; if (!last) return;
    setHistory(history.slice(0, -1));
    setMask(last.mask);
    if (pic && last.keep.length === pic.w * pic.h) { keepRef.current = last.keep; dropRef.current = last.drop; redrawOverlay(pic); }
  };
  const clearStrokes = () => {
    if (!pic || !mask) return; pushHistory(mask);
    keepRef.current = new Uint8Array(pic.w * pic.h); dropRef.current = new Uint8Array(pic.w * pic.h); redrawOverlay(pic);
  };
  /** Runs the guided cut from the strokes so far (after a short pause so "Cutting" can show). */
  const runCut = () => {
    if (!pic || !keepRef.current || !dropRef.current) return;
    if (!keepRef.current.some((v) => v)) { setMsg("Paint over your subject with Keep first; Remove strokes then tell it what is background."); return; }
    setCutting(true); setMsg(null);
    setTimeout(() => {
      const r = guidedCut(pic.rgba, pic.w, pic.h, keepRef.current!, dropRef.current!);
      if (r) { setMask(r.mask); setAutoOn(false); }
      setCutting(false);
    }, 30);
  };
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
  const drawPortrait = useCallback((c: CanvasRenderingContext2D, r: number, guides = false) => {
    const cut = cutRef.current, v = view.current;
    c.save(); clipToShape(c, v.frame.shape, r);
    if (cut) {
      const k = ((2 * r) / Math.min(cut.width, cut.height)) * v.zoom;
      const x = v.pan.x * 2 * r - (cut.width * k) / 2, y = v.pan.y * 2 * r - (cut.height * k) / 2, W = cut.width * k, H = cut.height * k;
      const marking = guides && MARKS.includes(v.tool);
      // while marking, what has been removed shows faintly, so a missed part can be painted back
      if (marking && origRef.current) { c.globalAlpha = 0.28; c.drawImage(origRef.current, x, y, W, H); c.globalAlpha = 1; }
      c.drawImage(cut, x, y, W, H);
      if (guides && overlayRef.current) c.drawImage(overlayRef.current, x, y, W, H);
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
        drawPortrait(c, r, true);
        const t = v.paused ? 0 : (performance.now() - t0) / 1000;
        drawFrame(c, v.frame, r, t, imgBorder);
        if (["erase", "restore", "keep", "drop"].includes(v.tool) && hoverRef.current) {
          c.beginPath(); c.arc(hoverRef.current.x - S / 2, hoverRef.current.y - S / 2, v.brush / 2, 0, Math.PI * 2);
          c.strokeStyle = v.tool === "erase" || v.tool === "drop" ? ui.warn : "#8fd18a"; c.lineWidth = 1.5; c.stroke();
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
  /** Paints a keep or remove stroke from the last point to (x, y), into the stroke map and its picture. */
  const markTo = (x: number, y: number) => {
    if (!pic) return;
    const seed = tool === "keep" ? keepRef.current : dropRef.current, other = tool === "keep" ? dropRef.current : keepRef.current;
    const q = toImage(x, y); if (!q || !seed || !other) return;
    const rr = brush / 2 / q.k, from = markLast.current ?? q;
    const steps = Math.max(1, Math.ceil(Math.hypot(q.x - from.x, q.y - from.y) / Math.max(1, rr / 2)));
    const ov = overlayRef.current?.getContext("2d");
    for (let s2 = 0; s2 <= steps; s2++) {
      const cx = from.x + ((q.x - from.x) * s2) / steps, cy = from.y + ((q.y - from.y) * s2) / steps;
      stampSeed(seed, pic.w, pic.h, cx, cy, rr);
      // a new stroke wins over an old one of the other kind where they overlap
      const x0 = Math.max(0, Math.floor(cx - rr)), x1 = Math.min(pic.w - 1, Math.ceil(cx + rr)), y0 = Math.max(0, Math.floor(cy - rr)), y1 = Math.min(pic.h - 1, Math.ceil(cy + rr));
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) if ((xx - cx) ** 2 + (yy - cy) ** 2 <= rr * rr) other[yy * pic.w + xx] = 0;
      if (ov) { ov.fillStyle = tool === "keep" ? "rgba(70,220,100,0.59)" : "rgba(235,70,70,0.59)"; ov.beginPath(); ov.arc(cx, cy, rr, 0, Math.PI * 2); ov.fill(); }
    }
    markLast.current = { x: q.x, y: q.y };
  };
  const onDown = (e: React.PointerEvent) => {
    if (!pic) { fileRef.current?.click(); return; }
    const p = local(e);
    if (MARKS.includes(tool)) {
      if (cutting || !mask) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      pushHistory(mask);
      drag.current = { x: p.x, y: p.y, px: pan.x, py: pan.y, painting: false };
      markLast.current = null; markTo(p.x, p.y);
      return;
    }
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
    hoverRef.current = p;
    if (!drag.current) return;
    if (MARKS.includes(tool)) { markTo(p.x, p.y); return; }
    if (drag.current.painting) { paintAt(p.x, p.y); drag.current.x = p.x; drag.current.y = p.y; return; }
    const r = PREVIEW * 0.3;
    setPan({ x: drag.current.px + (p.x - drag.current.x) / (2 * r), y: drag.current.py + (p.y - drag.current.y) / (2 * r) });
  };
  const onUp = () => {
    const wasMarking = !!drag.current && MARKS.includes(tool);
    if (drag.current?.painting && strokeMask.current) setMask(strokeMask.current);
    strokeMask.current = null; drag.current = null; markLast.current = null;
    if (wasMarking) { if (pic) redrawOverlay(pic); runCut(); }
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
    const size = Math.min(exportSize, 768), fps = 20, n = fps * 3;
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
          <canvas ref={canvasRef} role="img" aria-label="Token preview" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hoverRef.current = null; }} onWheel={onWheel}
            style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: !pic ? "pointer" : tool === "move" ? "grab" : "crosshair" }} />
        </div>
        <p style={{ fontSize: 12, color: ui.muted, margin: "6px 0 0" }}>
          {!pic ? "Choose, drop or paste a picture." : cutting ? "Cutting..." : tool === "keep" ? "Scribble over the parts to keep. It cuts again after each stroke." : tool === "drop" ? "Scribble over background that is still showing." : tool === "move" ? "Drag to move the picture, scroll to zoom." : tool === "wand" ? "Click a patch of background to remove it (uses the tolerance)." : tool === "erase" ? "Paint over what you want gone." : "Paint over what you want back."}
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
        <p style={{ fontSize: 12.5, color: ui.muted, margin: "0 0 6px" }}>Scribble <strong style={{ color: "#8fd18a" }}>Keep</strong> over your subject (face, hair, armour, anything it holds), then <strong style={{ color: ui.warn }}>Remove</strong> over background that is still showing. It cuts after every stroke, and never removes what you marked Keep.</p>
        <div style={rowS} role="group" aria-label="Tool">
          {([["move", "Move"], ["keep", "Keep"], ["drop", "Remove"], ["wand", "Remove by click"], ["erase", "Erase brush"], ["restore", "Restore brush"]] as [Tool, string][]).map(([k, l]) => (
            <button key={k} type="button" style={btn(tool === k)} aria-pressed={tool === k} disabled={!pic} onClick={() => setTool(k)}>{l}</button>
          ))}
        </div>
        {["keep", "drop", "erase", "restore"].includes(tool) && <label style={{ ...lab, marginTop: 6 }}>Brush size<input type="range" min={4} max={80} value={brush} onChange={(e) => setBrush(Number(e.target.value))} /></label>}
        <div style={{ ...rowS, marginTop: 6 }}>
          <button type="button" style={btn()} disabled={!history.length || cutting} onClick={undo}>Undo</button>
          <button type="button" style={btn()} disabled={!pic || cutting} onClick={clearStrokes}>Clear strokes</button>
          <button type="button" style={btn()} disabled={!pic || cutting} onClick={resetMask}>Bring everything back</button>
        </div>
        <div style={{ ...rowS, marginTop: 8 }}>
          <span style={{ fontSize: 12, color: ui.muted }}>Plain background?</span>
          <button type="button" style={btn(autoOn)} disabled={!pic} onClick={() => runAuto()}>Quick remove</button>
          <label style={lab}>Tolerance
            <input type="range" min={0} max={100} value={tolerance} disabled={!pic}
              onChange={(e) => { const v = Number(e.target.value); setTolerance(v); if (autoOn && pic) { setMask(autoMask(pic.rgba, pic.w, pic.h, v)); } }} />
          </label>
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
          The PNG is a still with a transparent background. {moving ? "The GIF loops 3 seconds of the animation and works on most virtual tabletops; GIF edges are crisp, not soft. At 512 px it is about 3 to 4 MB; 1024 makes a 768 px GIF of about 8 MB. The video loops it on a dark background. " : ""}
          {mode === "app" ? "On the tabletop the frame is drawn live, so the animation plays at the table." : "Everything happens in your browser: nothing is uploaded."}
        </p>
      </div>
    </div>
  );
}
