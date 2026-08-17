"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import {
  BUILDING_TYPES, buildingDef, makePlan, footprintOf, walkSplits, splitLine, doorPt, entPt,
  drawPlan, rotatePlan, flipPlan, renderControlImage,
  type BuildingPlan, type BuildingTypeDef, type Entrance, type Rect, type SplitHit,
} from "@/lib/building/generate";

// The Building tab. Pick a type for an auto floor plan, then DRAG interior walls, doors and the gold
// entrance to place them; flip/rotate to reorient. The edited plan autosaves to building_maps and
// paints through the imagine route (mode: "building").

const STYLES = [
  { v: "fantasy", label: "Fantasy" }, { v: "scifi", label: "Sci-fi" }, { v: "grimdark", label: "Grimdark" }, { v: "urban", label: "Urban" },
];
const CANVAS = 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
type Drag = { type: "wall" | "door"; node: SplitHit["node"]; r: Rect } | { type: "ent" };

export default function BuildingCreator({ campaignId }: { campaignId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [plan, setPlan] = useState<BuildingPlan>(() => makePlan("house", 5, (Math.random() * 1e9) | 0));
  const [style, setStyle] = useState("fantasy");
  const [modifier, setModifier] = useState("");
  const [rendered, setRendered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const planRef = useRef(plan);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<Drag | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    drawPlan(ctx, planRef.current, CANVAS);
  }, []);

  useEffect(() => { planRef.current = plan; draw(); }, [plan, draw]);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!campaignId) { setLoaded(true); return; }
      const { data } = await supabase.from("building_maps").select("plan").eq("campaign_id", campaignId).maybeSingle();
      if (off) return;
      const raw = (data as { plan?: unknown } | null)?.plan as BuildingPlan | undefined;
      if (raw && raw.tree && raw.entrance) setPlan(raw);
      setLoaded(true);
    })();
    return () => { off = true; };
  }, [supabase, campaignId]);

  useEffect(() => {
    if (!loaded || !campaignId) return;
    const t = setTimeout(() => {
      void supabase.from("building_maps").upsert({ campaign_id: campaignId, plan, updated_at: new Date().toISOString() }, { onConflict: "campaign_id" });
    }, 900);
    return () => clearTimeout(t);
  }, [plan, loaded, campaignId, supabase]);

  const at = (e: React.PointerEvent) => {
    const canvas = canvasRef.current; if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (CANVAS / r.width), y: (e.clientY - r.top) * (CANVAS / r.height) };
  };
  const pick = (p: { x: number; y: number }): Drag | null => {
    const pl = planRef.current, f = footprintOf(pl, CANVAS), near = CANVAS * 0.03;
    const splits: SplitHit[] = []; walkSplits(pl.tree, f, splits);
    for (const s of splits) { const d = doorPt(s.node, s.r); if (Math.hypot(p.x - d.x, p.y - d.y) < near * 1.3) return { type: "door", node: s.node, r: s.r }; }
    for (const s of splits) { const l = splitLine(s.node, s.r); const on = s.node.axis === "v" ? (Math.abs(p.x - l.x1) < near && p.y > l.y1 && p.y < l.y2) : (Math.abs(p.y - l.y1) < near && p.x > l.x1 && p.x < l.x2); if (on) return { type: "wall", node: s.node, r: s.r }; }
    const e = entPt(pl.entrance, f); if (Math.hypot(p.x - e.x, p.y - e.y) < near * 1.6) return { type: "ent" };
    const db = Math.min(Math.abs(p.x - f.x), Math.abs(p.x - f.x - f.w), Math.abs(p.y - f.y), Math.abs(p.y - f.y - f.h));
    if (db < near && p.x > f.x - near && p.x < f.x + f.w + near && p.y > f.y - near && p.y < f.y + f.h + near) return { type: "ent" };
    return null;
  };
  const applyDrag = (p: { x: number; y: number }) => {
    const d = drag.current; if (!d) return; const pl = planRef.current;
    if (d.type === "wall") { const t = d.node.axis === "v" ? (p.x - d.r.x) / d.r.w : (p.y - d.r.y) / d.r.h; d.node.pos = clamp(t, 0.12, 0.88); }
    else if (d.type === "door") { const t = d.node.axis === "v" ? (p.y - d.r.y) / d.r.h : (p.x - d.r.x) / d.r.w; d.node.door = clamp(t, 0.1, 0.9); }
    else { const f = footprintOf(pl, CANVAS); const dN = Math.abs(p.y - f.y), dS = Math.abs(p.y - f.y - f.h), dW = Math.abs(p.x - f.x), dE = Math.abs(p.x - f.x - f.w), m = Math.min(dN, dS, dW, dE);
      let ent: Entrance;
      if (m === dN) ent = { side: "N", off: clamp((p.x - f.x) / f.w, 0.05, 0.95) };
      else if (m === dS) ent = { side: "S", off: clamp((p.x - f.x) / f.w, 0.05, 0.95) };
      else if (m === dW) ent = { side: "W", off: clamp((p.y - f.y) / f.h, 0.05, 0.95) };
      else ent = { side: "E", off: clamp((p.y - f.y) / f.h, 0.05, 0.95) };
      pl.entrance = ent; }
    draw();
  };

  const onDown = (e: React.PointerEvent) => { const hit = pick(at(e)); if (hit) { drag.current = hit; canvasRef.current?.setPointerCapture(e.pointerId); } };
  const onMove = (e: React.PointerEvent) => { if (drag.current) applyDrag(at(e)); else { const h = pick(at(e)); if (canvasRef.current) canvasRef.current.style.cursor = h ? (h.type === "wall" ? "move" : "pointer") : "default"; } };
  const onUp = () => { if (drag.current) { drag.current = null; setPlan({ ...planRef.current }); } };

  const regen = (type: string, rooms: number, seed: number) => { setPlan(makePlan(type, rooms, seed)); setRendered(null); };

  const render = async () => {
    setBusy(true); setMsg(null);
    try {
      const control = renderControlImage(planRef.current, 1024);
      const res = await fetch("/api/world-map/imagine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, controlImage: control, mode: "building", buildingType: buildingDef(plan.type).label, style, promptModifier: modifier }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) setRendered(data.url);
      else setMsg(data.error || "The render failed. Try again.");
    } catch { setMsg("Something went wrong reaching the image service."); }
    finally { setBusy(false); }
  };

  const saveLocally = async () => {
    if (!rendered) return;
    try { const blob = await (await fetch(rendered)).blob(); const obj = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = obj; a.download = `${plan.type}-${style}.png`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(obj); }
    catch { setMsg("Could not save automatically. Right-click the image and Save image as."); }
  };

  const groups = useMemo(() => { const g: Record<string, BuildingTypeDef[]> = {}; for (const b of BUILDING_TYPES) (g[b.group] ||= []).push(b); return g; }, []);
  const label: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, margin: "14px 0 6px" };
  const select: React.CSSProperties = { width: "100%", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontFamily: "inherit", fontSize: 14 };
  const seg: React.CSSProperties = { flex: 1, padding: "7px 0", background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer" };
  const btn = (bg: string, fg: string): React.CSSProperties => ({ padding: "9px 14px", background: bg, color: fg, border: bg === "transparent" ? `1px solid ${C.line}` : "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, width: "100%" });

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 12 }}>
        <canvas ref={canvasRef} width={CANVAS} height={CANVAS} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
          style={{ display: "block", width: "min(560px, 86vw)", height: "auto", aspectRatio: "1 / 1", borderRadius: 8, background: "#0e0b08", touchAction: "none" }} />
        <p style={{ color: C.muted, fontSize: 12, margin: "8px 2px 0" }}>Drag a wall to move it, a door along its wall, or the gold entrance to any side.</p>
        {rendered && (
          <div style={{ marginTop: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={rendered} alt="Building" style={{ display: "block", width: "min(560px, 86vw)", borderRadius: 8 }} />
            <p style={{ color: C.muted, fontSize: 12, margin: "8px 2px 0" }}>Painted building. Save it, then reuse it anywhere.</p>
          </div>
        )}
      </div>

      <div style={{ width: 260, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 16 }}>
        <label style={label}>Building type</label>
        <select value={plan.type} onChange={(e) => regen(e.target.value, buildingDef(e.target.value).rooms, plan.seed)} style={select}>
          {Object.entries(groups).map(([g, items]) => <optgroup key={g} label={g}>{items.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</optgroup>)}
        </select>

        <label style={label}>Rooms: {plan.rooms}</label>
        <input type="range" min={1} max={12} value={plan.rooms} onChange={(e) => regen(plan.type, +e.target.value, plan.seed)} style={{ width: "100%", accentColor: C.sun }} />

        <label style={label}>Orientation</label>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => { setPlan(flipPlan(planRef.current, true)); setRendered(null); }} style={seg}>Flip &#8596;</button>
          <button type="button" onClick={() => { setPlan(flipPlan(planRef.current, false)); setRendered(null); }} style={seg}>Flip &#8597;</button>
          <button type="button" onClick={() => { setPlan(rotatePlan(planRef.current)); setRendered(null); }} style={seg}>Rotate &#8635;</button>
        </div>

        <label style={label}>Style</label>
        <select value={style} onChange={(e) => setStyle(e.target.value)} style={select}>{STYLES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</select>

        <label style={label}>Flavour</label>
        <textarea value={modifier} onChange={(e) => setModifier(e.target.value)} rows={2} placeholder="e.g. cluttered and lived-in, fire in the hearth"
          style={{ width: "100%", padding: "8px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontFamily: "inherit", fontSize: 13, resize: "vertical" }} />

        <div style={{ marginTop: 14 }}><button type="button" onClick={() => regen(plan.type, plan.rooms, (Math.random() * 1e9) | 0)} style={btn("transparent", C.text)}>New layout</button></div>
        <div style={{ marginTop: 8 }}><button type="button" onClick={render} disabled={busy} style={btn(C.sun, "#1b1712")}>{busy ? "Painting\u2026" : "Paint building"}</button></div>
        <div style={{ marginTop: 8 }}><button type="button" onClick={saveLocally} style={btn("transparent", C.text)}>Save image</button></div>

        {msg && <p style={{ color: "#c98a7a", fontSize: 12, marginTop: 12 }}>{msg}</p>}
      </div>
    </div>
  );
}
