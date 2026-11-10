"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "@/lib/forge-theme";
import type { createClient } from "@/lib/supabase/client";
import { describeTable, parseTable } from "@/lib/tabletop/roll-tables";
import { friendlyError, notReady } from "@/lib/friendly-error";

// components/roll-tables-panel.tsx (2026-11-08)
//
// The Tables tab at the tabletop (phase 5r, gap 2 in the tabletop audit doc): the campaign's rollable
// tables (p123 roll_tables). Everyone at the table sees the tables they may roll on: the GM all of them,
// a player the ones the GM shared. Rolling goes through app/api/tabletop/table-roll, which rolls on the
// server and posts the result to the chat. The GM writes tables here too: a name and plain text, one
// entry per line, previewed live by the same parser the roll uses (lib/tabletop/roll-tables), so a
// pasted book table ("01-05 Goblins") or a quick list ("3x Bandits") says what it will do before it is
// saved.

type Row = { id: string; name: string; body: string; players_can_roll: boolean; results_gm_only: boolean; updated_at: string };
type Draft = { id: string | null; name: string; body: string; players_can_roll: boolean; results_gm_only: boolean };

const EXAMPLE = "01-40 Nothing but wind\n41-70 Tracks of something large\n71-90 A wandering merchant\n91-00 Goblin ambush";

