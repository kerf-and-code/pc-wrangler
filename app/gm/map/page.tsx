"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";

const C = {
  bg: SAX.ink, surface: SAX.slateBg, surface2: "rgba(11,7,18,0.6)", line: SAX.line,
  text: SAX.text, muted: SAX.muted, sun: SAX.sun, plum: SAX.plum, good: SAX.good, warn: SAX.warn,
};

const VIS: { v: string; l: string }[] = [
  { v: "common", l: "Common knowledge" },
  { v: "player", l: "Party knows" },
  { v: "gm", l: "GM secret" },
  { v: "private", l: "Private (only me)" },
];

const BUCKET = "campaign-maps";

type Campaign = { id: string; name: string };
type MapRow = { id: string; name: string; image_path: string; visibility: string };
type Pin = { id: string; x: number; y: number; label: string | null; linked_type: string | null; linked_id: string | null; visibility: string };
type Ent = { id: string; title: string; type: string };
type Ch = { id: string; name: string; kind: string };

function pinColor(vis: string): string {
  if (vis === "gm") return C.warn;
  if (vis === "private") return C.muted;
  if (vis === "common") return C.good;
  return C.sun; // player
}

export default function MapPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [activeMap, setActiveMap] = useState<MapRow | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [entries, setEntries] = useState<Ent[]>([]);
  const [chars, setChars] = useState<Ch[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapName, setMapName] = useState<string>("");
  const [uploading, setUploading] = useState<boolean>(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at");
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      const [{ data: m }, { data: e }, { data: c }] = await Promise.all([
        supabase.from("maps").select("id, name, image_path, visibility").eq("campaign_id", campaignId).order("created_at"),
        supabase.from("entries").select("id, title, type").eq("campaign_id", campaignId).order("title"),
        supabase.from("characters").select("id, name, kind").eq("campaign_id", campaignId).order("name"),
      ]);
      const ml = (m as MapRow[]) || [];
      setMaps(ml);
      setEntries((e as Ent[]) || []);
      setChars((c as Ch[]) || []);
      setActiveMap(ml[0] || null);
      setSelected(null);
    })();
  }, [campaignId, supabase]);

  useEffect(() => {
    if (!activeMap) { setPins([]); return; }
    (async () => {
      const { data } = await supabase.from("map_pins").select("id, x, y, label, linked_type, linked_id, visibility").eq("map_id", activeMap.id);
      setPins((data as Pin[]) || []);
    })();
  }, [activeMap, supabase]);

  const publicUrl = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  async function uploadMap(file: File) {
    if (!campaignId || !file) return;
    setUploading(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const rand = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const path = `${campaignId}/${rand}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (upErr) { setUploading(false); return; }
    const { data, error } = await supabase.from("maps")
      .insert({ campaign_id: campaignId, name: mapName.trim() || "Map", image_path: path, visibility: "player" })
      .select("id, name, image_path, visibility").single();
    if (!error && data) { setMaps((arr) => [...arr, data as MapRow]); setActiveMap(data as MapRow); setMapName(""); }
    if (fileRef.current) fileRef.current.value = "";
    setUploading(false);
  }

  async function deleteMap(id: string) {
    await supabase.from("maps").delete().eq("id", id);
    setMaps((arr) => {
      const next = arr.filter((m) => m.id !== id);
      setActiveMap((cur) => (cur && cur.id === id ? next[0] || null : cur));
      return next;
    });
  }

  async function addPin(x: number, y: number) {
    if (!activeMap) return;
    const { data, error } = await supabase.from("map_pins")
      .insert({ map_id: activeMap.id, campaign_id: campaignId, x, y, label: "", visibility: "player" })
      .select("id, x, y, label, linked_type, linked_id, visibility").single();
    if (!error && data) { setPins((arr) => [...arr, data as Pin]); setSelected((data as Pin).id); }
  }

  async function updatePin(id: string, fields: Partial<Pin>) {
    setPins((arr) => arr.map((p) => (p.id === id ? { ...p, ...fields } : p)));
    await supabase.from("map_pins").update(fields).eq("id", id);
  }

  async function removePin(id: string) {
    await supabase.from("map_pins").delete().eq("id", id);
    setPins((arr) => arr.filter((p) => p.id !== id));
    if (selected === id) setSelected(null);
  }

  function onImageClick(ev: React.MouseEvent<HTMLImageElement>) {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
    addPin(x, y);
  }

  const sel = pins.find((p) => p.id === selected) || null;

  const eyebrow = { fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase" as const, color: C.muted, marginBottom: 6 };
  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 18px", marginBottom: 14 } as const;
  const input = { width: "100%", boxSizing: "border-box" as const, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 12px", fontSize: 14, outline: "none" };
  const sel2 = { ...input, marginTop: 4 };

  return (
    <PageShell width={1000}>
      <div style={eyebrow}>Story</div>
      <h1 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>Map</h1>
      <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 18px", maxWidth: 620 }}>
        Your campaign map. Upload the world, drop pins, and link each to a place, NPC, or piece of lore. Click the map to add a pin; players see only the pins you make party-visible.
      </p>

      <div style={{ ...box, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...input, width: "auto", flex: "1 1 200px" }}>
          {campaigns.length === 0 && <option value="">No campaigns yet</option>}
          {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        {maps.map((m) => (
          <button key={m.id} type="button" onClick={() => { setActiveMap(m); setSelected(null); }}
            style={{ background: activeMap?.id === m.id ? C.sun : "transparent", color: activeMap?.id === m.id ? SAX.inkDeep : C.text, border: `1px solid ${activeMap?.id === m.id ? C.sun : C.line}`, borderRadius: 999, padding: "6px 14px", fontSize: 13, cursor: "pointer" }}>
            {m.name}
          </button>
        ))}
      </div>

      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={mapName} onChange={(e) => setMapName(e.target.value)} placeholder="Map name (optional)" style={{ ...input, flex: "1 1 180px" }} />
        <input ref={fileRef} type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMap(f); }}
          style={{ fontSize: 13, color: C.muted }} disabled={uploading || !campaignId} />
        {uploading && <span style={{ fontSize: 12, color: C.muted }}>Uploading…</span>}
        {activeMap && (
          <button type="button" onClick={() => deleteMap(activeMap.id)}
            style={{ marginLeft: "auto", background: "transparent", color: C.warn, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>
            Delete this map
          </button>
        )}
      </div>

      {!activeMap ? (
        <div style={{ ...box, color: C.muted, fontSize: 14 }}>Upload a map image to begin.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: 16, alignItems: "start" }}>
          <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", lineHeight: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={publicUrl(activeMap.image_path)} alt={activeMap.name} onClick={onImageClick}
              style={{ maxWidth: "100%", display: "block", cursor: "crosshair", borderRadius: 10, border: `1px solid ${C.line}` }} />
            {pins.map((p) => (
              <button key={p.id} type="button" title={p.label || "pin"}
                onClick={(ev) => { ev.stopPropagation(); setSelected(p.id); }}
                style={{
                  position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%, -50%)",
                  width: selected === p.id ? 20 : 15, height: selected === p.id ? 20 : 15, borderRadius: "50%",
                  background: pinColor(p.visibility), border: `2px solid ${selected === p.id ? C.text : SAX.inkDeep}`,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.5)", cursor: "pointer", padding: 0,
                }} />
            ))}
          </div>

          <div>
            {sel ? (
              <div style={box}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Pin</div>
                <label style={{ fontSize: 11, color: C.muted }}>Label</label>
                <input value={sel.label || ""}
                  onChange={(e) => updatePin(sel.id, { label: e.target.value })}
                  placeholder="Ravenhollow" style={sel2} />

                <label style={{ fontSize: 11, color: C.muted, display: "block", marginTop: 12 }}>Links to</label>
                <select value={sel.linked_type && sel.linked_id ? `${sel.linked_type}:${sel.linked_id}` : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) updatePin(sel.id, { linked_type: null, linked_id: null });
                    else { const [t, id] = v.split(":"); updatePin(sel.id, { linked_type: t, linked_id: id }); }
                  }} style={sel2}>
                  <option value="">Nothing</option>
                  <optgroup label="Places, lore & notes">
                    {entries.map((e) => <option key={e.id} value={`entry:${e.id}`}>{e.title}</option>)}
                  </optgroup>
                  <optgroup label="NPCs">
                    {chars.filter((c) => c.kind === "npc").map((c) => <option key={c.id} value={`character:${c.id}`}>{c.name}</option>)}
                  </optgroup>
                </select>

                <label style={{ fontSize: 11, color: C.muted, display: "block", marginTop: 12 }}>Who can see this pin</label>
                <select value={sel.visibility} onChange={(e) => updatePin(sel.id, { visibility: e.target.value })} style={sel2}>
                  {VIS.map((v) => <option key={v.v} value={v.v}>{v.l}</option>)}
                </select>

                <button type="button" onClick={() => removePin(sel.id)}
                  style={{ marginTop: 16, background: "transparent", color: C.warn, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>
                  Remove pin
                </button>
              </div>
            ) : (
              <div style={{ ...box, color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
                Click the map to drop a pin, or click an existing pin to edit it. Pins are colored by who can see them: gold for the party, red for GM secrets.
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
