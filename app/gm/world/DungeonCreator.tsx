"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import { CELL_TYPES, N, emptyLevels, normalizeLevels, renderDungeonLevel } from "@/lib/dungeon/render";

// The Dungeon tab. Paint a 20x20 grid across three stacked levels, autosave the layout to
// dungeon_maps, and paint each level into a top-down battle map through the imagine route
// (mode: "dungeon"). The free-text flavour rides along on the prompt.

export default function DungeonCreator({ campaignId }: { campaignId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [levels, setLevels] = useState<number[][]>(() => emptyLevels());
  const [level, setLevel] = useState(0);
  const [brush, setBrush] = useState(2); // Room
  const [modifier, setModifier] = useState("");
  const [rendered, setRendered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const painting = useRef(false);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!campaignId) { setLoaded(true); return; }
      const { data } = await supabase.from("dungeon_maps").select("levels").eq("campaign_id", campaignId).maybeSingle();
      if (off) return;
      const raw = (data as { levels?: unknown } | null)?.levels;
      if (raw) setLevels(normalizeLevels(raw));
      setLoaded(true);
    })();
    return () => { off = true; };
  }, [supabase, campaignId]);

  // Autosave the layout ~1s after the last edit.
  useEffect(() => {
    if (!loaded || !campaignId) return;
    const t = setTimeout(() => {
      void supabase.from("dungeon_maps").upsert(
        { campaign_id: campaignId, levels, updated_at: new Date().toISOString() },
        { onConflict: "campaign_id" },
      );
    }, 900);
    return () => clearTimeout(t);
  }, [levels, loaded, campaignId, supabase]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const W = canvas.width, CELL = W / N, g = levels[level];
    ctx.fillStyle = "#141019"; ctx.fillRect(0, 0, W, W);
    if (level > 0) { const b = levels[level - 1]; for (let i = 0; i < N * N; i++) if (b[i]) { const x = (i % N) * CELL, y = ((i / N) | 0) * CELL; ctx.fillStyle = "rgba(201,162,75,0.06)"; ctx.fillRect(x, y, CELL, CELL); } }
    for (let i = 0; i < N * N; i++) { const t = g[i]; if (!t) continue; const col = CELL_TYPES[t].color; if (!col) continue; const x = (i % N) * CELL, y = ((i / N) | 0) * CELL; ctx.fillStyle = col; ctx.fillRect(x, y, CELL, CELL); if (CELL_TYPES[t].key === "corridor") { ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect(x + CELL * 0.18, y + CELL * 0.18, CELL * 0.64, CELL * 0.64); } }
    ctx.strokeStyle = "#2a2620"; ctx.lineWidth = CELL * 0.14; ctx.lineCap = "round";
    const wall = (t: number, rr: number, cc: number) => { if (rr < 0 || cc < 0 || rr >= N || cc >= N) return true; const nt = g[rr * N + cc]; if (!nt) return true; if (CELL_TYPES[nt].key === "corridor") return false; return nt !== t; };
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const t = g[r * N + c]; if (!t || CELL_TYPES[t].key === "corridor") continue; const x = c * CELL, y = r * CELL; ctx.beginPath();
      if (wall(t, r - 1, c)) { ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); }
      if (wall(t, r + 1, c)) { ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); }
      if (wall(t, r, c - 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); }
      if (wall(t, r, c + 1)) { ctx.moveTo(x + CELL, y); ctx.lineTo(x + CELL, y + CELL); }
      ctx.stroke(); }
    ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
    for (let i = 0; i <= N; i++) { ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, W); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke(); }
  }, [levels, level]);

  useEffect(() => { draw(); }, [draw]);

  const cellAt = (e: React.PointerEvent) => {
    const canvas = canvasRef.current; if (!canvas) return -1;
    const r = canvas.getBoundingClientRect(), sx = canvas.width / r.width, sy = canvas.height / r.height, CELL = canvas.width / N;
    const col = (((e.clientX - r.left) * sx) / CELL) | 0, row = (((e.clientY - r.top) * sy) / CELL) | 0;
    if (col < 0 || row < 0 || col >= N || row >= N) return -1;
    return row * N + col;
  };
  const paintAt = (e: React.PointerEvent) => {
    const i = cellAt(e); if (i < 0) return;
    setLevels((prev) => { const next = prev.map((a) => a.slice()); next[level][i] = brush === 0 ? 0 : brush; return next; });
  };

  const render = async () => {
    setBusy(true); setMsg(null);
    try {
      const control = renderDungeonLevel(levels[level], 1024);
      const res = await fetch("/api/world-map/imagine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, controlImage: control, mode: "dungeon", promptModifier: modifier }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) setRendered(data.url);
      else setMsg(data.error || "The render failed. Try again.");
    } catch { setMsg("Something went wrong reaching the image service."); }
    finally { setBusy(false); }
  };

  const saveLocally = async () => {
    if (!rendered) return;
    try { const blob = await (await fetch(rendered)).blob(); const obj = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = obj; a.download = `dungeon-level${level + 1}.png`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(obj); }
    catch { setMsg("Could not save automatically. Right-click the image and Save image as."); }
  };

  const label: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, margin: "14px 0 6px" };
  const btn = (bg: string, fg: string): React.CSSProperties => ({ padding: "9px 14px", background: bg, color: fg, border: bg === "transparent" ? `1px solid ${C.line}` : "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, width: "100%" });

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 12 }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={800}
          onPointerDown={(e) => { painting.current = true; canvasRef.current?.setPointerCapture(e.pointerId); paintAt(e); }}
          onPointerMove={(e) => { if (painting.current) paintAt(e); }}
          onPointerUp={() => { painting.current = false; }}
          style={{ display: "block", width: "min(560px, 86vw)", height: "auto", aspectRatio: "1 / 1", borderRadius: 8, background: "#0e0b08", cursor: "crosshair", touchAction: "none" }}
        />
        {rendered && (
          <div style={{ marginTop: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={rendered} alt="Rendered level" style={{ display: "block", width: "min(560px, 86vw)", borderRadius: 8 }} />
            <p style={{ color: C.muted, fontSize: 12, margin: "8px 2px 0" }}>Painted level {level + 1}. Save it, then reuse it anywhere.</p>
          </div>
        )}
      </div>

      <div style={{ width: 270, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 16 }}>
        <label style={label}>Level</label>
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2].map((l) => (
            <button key={l} type="button" onClick={() => setLevel(l)}
              style={{ flex: 1, padding: "8px 0", background: level === l ? C.surface2 : "transparent", color: level === l ? C.sun : C.muted, border: `1px solid ${level === l ? C.sun : C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              Level {l + 1}
            </button>
          ))}
        </div>

        <label style={label}>Brush</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {CELL_TYPES.map((t, i) => (
            <button key={t.key} type="button" onClick={() => setBrush(i)}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", background: brush === i ? C.surface2 : "transparent", color: C.text, border: `1px solid ${brush === i ? C.sun : C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer", textAlign: "left" }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, border: "1px solid rgba(0,0,0,.4)", background: t.color || "repeating-linear-gradient(45deg,#333,#333 3px,#222 3px,#222 6px)" }} />
              {t.label}
            </button>
          ))}
        </div>

        <label style={label}>Flavour</label>
        <textarea value={modifier} onChange={(e) => setModifier(e.target.value)} rows={2}
          placeholder="e.g. overgrown and abandoned, torch-lit"
          style={{ width: "100%", padding: "8px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontFamily: "inherit", fontSize: 13, resize: "vertical" }} />

        <div style={{ marginTop: 14 }}><button type="button" onClick={render} disabled={busy} style={btn(C.sun, "#1b1712")}>{busy ? "Painting\u2026" : `Paint level ${level + 1}`}</button></div>
        <div style={{ marginTop: 8 }}><button type="button" onClick={saveLocally} style={btn("transparent", C.text)}>Save image</button></div>
        <div style={{ marginTop: 8 }}><button type="button" onClick={() => setLevels((prev) => { const next = prev.map((a) => a.slice()); next[level] = next[level].map(() => 0); return next; })} style={btn("transparent", C.muted)}>Clear level {level + 1}</button></div>

        {msg && <p style={{ color: "#c98a7a", fontSize: 12, marginTop: 12 }}>{msg}</p>}
      </div>
    </div>
  );
}
