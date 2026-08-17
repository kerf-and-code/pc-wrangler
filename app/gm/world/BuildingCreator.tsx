"use client";

import React, { useMemo, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { generateBuilding, buildingDef, BUILDING_TYPES, type BuildingTypeDef } from "@/lib/building/generate";

// The Building tab. Pick a type, get an auto floor plan, paint it in a genre through the imagine route
// (mode: "building"), and save. Fully parametric - nothing is stored; regenerate from the settings.

const STYLES = [
  { v: "fantasy", label: "Fantasy" },
  { v: "scifi", label: "Sci-fi" },
  { v: "grimdark", label: "Grimdark" },
  { v: "urban", label: "Urban" },
];

export default function BuildingCreator({ campaignId }: { campaignId: string }) {
  const [type, setType] = useState("house");
  const [rooms, setRooms] = useState(5);
  const [floor, setFloor] = useState(0);
  const [style, setStyle] = useState("fantasy");
  const [modifier, setModifier] = useState("");
  const [seed, setSeed] = useState<number>(() => (Math.random() * 1e9) | 0);
  const [rendered, setRendered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const control = useMemo(() => generateBuilding({ type, rooms, floor, seed, size: 1024 }), [type, rooms, floor, seed]);
  const groups = useMemo(() => {
    const g: Record<string, BuildingTypeDef[]> = {};
    for (const b of BUILDING_TYPES) (g[b.group] ||= []).push(b);
    return g;
  }, []);

  const changeType = (t: string) => { setType(t); setRooms(buildingDef(t).rooms); setRendered(null); };

  const render = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/world-map/imagine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, controlImage: control, mode: "building", buildingType: buildingDef(type).label, style, promptModifier: modifier }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) setRendered(data.url);
      else setMsg(data.error || "The render failed. Try again.");
    } catch { setMsg("Something went wrong reaching the image service."); }
    finally { setBusy(false); }
  };

  const saveLocally = async () => {
    const url = rendered || control;
    try { const blob = await (await fetch(url)).blob(); const obj = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = obj; a.download = `${type}-floor${floor + 1}-${style}.png`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(obj); }
    catch { setMsg("Could not save automatically. Right-click the image and Save image as."); }
  };

  const label: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, margin: "14px 0 6px" };
  const select: React.CSSProperties = { width: "100%", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontFamily: "inherit", fontSize: 14 };
  const seg = (on: boolean): React.CSSProperties => ({ flex: 1, padding: "7px 0", background: on ? C.surface2 : "transparent", color: on ? C.sun : C.muted, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer" });
  const btn = (bg: string, fg: string): React.CSSProperties => ({ padding: "9px 14px", background: bg, color: fg, border: bg === "transparent" ? `1px solid ${C.line}` : "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, width: "100%" });

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={rendered || control} alt="Building" style={{ display: "block", width: "min(560px, 86vw)", borderRadius: 8, background: "#0e0b08" }} />
        <p style={{ color: C.muted, fontSize: 12, margin: "10px 2px 0" }}>
          {rendered ? "Painted building. Save it, then reuse it anywhere." : "Floor plan (the bones). Pick a style and Paint building to render it."}
        </p>
      </div>

      <div style={{ width: 260, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 16 }}>
        <label style={label}>Building type</label>
        <select value={type} onChange={(e) => changeType(e.target.value)} style={select}>
          {Object.entries(groups).map(([g, items]) => (
            <optgroup key={g} label={g}>
              {items.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </optgroup>
          ))}
        </select>

        <label style={label}>Rooms: {rooms}</label>
        <input type="range" min={1} max={12} value={rooms} onChange={(e) => { setRooms(+e.target.value); setRendered(null); }} style={{ width: "100%", accentColor: C.sun }} />

        <label style={label}>Floor</label>
        <div style={{ display: "flex", gap: 6 }}>{[0, 1, 2].map((f) => <button key={f} type="button" onClick={() => { setFloor(f); setRendered(null); }} style={seg(floor === f)}>Floor {f + 1}</button>)}</div>

        <label style={label}>Style</label>
        <select value={style} onChange={(e) => setStyle(e.target.value)} style={select}>
          {STYLES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>

        <label style={label}>Flavour</label>
        <textarea value={modifier} onChange={(e) => setModifier(e.target.value)} rows={2}
          placeholder="e.g. cluttered and lived-in, fire in the hearth"
          style={{ width: "100%", padding: "8px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontFamily: "inherit", fontSize: 13, resize: "vertical" }} />

        <div style={{ marginTop: 14 }}><button type="button" onClick={() => { setSeed((Math.random() * 1e9) | 0); setRendered(null); }} style={btn("transparent", C.text)}>New layout</button></div>
        <div style={{ marginTop: 8 }}><button type="button" onClick={render} disabled={busy} style={btn(C.sun, "#1b1712")}>{busy ? "Painting\u2026" : "Paint building"}</button></div>
        <div style={{ marginTop: 8 }}><button type="button" onClick={saveLocally} style={btn("transparent", C.text)}>Save image</button></div>

        {msg && <p style={{ color: "#c98a7a", fontSize: 12, marginTop: 12 }}>{msg}</p>}
      </div>
    </div>
  );
}
