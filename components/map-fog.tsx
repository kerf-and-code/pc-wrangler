"use client";

// components/map-fog.tsx
//
// Fog of war over a campaign map. One component, two modes: the GM paints, players watch.
//
// SCOPE, DELIBERATELY SMALL
//   This is for the occasional table that wants a map reveal without opening a VTT. It is not
//   trying to be one: no line of sight, no token vision, no dynamic lighting. A brush, an eraser,
//   and a live view for the players.
//
// HOW THE MASK WORKS
//   The map is a grid of cols x rows cells and one bit per cell says whether it has been revealed.
//   Cells are FRACTIONS of the image, exactly like map_pins.x/y, so the mask survives any image
//   size, any zoom, and any screen. The grid is coarse on purpose - a few hundred bytes writes on
//   every stroke and syncs over Realtime without any thought about payload size - and the blur on
//   the rendered canvas hides most of the blockiness.
//
// IT RENDERS THE OVERLAY ONLY, NOT THE IMAGE
//   Both map pages already draw their own <img> inside a position:relative wrapper, with pins
//   absolutely positioned on top and an SVG trace beside them. A component that rendered its own
//   image would duplicate it and knock every pin out of alignment, so this drops INSIDE that
//   existing wrapper as another absolutely-positioned layer. The GM's controls float over the map
//   rather than sitting below it, for the same reason: the wrapper is an inline-block with
//   lineHeight 0 and is not a place to put a toolbar.
//
// AN HONEST LIMIT, WORTH STATING IN THE UI TOO
//   The player's browser is sent the whole map image and paints fog on top of it. Anyone who opens
//   devtools can see the unfogged map. Hiding it properly would mean compositing a masked image on
//   the server for every pan and zoom, which is a great deal of work and cost for a courtesy
//   feature. If a map has a real secret on it, upload a separate player version of the image.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

export type FogRow = { map_id: string; cols: number; rows: number; cells: string; updated_at: string };

/* ------------------------------------------------------------------ bitset */

const bytesFor = (n: number) => Math.ceil(n / 8);

function decode(cells: string, count: number): Uint8Array {
  const out = new Uint8Array(bytesFor(count));
  if (!cells) return out;
  try {
    const bin = atob(cells);
    for (let i = 0; i < Math.min(bin.length, out.length); i++) out[i] = bin.charCodeAt(i);
  } catch { /* a corrupt mask reveals nothing rather than throwing mid-session */ }
  return out;
}

function encode(bits: Uint8Array): string {
  let s = "";
  for (const b of bits) s += String.fromCharCode(b);
  return btoa(s);
}

const get = (bits: Uint8Array, i: number) => (bits[i >> 3] & (1 << (i & 7))) !== 0;
const set = (bits: Uint8Array, i: number, on: boolean) => {
  if (on) bits[i >> 3] |= 1 << (i & 7);
  else bits[i >> 3] &= ~(1 << (i & 7));
};

/* --------------------------------------------------------------- rendering */

/**
 * Paint the mask onto a canvas sized to the displayed image.
 *
 * Hidden cells are drawn as opaque black for the GM at partial alpha, so they can still see what
 * they are about to reveal, and fully opaque for players, because a translucent fog is not fog.
 */
function paint(
  canvas: HTMLCanvasElement, bits: Uint8Array, cols: number, rows: number, gm: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = gm ? "rgba(6,5,4,0.62)" : "rgb(6,5,4)";
  const cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!get(bits, r * cols + c)) {
        // Half a cell of overlap on each side so the blur below has something to work with and the
        // grid does not read as tiles.
        ctx.fillRect(c * cw - cw * 0.25, r * ch - ch * 0.25, cw * 1.5, ch * 1.5);
      }
    }
  }
}

/* --------------------------------------------------------------- component */

