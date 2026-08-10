"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SAX, surfaces } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

// The "Loose ends" tab, in two sections.
//
//   New       lore beats the fold could not file (approved gm_events, kind 'lore', every entity FK
//             null, lore_disposition null). Each is filed through /api/lore-triage.
//   Backlog   the old sentence-titled lore ENTRIES from before the fold existed. Each is cleaned
//             through /api/lore-retro, which backs the entry up before it touches it.
//
// Both read their pile client-side and drive a server route for every write, so the ownership and
// safety guards stay server-side. The picker and the Backlog's suggested target are built off the
// entries and chars the codex page already has in state.

type TEntry = { id: string; type: string; title: string; tags: string[] | null };
type TChar = { id: string; name: string; kind: string };
type Beat = { id: string; summary: string };
type BacklogEntry = { id: string; title: string; body: string | null };
type Kind = "npc" | "location" | "faction";
type Opt = { kind: Kind; id: string; name: string; label: string };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Whole-word, case-insensitive presence of a distinctive (4+ char) name in some text.
function matchesIn(name: string, text: string): boolean {
  if (name.length < 4) return false;
  return new RegExp(`\\b${escapeRegex(name)}\\b`, "i").test(text);
}
// A title that reads as a sentence rather than a name: the mark of a backlog entry. Mirrors the
// dry-run SQL heuristic (long, or many words, or carrying sentence punctuation).
function looksSentence(title: string): boolean {
  const t = (title || "").trim();
  return t.length > 60 || t.split(/\s+/).length >= 7 || /[.!?]/.test(t);
}

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
const sectionLabel: React.CSSProperties = {
  fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", marginBottom: 8,
};

async function postJson(url: string, payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data?.error || "That did not work." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That did not work." };
  }
}

// ---- New: an unfiled beat ----
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

  async function run(payload: Record<string, unknown>, which: string) {
    setBusy(which);
    setError(null);
    const r = await postJson("/api/lore-triage", { eventId: beat.id, ...payload });
    if (!r.ok) { setError(r.error || "That did not work."); setBusy(null); return; }
    onResolved(beat.id);
  }

  function doAttach() {
    const sep = pick.indexOf(":");
    const kind = sep >= 0 ? pick.slice(0, sep) : "";
    const id = sep >= 0 ? pick.slice(sep + 1) : "";
    if (!kind || !id) { setError("Pick something to attach to."); return; }
    void run({ action: "attach", target: { kind, id } }, "attach");
  }
  function doCreate() {
    if (!newName.trim()) { setError("Name the new entity."); return; }
    void run({ action: "create", name: newName.trim(), kind: newKind }, "create");
  }
  function doKeep() {
    if (!title.trim()) { setError("Give the lore entry a title."); return; }
    void run({ action: "keep", title: title.trim() }, "keep");
  }
  function doDismiss() { void run({ action: "dismiss" }, "dismiss"); }

  const disabled = busy !== null;

  return (
    <div style={{ ...surfaces.slate, borderRadius: FORGE_RADIUS, padding: 14 }}>
      <div style={{ fontSize: 14, color: C.text, lineHeight: 1.55, marginBottom: 12 }}>{beat.summary}</div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={pick} disabled={disabled} onChange={(e) => setPick(e.target.value)} style={{ ...fieldStyle, flex: "1 1 220px", minWidth: 180 }}>
            <option value="">Attach to an existing entity…</option>
            {options.map((o) => <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>{o.label}</option>)}
          </select>
          <button type="button" disabled={disabled} onClick={doAttach} style={primaryBtn}>{busy === "attach" ? "Attaching…" : "Attach"}</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={newName} disabled={disabled} onChange={(e) => setNewName(e.target.value)} placeholder="…or create a new one, named" style={{ ...fieldStyle, flex: "1 1 200px", minWidth: 160 }} />
          <select value={newKind} disabled={disabled} onChange={(e) => setNewKind(e.target.value as Kind)} style={{ ...fieldStyle, flex: "0 0 auto" }}>
            <option value="npc">NPC</option><option value="location">Place</option><option value="faction">Faction</option>
          </select>
          <button type="button" disabled={disabled} onClick={doCreate} style={primaryBtn}>{busy === "create" ? "Creating…" : "Create + attach"}</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={title} disabled={disabled} onChange={(e) => setTitle(e.target.value)} placeholder="…or keep as its own lore entry, titled" style={{ ...fieldStyle, flex: "1 1 200px", minWidth: 160 }} />
          <button type="button" disabled={disabled} onClick={doKeep} style={primaryBtn}>{busy === "keep" ? "Keeping…" : "Keep as lore"}</button>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" disabled={disabled} onClick={doDismiss} style={ghostBtn}>{busy === "dismiss" ? "Dismissing…" : "Dismiss"}</button>
        </div>
      </div>
      {error && <div style={{ color: C.warn, fontSize: 12.5, marginTop: 10 }}>{error}</div>}
    </div>
  );
}

