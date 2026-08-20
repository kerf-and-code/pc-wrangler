"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { SAX, surfaces } from "@/lib/theme";

// app/gm/import/review/page.tsx
//
// Review what the import extracted before it lands. Candidates are grouped by kind; each is Include or
// Skip (structural ones from Obsidian/World Anvil arrive pre-included, prose ones default to a glance),
// a dedupe match shows as "folds into <existing>". Commit writes the included ones into the codex and the
// included sessions onto the timeline, via /api/import/commit.

type Cand = {
  id: string; kind: string; name: string; body: string | null; origin: string | null;
  dedupe_kind: string | null; dedupe_id: string | null; decision: string; confidence: number | null;
};
type Sess = { id: string; idx: number; label: string | null; occurred_on: string | null; recap: string | null; decision: string };

const KIND_LABEL: Record<string, string> = {
  npc: "NPCs", location: "Places", faction: "Factions", item: "Items", lore: "Lore", pc: "Player characters",
};
const KIND_ORDER = ["npc", "location", "faction", "item", "lore", "pc"];

const btn: React.CSSProperties = { border: "none", borderRadius: 7, padding: "9px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" };
const primaryBtn: React.CSSProperties = { ...btn, background: C.sun, color: SAX.inkDeep };
const ghostBtn: React.CSSProperties = { ...btn, background: "transparent", color: C.muted, border: `1px solid ${C.line}`, fontWeight: 600, fontSize: 12.5 };
const label: React.CSSProperties = { fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", textTransform: "uppercase" };

async function postJson(url: string, payload: Record<string, unknown>) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; created?: number; folded?: number; timeline?: number };
  return { ok: res.ok, ...data };
}
const included = (d: string) => d === "approved" || d === "merged";