export default function MapFog({
  mapId, campaignId, shareCode, editable = false, onError, pollMs = 5000,
}: {
  mapId: string;
  campaignId?: string;
  /** Player mode: read through the share code, no session needed. */
  shareCode?: string;
  editable?: boolean;
  onError?: (m: string) => void;
  /**
   * How often to re-read the fog when Realtime has not delivered anything. Lower is snappier and
   * more expensive: at 1000ms, five players over a four-hour session make about 72,000 requests for
   * something that changes maybe twenty times. 5000 is the default for that reason, and it stops
   * mattering the moment Realtime works - see the backoff below.
   */
  pollMs?: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [cols, setCols] = useState(64);
  const [rows, setRows] = useState(48);
  const [bits, setBits] = useState<Uint8Array | null>(null);
  // Distinct from `bits`, which is null both while loading AND for a map that simply has no fog.
  // Without this the cover below could never lift on an unfogged map.
  const [loaded, setLoaded] = useState(false);
  // Set the first time a Realtime message lands. After that the poll is pure insurance and can slow
  // right down, because updates are already arriving the instant they happen.
  const realtimeWorks = useRef(false);
  // What we last rendered. Comparing this before repainting means a poll that finds nothing new
  // costs one small read and no re-render.
  const lastStamp = useRef<string>("");
  const [brush, setBrush] = useState(3);
  const [erasing, setErasing] = useState(false);
  // Painting is OFF until asked for. The brush is a full-size layer over the image, so while it is
  // live it swallows every click - including the one that places a pin. Two tools cannot both own
  // the same surface, so the GM says which one is in hand.
  const [painting, setPainting] = useState(false);
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const count = cols * rows;

  /* ---- load ------------------------------------------------------------- */
  const readFog = useCallback(async (): Promise<FogRow | null | "error"> => {
    if (shareCode) {
      const { data, error } = await supabase.rpc("map_fog_for_share", { p_share: shareCode });
      if (error) return "error";
      return ((data as FogRow[]) ?? []).find((r) => r.map_id === mapId) ?? null;
    }
    const { data, error } = await supabase
      .from("map_fog").select("map_id, cols, rows, cells, updated_at").eq("map_id", mapId).maybeSingle();
    if (error) return "error";
    return (data as FogRow | null) ?? null;
  }, [mapId, shareCode, supabase]);

  const applyRow = useCallback((row: FogRow | null) => {
    if (!row) { setBits(null); lastStamp.current = ""; return; }
    if (row.updated_at === lastStamp.current) return;   // nothing changed, do not repaint
    lastStamp.current = row.updated_at;
    setCols(row.cols); setRows(row.rows);
    setBits(decode(row.cells, row.cols * row.rows));
  }, []);

  // The first read goes through the same readFog/applyRow pair the poll uses, so both paths agree
  // on what counts as a change and lastStamp is primed - otherwise the very first poll always
  // repainted, having no idea what was already on screen.
  useEffect(() => {
    let live = true;
    (async () => {
      const row = await readFog();
      if (!live) return;
      if (row === "error") {
        // Silence here is indistinguishable from "this map has no fog", which is the wrong thing to
        // conclude from a missing function or a denied read.
        onError?.("Could not read the fog for this map.");
        console.warn("map-fog: read failed");
        setLoaded(true);
        return;
      }
      applyRow(row);
      setLoaded(true);
    })();
    return () => { live = false; };
  }, [readFog, applyRow, onError]);

  /* ---- live updates for players ---------------------------------------- */
  useEffect(() => {
    if (editable) return;   // the GM is the one writing; echoing their own strokes back fights the brush
    const ch = supabase
      .channel(`fog:${mapId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "map_fog", filter: `map_id=eq.${mapId}` },
        (payload) => {
          const row = payload.new as FogRow | null;
          if (!row?.cells && row?.cells !== "") return;
          realtimeWorks.current = true;
          applyRow(row);
        })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [mapId, editable, supabase, applyRow]);

  /* ---- polling, as a safety net ---------------------------------------- */
  //
  // Realtime should make this unnecessary: it pushes a change the moment the GM paints. But it has
  // to be switched on per table in Supabase, and if it is not, the map silently never updates -
  // which is indistinguishable from the feature being broken. So the player also asks.
  //
  // Two things keep the cost honest. It stops entirely while the tab is hidden, because a map left
  // open in a background tab should not be asking anything. And once a Realtime message has landed
  // it slows to a fifth of the rate, since at that point the poll is only insurance against a
  // dropped socket rather than the mechanism.
  useEffect(() => {
    if (editable || pollMs <= 0) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (!live) return;
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        const row = await readFog();
        if (!live) return;
        if (row !== "error") applyRow(row);
      }
      const wait = realtimeWorks.current ? pollMs * 5 : pollMs;
      timer = setTimeout(tick, wait);
    };

    timer = setTimeout(tick, pollMs);
    const wake = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", wake);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [editable, pollMs, readFog, applyRow]);

  /* ---- render ----------------------------------------------------------- */
  const redraw = useCallback(() => {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!cv || !wrap || !bits) return;
    const r = wrap.getBoundingClientRect();
    if (cv.width !== Math.round(r.width) || cv.height !== Math.round(r.height)) {
      cv.width = Math.round(r.width); cv.height = Math.round(r.height);
    }
    paint(cv, bits, cols, rows, editable);
  }, [bits, cols, rows, editable]);

  useEffect(() => { redraw(); }, [redraw]);

  // A ResizeObserver rather than a window resize listener, because the thing that actually changes
  // size here is the IMAGE: it has zero height until it loads, and the layout shifts again when the
  // sidebar wraps on a narrow screen. Watching the element catches both, and it replaces the
  // onLoad hook that existed while this component still rendered its own <img>.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw, bits]);

  /* ---- saving ----------------------------------------------------------- */
  // Debounced: a single stroke crosses dozens of cells and each one should not be a round trip.
  const scheduleSave = useCallback((next: Uint8Array) => {
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!dirty.current || !campaignId) return;
      dirty.current = false;
      setSaving(true);
      const { error } = await supabase.from("map_fog").upsert({
        map_id: mapId, campaign_id: campaignId, cols, rows,
        cells: encode(next), updated_at: new Date().toISOString(),
      }, { onConflict: "map_id" });
      setSaving(false);
      if (error) onError?.(`Could not save the fog: ${error.message}`);
    }, 400);
  }, [mapId, campaignId, cols, rows, supabase, onError]);

  /* ---- painting --------------------------------------------------------- */
  const applyAt = useCallback((clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap || !bits) return;
    const r = wrap.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    const cc = Math.floor(fx * cols), cr = Math.floor(fy * rows);
    const next = new Uint8Array(bits);
    for (let dr = -brush; dr <= brush; dr++) {
      for (let dc = -brush; dc <= brush; dc++) {
        if (dr * dr + dc * dc > brush * brush) continue;   // round brush, not square
        const rr = cr + dr, ccx = cc + dc;
        if (rr < 0 || rr >= rows || ccx < 0 || ccx >= cols) continue;
        set(next, rr * cols + ccx, !erasing);
      }
    }
    setBits(next);
    scheduleSave(next);
  }, [bits, brush, cols, rows, erasing, scheduleSave]);

  const fill = useCallback((revealed: boolean) => {
    const next = new Uint8Array(bytesFor(count));
    if (revealed) next.fill(0xff);
    setBits(next);
    scheduleSave(next);
  }, [count, scheduleSave]);

  const enableFog = useCallback(() => {
    // Starts fully hidden. Fog you have to switch on and then hide manually would be a strange way
    // round: the reason to turn it on is that the map is not meant to be seen yet.
    const next = new Uint8Array(bytesFor(count));
    setBits(next);
    scheduleSave(next);
  }, [count, scheduleSave]);

  /* ---- markup ----------------------------------------------------------- */
  //
  // Everything here is absolutely positioned so it layers over the caller's image. The canvas never
  // takes pointer events - the GM's brush lives on its own transparent layer ABOVE it, so a stroke
  // does not have to fight the pin buttons underneath for the click.
  return (
    <>
      {/* COVER THE MAP UNTIL THE FOG IS KNOWN.
          The caller renders its <img> immediately while this component's read is still in flight,
          so on every load and refresh there was a window where players saw the whole map before the
          canvas painted over it. Fog that arrives a moment late is not fog. This blanks the image
          until the answer is in, then lifts: on a fogged map the canvas has already taken over, and
          on an unfogged one there was nothing to hide. Players only - a GM covering their own map
          while it loads would just be in the way. */}
      {!editable && !loaded && (
        <div style={{
          position: "absolute", inset: 0, background: "rgb(6,5,4)",
          borderRadius: 4, pointerEvents: "none",
        }} />
      )}

      {bits && (
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            pointerEvents: "none", borderRadius: 4,
            // Softens the cell edges enough that a coarse grid does not read as tiles.
            filter: "blur(6px)",
          }}
        />
      )}

      {editable && bits && painting && (
        <div
          ref={wrapRef}
          style={{ position: "absolute", inset: 0, cursor: erasing ? "cell" : "crosshair", touchAction: "none" }}
          onPointerDown={(e) => { drawing.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); applyAt(e.clientX, e.clientY); }}
          onPointerMove={(e) => { if (drawing.current) applyAt(e.clientX, e.clientY); }}
          onPointerUp={() => { drawing.current = false; }}
          onPointerLeave={() => { drawing.current = false; }}
        />
      )}

      {/* Measured against the image even when the brush layer is absent, so the canvas can size
          itself before fog has been switched on. */}
      {(!editable || !painting || !bits) && (
        <div ref={wrapRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      )}

      {editable && (
        <div style={{
          position: "absolute", left: 8, top: 8, zIndex: 5,
          display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap",
          background: "rgba(10,8,6,0.82)", borderRadius: 4, padding: "7px 9px",
          lineHeight: 1.2,
        }}>
          {!bits ? (
            <button onClick={enableFog} style={btn}>Add fog</button>
          ) : (
            <>
              <button onClick={() => setPainting((v) => !v)}
                title={painting ? "Back to placing pins" : "Paint fog instead of placing pins"}
                style={{ ...btn, background: painting ? "rgba(200,162,75,0.9)" : "transparent",
                         color: painting ? "#241a0d" : C.text }}>
                {painting ? "Painting" : "Paint"}
              </button>
              <button onClick={() => setErasing(false)} disabled={!painting}
                style={{ ...btn, opacity: !painting ? 0.35 : erasing ? 0.5 : 1 }}>Reveal</button>
              <button onClick={() => setErasing(true)} disabled={!painting}
                style={{ ...btn, opacity: !painting ? 0.35 : erasing ? 1 : 0.5 }}>Hide</button>
              <input type="range" min={1} max={10} value={brush} title="Brush size" disabled={!painting}
                onChange={(e) => setBrush(Number(e.target.value))} style={{ width: 74 }} />
              <button onClick={() => fill(true)} style={btn}>All</button>
              <button onClick={() => fill(false)} style={btn}>None</button>
              <span style={{ fontSize: 11, opacity: saving ? 1 : 0.45, color: C.text }}>
                {saving ? "saving\u2026" : "saved"}
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}

const btn: React.CSSProperties = {
  background: "transparent", color: "inherit", border: "1px solid rgba(255,235,200,0.28)",
  borderRadius: 4, padding: "7px 13px", fontSize: 12.5, cursor: "pointer",
};
const label: React.CSSProperties = { fontSize: 12.5, display: "inline-flex", alignItems: "center" };
