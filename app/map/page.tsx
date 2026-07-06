"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";

const C = { surface: SAX.slateBg, line: SAX.line, text: SAX.text, muted: SAX.muted, sun: SAX.sun, plum: SAX.plum };
const BUCKET = "campaign-maps";

type Row = {
  map_id: string; map_name: string; image_path: string;
  pin_id: string | null; x: number | null; y: number | null;
  label: string | null; linked_type: string | null; linked_title: string | null;
};
type Pin = { id: string; x: number; y: number; label: string | null; linked_title: string | null };
type MapView = { id: string; name: string; image_path: string; pins: Pin[] };

export default function PlayerMapPage() {
  const supabase = useMemo(() => createClient(), []);
  const [maps, setMaps] = useState<MapView[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "invalid">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      const shareCode = new URLSearchParams(window.location.search).get("share");
      if (!shareCode) { if (active) setStatus("invalid"); return; }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) { if (active) setStatus("invalid"); return; }
      }

      const { data } = await supabase.rpc("map_for_player", { p_share: shareCode });
      if (!active) return;
      const rows = (data as Row[]) || [];
      const byMap = new Map<string, MapView>();
      for (const r of rows) {
        if (!byMap.has(r.map_id)) byMap.set(r.map_id, { id: r.map_id, name: r.map_name, image_path: r.image_path, pins: [] });
        if (r.pin_id && r.x !== null && r.y !== null) {
          byMap.get(r.map_id)!.pins.push({ id: r.pin_id, x: r.x, y: r.y, label: r.label, linked_title: r.linked_title });
        }
      }
      const list = Array.from(byMap.values());
      setMaps(list);
      setActiveId(list[0]?.id || "");
      setStatus(list.length ? "ready" : "empty");
    })();
    return () => { active = false; };
  }, [supabase]);

  const publicUrl = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const active = maps.find((m) => m.id === activeId) || null;
  const sel = active?.pins.find((p) => p.id === selectedPin) || null;

  const eyebrow = { fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase" as const, color: C.muted };

  return (
    <PageShell width={1000}>
      <div style={{ width: "100%", maxWidth: 760, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <span style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 26, fontWeight: 700 }}>The map</span>
        </div>
        <div style={{ ...eyebrow, textAlign: "center", marginBottom: 18 }}>WHERE YOU&rsquo;VE BEEN, WHAT YOU&rsquo;VE FOUND</div>
        <div style={{ height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${C.sun}, ${C.plum})`, marginBottom: 24 }} />

        {status === "loading" && <p style={{ textAlign: "center", color: C.muted, fontSize: 14 }}>Loading&hellip;</p>}
        {status === "invalid" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>This link looks broken. Ask your GM for the campaign link.</p>
        )}
        {status === "empty" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            No map yet. When your GM shares one, it&rsquo;ll appear here with the places you&rsquo;ve discovered.
          </p>
        )}

        {status === "ready" && active && (
          <>
            {maps.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 16 }}>
                {maps.map((m) => (
                  <button key={m.id} type="button" onClick={() => { setActiveId(m.id); setSelectedPin(null); }}
                    style={{ background: activeId === m.id ? C.sun : "transparent", color: activeId === m.id ? SAX.inkDeep : C.text, border: `1px solid ${activeId === m.id ? C.sun : C.line}`, borderRadius: 999, padding: "6px 14px", fontSize: 13, cursor: "pointer" }}>
                    {m.name}
                  </button>
                ))}
              </div>
            )}

            <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", lineHeight: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={publicUrl(active.image_path)} alt={active.name}
                style={{ maxWidth: "100%", display: "block", borderRadius: 10, border: `1px solid ${C.line}` }} />
              {active.pins.map((p) => (
                <button key={p.id} type="button" title={p.label || p.linked_title || "pin"}
                  onClick={() => setSelectedPin((cur) => (cur === p.id ? null : p.id))}
                  style={{
                    position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%, -50%)",
                    width: selectedPin === p.id ? 20 : 15, height: selectedPin === p.id ? 20 : 15, borderRadius: "50%",
                    background: C.sun, border: `2px solid ${selectedPin === p.id ? C.text : SAX.inkDeep}`,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.5)", cursor: "pointer", padding: 0,
                  }} />
              ))}
            </div>

            {sel && (sel.label || sel.linked_title) && (
              <div style={{ marginTop: 14, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 18px", textAlign: "left" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{sel.label || sel.linked_title}</div>
                {sel.linked_title && sel.label && sel.linked_title !== sel.label && (
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{sel.linked_title}</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
