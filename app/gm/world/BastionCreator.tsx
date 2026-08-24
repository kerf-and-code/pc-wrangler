"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import {
  BASTION_START_LEVEL, SPACE_SQUARES, BASIC_FACILITIES, BASIC_ADD_COST, DEFENSIVE_WALL,
  SOURCE_LABEL, CLASS_CAPABILITIES, capabilitiesForClass, availableFacilities, specialFacilitySlotsAt,
  PROPULSION_FACILITY_IDS,
  type FacilitySource, type FacilitySpace, type SpecialFacility, type BuilderContext,
} from "@/lib/bastion/rules";
import {
  FT_PER_SQUARE, BASTION_GRID_SIZES, emptyPlan, normalizePlan, setDecks, resizePlan,
  addPlacement, removePlacement, squaresUsed, maxSquares, costSummary, deckLabel, placementColor,
  renderBastionDeck, ORDER_COLORS, BASIC_COLOR,
  type BastionPlan, type Placement, type BastionKind, type DoorKind, type DoorEdge,
} from "@/lib/bastion/model";

// The Bastion tab (2024 bastion rules). Pick traditional or a multi-deck ship, choose a level and class
// to gate the facility palette, then PAINT each placed facility onto a 5-ft-square grid across the decks
// and drop doors on any edge. The rules dataset (lib/bastion/rules) gates what you can take; the layout
// model (lib/bastion/model) holds the plan, costs, and control-image render. Autosaves to bastion_maps
// and paints each deck through the imagine route (mode: "bastion"). Same flavour + render as the others.

