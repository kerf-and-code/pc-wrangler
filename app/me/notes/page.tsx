"use client";

// A player's own notes, one campaign at a time.
//
// SEPARATE FROM THE PER-ENTRY NOTES on the codex, and deliberately so: those hang off something the
// GM revealed, and these hang off nothing. A player wants somewhere to write "I think the
// Toll-Keeper is lying" before there is an entry to attach it to, and a note that has to wait for
// the GM to create a subject is a note that never gets written.
//
// PRIVATE, PERMANENTLY. Same table, same single owner-only policy. There is no share control here
// because there is nothing in the schema to share with, and the page says so rather than leaving a
// player to infer it from the absence of a button.

import React, { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { Header } from "@/app/me/campaigns/page";

type Campaign = { campaign_id: string; campaign_name: string };
type Note = { id: string; body: string; updated_at: string };

export default function NotesPage() {
  const supabase = createClient();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      // my_campaigns() derives a player's campaigns from characters they own, which is the same
      // source the rest of the player pages use. Reading memberships here would show nothing.
      const { data, error } = await supabase.rpc("my_campaigns");
      if (error) { setStatus("error"); return; }
      const rows = (data as Campaign[]) || [];
      setCampaigns(rows);
      if (rows.length) setCampaignId(rows[0].campaign_id);
      setStatus(rows.length ? "ready" : "empty");
    })();
  }, [supabase]);

  const load = useCallback(async (cid: string) => {
    if (!cid) { setNotes([]); return; }
    const { data } = await supabase
      .from("player_notes")
      .select("id, body, updated_at")
      .eq("campaign_id", cid)
      .is("entry_id", null)          // free notes only; the entry ones live on the codex
      .order("updated_at", { ascending: false });
    setNotes((data as Note[]) || []);
  }, [supabase]);

  useEffect(() => { void load(campaignId); }, [campaignId, load]);

  const add = async () => {
    const body = draft.trim();
    if (!body || !campaignId || busy) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("player_notes").insert({
        profile_id: user.id, campaign_id: campaignId, entry_id: null, body,
      });
      setDraft("");
      await load(campaignId);
    }
    setBusy(false);
  };

  const save = async (id: string, body: string) => {
    await supabase.from("player_notes").update({ body }).eq("id", id);
  };

  const remove = async (id: string) => {
    await supabase.from("player_notes").delete().eq("id", id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 700, margin: "0 auto" }}>
        <Header title="Your notes" sub="ONLY YOU CAN SEE THESE" />

        {status === "loading" && <p style={muted}>Loading&hellip;</p>}
        {status === "error" && <p style={muted}>Something went wrong. Please refresh.</p>}
        {status === "empty" && (
          <p style={muted}>
            Once you are playing in a campaign, this is where you can keep your own notes on it.
          </p>
        )}

        {status === "ready" && (
          <>
            {campaigns.length > 1 && (
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
                style={{ ...field, marginBottom: 14 }}>
                {campaigns.map((c) => (
                  <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>
                ))}
              </select>
            )}

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="A suspicion, a name you want to remember, something you meant to ask about."
              rows={3}
              style={{ ...field, resize: "vertical", marginBottom: 8 }}
            />
            <button onClick={() => void add()} disabled={!draft.trim() || busy}
              style={{
                ...field, width: "auto", cursor: draft.trim() ? "pointer" : "default",
                opacity: draft.trim() ? 1 : 0.45, padding: "8px 16px", marginBottom: 22,
                background: C.brass, color: C.ink, border: "none", fontWeight: 600,
              }}>
              {busy ? "Saving" : "Add note"}
            </button>

            {notes.length === 0 ? (
              <p style={muted}>Nothing yet. Whatever you write here stays between you and the page.</p>
            ) : (
              notes.map((n) => (
                <NoteRow key={n.id} note={n} onSave={save} onRemove={remove} />
              ))
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}

/**
 * One note. Saves on blur rather than per keystroke - a note is a paragraph, not a chat message.
 * Delete is a plain link rather than a button, and confirms, because a note nobody else can see is
 * a note nobody else can recover.
 */
function NoteRow({ note, onSave, onRemove }: {
  note: Note;
  onSave: (id: string, body: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [body, setBody] = useState(note.body);
  const [dirty, setDirty] = useState(false);

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
      padding: "12px 14px", marginBottom: 9,
    }}>
      <textarea
        value={body}
        onChange={(e) => { setBody(e.target.value); setDirty(true); }}
        onBlur={() => { if (dirty) { void onSave(note.id, body); setDirty(false); } }}
        rows={Math.min(10, Math.max(2, body.split("\n").length + 1))}
        style={{
          width: "100%", background: "transparent", color: C.text, border: "none",
          fontSize: 14, lineHeight: 1.6, resize: "vertical", fontFamily: "inherit", padding: 0,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginTop: 8, gap: 10 }}>
        <span style={{ fontFamily: SAX.mono, fontSize: 10.5, color: C.muted }}>
          {dirty ? "unsaved" : new Date(note.updated_at).toLocaleDateString()}
        </span>
        <button
          onClick={() => { if (confirm("Delete this note? Nobody else has a copy.")) void onRemove(note.id); }}
          style={{ background: "transparent", border: "none", cursor: "pointer",
            color: C.muted, fontSize: 12, textDecoration: "underline", padding: 0 }}>
          Delete
        </button>
      </div>
    </div>
  );
}

const muted: React.CSSProperties = { color: C.muted, fontSize: 14, lineHeight: 1.6 };
const field: React.CSSProperties = {
  width: "100%", background: C.surface2, color: C.text,
  border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
  padding: "9px 11px", fontSize: 14, lineHeight: 1.55, fontFamily: "inherit",
};