// ---- Backlog: an old sentence-titled entry ----
function BacklogRow({ entry, options, onResolved }: {
  entry: BacklogEntry;
  options: Opt[];
  onResolved: (id: string) => void;
}) {
  const suggestions = useMemo(
    () => options.filter((o) => matchesIn(o.name, `${entry.title}\n${entry.body || ""}`)),
    [options, entry],
  );
  const [pick, setPick] = useState(suggestions.length === 1 ? `${suggestions[0].kind}:${suggestions[0].id}` : "");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<Kind>("npc");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(payload: Record<string, unknown>, which: string) {
    setBusy(which);
    setError(null);
    const r = await postJson("/api/lore-retro", { entryId: entry.id, ...payload });
    if (!r.ok) { setError(r.error || "That did not work."); setBusy(null); return; }
    onResolved(entry.id);
  }

  function doAttach() {
    const sep = pick.indexOf(":");
    const kind = sep >= 0 ? pick.slice(0, sep) : "";
    const id = sep >= 0 ? pick.slice(sep + 1) : "";
    if (!kind || !id) { setError("Pick something to attach to."); return; }
    void run({ action: "attach", target: { kind, id } }, "attach");
  }
  function doCreate() {
    if (!newName.trim()) { setError("Name the new entity."); return; }
    void run({ action: "create", name: newName.trim(), kind: newKind }, "create");
  }
  function doRetitle() {
    if (!title.trim()) { setError("Give it a real title."); return; }
    void run({ action: "retitle", title: title.trim() }, "retitle");
  }
  function doDelete() { void run({ action: "delete" }, "delete"); }

  const disabled = busy !== null;
  const preview = (entry.body || "").trim();

  return (
    <div style={{ ...surfaces.slate, borderRadius: FORGE_RADIUS, padding: 14 }}>
      <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.5, fontStyle: "italic", marginBottom: preview ? 6 : 12 }}>
        {entry.title}
      </div>
      {preview && (
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, marginBottom: 12 }}>
          {preview.length > 240 ? `${preview.slice(0, 240)}…` : preview}
        </div>
      )}
      {suggestions.length === 1 && (
        <div style={{ fontSize: 12, color: C.plum, marginBottom: 8 }}>Looks like it is about {suggestions[0].name}.</div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={pick} disabled={disabled} onChange={(e) => setPick(e.target.value)} style={{ ...fieldStyle, flex: "1 1 220px", minWidth: 180 }}>
            <option value="">Fold into an existing entity…</option>
            {options.map((o) => <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>{o.label}</option>)}
          </select>
          <button type="button" disabled={disabled} onClick={doAttach} style={primaryBtn}>{busy === "attach" ? "Folding…" : "Fold in"}</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={newName} disabled={disabled} onChange={(e) => setNewName(e.target.value)} placeholder="…or make a new entity, named" style={{ ...fieldStyle, flex: "1 1 200px", minWidth: 160 }} />
          <select value={newKind} disabled={disabled} onChange={(e) => setNewKind(e.target.value as Kind)} style={{ ...fieldStyle, flex: "0 0 auto" }}>
            <option value="npc">NPC</option><option value="location">Place</option><option value="faction">Faction</option>
          </select>
          <button type="button" disabled={disabled} onClick={doCreate} style={primaryBtn}>{busy === "create" ? "Creating…" : "Create + fold"}</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={title} disabled={disabled} onChange={(e) => setTitle(e.target.value)} placeholder="…or keep it, with a real title" style={{ ...fieldStyle, flex: "1 1 200px", minWidth: 160 }} />
          <button type="button" disabled={disabled} onClick={doRetitle} style={primaryBtn}>{busy === "retitle" ? "Saving…" : "Retitle + keep"}</button>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" disabled={disabled} onClick={doDelete} style={ghostBtn}>{busy === "delete" ? "Deleting…" : "Delete"}</button>
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
  const [backlog, setBacklog] = useState<BacklogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) { setBeats([]); setBacklog([]); return; }
    setLoading(true);
    setErr(null);
    const [beatRes, entryRes] = await Promise.all([
      supabase.from("gm_events").select("id, summary")
        .eq("campaign_id", campaignId).eq("kind", "lore")
        .is("npc_id", null).is("location_id", null).is("faction_id", null).is("lore_disposition", null)
        .order("occurred_at", { ascending: false }),
      supabase.from("entries").select("id, title, body, tags")
        .eq("campaign_id", campaignId).eq("type", "lore").order("title"),
    ]);
    if (beatRes.error) setErr(beatRes.error.message);
    else setBeats((beatRes.data as Beat[]) || []);
    if (!entryRes.error) {
      const rows = ((entryRes.data as { id: string; title: string; body: string | null; tags: string[] | null }[]) || [])
        .filter((e) => !(e.tags || []).some((t) => t === "faction" || t === "item"))
        .filter((e) => looksSentence(e.title))
        .map((e) => ({ id: e.id, title: e.title, body: e.body }));
      setBacklog(rows);
    }
    setLoading(false);
  }, [supabase, campaignId]);

  useEffect(() => { void load(); }, [load]);

  const options: Opt[] = useMemo(() => [
    ...chars.filter((c) => c.kind === "npc").map((c) => ({ kind: "npc" as Kind, id: c.id, name: c.name, label: `NPC · ${c.name}` })),
    ...entries.filter((e) => e.type === "location").map((e) => ({ kind: "location" as Kind, id: e.id, name: e.title, label: `Place · ${e.title}` })),
    ...entries.filter((e) => e.type === "lore" && (e.tags || []).includes("faction")).map((e) => ({ kind: "faction" as Kind, id: e.id, name: e.title, label: `Faction · ${e.title}` })),
  ], [chars, entries]);

  const onBeatResolved = useCallback((id: string) => {
    setBeats((bs) => bs.filter((b) => b.id !== id));
    onChanged();
  }, [onChanged]);

  const onBacklogResolved = useCallback((id: string) => {
    setBacklog((bs) => bs.filter((b) => b.id !== id));
    onChanged();
  }, [onChanged]);

  return (
    <div style={{ ...surfaces.slate, padding: 18, width: "100%", boxSizing: "border-box" }}>
      <div style={{ fontSize: 13, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", marginBottom: 6 }}>
        LOOSE ENDS
      </div>
      <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.55, margin: "0 0 18px" }}>
        Lore that was not filed anywhere: new facts from play that named no single entity, and the old sentence-titled
        entries from before. Attach each to who or where it is about, create that entity, keep it as its own titled
        entry, or clear it.
      </p>

      {err && <p style={{ color: C.warn, fontSize: 13, marginBottom: 12 }}>{err}</p>}
      {loading && <p style={{ color: C.muted, fontSize: 13.5 }}>Loading…</p>}

      <div style={sectionLabel}>NEW · {beats.length}</div>
      {beats.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 13.5, marginBottom: 22 }}>
          Nothing new. Lore beats that name no single entity will collect here after you approve them on Review.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
          {beats.map((b) => <TriageRow key={b.id} beat={b} options={options} onResolved={onBeatResolved} />)}
        </div>
      )}

      <div style={sectionLabel}>BACKLOG · {backlog.length}</div>
      {backlog.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 13.5 }}>
          No sentence-titled lore left to clean up here.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {backlog.map((e) => <BacklogRow key={e.id} entry={e} options={options} onResolved={onBacklogResolved} />)}
        </div>
      )}
    </div>
  );
}