export default function RollTablesPanel({ campaignId, isGm, supabase, asWho, gmName, onPosted }: {
  campaignId: string;
  isGm: boolean;
  supabase: ReturnType<typeof createClient>;
  /** the character the viewer is rolling as ("" for themselves, or the GM's own name) */
  asWho: string;
  gmName: string;
  /** called with the chat message the roll posted, so the chat shows it at once */
  onPosted: (message: unknown) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<{ id: string; total: number; result: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [secret, setSecret] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("roll_tables")
      .select("id, name, body, players_can_roll, results_gm_only, updated_at").eq("campaign_id", campaignId).order("name");
    if (error) { setErr(/roll_tables/.test(error.message) ? notReady("Rollable tables", "p123") : friendlyError(error)); setRows([]); return; }
    setRows((data ?? []) as Row[]);
  }, [supabase, campaignId]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [rows, query]);

  const rollOn = async (r: Row) => {
    setBusy(r.id); setErr(null);
    try {
      const charId = asWho || null;
      const res = await fetch("/api/tabletop/table-roll", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, tableId: r.id, gmOnly: isGm && secret, characterId: charId, asName: !charId && isGm ? gmName : undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; message?: unknown; total?: number; result?: string };
      if (!res.ok || !j.message) { setErr(j.error || `The roll failed (${res.status}).`); return; }
      setLast({ id: r.id, total: j.total ?? 0, result: j.result ?? "" });
      onPosted(j.message);
    } finally { setBusy(null); }
  };

  const preview = useMemo(() => (draft ? parseTable(draft.body) : null), [draft]);

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { setErr("Give the table a name."); return; }
    if (!preview?.ok) { setErr(preview ? preview.error : "Add some entries."); return; }
    setBusy("save"); setErr(null);
    const fields = { name: name.slice(0, 80), body: draft.body, players_can_roll: draft.players_can_roll, results_gm_only: draft.results_gm_only, updated_at: new Date().toISOString() };
    const { error } = draft.id
      ? await supabase.from("roll_tables").update(fields).eq("id", draft.id)
      : await supabase.from("roll_tables").insert({ ...fields, campaign_id: campaignId });
    setBusy(null);
    if (error) { setErr(`Could not save: ${error.message}`); return; }
    setDraft(null); void load();
  };

  const remove = async () => {
    if (!draft?.id) return;
    setBusy("save"); setErr(null);
    const { error } = await supabase.from("roll_tables").delete().eq("id", draft.id);
    setBusy(null); setConfirmDelete(false);
    if (error) { setErr(`Could not delete: ${error.message}`); return; }
    setDraft(null); void load();
  };

  const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 13 };
  const small: React.CSSProperties = { padding: "5px 10px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" };
  const primary: React.CSSProperties = { ...small, background: C.sun, color: "#1b1712", border: "none", fontWeight: 600 };
  const check: React.CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: C.text, marginTop: 8 };

  // ---- the editor ----
  if (draft) {
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{draft.id ? "Edit table" : "New table"}</div>
        <label style={{ display: "block", fontSize: 12, color: C.muted, margin: "10px 0 4px" }} htmlFor="rt-name">Name</label>
        <input id="rt-name" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Forest encounters" style={field} />
        <label style={{ display: "block", fontSize: 12, color: C.muted, margin: "10px 0 4px" }} htmlFor="rt-body">Entries, one per line</label>
        <textarea id="rt-body" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value.slice(0, 20000) })} rows={12}
          placeholder={EXAMPLE} aria-describedby="rt-help rt-preview" style={{ ...field, fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12.5, resize: "vertical" }} />
        <p id="rt-help" style={{ fontSize: 11.5, color: C.muted, margin: "6px 0 0" }}>
          Paste a numbered table from a book (&ldquo;01-05 Goblins&rdquo;, &ldquo;96-00 A dragon&rdquo;), or write a plain list where each line is as likely as the next.
          &ldquo;3x Bandits&rdquo; makes a line three times as likely. Start with a line like &ldquo;2d6&rdquo; to roll other dice.
        </p>
        <p id="rt-preview" role="status" style={{ fontSize: 12.5, margin: "8px 0 0", color: preview?.ok ? (preview.table.kind === "numbered" && preview.table.gaps.length ? C.sun : C.good) : "#e07a70" }}>
          {draft.body.trim() ? (preview?.ok ? describeTable(preview.table) : preview?.error) : "Add some entries to see what it will roll."}
        </p>
        <label style={check}>
          <input type="checkbox" checked={draft.players_can_roll} onChange={(e) => setDraft({ ...draft, players_can_roll: e.target.checked })} />
          <span>Players can see and roll it <span style={{ color: C.muted }}>(a wild magic table, say)</span></span>
        </label>
        <label style={check}>
          <input type="checkbox" checked={draft.results_gm_only} onChange={(e) => setDraft({ ...draft, results_gm_only: e.target.checked })} />
          <span>Results go only to the GM <span style={{ color: C.muted }}>(and to the player who rolled)</span></span>
        </label>
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void save()} disabled={busy === "save"} style={primary}>{busy === "save" ? "Saving..." : "Save table"}</button>
          <button type="button" onClick={() => { setDraft(null); setConfirmDelete(false); setErr(null); }} style={small}>Cancel</button>
          {draft.id && !confirmDelete && <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...small, color: "#e07a70", marginLeft: "auto" }}>Delete</button>}
          {draft.id && confirmDelete && (
            <button type="button" onClick={() => void remove()} disabled={busy === "save"} style={{ ...small, color: "#1b1712", background: "#e07a70", border: "none", marginLeft: "auto" }}>
              Delete {draft.name.trim() || "this table"} for good
            </button>
          )}
        </div>
        {err && <p role="alert" style={{ color: "#e07a70", fontSize: 12, marginTop: 10 }}>{err}</p>}
      </div>
    );
  }

  // ---- the list ----
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <div style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>Rollable tables</div>
        {isGm && <button type="button" onClick={() => { setErr(null); setDraft({ id: null, name: "", body: "", players_can_roll: false, results_gm_only: false }); }} style={small}>New table</button>}
      </div>
      <p style={{ color: C.muted, fontSize: 12, margin: "6px 0 8px" }}>
        {isGm ? "Loot, encounters, names, weather. A roll lands in the chat for the table to see." : "Tables the GM has shared with you. A roll lands in the chat."}
      </p>
      {(rows?.length ?? 0) > 6 && <input aria-label="Find a table" value={query} onChange={(e) => setQuery(e.target.value.slice(0, 60))} placeholder="Find a table..." style={{ ...field, marginBottom: 8 }} />}
      {isGm && (
        <label style={{ ...check, marginTop: 0, marginBottom: 8 }}>
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
          <span>Roll in secret <span style={{ color: C.muted }}>(only you see the result)</span></span>
        </label>
      )}
      {rows === null && <p style={{ color: C.muted, fontSize: 12.5 }}>Loading tables...</p>}
      {rows !== null && rows.length === 0 && (
        <p style={{ color: C.muted, fontSize: 12.5 }}>{isGm ? "No tables yet. Make one with New table: paste one from a book, or type a list." : "The GM has not shared any tables yet."}</p>
      )}
      <div style={{ display: "grid", gap: 6 }}>
        {shown.map((r) => {
          const p = parseTable(r.body);
          return (
            <div key={r.id} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 9px" }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: C.text }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>
                    {p.ok ? (p.table.dice ? `${p.table.dice}, ${p.table.entries.length} entries` : "1 entry") : "Needs fixing"}
                    {isGm && r.players_can_roll ? ", shared" : ""}{r.results_gm_only ? ", results to the GM" : ""}
                  </div>
                </div>
                {isGm && <button type="button" onClick={() => { setErr(null); setDraft({ id: r.id, name: r.name, body: r.body, players_can_roll: r.players_can_roll, results_gm_only: r.results_gm_only }); }} style={{ ...small, padding: "3px 8px" }} aria-label={`Edit ${r.name}`}>Edit</button>}
                <button type="button" disabled={!p.ok || busy === r.id} onClick={() => void rollOn(r)} style={{ ...primary, padding: "4px 10px", opacity: p.ok ? 1 : 0.5 }} aria-label={`Roll on ${r.name}`}>
                  {busy === r.id ? "Rolling..." : "Roll"}
                </button>
              </div>
              {last?.id === r.id && (
                <p role="status" style={{ margin: "6px 0 0", fontSize: 12.5, color: C.text }}>
                  <b style={{ color: C.sun }}>{last.total}</b> {last.result}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {err && <p role="alert" style={{ color: "#e07a70", fontSize: 12, marginTop: 10 }}>{err}</p>}
    </div>
  );
}
