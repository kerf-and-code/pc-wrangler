"use client";

import React, { useEffect, useRef, useState } from "react";
import { C } from "@/lib/forge-theme";
import type { createClient } from "@/lib/supabase/client";
import { friendlyError, notReady } from "@/lib/friendly-error";

// components/table-pins.tsx (2026-11-09)
//
// Phase 5x (p128): pins on the map and the GM's private notes on tokens.
//
//   PinCard     opens when someone clicks a pin. The GM edits it: label, colour, the wiki entry it opens,
//               a note only the GM sees, and whether players see it at all; or deletes it. A player sees
//               its label and, when the wiki lets them read the entry, a button to read it. Players only
//               ever receive the pins tabletop_pins gives them (on revealed squares, no notes).
//   TokenNotes  the GM's note on a token (vtt_token_notes, GM only), saved as they type.

type Supa = ReturnType<typeof createClient>;
export type Pin = { id: string; x: number; y: number; label: string; color: string; entryId: string | null; entryTitle: string | null; gmNote?: string; playersSee: boolean };
export type EntryOption = { id: string; title: string; type: string; visibility: string };

export const PIN_COLORS = ["#d9a43a", "#e07a70", "#7fc4ea", "#7fcf7a", "#c79be0", "#f2e6c9"];

const box: React.CSSProperties = { background: "rgba(28,24,20,0.98)", border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, color: C.text, fontSize: 12.5, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" };
const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "6px 8px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5 };
const small: React.CSSProperties = { padding: "5px 10px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" };

export function PinCard({ pin, isGm, campaignId, supabase, entries, onNeedEntries, onSaved, onRead, onClose }: {
  pin: Pin; isGm: boolean; campaignId: string; supabase: Supa;
  entries: EntryOption[] | null;
  onNeedEntries: () => void;
  /** after a save or delete, with the error if there was one */
  onSaved: (error: string | null) => void;
  onRead: (pin: Pin) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(pin.label);
  const [color, setColor] = useState(pin.color);
  const [entryId, setEntryId] = useState(pin.entryId ?? "");
  const [note, setNote] = useState(pin.gmNote ?? "");
  const [playersSee, setPlayersSee] = useState(pin.playersSee);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { if (isGm && entries === null) onNeedEntries(); }, [isGm, entries, onNeedEntries]);

  const save = async () => {
    const l = label.trim().slice(0, 80);
    if (!l) { onSaved("Give the pin a label."); return; }
    setBusy(true);
    const { error } = await supabase.from("vtt_pins").update({ label: l, color, entry_id: entryId || null, gm_note: note.slice(0, 2000), players_see: playersSee, updated_at: new Date().toISOString() }).eq("id", pin.id);
    setBusy(false);
    onSaved(error ? `Could not save the pin: ${error.message}` : null);
  };
  const remove = async () => {
    setBusy(true);
    const { error } = await supabase.from("vtt_pins").delete().eq("id", pin.id).eq("campaign_id", campaignId);
    setBusy(false);
    onSaved(error ? `Could not delete the pin: ${error.message}` : null);
  };

  if (!isGm) {
    return (
      <div role="dialog" aria-label={`Pin: ${pin.label}`} style={{ ...box, width: "min(320px, calc(100vw - 40px))" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: pin.color }} />
          <strong style={{ flex: 1, fontSize: 13.5 }}>{pin.label}</strong>
          <button type="button" onClick={onClose} style={small}>Close</button>
        </div>
        {pin.entryId && pin.entryTitle && (
          <button type="button" onClick={() => onRead(pin)} style={{ ...small, marginTop: 10, width: "100%", background: C.sun, color: "#1b1712", border: "none", fontWeight: 600 }}>
            Read {pin.entryTitle}
          </button>
        )}
      </div>
    );
  }

  const shown = (entries ?? []).filter((e) => !query.trim() || e.title.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 80);
  return (
    <div role="dialog" aria-label={`Pin: ${pin.label}`} style={{ ...box, width: "min(380px, calc(100vw - 40px))", maxHeight: "70vh", overflowY: "auto" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <strong style={{ flex: 1, fontSize: 13.5 }}>Pin</strong>
        <button type="button" onClick={onClose} style={small}>Close</button>
      </div>
      <label htmlFor="pin-label" style={{ display: "block", color: C.muted, fontSize: 11.5, margin: "10px 0 4px" }}>Label (players see it)</label>
      <input id="pin-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} style={field} />
      <div role="group" aria-label="Colour" style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {PIN_COLORS.map((c) => (
          <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
            style={{ width: 22, height: 22, borderRadius: 999, background: c, border: color === c ? "2px solid #fff" : `1px solid ${C.line}`, cursor: "pointer" }} />
        ))}
      </div>
      <label htmlFor="pin-entry-find" style={{ display: "block", color: C.muted, fontSize: 11.5, margin: "10px 0 4px" }}>Wiki entry it opens</label>
      <input id="pin-entry-find" value={query} onChange={(e) => setQuery(e.target.value.slice(0, 60))} placeholder={entryId ? (entries ?? []).find((e) => e.id === entryId)?.title ?? pin.entryTitle ?? "Find an entry..." : "Find an entry..."} style={field} />
      <div role="listbox" aria-label="Wiki entries" style={{ maxHeight: 130, overflowY: "auto", marginTop: 4, border: `1px solid ${C.line}`, borderRadius: 7 }}>
        <button type="button" role="option" aria-selected={!entryId} onClick={() => setEntryId("")}
          style={{ display: "block", width: "100%", padding: "5px 8px", background: !entryId ? C.surface2 : "transparent", color: !entryId ? C.sun : C.muted, border: "none", borderBottom: `1px solid ${C.line}`, textAlign: "left", cursor: "pointer", fontSize: 12 }}>No entry</button>
        {entries === null && <p style={{ color: C.muted, margin: 6, fontSize: 12 }}>Loading the wiki...</p>}
        {shown.map((e) => (
          <button key={e.id} type="button" role="option" aria-selected={entryId === e.id} onClick={() => setEntryId(e.id)}
            style={{ display: "flex", width: "100%", gap: 6, padding: "5px 8px", background: entryId === e.id ? C.surface2 : "transparent", color: entryId === e.id ? C.sun : C.text, border: "none", borderBottom: `1px solid ${C.line}`, textAlign: "left", cursor: "pointer", fontSize: 12 }}>
            <span style={{ flex: 1 }}>{e.title}</span><span style={{ color: C.muted, fontSize: 11 }}>{e.visibility === "gm" ? "GM only" : e.type}</span>
          </button>
        ))}
      </div>
      <p style={{ color: C.muted, fontSize: 11, margin: "4px 0 0" }}>Players can open it only when the wiki lets them read it.</p>
      <label htmlFor="pin-note" style={{ display: "block", color: C.muted, fontSize: 11.5, margin: "10px 0 4px" }}>Your note (only you see it)</label>
      <textarea id="pin-note" value={note} rows={3} maxLength={2000} onChange={(e) => setNote(e.target.value)} style={{ ...field, resize: "vertical" }} />
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <input type="checkbox" checked={playersSee} onChange={(e) => setPlayersSee(e.target.checked)} />
        Players see it <span style={{ color: C.muted }}>(once the fog there is lifted)</span>
      </label>
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" disabled={busy} onClick={() => void save()} style={{ ...small, background: C.sun, color: "#1b1712", border: "none", fontWeight: 600 }}>{busy ? "Saving..." : "Save"}</button>
        {pin.entryId && <button type="button" onClick={() => onRead(pin)} style={small}>Read the entry</button>}
        {!confirmDel
          ? <button type="button" onClick={() => setConfirmDel(true)} style={{ ...small, color: "#e07a70", marginLeft: "auto" }}>Delete</button>
          : <button type="button" disabled={busy} onClick={() => void remove()} style={{ ...small, background: "#e07a70", color: "#1b1712", border: "none", marginLeft: "auto" }}>Delete this pin</button>}
      </div>
    </div>
  );
}

export function TokenNotes({ tokenId, tokenName, campaignId, supabase, onChange, onClose }: {
  tokenId: string; tokenName: string; campaignId: string; supabase: Supa;
  /** whether the token now has a note, for the GM's marker on it */
  onChange: (has: boolean) => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const timer = useRef<number | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.from("vtt_token_notes").select("body").eq("token_id", tokenId).maybeSingle().then(({ data, error }) => {
      if (!live) return;
      if (error) { setStatus(/vtt_token_notes/.test(error.message) ? notReady("Notes", "p128") : friendlyError(error)); setBody(""); return; }
      setBody((data as { body?: string } | null)?.body ?? "");
    });
    return () => { live = false; };
  }, [supabase, tokenId]);

  const save = (text: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    setStatus("Saving...");
    timer.current = window.setTimeout(async () => {
      const t = text.slice(0, 4000);
      const { error } = t.trim()
        ? await supabase.from("vtt_token_notes").upsert({ token_id: tokenId, campaign_id: campaignId, body: t, updated_at: new Date().toISOString() })
        : await supabase.from("vtt_token_notes").delete().eq("token_id", tokenId);
      setStatus(error ? `Could not save: ${error.message}` : "Saved");
      if (!error) onChange(!!t.trim());
    }, 600);
  };

  return (
    <div role="dialog" aria-label={`Your note on ${tokenName}`} style={{ ...box, width: "min(380px, calc(100vw - 40px))" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <strong style={{ flex: 1, fontSize: 13 }}>Your note on {tokenName}</strong>
        <span role="status" style={{ color: C.muted, fontSize: 11.5 }}>{status}</span>
        <button type="button" onClick={onClose} style={small}>Done</button>
      </div>
      <textarea aria-label={`Note on ${tokenName}`} value={body ?? ""} disabled={body === null} rows={5} maxLength={4000}
        placeholder={body === null ? "Loading..." : "Motives, secrets, what they carry. Only you see this."}
        onChange={(e) => { setBody(e.target.value); save(e.target.value); }} style={{ ...field, resize: "vertical" }} />
    </div>
  );
}
