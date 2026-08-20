"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";
import { parseAndIngest, parsePasted, type InputFile } from "@/lib/backfill/parse-client";
import type { SessionMode } from "@/lib/backfill/ingest";
import type { NormalizedImport } from "@/lib/backfill/types";

// app/gm/import/page.tsx
//
// Backfill upload. The GM drops an Obsidian vault (.zip), a World Anvil export (.zip / .json), a Word or
// PDF doc, or pastes notes. Parsing happens HERE in the browser (only normalized text is sent up), then
// /api/import/start extracts and stages, and we hand off to the review screen.

type Campaign = { id: string; name: string };

const fieldStyle: React.CSSProperties = {
  boxSizing: "border-box", background: C.surface2, color: C.text,
  border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 11px", fontSize: 14, outline: "none", width: "100%",
};
const primaryBtn: React.CSSProperties = {
  background: C.sun, color: SAX.inkDeep, border: "none", borderRadius: 7,
  padding: "11px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: 7,
  padding: "9px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer",
};
const label: React.CSSProperties = { fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 };

export default function ImportPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [camps, setCamps] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [sessionMode, setSessionMode] = useState<SessionMode>("auto");
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<NormalizedImport | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("campaigns").select("id, name").eq("gm_id", user.id).order("created_at");
      const list = (data as Campaign[]) || [];
      setCamps(list);
      if (list[0]) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
    setPreview(null);
  }

  async function run() {
    setError(null);
    if (!campaignId) { setError("Pick a campaign."); return; }
    if (files.length === 0 && !pasted.trim()) { setError("Add a file or paste some notes."); return; }
    setStatus("parsing");
    try {
      const bundle: NormalizedImport = files.length
        ? await parseAndIngest(files as unknown as InputFile[], { sessionMode })
        : parsePasted(pasted, { sessionMode });
      if (!bundle.notes.length && !bundle.sessions.length) {
        setStatus("error"); setError("Nothing readable was found in that upload."); setPreview(bundle); return;
      }
      setPreview(bundle);
      setStatus("uploading");
      const res = await fetch("/api/import/start", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId, bundle, sessionMode }),
      });
      const data = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
      if (!res.ok || !data.jobId) { setStatus("error"); setError(data.error || "The import could not start."); return; }
      router.push(`/gm/import/review?job=${data.jobId}`);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Something went wrong parsing the upload.");
    }
  }

  const busy = status === "parsing" || status === "uploading";

  return (
    <PageShell width={760}>
      <div style={label}>Backfill</div>
      <h1 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>
        Bring an existing campaign in
      </h1>
      <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.6, margin: "0 0 22px", maxWidth: 620 }}>
        Upload the notes you already have and we build the codex from them: NPCs, places, factions, and lore,
        plus a session timeline if your notes are split by session. You review everything before it lands in
        the campaign. Nothing but the extracted text leaves your browser.
      </p>

      {camps.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <div style={label}>Campaign</div>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={fieldStyle}>
            {camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `1.5px dashed ${dragOver ? C.brass : C.line}`, borderRadius: FORGE_RADIUS,
          background: dragOver ? "rgba(200,162,75,0.06)" : C.surface, padding: "26px 20px", textAlign: "center",
          cursor: "pointer", marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 15, color: C.text, fontWeight: 600 }}>Drop files here, or click to choose</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
          An Obsidian vault or World Anvil export as a .zip, a World Anvil .json, a .docx or .pdf, or .md / .txt.
        </div>
        <input ref={inputRef} type="file" multiple hidden
          accept=".zip,.json,.md,.markdown,.txt,.docx,.pdf,.html,.htm,.csv"
          onChange={(e) => addFiles(e.target.files)} />
      </div>

      {files.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: C.muted, padding: "4px 0" }}>
              <span>{f.name} <span style={{ color: C.line }}>· {(f.size / 1024).toFixed(0)} KB</span></span>
              <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} style={{ ...ghostBtn, padding: "2px 8px", fontSize: 12 }}>remove</button>
            </div>
          ))}
        </div>
      )}

      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", color: C.muted, fontSize: 13.5 }}>…or paste notes instead</summary>
        <textarea value={pasted} onChange={(e) => { setPasted(e.target.value); setPreview(null); }} rows={7}
          placeholder="Paste session notes. Mark sessions with lines like &quot;Session 3&quot; or a date to build a timeline."
          style={{ ...fieldStyle, marginTop: 8, resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 13 }} />
      </details>

      <div style={{ marginBottom: 20 }}>
        <div style={label}>Timeline</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {([["auto", "Detect sessions"], ["per-file", "One file per session"], ["none", "No timeline (entities only)"]] as [SessionMode, string][]).map(([m, lbl]) => (
            <button key={m} type="button" onClick={() => setSessionMode(m)}
              style={{ ...ghostBtn, ...(sessionMode === m ? { background: C.brass, color: SAX.inkDeep, border: "none" } : null) }}>{lbl}</button>
          ))}
        </div>
      </div>

      {preview && (
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "12px 14px", marginBottom: 16, fontSize: 13.5, color: C.muted }}>
          Parsed {preview.stats.noteCount} note(s), {preview.sessions.length} session(s).
          {preview.warnings.length > 0 && <div style={{ color: C.warn, marginTop: 6 }}>{preview.warnings.join(" ")}</div>}
        </div>
      )}

      {error && <div style={{ color: C.warn, fontSize: 13.5, marginBottom: 14 }}>{error}</div>}

      <button type="button" disabled={busy} onClick={run} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
        {status === "parsing" ? "Reading your notes…" : status === "uploading" ? "Extracting…" : "Import and review"}
      </button>
    </PageShell>
  );
}