export default function ImportReviewPage() {
  const supabase = useMemo(() => createClient(), []);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [cands, setCands] = useState<Cand[]>([]);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    setJobId(id);
  }, []);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    const [{ data: job }, { data: cData }, { data: sData }] = await Promise.all([
      supabase.from("import_jobs").select("status").eq("id", jobId).maybeSingle(),
      supabase.from("import_candidates").select("id, kind, name, body, origin, dedupe_kind, dedupe_id, decision, confidence").eq("job_id", jobId).order("kind"),
      supabase.from("import_sessions").select("id, idx, label, occurred_on, recap, decision").eq("job_id", jobId).order("idx"),
    ]);
    setStatus((job as { status: string } | null)?.status || "");
    setCands((cData as Cand[]) || []);
    setSessions((sData as Sess[]) || []);
    setLoading(false);
  }, [supabase, jobId]);

  useEffect(() => { void load(); }, [load]);

  const setCandDecision = async (ids: string[], decision: string) => {
    setCands((cs) => cs.map((c) => ids.includes(c.id) ? { ...c, decision } : c));
    await postJson("/api/import/decide", { jobId, candidateIds: ids, decision });
  };
  const toggleCand = (c: Cand) => {
    const next = included(c.decision) ? "rejected" : (c.dedupe_id ? "merged" : "approved");
    void setCandDecision([c.id], next);
  };
  const setSessDecision = async (ids: string[], decision: string) => {
    setSessions((ss) => ss.map((s) => ids.includes(s.id) ? { ...s, decision } : s));
    await postJson("/api/import/decide", { jobId, sessionIds: ids, decision });
  };

  const commit = async () => {
    setCommitting(true); setError(null);
    const r = await postJson("/api/import/commit", { jobId });
    setCommitting(false);
    if (!r.ok) { setError(r.error || "Commit failed."); return; }
    setResult(`Added ${r.created ?? 0} new, folded ${r.folded ?? 0} into existing, and placed ${r.timeline ?? 0} session(s) on the timeline.`);
    void load();
  };

  const grouped = useMemo(() => {
    const g: Record<string, Cand[]> = {};
    for (const c of cands) (g[c.kind] ||= []).push(c);
    return g;
  }, [cands]);

  const includedCount = cands.filter((c) => included(c.decision)).length;
  const includedSessions = sessions.filter((s) => included(s.decision)).length;
  const done = status === "committed";

  if (!jobId) return <PageShell width={820}><p style={{ color: C.muted }}>No import selected.</p></PageShell>;

  return (
    <PageShell width={820}>
      <div style={{ ...label, marginBottom: 6 }}>Backfill · review</div>
      <h1 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>
        {done ? "Imported" : "Review before it lands"}
      </h1>
      <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 20px", maxWidth: 640 }}>
        {done
          ? "These are in your campaign now. Everything came in GM-only; publish what your players should see from the codex."
          : "Everything comes in GM-only until you publish it. Include what is right, skip the rest, then commit."}
      </p>

      {loading && <p style={{ color: C.muted }}>Loading…</p>}
      {result && <div style={{ ...surfaces.slate, borderRadius: FORGE_RADIUS, padding: 14, marginBottom: 18, color: C.good, fontSize: 14 }}>{result}</div>}
      {error && <div style={{ color: C.warn, fontSize: 13.5, marginBottom: 14 }}>{error}</div>}

      {!loading && !done && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
          <button type="button" disabled={committing || includedCount + includedSessions === 0} onClick={commit}
            style={{ ...primaryBtn, opacity: committing || includedCount + includedSessions === 0 ? 0.6 : 1 }}>
            {committing ? "Committing…" : `Commit ${includedCount} entit${includedCount === 1 ? "y" : "ies"}` + (includedSessions ? ` + ${includedSessions} session${includedSessions === 1 ? "" : "s"}` : "")}
          </button>
          <span style={{ color: C.muted, fontSize: 12.5 }}>{cands.length} found · {includedCount} included</span>
        </div>
      )}

      {KIND_ORDER.filter((k) => grouped[k]?.length).map((k) => {
        const rows = grouped[k];
        const ids = rows.map((r) => r.id);
        return (
          <div key={k} style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={label}>{KIND_LABEL[k] || k} · {rows.length}</div>
              {!done && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => setCandDecision(ids, k === "pc" ? "rejected" : "approved")} style={ghostBtn}>Include all</button>
                  <button type="button" onClick={() => setCandDecision(ids, "rejected")} style={ghostBtn}>Skip all</button>
                </div>
              )}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {rows.map((c) => {
                const on = included(c.decision);
                return (
                  <div key={c.id} style={{ ...surfaces.slate, borderRadius: FORGE_RADIUS, padding: "11px 13px", display: "flex", gap: 12, alignItems: "flex-start", opacity: on ? 1 : 0.5 }}>
                    {!done && (
                      <input type="checkbox" checked={on} onChange={() => toggleCand(c)} style={{ marginTop: 3, width: 16, height: 16, accentColor: SAX.brass }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, color: C.text, fontWeight: 600 }}>
                        {c.name}
                        {c.origin === "structural" && <span style={{ ...label, marginLeft: 8, fontSize: 10 }}>authored</span>}
                      </div>
                      {c.dedupe_id && <div style={{ fontSize: 12.5, color: C.plum, marginTop: 2 }}>folds into an existing entry</div>}
                      {c.body && <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, marginTop: 4 }}>{c.body.length > 200 ? `${c.body.slice(0, 200)}…` : c.body}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {sessions.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={label}>Timeline · {sessions.length} session{sessions.length === 1 ? "" : "s"}</div>
            {!done && (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => setSessDecision(sessions.map((s) => s.id), "approved")} style={ghostBtn}>Include all</button>
                <button type="button" onClick={() => setSessDecision(sessions.map((s) => s.id), "rejected")} style={ghostBtn}>Skip all</button>
              </div>
            )}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {sessions.map((s) => {
              const on = included(s.decision);
              return (
                <div key={s.id} style={{ ...surfaces.slate, borderRadius: FORGE_RADIUS, padding: "11px 13px", display: "flex", gap: 12, alignItems: "flex-start", opacity: on ? 1 : 0.5 }}>
                  {!done && <input type="checkbox" checked={on} onChange={() => setSessDecision([s.id], on ? "rejected" : "approved")} style={{ marginTop: 3, width: 16, height: 16, accentColor: SAX.brass }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{s.label || `Session ${s.idx}`} {s.occurred_on && <span style={{ color: C.muted, fontWeight: 400 }}>· {s.occurred_on}</span>}</div>
                    {s.recap && <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, marginTop: 4 }}>{s.recap.length > 200 ? `${s.recap.slice(0, 200)}…` : s.recap}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {done && (
        <a href="/gm/codex" style={{ ...primaryBtn, display: "inline-block", textDecoration: "none" }}>Open the codex</a>
      )}
    </PageShell>
  );
}