const STYLES = [
  { v: "fantasy", label: "Fantasy" }, { v: "scifi", label: "Sci-fi" }, { v: "grimdark", label: "Grimdark" }, { v: "urban", label: "Urban" },
];
const SOURCES: FacilitySource[] = ["base", "forgotten-realms", "eberron", "ravenloft"];
const BRUSHES = [1, 2, 3, 5];
const DOOR_KINDS: { v: DoorKind; label: string }[] = [
  { v: "door", label: "Door" }, { v: "locked", label: "Locked" }, { v: "secret", label: "Secret" },
  { v: "portcullis", label: "Portcullis" }, { v: "window", label: "Window" },
];
const CAP_TOGGLES: { key: keyof BuilderContext; label: string }[] = [
  { key: "arcaneFocus", label: "Arcane focus" },
  { key: "holyDruidicFocus", label: "Holy / druidic focus" },
  { key: "spellcastingFocus", label: "Any spellcasting focus" },
  { key: "artisanToolsFocus", label: "Artisan's tools as focus" },
  { key: "expertise", label: "Expertise in a skill" },
  { key: "martialFeature", label: "Fighting Style / Unarmored Def." },
];
const CANVAS = 1000;
const newId = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export default function BastionCreator({ campaignId }: { campaignId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [plan, setPlan] = useState<BastionPlan>(() => emptyPlan("traditional", BASTION_START_LEVEL));
  const [deck, setDeck] = useState(0);
  const [brushIdx, setBrushIdx] = useState(0);      // 0 = eraser, else 1-based placement index
  const [brushSize, setBrushSize] = useState(2);
  const [tool, setTool] = useState<"paint" | "door">("paint");
  const [doorKind, setDoorKind] = useState<DoorKind>("door");
  const [skillsText, setSkillsText] = useState("");
  const [style, setStyle] = useState("fantasy");
  const [modifier, setModifier] = useState("");
  const [rendered, setRendered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const planRef = useRef(plan);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const painting = useRef(false);

  const meta = plan.meta;
  const skills = useMemo(() => skillsText.split(",").map((s) => s.trim()).filter(Boolean), [skillsText]);
  const ctx: BuilderContext = useMemo(() => ({
    level: meta.level,
    ...(meta.caps ?? {}),
    skills,
    allowedSources: meta.allowedSources ?? ["base"],
    enforceFactionRenown: meta.enforceFactionRenown,
  }), [meta.level, meta.caps, meta.allowedSources, meta.enforceFactionRenown, skills]);
  const available = useMemo(() => availableFacilities(ctx), [ctx]);
  const bySource = useMemo(() => {
    const g: Record<string, SpecialFacility[]> = {};
    for (const fac of available) (g[fac.source] ||= []).push(fac);
    for (const k of Object.keys(g)) g[k].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    return g;
  }, [available]);

  // ---- persistence ----
  useEffect(() => { planRef.current = plan; }, [plan]);
  useEffect(() => {
    let off = false;
    (async () => {
      if (!campaignId) { setLoaded(true); return; }
      const { data } = await supabase.from("bastion_maps").select("plan").eq("campaign_id", campaignId).maybeSingle();
      if (off) return;
      const raw = (data as { plan?: unknown } | null)?.plan;
      if (raw && typeof raw === "object" && Object.keys(raw as object).length) setPlan(normalizePlan(raw));
      setLoaded(true);
    })();
    return () => { off = true; };
  }, [supabase, campaignId]);
  useEffect(() => {
    if (!loaded || !campaignId) return;
    const t = setTimeout(() => {
      void supabase.from("bastion_maps").upsert({ campaign_id: campaignId, plan, updated_at: new Date().toISOString() }, { onConflict: "campaign_id" });
    }, 900);
    return () => clearTimeout(t);
  }, [plan, loaded, campaignId, supabase]);

  // keep the active deck valid when the deck count shrinks
  useEffect(() => { if (deck >= plan.decks) setDeck(plan.decks - 1); }, [plan.decks, deck]);

  // ---- live editor draw ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const cx = canvas.getContext("2d"); if (!cx) return;
    const p = planRef.current, n = p.gridN, CELL = CANVAS / n, g = p.levels[deck] ?? [];
    cx.fillStyle = "#0e0b08"; cx.fillRect(0, 0, CANVAS, CANVAS);
    // ghost of the deck below (helps align ship decks / multi-level facilities)
    if (deck > 0) { const b = p.levels[deck - 1] ?? []; for (let i = 0; i < n * n; i++) if (b[i]) { const x = (i % n) * CELL, y = ((i / n) | 0) * CELL; cx.fillStyle = "rgba(201,162,75,0.06)"; cx.fillRect(x, y, CELL, CELL); } }
    // fills
    for (let i = 0; i < n * n; i++) { const v = g[i]; if (!v) continue; const pl = p.placements[v - 1]; if (!pl) continue; const x = (i % n) * CELL, y = ((i / n) | 0) * CELL; cx.fillStyle = pl.color || placementColor(pl); cx.fillRect(x, y, CELL, CELL); }
    // walls between different placements / empty
    cx.strokeStyle = "#2a2620"; cx.lineWidth = Math.max(1.5, CELL * 0.14); cx.lineCap = "round";
    const at = (rr: number, cc: number) => (rr < 0 || cc < 0 || rr >= n || cc >= n) ? 0 : g[rr * n + cc];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const v = g[r * n + c]; if (!v) continue; const x = c * CELL, y = r * CELL; cx.beginPath();
      if (at(r - 1, c) !== v) { cx.moveTo(x, y); cx.lineTo(x + CELL, y); }
      if (at(r + 1, c) !== v) { cx.moveTo(x, y + CELL); cx.lineTo(x + CELL, y + CELL); }
      if (at(r, c - 1) !== v) { cx.moveTo(x, y); cx.lineTo(x, y + CELL); }
      if (at(r, c + 1) !== v) { cx.moveTo(x + CELL, y); cx.lineTo(x + CELL, y + CELL); }
      cx.stroke(); }
    // highlight the active brush's cells
    if (brushIdx > 0) { cx.strokeStyle = C.sun; cx.lineWidth = Math.max(2, CELL * 0.16);
      for (let i = 0; i < n * n; i++) if (g[i] === brushIdx) { const x = (i % n) * CELL, y = ((i / n) | 0) * CELL; cx.strokeRect(x + CELL * 0.12, y + CELL * 0.12, CELL * 0.76, CELL * 0.76); } }
    // grid
    cx.strokeStyle = "rgba(255,255,255,0.05)"; cx.lineWidth = 1;
    for (let i = 0; i <= n; i++) { cx.beginPath(); cx.moveTo(i * CELL, 0); cx.lineTo(i * CELL, CANVAS); cx.stroke(); cx.beginPath(); cx.moveTo(0, i * CELL); cx.lineTo(CANVAS, i * CELL); cx.stroke(); }
    // doors on this deck
    const dw = Math.max(3, CELL * 0.5);
    for (const d of p.doors) { if (d.deck !== deck) continue; const x = d.x * CELL, y = d.y * CELL;
      cx.fillStyle = d.kind === "portcullis" ? "#8a8272" : d.kind === "window" ? "#8fb0c0" : d.kind === "secret" ? "#7a6bb0" : d.kind === "locked" ? "#c98a7a" : "#d8cdb5";
      const th = Math.max(2, CELL * 0.16);
      if (d.edge === "N") cx.fillRect(x + (CELL - dw) / 2, y - th / 2, dw, th);
      else if (d.edge === "S") cx.fillRect(x + (CELL - dw) / 2, y + CELL - th / 2, dw, th);
      else if (d.edge === "W") cx.fillRect(x - th / 2, y + (CELL - dw) / 2, th, dw);
      else cx.fillRect(x + CELL - th / 2, y + (CELL - dw) / 2, th, dw); }
  }, [deck, brushIdx]);
  useEffect(() => { draw(); }, [draw, plan]);

  // ---- pointer interaction ----
  const cellAt = (e: React.PointerEvent) => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const r = canvas.getBoundingClientRect(), n = planRef.current.gridN, CELL = CANVAS / n;
    const px = (e.clientX - r.left) * (CANVAS / r.width), py = (e.clientY - r.top) * (CANVAS / r.height);
    const col = (px / CELL) | 0, row = (py / CELL) | 0;
    if (col < 0 || row < 0 || col >= n || row >= n) return null;
    return { row, col, fx: (px / CELL) - col, fy: (py / CELL) - row };
  };
  const paintAt = (e: React.PointerEvent) => {
    const hit = cellAt(e); if (!hit) return;
    const n = planRef.current.gridN, half = Math.floor(brushSize / 2);
    setPlan((prev) => {
      const levels = prev.levels.map((a) => a.slice());
      for (let dr = 0; dr < brushSize; dr++) for (let dc = 0; dc < brushSize; dc++) {
        const r2 = hit.row - half + dr, c2 = hit.col - half + dc;
        if (r2 >= 0 && c2 >= 0 && r2 < n && c2 < n) levels[deck][r2 * n + c2] = brushIdx;
      }
      return { ...prev, levels };
    });
  };
  const doorAt = (e: React.PointerEvent) => {
    const hit = cellAt(e); if (!hit) return;
    const { row, col, fx, fy } = hit;
    const dTop = fy, dBot = 1 - fy, dLeft = fx, dRight = 1 - fx;
    const m = Math.min(dTop, dBot, dLeft, dRight);
    const edge: DoorEdge = m === dTop ? "N" : m === dBot ? "S" : m === dLeft ? "W" : "E";
    setPlan((prev) => {
      const idx = prev.doors.findIndex((d) => d.deck === deck && d.x === col && d.y === row && d.edge === edge);
      const doors = prev.doors.slice();
      if (idx >= 0) { if (doors[idx].kind === doorKind) doors.splice(idx, 1); else doors[idx] = { ...doors[idx], kind: doorKind }; }
      else doors.push({ deck, x: col, y: row, edge, kind: doorKind });
      return { ...prev, doors };
    });
  };

  const onDown = (e: React.PointerEvent) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    if (tool === "door") { doorAt(e); return; }
    painting.current = true; paintAt(e);
  };
  const onMove = (e: React.PointerEvent) => { if (tool === "paint" && painting.current) paintAt(e); };
  const onUp = () => { painting.current = false; };

  // ---- structure changes ----
  const changeKind = (kind: BastionKind) => { setPlan((p) => setDecks(p, kind, kind === "ship" ? !!p.meta.topDeck : false)); setRendered(null); };
  const toggleTop = () => { setPlan((p) => setDecks(p, "ship", !p.meta.topDeck)); setRendered(null); };
  const changeGrid = (n: number) => { setPlan((p) => resizePlan(p, n)); setRendered(null); };
  const patchMeta = (m: Partial<BastionPlan["meta"]>) => setPlan((p) => ({ ...p, meta: { ...p.meta, ...m } }));
  const changeClass = (cn: string) => patchMeta({ className: cn || undefined, caps: cn ? capabilitiesForClass(cn) : {} });
  const toggleCap = (k: keyof BuilderContext) => patchMeta({ caps: { ...(meta.caps ?? {}), [k]: !(meta.caps as Record<string, boolean> | undefined)?.[k] } });
  const toggleSource = (s: FacilitySource) => {
    const cur = meta.allowedSources ?? ["base"];
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    patchMeta({ allowedSources: next.length ? next : ["base"] });
  };

  // ---- placements ----
  const addSpecial = (fac: SpecialFacility) => {
    const p: Placement = { id: newId(), kind: "special", facilityId: fac.id, label: fac.name, space: fac.space, order: fac.order, color: ORDER_COLORS[fac.order] };
    setPlan((prev) => { const np = addPlacement(prev, p); setBrushIdx(np.placements.length); return np; });
  };
  const addBasic = (name: string) => {
    const p: Placement = { id: newId(), kind: "basic", basicName: name, label: name, space: "Roomy", color: BASIC_COLOR };
    setPlan((prev) => { const np = addPlacement(prev, p); setBrushIdx(np.placements.length); return np; });
  };
  const remove = (index1: number) => { setPlan((p) => removePlacement(p, index1)); setBrushIdx(0); };
  const patchPlacement = (index1: number, patch: Partial<Placement>) =>
    setPlan((p) => ({ ...p, placements: p.placements.map((pl, i) => i === index1 - 1 ? { ...pl, ...patch } : pl) }));

  const selected = brushIdx > 0 ? plan.placements[brushIdx - 1] : undefined;
  const selectedFac = selected?.facilityId ? available.find((f) => f.id === selected.facilityId) ?? null : null;

  // ---- accounting ----
  const specialCount = plan.placements.filter((p) => p.kind === "special").length;
  const specialSlots = specialFacilitySlotsAt(meta.level);
  const hasPropulsion = plan.placements.some((p) => p.facilityId && PROPULSION_FACILITY_IDS.includes(p.facilityId));
  const cost = useMemo(() => {
    const base = costSummary(plan);
    // First Cramped + first Roomy basic facility are free at creation.
    let freeC = false, freeR = false; let credGp = 0, credDays = 0;
    for (const p of plan.placements) { if (p.kind !== "basic") continue;
      if (!freeC && p.space === "Cramped") { freeC = true; credGp += BASIC_ADD_COST.Cramped.gp; credDays += BASIC_ADD_COST.Cramped.days; }
      else if (!freeR && p.space === "Roomy") { freeR = true; credGp += BASIC_ADD_COST.Roomy.gp; credDays += BASIC_ADD_COST.Roomy.days; } }
    const lines = credGp ? [...base.lines, { label: "Free starting facilities", gp: -credGp, days: -credDays }] : base.lines;
    return { lines, totalGp: base.totalGp - credGp, totalDays: base.totalDays - credDays };
  }, [plan]);

  // ---- render ----
  const doRender = async () => {
    setBusy(true); setMsg(null);
    try {
      const control = renderBastionDeck(planRef.current, deck, 1024);
      const facilities = Array.from(new Map(planRef.current.placements.map((p) => [p.color, { label: p.label, color: p.color }])).values());
      const res = await fetch("/api/world-map/imagine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId, controlImage: control, mode: "bastion", bastionKind: plan.kind, style,
          facilities, deckLabel: deckLabel(plan, deck), promptModifier: modifier,
          scaleHint: `1 grid square = ${FT_PER_SQUARE} ft`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) setRendered(data.url);
      else setMsg(data.error || "The render failed. Try again.");
    } catch { setMsg("Something went wrong reaching the image service."); }
    finally { setBusy(false); }
  };
  const saveLocally = async () => {
    if (!rendered) return;
    try { const blob = await (await fetch(rendered)).blob(); const obj = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = obj; a.download = `bastion-${plan.kind}-${deckLabel(plan, deck).replace(/\s+/g, "-").toLowerCase()}.png`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(obj); }
    catch { setMsg("Could not save automatically. Right-click the image and Save image as."); }
  };
  const clearDeck = () => setPlan((p) => { const levels = p.levels.map((a, i) => i === deck ? a.map(() => 0) : a); return { ...p, levels, doors: p.doors.filter((d) => d.deck !== deck) }; });

  // ---- styles ----
  const label: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, margin: "14px 0 6px" };
  const seg = (on: boolean): React.CSSProperties => ({ flex: 1, padding: "7px 0", background: on ? C.surface2 : "transparent", color: on ? C.sun : C.muted, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer" });
  const select: React.CSSProperties = { width: "100%", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontFamily: "inherit", fontSize: 14 };
  const btn = (bg: string, fg: string): React.CSSProperties => ({ padding: "9px 14px", background: bg, color: fg, border: bg === "transparent" ? `1px solid ${C.line}` : "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, width: "100%" });
  const chip = (on: boolean): React.CSSProperties => ({ padding: "5px 9px", background: on ? C.surface2 : "transparent", color: on ? C.sun : C.muted, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 999, fontSize: 12, cursor: "pointer" });
  const num: React.CSSProperties = { width: 70, padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 13 };

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
      {/* canvas + info */}
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 12 }}>
        <canvas ref={canvasRef} width={CANVAS} height={CANVAS} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
          style={{ display: "block", width: "min(560px, 86vw)", height: "auto", aspectRatio: "1 / 1", borderRadius: 8, background: "#0e0b08", cursor: tool === "door" ? "pointer" : "crosshair", touchAction: "none" }} />
        <p style={{ color: C.muted, fontSize: 12, margin: "8px 2px 0" }}>
          {plan.gridN}&times;{plan.gridN} grid, 1 square = {FT_PER_SQUARE} ft &middot; {plan.gridN * FT_PER_SQUARE}&times;{plan.gridN * FT_PER_SQUARE} ft across &middot; {deckLabel(plan, deck)}.
          {tool === "door" ? " Click a cell near an edge to drop a door; click it again to remove." : brushIdx === 0 ? " Eraser selected — drag to clear cells." : " Drag to paint the selected facility."}
        </p>
        {rendered && (
          <div style={{ marginTop: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={rendered} alt="Bastion deck" style={{ display: "block", width: "min(560px, 86vw)", borderRadius: 8 }} />
            <p style={{ color: C.muted, fontSize: 12, margin: "8px 2px 0" }}>Painted {deckLabel(plan, deck).toLowerCase()}. Save it, then reuse it anywhere.</p>
          </div>
        )}
      </div>

      {/* structure + gating */}
      <div style={{ width: 288, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 16 }}>
        <label style={label}>Bastion type</label>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => changeKind("traditional")} style={seg(plan.kind === "traditional")}>Traditional</button>
          <button type="button" onClick={() => changeKind("ship")} style={seg(plan.kind === "ship")}>Ship</button>
        </div>
        {plan.kind === "ship" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, color: C.text, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={!!meta.topDeck} onChange={toggleTop} style={{ accentColor: C.sun }} /> Build the optional top deck (4 decks)
          </label>
        )}

        <label style={label}>{plan.kind === "ship" ? "Deck" : "Level (floor)"}</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {plan.levels.map((_, d) => <button key={d} type="button" onClick={() => setDeck(d)} style={{ ...seg(deck === d), flex: "1 1 46%", fontSize: 12 }}>{deckLabel(plan, d)}</button>)}
        </div>

        <label style={label}>Grid size (squares per side)</label>
        <div style={{ display: "flex", gap: 6 }}>{BASTION_GRID_SIZES.map((s) => <button key={s} type="button" onClick={() => changeGrid(s)} style={seg(plan.gridN === s)}>{s}</button>)}</div>

        <label style={label}>Character level</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="number" min={BASTION_START_LEVEL} max={20} step={1} value={meta.level}
            onChange={(e) => patchMeta({ level: Math.max(BASTION_START_LEVEL, Math.min(20, Math.round(Number(e.target.value) || BASTION_START_LEVEL))) })} style={num} />
          <span style={{ color: C.muted, fontSize: 12 }}>Special facility slots: {specialCount}/{specialSlots}</span>
        </div>

        <label style={label}>Class (pre-fills the gating below)</label>
        <select value={meta.className ?? ""} onChange={(e) => changeClass(e.target.value)} style={select}>
          <option value="">Custom / none</option>
          {Object.keys(CLASS_CAPABILITIES).map((cn) => <option key={cn} value={cn}>{cn}</option>)}
        </select>

        <label style={label}>Character capabilities (override as needed)</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {CAP_TOGGLES.map((t) => <button key={String(t.key)} type="button" onClick={() => toggleCap(t.key)} style={chip(!!(meta.caps as Record<string, boolean> | undefined)?.[t.key])}>{t.label}</button>)}
        </div>
        <label style={label}>Skill proficiencies (comma-separated)</label>
        <input type="text" value={skillsText} onChange={(e) => setSkillsText(e.target.value)} placeholder="e.g. Medicine"
          style={{ width: "100%", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 13 }} />

        <label style={label}>Content sources offered</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SOURCES.map((s) => <button key={s} type="button" onClick={() => toggleSource(s)} style={chip((meta.allowedSources ?? ["base"]).includes(s))}>{SOURCE_LABEL[s]}</button>)}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: C.text, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={!!meta.enforceFactionRenown} onChange={(e) => patchMeta({ enforceFactionRenown: e.target.checked })} style={{ accentColor: C.sun }} />
          Hard-gate faction / renown facilities
        </label>

        {plan.kind === "ship"
          ? <p style={{ color: hasPropulsion ? C.muted : "#c98a7a", fontSize: 12, marginTop: 12 }}>
              {hasPropulsion ? "Propulsion Helm placed — this mobile bastion can move." : "A ship bastion needs a propulsion Helm (Eberron source). No defensive walls on a mobile bastion."}
            </p>
          : (
            <>
              <label style={label}>Defensive walls ({DEFENSIVE_WALL.gpPerSquare} gp / {DEFENSIVE_WALL.daysPerSquare} days per 5-ft square)</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="number" min={0} max={999} step={1} value={meta.defensiveWallSquares ?? 0}
                  onChange={(e) => patchMeta({ defensiveWallSquares: Math.max(0, Math.round(Number(e.target.value) || 0)) })} style={num} />
                <span style={{ color: C.muted, fontSize: 12 }}>squares of 20-ft wall</span>
              </div>
            </>
          )}
      </div>

      {/* palette + placed + tools */}
      <div style={{ width: 300, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 16 }}>
        <label style={label}>Tool</label>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => setTool("paint")} style={seg(tool === "paint")}>Paint rooms</button>
          <button type="button" onClick={() => setTool("door")} style={seg(tool === "door")}>Place doors</button>
        </div>
        {tool === "paint" ? (
          <>
            <label style={label}>Brush size</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => setBrushIdx(0)} style={seg(brushIdx === 0)}>Erase</button>
              {BRUSHES.map((b) => <button key={b} type="button" onClick={() => setBrushSize(b)} style={seg(brushSize === b)}>{b}&times;{b}</button>)}
            </div>
          </>
        ) : (
          <>
            <label style={label}>Door type</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {DOOR_KINDS.map((d) => <button key={d.v} type="button" onClick={() => setDoorKind(d.v)} style={chip(doorKind === d.v)}>{d.label}</button>)}
            </div>
          </>
        )}

        <label style={label}>Placed facilities ({plan.placements.length})</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 168, overflowY: "auto" }}>
          {plan.placements.length === 0 && <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>Add a facility below, then paint its squares.</p>}
          {plan.placements.map((pl, i) => {
            const idx = i + 1, used = squaresUsed(plan, idx), max = maxSquares(pl), over = used > max;
            return (
              <button key={pl.id} type="button" onClick={() => { setBrushIdx(idx); setTool("paint"); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: brushIdx === idx ? C.surface2 : "transparent", border: `1px solid ${brushIdx === idx ? C.sun : C.line}`, borderRadius: 7, cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, border: "1px solid rgba(0,0,0,.4)", background: pl.color }} />
                <span style={{ flex: 1, color: C.text, fontSize: 12.5 }}>{pl.label}{pl.enlarged ? " (Vast)" : ""}</span>
                <span style={{ color: over ? "#c98a7a" : C.muted, fontSize: 11.5 }}>{used}/{max}</span>
                <span onClick={(e) => { e.stopPropagation(); remove(idx); }} style={{ color: C.muted, fontSize: 14, padding: "0 2px", cursor: "pointer" }}>&times;</span>
              </button>
            );
          })}
        </div>

        {selected && (
          <div style={{ marginTop: 10, padding: 10, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8 }}>
            <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{selected.label}</div>
            {selectedFac && <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{selectedFac.note}</div>}
            {selectedFac && <div style={{ color: C.muted, fontSize: 11.5, marginTop: 4 }}>Order: {selectedFac.order} &middot; Level {selectedFac.level} &middot; {selectedFac.hirelings} hireling{selectedFac.hirelings === 1 ? "" : "s"}{selectedFac.hirelingsNote ? ` (${selectedFac.hirelingsNote})` : ""} &middot; {SOURCE_LABEL[selectedFac.source]}</div>}
            {selectedFac && selectedFac.prereq.kind !== "none" && <div style={{ color: C.muted, fontSize: 11.5, marginTop: 4 }}>Requires: {selectedFac.prereq.label}{selectedFac.prereq.extra ? ` + ${selectedFac.prereq.extra.label}` : ""}</div>}
            {selected.kind === "basic" && (
              <div style={{ marginTop: 8 }}>
                <span style={{ color: C.muted, fontSize: 11.5 }}>Size: </span>
                {(["Cramped", "Roomy", "Vast"] as FacilitySpace[]).map((sp) => (
                  <button key={sp} type="button" onClick={() => patchPlacement(brushIdx, { space: sp })} style={{ ...chip(selected.space === sp), marginRight: 4 }}>{sp} ({SPACE_SQUARES[sp]})</button>
                ))}
              </div>
            )}
            {selected.kind === "special" && selectedFac?.enlargeToVastGp && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, color: C.text, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={!!selected.enlarged} onChange={(e) => patchPlacement(brushIdx, { enlarged: e.target.checked })} style={{ accentColor: C.sun }} />
                Enlarge to Vast (+{selectedFac.enlargeToVastGp} gp)
              </label>
            )}
            <input type="text" value={selected.planeOrType ?? ""} onChange={(e) => patchPlacement(brushIdx, { planeOrType: e.target.value })}
              placeholder="Optional note (garden type, plane, guild…)"
              style={{ width: "100%", marginTop: 8, padding: "6px 8px", background: C.surface, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5 }} />
          </div>
        )}

        <label style={label}>Add basic facility (2 free at creation)</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {BASIC_FACILITIES.map((b) => <button key={b} type="button" onClick={() => addBasic(b)} style={chip(false)}>{b}</button>)}
        </div>

        <label style={label}>Add special facility (gated by level, class &amp; source)</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
          {available.length === 0 && <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>No facilities available at this level with the current sources and capabilities.</p>}
          {SOURCES.filter((s) => bySource[s]?.length).map((s) => (
            <div key={s}>
              <div style={{ color: C.muted, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", margin: "2px 0 4px" }}>{SOURCE_LABEL[s]}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {bySource[s].map((fac) => (
                  <button key={fac.id} type="button" onClick={() => addSpecial(fac)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "transparent", border: `1px solid ${C.line}`, borderRadius: 7, cursor: "pointer", textAlign: "left" }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, border: "1px solid rgba(0,0,0,.4)", background: ORDER_COLORS[fac.order] }} />
                    <span style={{ flex: 1, color: C.text, fontSize: 12.5 }}>{fac.name}</span>
                    <span style={{ color: C.muted, fontSize: 11 }}>L{fac.level} &middot; {fac.space}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* costs + flavour + render */}
      <div style={{ width: 262, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 16 }}>
        <label style={label}>Build cost</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {cost.lines.length === 0 && <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>Special facilities are gained by leveling (no gp). Basic facilities and walls cost gp and time.</p>}
          {cost.lines.map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
              <span style={{ color: C.muted }}>{l.label}</span>
              <span style={{ color: C.text, whiteSpace: "nowrap" }}>{l.gp.toLocaleString()} gp</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.line}` }}>
            <span style={{ color: C.text, fontWeight: 600 }}>Total</span>
            <span style={{ color: C.sun, fontWeight: 600 }}>{cost.totalGp.toLocaleString()} gp &middot; {cost.totalDays} days</span>
          </div>
        </div>
        {specialCount > specialSlots && <p style={{ color: "#c98a7a", fontSize: 12, marginTop: 10 }}>{specialCount} special facilities placed but only {specialSlots} slots at level {meta.level}.</p>}

        <label style={label}>Bastion name (optional)</label>
        <input type="text" value={meta.name ?? ""} onChange={(e) => patchMeta({ name: e.target.value || undefined })} placeholder="e.g. Blackbriar Keep"
          style={{ width: "100%", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 13 }} />

        <label style={label}>Style</label>
        <select value={style} onChange={(e) => setStyle(e.target.value)} style={select}>{STYLES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</select>

        <label style={label}>Flavour</label>
        <textarea value={modifier} onChange={(e) => setModifier(e.target.value)} rows={2} placeholder="e.g. candle-lit stone halls, banners overhead"
          style={{ width: "100%", padding: "8px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontFamily: "inherit", fontSize: 13, resize: "vertical" }} />

        <div style={{ marginTop: 14 }}><button type="button" onClick={doRender} disabled={busy} style={btn(C.sun, "#1b1712")}>{busy ? "Painting…" : `Paint ${deckLabel(plan, deck).toLowerCase()}`}</button></div>
        <div style={{ marginTop: 8 }}><button type="button" onClick={saveLocally} style={btn("transparent", C.text)}>Save image</button></div>
        <div style={{ marginTop: 8 }}><button type="button" onClick={clearDeck} style={btn("transparent", C.muted)}>Clear {deckLabel(plan, deck).toLowerCase()}</button></div>

        {msg && <p style={{ color: "#c98a7a", fontSize: 12, marginTop: 12 }}>{msg}</p>}
      </div>
    </div>
  );
}
