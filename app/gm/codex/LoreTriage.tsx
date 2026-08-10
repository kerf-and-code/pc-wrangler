"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SAX, surfaces } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

// The "Loose ends" tab: lore beats the fold could not file. A beat lands here when it named no
// single entity, so the recorder left it as an approved gm_event (kind 'lore', every entity FK
// null, lore_disposition null). Each row offers the four dispositions the triage route handles:
// attach to an existing entity, create a new one and attach, keep it as its own titled lore entry,
// or dismiss it. The writes all go through /api/lore-triage so the ownership and one-way guards stay
// server-side; this component only reads the pile and drives that route.

type TEntry = { id: string; type: string; title: string; tags: string[] | null };
type TChar = { id: string; name: string; kind: string };
type Beat = { id: string; summary: string };
type Kind = "npc" | "location" | "faction";
type Opt = { kind: Kind; id: string; label: string };

const fieldStyle: React.CSSProperties = {
  boxSizing: "border-box", background: C.surface2, color: C.text,
  border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", fontSize: 13.5, outline: "none",
};
const primaryBtn: React.CSSProperties = {
  background: C.sun, color: SAX.inkDeep, border: "none", borderRadius: 7,
  padding: "8px 13px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap",
};
const ghostBtn: React.CSSProperties = {
  background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: 7,
  padding: "8px 13px", fontWeight: 600, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap",
};

function TriageRow({ beat, options, onResolved }: {
  beat: Beat;
  options: Opt[];
  onResolved: (id: string) => void;
}) {
  const [pick, setPick] = useState("");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<Kind>("npc");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(payload: Record<string, unknown>, which: string) {
    setBusy(which);
    setError(null);
    try {
      const res = await fetch("/api/lore-triage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: beat.id, ...payload }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data?.error || "That did not work.");
        setBusy(null);
        return;
      }
      onResolved(beat.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      setBusy(null);
    }
  }

  function doAttach() {
    const sep = pick.indexOf(":");
    const kind = sep >= 0 ? pick.slice(0, sep) : "";
    const id = sep >= 0 ? pick.slice(sep + 1) : "";
    if (!kind || !id) { setError("Pick something to attach to."); return; }
    void post({ action: "attach", target: { kind, id } }, "attach");
  }
  function doCreate() {
    if (!newName.trim()) { setError("Name the new entity."); return; }
    void post({ action: "create", name: newName.trim(), kind: newKind }, "create");
  }
  function doKeep() {
    if (!title.trim()) { setError("Give the lore entry a title."); return; }
    void post({ action: "keep", title: title.trim() }, "keep");
  }
  function doDismiss() {
    void post({ action: "dismiss" }, "dismiss");
  }

  const disabled = busy !== null;

  return (
    <div style={{ ...surfaces.slate, borderRadius: FORGE_RADIUS, padding: 14 }}>
      <div style={{ fontSize: 14, color: C.text, lineHeight: 1.55, marginBottom: 12 }}>{beat.summary}</div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={pick} disabled={disabled} onChange={(e) => setPick(e.target.value)}
            style={{ ...fieldStyle, flex: "1 1 220px", minWidth: 180 }}>
            <option value="">Attach to an existing entity…</option>
            {options.map((o) => (
              <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>{o.label}</option>
            ))}
          </select>
          <button type="button" disabled={disabled} onClick={doAttach} style={primaryBtn}>
            {busy === "attach" ? "Attaching…" : "Attach"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={newName} disabled={disabled} onChange={(e) => setNewName(e.target.value)}
            placeholder="…or create a new one, named" style={{ ...fieldStyle, flex: "1 1 200px", minWidth: 160 }} />
          <select value={newKind} disabled={disabled} onChange={(e) => setNewKind(e.target.value as Kind)}
            style={{ ...fieldStyle, flex: "0 0 auto" }}>
            <option value="npc">NPC</option>
            <option value="location">Place</option>
            <option value="faction">Faction</option>
          </select>
          <button type="button" disabled={disabled} onClick={doCreate} style={primaryBtn}>
            {busy === "create" ? "Creating…" : "Create + attach"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={title} disabled={disabled} onChange={(e) => setTitle(e.target.value)}
            placeholder="…or keep as its own lore entry, titled" style={{ ...fieldStyle, flex: "1 1 200px", minWidth: 160 }} />
          <button type="button" disabled={disabled} onClick={doKeep} style={primaryBtn}>
            {busy === "keep" ? "Keeping…" : "Keep as lore"}
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" disabled={disabled} onClick={doDismiss} style={ghostBtn}>
            {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
      </div>

      {error && <div style={{ color: C.warn, fontSize: 12.5, marginTop: 10 }}>{error}</div>}
    </div>
  );
}

export default function LoreTriage({ campaignId, entries, chars, onChanged }: {
  campaignId: string;
  entries: TEntry[];
  chars: TChar[];
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) { setBeats([]); return; }
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("gm_events")
      .select("id, summary")
      .eq("campaign_id", campaignId)
      .eq("kind", "lore")
      .is("npc_id", null)
      .is("location_id", null)
      .is("faction_id", null)
      .is("lore_disposition", null)
      .order("occurred_at", { ascending: false });
    if (error) setErr(error.message);
    setBeats((data as Beat[]) || []);
    setLoading(false);
  }, [supabase, campaignId]);

  useEffect(() => { void load(); }, [load]);

  // The entities a beat can be folded onto: this campaign's NPCs, places and factions.
  const options: Opt[] = useMemo(() => [
    ...chars.filter((c) => c.kind === "npc").map((c) => ({ kind: "npc" as Kind, id: c.id, label: `NPC · ${c.name}` })),
    ...entries.filter((e) => e.type === "location").map((e) => ({ kind: "location" as Kind, id: e.id, label: `Place · ${e.title}` })),
    ...entries.filter((e) => e.type === "lore" && (e.tags || []).includes("faction")).map((e) => ({ kind: "faction" as Kind, id: e.id, label: `Faction · ${e.title}` })),
  ], [chars, entries]);

  const onResolved = useCallback((id: string) => {
    setBeats((bs) => bs.filter((b) => b.id !== id));
    onChanged();
  }, [onChanged]);

  return (
    <div style={{ ...surfaces.slate, padding: 18, width: "100%", boxSizing: "border-box" }}>
      <div style={{ fontSize: 13, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", marginBottom: 6 }}>
        LOOSE ENDS
      </div>
      <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.55, margin: "0 0 16px" }}>
        Lore from play that named no single entity, so it was not filed anywhere. Attach each fact to who or
        where it is about, create that entity, keep it as its own lore entry, or dismiss it.
      </p>

      {err && <p style={{ color: C.warn, fontSize: 13, marginBottom: 12 }}>{err}</p>}

      {loading ? (
        <p style={{ color: C.muted, fontSize: 13.5 }}>Loading…</p>
      ) : beats.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 13.5 }}>
          Nothing to file. New lore beats that name no single entity will collect here after you approve them on Review.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {beats.map((b) => (
            <TriageRow key={b.id} beat={b} options={options} onResolved={onResolved} />
          ))}
        </div>
      )}
    </div>
  );
}
