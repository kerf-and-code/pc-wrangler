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
// linked_entry_id is the place this map IS, not a place shown on it. A site map of the
// waystation names the waystation here, which is why that place never appears as a pin.
type MapRow = { id: string; name: string; image_path: string; visibility: string; linked_entry_id: string | null };
type Pin = { id: string; x: number; y: number; label: string | null; linked_type: string | null; linked_id: string | null; visibility: string };
type Ent = { id: string; title: string; type: string };
type Ch = { id: string; name: string; kind: string };
type Sess = { id: string; session_number: number | null };
// One narration beat that named a place. t_start_seconds is what puts the stops of a
// session in the order they were actually visited rather than alphabetically.
type LocEv = { session_id: string | null; location_id: string; t_start_seconds: number | null };
// Where a place lives, campaign-wide. Used to tell "pinned on the map you are looking at"
// from "pinned on a different map", which are very different answers to "can I draw this".
type PlacedPin = { map_id: string; linked_id: string };

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
  // The place waiting to be put somewhere. While this is set the next map click creates a
  // pin already labelled and linked, instead of the usual blank one.
  const [placing, setPlacing] = useState<Ent | null>(null);
  // Every beat that named a place, for the whole campaign. Drives both the tray ordering
  // and the trace, so they can never disagree about what happened.
  const [locEvents, setLocEvents] = useState<LocEv[]>([]);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [placedPins, setPlacedPins] = useState<PlacedPin[]>([]);
  const [traceSession, setTraceSession] = useState<string>("");
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
      // Paged. gm_events grows with every session forever, and an unbounded select would
      // stop at PostgREST's 1000-row cap without saying so, which here would quietly
      // truncate a campaign's history rather than fail.
      const loadLocEvents = async (): Promise<LocEv[]> => {
        const PAGE = 1000;
        const out: LocEv[] = [];
        for (let page = 0; page < 50; page++) {
          const from = page * PAGE;
          const { data, error } = await supabase
            .from("gm_events")
            .select("session_id, location_id, t_start_seconds")
            .eq("campaign_id", campaignId)
            .not("location_id", "is", null)
            .order("id", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) break;
          const rows = (data as LocEv[]) || [];
          out.push(...rows);
          if (rows.length < PAGE) break;
        }
        return out;
      };

      const [{ data: m }, { data: e }, { data: c }, { data: ss }, { data: pp }, ev] = await Promise.all([
        supabase.from("maps").select("id, name, image_path, visibility, linked_entry_id").eq("campaign_id", campaignId).order("created_at"),
        supabase.from("entries").select("id, title, type").eq("campaign_id", campaignId).order("title"),
        supabase.from("characters").select("id, name, kind").eq("campaign_id", campaignId).order("name"),
        supabase.from("sessions").select("id, session_number").eq("campaign_id", campaignId).order("session_number", { ascending: true }),
        // Campaign-wide, not per map. A stop pinned on another map is not drawable here but
        // it is still placed, and saying so beats reporting it as nowhere.
        supabase.from("map_pins").select("map_id, linked_id").eq("campaign_id", campaignId).eq("linked_type", "entry"),
        loadLocEvents(),
      ]);
      const ml = (m as MapRow[]) || [];
      setMaps(ml);
      setEntries((e as Ent[]) || []);
      setChars((c as Ch[]) || []);
      setSessions((ss as Sess[]) || []);
      setPlacedPins(((pp as PlacedPin[]) || []).filter((x) => x.linked_id));
      setLocEvents(ev);
      setActiveMap(ml[0] || null);
      setSelected(null);
      setPlacing(null);
      setTraceSession("");
    })();
  }, [campaignId, supabase]);

  useEffect(() => {
    if (!activeMap) { setPins([]); return; }
    setPlacing(null);
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
      .select("id, name, image_path, visibility, linked_entry_id").single();
    if (!error && data) { setMaps((arr) => [...arr, data as MapRow]); setActiveMap(data as MapRow); setMapName(""); }
    if (fileRef.current) fileRef.current.value = "";
    setUploading(false);
  }

  // Point this map at the place it depicts, or clear it. Kept separate from pin editing
  // because it is a property of the map, not of anything on it.
  async function setMapPlace(entryId: string | null) {
    if (!activeMap) return;
    const next = { ...activeMap, linked_entry_id: entryId };
    setActiveMap(next);
    setMaps((arr) => arr.map((m) => (m.id === next.id ? next : m)));
    await supabase.from("maps").update({ linked_entry_id: entryId }).eq("id", next.id);
  }

  async function deleteMap(id: string) {
    await supabase.from("maps").delete().eq("id", id);
    setMaps((arr) => {
      const next = arr.filter((m) => m.id !== id);
      setActiveMap((cur) => (cur && cur.id === id ? next[0] || null : cur));
      return next;
    });
  }

  // link is set when the pin comes from the tray: the entry is known before the click, so
  // the pin is born labelled and linked rather than blank and waiting for two more edits.
  async function addPin(x: number, y: number, link?: Ent) {
    if (!activeMap) return;
    const { data, error } = await supabase.from("map_pins")
      .insert({
        map_id: activeMap.id, campaign_id: campaignId, x, y,
        label: link ? link.title : "",
        linked_type: link ? "entry" : null,
        linked_id: link ? link.id : null,
        visibility: "player",
      })
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
    if (placing) {
      const p = placing;
      setPlacing(null);
      addPin(x, y, p);
      return;
    }
    addPin(x, y);
  }

  const sel = pins.find((p) => p.id === selected) || null;

  const mentions = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of locEvents) c[e.location_id] = (c[e.location_id] || 0) + 1;
    return c;
  }, [locEvents]);

  // The route for the chosen session: each place once, in the order it first came up.
  //
  // Every stop resolves one of four ways, and the difference matters because only the
  // first can be drawn:
  //   pin      pinned on the map currently open, so it has coordinates here
  //   map      a map in its own right (p10), so the stop opens rather than draws
  //   elsewhere pinned, but on a different map
  //   nowhere  not placed at all
  const trace = useMemo(() => {
    if (!traceSession) return [];
    const first = new Map<string, number>();
    for (const e of locEvents) {
      if (e.session_id !== traceSession) continue;
      const t = e.t_start_seconds ?? Number.MAX_SAFE_INTEGER;
      const cur = first.get(e.location_id);
      if (cur === undefined || t < cur) first.set(e.location_id, t);
    }
    return Array.from(first.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => {
        const title = entries.find((x) => x.id === id)?.title || "(unknown place)";
        const pin = pins.find((p) => p.linked_type === "entry" && p.linked_id === id) || null;
        const ownMap = maps.find((m) => m.linked_entry_id === id) || null;
        const other = placedPins.find((pp) => pp.linked_id === id && pp.map_id !== activeMap?.id);
        const otherMap = other ? maps.find((m) => m.id === other.map_id) || null : null;
        return { id, title, pin, ownMap, otherMap };
      });
  }, [traceSession, locEvents, entries, pins, maps, placedPins, activeMap]);

  // Runs of CONSECUTIVE stops pinned on this map.
  //
  // The line is drawn per run rather than across every pinned stop, because skipping a gap
  // asserts a journey that did not happen. Session 2 goes Toll-Bridge, Ashmoor, Hollowmere,
  // old hill-fort, and Hollowmere is a map rather than a pin here. Joining Ashmoor straight
  // to the hill-fort would draw a leg the party never took, which is worse than drawing
  // nothing: a map that quietly invents a route is harder to distrust than one with a gap
  // in it.
  //
  // idx is the stop's position in the WHOLE route, not in the drawable subset, so the badge
  // on the map and the number in the list underneath always agree.
  const runs = useMemo(() => {
    const out: { idx: number; pin: Pin }[][] = [];
    let cur: { idx: number; pin: Pin }[] = [];
    trace.forEach((t, i) => {
      if (t.pin) cur.push({ idx: i + 1, pin: t.pin });
      else if (cur.length) { out.push(cur); cur = []; }
    });
    if (cur.length) out.push(cur);
    return out;
  }, [trace]);

  const pinnedStops = runs.flat();

  // Places the sessions named that have no pin on THIS map. Scoped per map on purpose: a
  // place can legitimately belong to both a world map and a city map, so a pin elsewhere
  // should not hide it here.
  //
  // Ordered by how often the table has been there, then alphabetically. A GM opening a new
  // map wants the Toll-Bridge they visited seven times before the inn they passed once.
  const locations = entries.filter((e) => e.type === "location");
  const unpinned = locations
    // The place this map depicts is excluded: pinning Hollowmere onto the Hollowmere map
    // would be a pin pointing at the thing it sits on.
    .filter((e) => e.id !== activeMap?.linked_entry_id)
    .filter((e) => !pins.some((p) => p.linked_type === "entry" && p.linked_id === e.id))
    .sort((a, b) => (mentions[b.id] || 0) - (mentions[a.id] || 0) || a.title.localeCompare(b.title));

  const eyebrow = { fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase" as const, color: C.muted, marginBottom: 6 };
  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 18px", marginBottom: 14 } as const;
  const input = { width: "100%", boxSizing: "border-box" as const, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 12px", fontSize: 14, outline: "none" };
  const sel2 = { ...input, marginTop: 4 };

  return (
    <PageShell width={1000}>
      <div style={eyebrow}>Story</div>
      <h1 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>Map</h1>
      <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 18px", maxWidth: 620 }}>
        Your campaign map. Upload the world, drop pins, and link each to a place, NPC, or piece of lore. If a map IS somewhere, say so above and it stops asking you to pin it to itself. Places your sessions have named show up below ready to be placed. Click the map to add a pin; players see only the pins you make party-visible.
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
          <select value={activeMap.linked_entry_id || ""}
            onChange={(e) => setMapPlace(e.target.value || null)}
            title="The place this map depicts"
            style={{ ...input, width: "auto", flex: "1 1 200px" }}>
            <option value="">This map is not a place</option>
            {locations.map((e) => (
              <option key={e.id} value={e.id}>Map of {e.title}</option>
            ))}
          </select>
        )}
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
            {runs.some((r) => r.length >= 2) && (
              // viewBox 0..100 with preserveAspectRatio none lines the SVG up exactly with
              // the percentage-positioned pins, whatever the image's aspect ratio.
              // non-scaling-stroke stops that same stretch from distorting the line.
              <svg viewBox="0 0 100 100" preserveAspectRatio="none"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                {runs.filter((r) => r.length >= 2).map((r) => (
                  <polyline key={`run-${r[0].idx}`}
                    points={r.map((sx) => `${sx.pin.x * 100},${sx.pin.y * 100}`).join(" ")}
                    fill="none" stroke={C.sun} strokeWidth={2} strokeDasharray="6 4"
                    strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
            )}
            {pinnedStops.map((sx) => (
              <span key={`ord-${sx.idx}`}
                style={{
                  position: "absolute", left: `${sx.pin.x * 100}%`, top: `${sx.pin.y * 100}%`,
                  transform: "translate(-50%, -160%)", pointerEvents: "none",
                  background: C.sun, color: SAX.inkDeep, borderRadius: 999,
                  fontSize: 11, fontWeight: 700, lineHeight: 1, padding: "3px 6px",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
                }}>{sx.idx}</span>
            ))}
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

            {sessions.length > 0 && (
              <div style={box}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Session trace</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, marginBottom: 10 }}>
                  Where a session went, in the order it came up in play. Stops pinned on this
                  map are numbered and joined by a line. The line breaks wherever a stop is
                  somewhere else, rather than drawing a leg the party never travelled.
                </div>
                <select value={traceSession} onChange={(e) => setTraceSession(e.target.value)} style={sel2}>
                  <option value="">No trace</option>
                  {sessions.map((ss) => (
                    <option key={ss.id} value={ss.id}>Session {ss.session_number ?? "?"}</option>
                  ))}
                </select>

                {traceSession && trace.length === 0 && (
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
                    No places were named in that session.
                  </div>
                )}

                {trace.length > 0 && (
                  <ol style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
                    {trace.map((t) => (
                      <li key={t.id} style={{ color: t.pin ? C.text : C.muted }}>
                        {t.title}{" "}
                        {t.pin ? (
                          <span style={{ color: C.sun }}>on this map</span>
                        ) : t.ownMap ? (
                          <button type="button"
                            onClick={() => { setActiveMap(t.ownMap as MapRow); setSelected(null); }}
                            style={{ background: "none", border: "none", color: C.plum, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 12.5 }}>
                            open its map
                          </button>
                        ) : t.otherMap ? (
                          <button type="button"
                            onClick={() => { setActiveMap(t.otherMap as MapRow); setSelected(null); }}
                            style={{ background: "none", border: "none", color: C.plum, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 12.5 }}>
                            on {t.otherMap.name}
                          </button>
                        ) : (
                          <span style={{ color: C.warn }}>not on any map</span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {unpinned.length > 0 && (
              <div style={box}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  Not on this map yet
                </div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, marginBottom: 10 }}>
                  Places your sessions named. Pick one, then click the map: the pin arrives
                  already labelled and linked to its Codex entry. The number is how many times
                  it has come up in play.
                </div>
                {placing && (
                  <div style={{ fontSize: 12.5, color: C.sun, marginBottom: 10, lineHeight: 1.5 }}>
                    Click the map to place <strong>{placing.title}</strong>.{" "}
                    <button type="button" onClick={() => setPlacing(null)}
                      style={{ background: "none", border: "none", color: C.muted, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 12.5 }}>
                      cancel
                    </button>
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {unpinned.map((e) => {
                    const on = placing?.id === e.id;
                    const n = mentions[e.id] || 0;
                    return (
                      <button key={e.id} type="button" onClick={() => setPlacing(on ? null : e)}
                        style={{
                          background: on ? C.sun : "transparent", color: on ? SAX.inkDeep : C.text,
                          border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 999,
                          padding: "5px 11px", fontSize: 12.5, cursor: "pointer",
                        }}>
                        {e.title}{n > 0 ? ` (${n})` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
