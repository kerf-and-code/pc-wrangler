"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { useMomentPlayer, MomentButton } from "@/components/moment-player";
import { SAX, surfaces, ui, AXES, type AxisKey } from "@/lib/theme";

const C = {
  bg: SAX.ink, surface: SAX.slateBg, surface2: "rgba(11,7,18,0.6)", line: SAX.line,
  text: SAX.text, muted: SAX.muted, sun: SAX.sun, plum: SAX.plum, warn: SAX.warn, good: SAX.good,
};

type Campaign = { id: string; name: string };
type JobRow = { id: string; status: string; extract_cursor: number; session: { session_number: number | null } | null };
type Prop = {
  id: string; event_type: string; axis: string | null; frame: string | null; target: string | null;
  confidence: number | null; rationale: string | null; status: string;
  character: { name: string } | null;
  segment: { text: string; start_ms: number | null } | null;
};
type GmProp = {
  id: string; kind: string; summary: string; detail: string | null; quote: string | null;
  npc_name: string | null; location_name: string | null; target_character_id: string | null;
  confidence: number | null; t_start_seconds: number | null; status: string;
  audio_track_id: string | null;
};
type GmKind = { kind: string; category: string; label: string; sort: number };

const fmtTime = (ms: number | null): string => {
  if (ms === null || ms === undefined) return "";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function ReviewPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobId, setJobId] = useState<string>("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [props, setProps] = useState<Prop[]>([]);
  const [counts, setCounts] = useState<{ accepted: number; rejected: number }>({ accepted: 0, rejected: 0 });
  const [running, setRunning] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [gmProposed, setGmProposed] = useState<number | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // GM narration tab
  const [tab, setTab] = useState<"player" | "gm">("player");
  const [gmProps, setGmProps] = useState<GmProp[]>([]);
  const [gmKinds, setGmKinds] = useState<GmKind[]>([]);
  const [gmCounts, setGmCounts] = useState<{ approved: number; rejected: number }>({ approved: 0, rejected: 0 });
  const [showMeta, setShowMeta] = useState<boolean>(false);
  const [edits, setEdits] = useState<Record<string, { summary?: string; kind?: string }>>({});
  const gmPlayer = useMomentPlayer();

  const job = jobs.find((j) => j.id === jobId) || null;

  useEffect(() => {
    (async () => {
      const [{ data: camps }, { data: ets }, { data: gks }] = await Promise.all([
        supabase.from("campaigns").select("id, name").order("created_at", { ascending: true }),
        supabase.from("event_types").select("key, label"),
        supabase.from("gm_event_kinds").select("kind, category, label, sort").order("sort", { ascending: true }),
      ]);
      const list = (camps as Campaign[]) || [];
      setCampaigns(list);
      const lab: Record<string, string> = {};
      ((ets as { key: string; label: string }[]) || []).forEach((e) => { lab[e.key] = e.label; });
      setLabels(lab);
      setGmKinds((gks as GmKind[]) || []);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  async function loadJobs(cid: string) {
    const { data } = await supabase
      .from("capture_jobs")
      .select("id, status, extract_cursor, session:sessions(session_number)")
      .eq("campaign_id", cid)
      .in("status", ["extracting", "review", "done"])
      .order("created_at", { ascending: false });
    const list = (data as unknown as JobRow[]) || [];
    setJobs(list);
    setJobId(list.length ? list[0].id : "");
  }

  useEffect(() => { if (campaignId) loadJobs(campaignId); }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadProps(jid: string) {
    const { data } = await supabase
      .from("proposed_events")
      .select("id, event_type, axis, frame, target, confidence, rationale, status, character:characters(name), segment:transcript_segments(text, start_ms)")
      .eq("job_id", jid)
      .order("confidence", { ascending: false });
    const all = (data as unknown as Prop[]) || [];
    setProps(all.filter((p) => p.status === "proposed"));
    setCounts({
      accepted: all.filter((p) => p.status === "accepted").length,
      rejected: all.filter((p) => p.status === "rejected").length,
    });
  }

  async function loadGmProps(jid: string) {
    const { data } = await supabase
      .from("gm_proposed_events")
      .select("id, kind, summary, detail, quote, npc_name, location_name, target_character_id, confidence, t_start_seconds, status, audio_track_id")
      .eq("job_id", jid)
      .order("created_at", { ascending: true });
    const all = (data as GmProp[]) || [];
    setGmProps(all.filter((p) => p.status === "proposed"));
    setGmCounts({
      approved: all.filter((p) => p.status === "approved").length,
      rejected: all.filter((p) => p.status === "rejected").length,
    });
  }

  useEffect(() => {
    if (jobId) { loadProps(jobId); loadGmProps(jobId); }
    else {
      setProps([]); setGmProps([]);
      setCounts({ accepted: 0, rejected: 0 }); setGmCounts({ approved: 0, rejected: 0 });
    }
    setEdits({});
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runExtraction() {
    if (!jobId) return;
    setRunning(true); setError(null); setProgress(null); setGmProposed(null);
    // Player extractor first, then the GM extractor. The job flips to "review"
    // only once both have finished their portion (the routes coordinate that).
    let done = false;
    while (!done) {
      const res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setError(out.error || "Extraction failed."); setRunning(false); return; }
      setProgress({ processed: out.processed, total: out.total });
      done = Boolean(out.done);
    }
    let gmDone = false;
    let gmCount = 0;
    while (!gmDone) {
      const res = await fetch("/api/extract-gm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setError(out.error || "GM extraction failed."); break; }
      if (Number(out.total) > 0) setProgress({ processed: out.processed, total: out.total });
      gmCount += Number(out.proposed || 0);
      gmDone = Boolean(out.done);
    }
    setGmProposed(gmCount);
    setRunning(false);
    await loadProps(jobId);
    await loadGmProps(jobId);
    await loadJobs(campaignId);
  }

  async function review(id: string, accept: boolean) {
    setBusy(true);
    const { error: e } = await supabase.rpc("review_proposed_event", { p_id: id, p_accept: accept });
    if (e) setError(e.message);
    else {
      setProps((prev) => prev.filter((p) => p.id !== id));
      setCounts((c) => ({ accepted: c.accepted + (accept ? 1 : 0), rejected: c.rejected + (accept ? 0 : 1) }));
    }
    setBusy(false);
  }

  async function acceptAll() {
    setBusy(true); setError(null);
    const ids = props.map((p) => p.id);
    for (const id of ids) {
      const { error: e } = await supabase.rpc("review_proposed_event", { p_id: id, p_accept: true });
      if (e) { setError(e.message); break; }
    }
    setBusy(false);
    await loadProps(jobId);
  }

  async function markDone() {
    if (!job) return;
    await supabase.from("capture_jobs").update({ status: "done" }).eq("id", job.id);
    loadJobs(campaignId);
  }

  const setEdit = (id: string, patch: { summary?: string; kind?: string }) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  async function reviewGm(p: GmProp, action: "approve" | "reject", createNpc = false) {
    setBusy(true); setError(null);
    const e = edits[p.id];
    const payload: Record<string, unknown> = { action, id: p.id };
    if (action === "approve") {
      payload.summary = e?.summary ?? p.summary;
      payload.kind = e?.kind ?? p.kind;
      if (createNpc) { payload.createNpc = true; payload.npcName = p.npc_name || ""; }
    }
    const res = await fetch("/api/gm-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) setError(out.error || "Could not update the event.");
    else {
      setGmProps((prev) => prev.filter((x) => x.id !== p.id));
      setGmCounts((c) => ({ approved: c.approved + (action === "approve" ? 1 : 0), rejected: c.rejected + (action === "reject" ? 1 : 0) }));
    }
    setBusy(false);
  }

  const gmView = gmProps.filter((p) => showMeta || p.kind !== "meta");

  const box = { ...surfaces.slate, padding: 20, marginBottom: 18 } as const;
  const btn = (bg: string, fg: string) => ({ background: bg, color: fg, border: "none", borderRadius: 9, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" } as const);
  const tabBtn = (on: boolean) => ({ background: on ? C.plum : "transparent", color: on ? SAX.inkDeep : C.muted, border: `1px solid ${on ? C.plum : C.line}`, borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" } as const);

  return (
    <PageShell width={900}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Review</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px" }}>
        Claude reads the transcript and proposes events. Nothing counts until you accept it into the spine.
      </p>

        <div style={box}>
          <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>CAMPAIGN</label>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, marginBottom: 14, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 15 }}>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>CAPTURE JOB</label>
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 15 }}>
            {jobs.length === 0 && <option value="">No transcribed jobs yet</option>}
            {jobs.map((j) => (<option key={j.id} value={j.id}>Session {j.session?.session_number ?? "?"} ({j.status})</option>))}
          </select>
        </div>

        {job && (
          <>
            {/* job-level: extraction + status, shared by both tabs */}
            <div style={box}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, color: C.muted }}>
                  Session {job.session?.session_number ?? "?"} · <span style={{ fontFamily: "ui-monospace, monospace" }}>{job.status}</span>
                </div>
                {job.status === "extracting" && (
                  <button type="button" onClick={runExtraction} disabled={running} style={{ ...btn(C.plum, SAX.inkDeep), opacity: running ? 0.7 : 1 }}>
                    {running ? "Extracting…" : "Run extraction"}
                  </button>
                )}
              </div>
              {running && progress && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ height: 6, background: C.surface2, borderRadius: 6, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress.total ? Math.round((progress.processed / progress.total) * 100) : 0}%`, background: C.plum, transition: "width .3s" }} />
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{progress.processed} / {progress.total} transcript lines</div>
                </div>
              )}
              {error && <p style={{ color: C.warn, fontSize: 13, marginTop: 12 }}>{error}</p>}
              {gmProposed !== null && (
                <p style={{ color: C.muted, fontSize: 12.5, marginTop: 10 }}>
                  {gmProposed} GM narration event{gmProposed === 1 ? "" : "s"} captured. Review them in the GM narration tab.
                </p>
              )}
            </div>

            {/* tab switcher */}
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <button type="button" onClick={() => setTab("player")} style={tabBtn(tab === "player")}>Player events ({props.length})</button>
              <button type="button" onClick={() => setTab("gm")} style={tabBtn(tab === "gm")}>GM narration ({gmView.length})</button>
            </div>

            {tab === "player" ? (
              <>
                <div style={box}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 14, color: C.muted }}>
                      <span style={{ color: C.good, fontWeight: 700 }}>{counts.accepted}</span> accepted ·{" "}
                      <span style={{ color: C.warn, fontWeight: 700 }}>{counts.rejected}</span> rejected ·{" "}
                      <span style={{ color: C.sun, fontWeight: 700 }}>{props.length}</span> awaiting review
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {props.length > 0 && <button type="button" onClick={acceptAll} disabled={busy} style={{ ...btn(C.good, SAX.inkDeep), opacity: busy ? 0.7 : 1 }}>Accept all</button>}
                      {job.status === "review" && props.length === 0 && <button type="button" onClick={markDone} style={btn(C.sun, SAX.inkDeep)}>Mark done</button>}
                    </div>
                  </div>
                </div>

                {props.length === 0 ? (
                  <div style={{ ...box, color: C.muted, fontSize: 14 }}>
                    {job.status === "extracting" ? "Run extraction to generate proposed events from the transcript." : "Nothing left to review for this job."}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {props.map((p) => {
                      const ax = p.axis ? AXES[p.axis as AxisKey] : null;
                      const conf = p.confidence !== null ? Math.round((p.confidence || 0) * 100) : null;
                      return (
                        <div key={p.id} style={box}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 15, fontWeight: 700 }}>{p.character?.name || "GM / Narrator"}</span>
                              <span style={{ fontSize: 13, color: C.muted }}>{labels[p.event_type] || p.event_type}</span>
                              {ax && <span style={{ fontSize: 11, fontWeight: 700, color: SAX.inkDeep, background: ax.color, padding: "2px 8px", borderRadius: 999 }}>{ax.tavernName}</span>}
                              {p.frame && <span style={{ fontSize: 11, color: C.muted, fontFamily: "ui-monospace, monospace" }}>{p.frame}</span>}
                            </div>
                            {conf !== null && <span style={{ fontSize: 13, fontWeight: 700, color: conf >= 70 ? C.good : conf >= 40 ? C.sun : C.warn }}>{conf}%</span>}
                          </div>

                          {p.segment?.text && (
                            <div style={{ marginTop: 10, padding: "10px 12px", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 13, color: C.text }}>
                              <span style={{ color: C.muted, fontFamily: "ui-monospace, monospace", fontSize: 11, marginRight: 8 }}>{fmtTime(p.segment.start_ms)}</span>
                              {"\u201c"}{p.segment.text}{"\u201d"}
                            </div>
                          )}
                          {p.rationale && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8, fontStyle: "italic" }}>{p.rationale}</div>}

                          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                            <button type="button" onClick={() => review(p.id, true)} disabled={busy} style={btn(C.good, SAX.inkDeep)}>Accept</button>
                            <button type="button" onClick={() => review(p.id, false)} disabled={busy} style={{ background: "transparent", color: C.warn, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Reject</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={box}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 14, color: C.muted }}>
                      <span style={{ color: C.good, fontWeight: 700 }}>{gmCounts.approved}</span> approved ·{" "}
                      <span style={{ color: C.warn, fontWeight: 700 }}>{gmCounts.rejected}</span> rejected ·{" "}
                      <span style={{ color: C.sun, fontWeight: 700 }}>{gmView.length}</span> awaiting review
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: C.muted, cursor: "pointer" }}>
                      <input type="checkbox" checked={showMeta} onChange={(e) => setShowMeta(e.target.checked)} style={{ width: 15, height: 15, accentColor: C.plum, cursor: "pointer" }} />
                      Show table-talk
                    </label>
                  </div>
                </div>

                {gmPlayer.error && <p style={{ color: C.warn, fontSize: 12.5, marginBottom: 10 }}>{gmPlayer.error}</p>}

                {gmView.length === 0 ? (
                  <div style={{ ...box, color: C.muted, fontSize: 14 }}>
                    {job.status === "extracting" ? "Run extraction to generate GM narration events." : "No GM narration events awaiting review."}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {gmView.map((p) => {
                      const eKind = edits[p.id]?.kind ?? p.kind;
                      const eSummary = edits[p.id]?.summary ?? p.summary;
                      const isNpc = eKind.startsWith("npc_");
                      const conf = p.confidence !== null ? Math.round((p.confidence || 0) * 100) : null;
                      return (
                        <div key={p.id} style={box}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <select value={eKind} onChange={(ev) => setEdit(p.id, { kind: ev.target.value })}
                              style={{ background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", fontSize: 12.5 }}>
                              {gmKinds.map((k) => (<option key={k.kind} value={k.kind}>{k.label}</option>))}
                            </select>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              {p.audio_track_id ? (
                                <MomentButton active={gmPlayer.activeId === p.id} loading={gmPlayer.loadingId === p.id} tStart={p.t_start_seconds}
                                  onClick={() => gmPlayer.play(p.id, p.audio_track_id, p.t_start_seconds)} />
                              ) : (p.t_start_seconds !== null && (
                                <span style={{ color: C.muted, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{fmtTime(Math.round((p.t_start_seconds || 0) * 1000))}</span>
                              ))}
                              {conf !== null && <span style={{ fontSize: 13, fontWeight: 700, color: conf >= 70 ? C.good : conf >= 40 ? C.sun : C.warn }}>{conf}%</span>}
                            </div>
                          </div>

                          <textarea value={eSummary} onChange={(ev) => setEdit(p.id, { summary: ev.target.value })} rows={2}
                            style={{ display: "block", width: "100%", marginTop: 10, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 11px", fontSize: 14, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />

                          {(p.npc_name || p.location_name) && (
                            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
                              {p.npc_name && <span style={{ fontSize: 12, color: C.muted }}>NPC: <span style={{ color: C.text }}>{p.npc_name}</span></span>}
                              {p.location_name && <span style={{ fontSize: 12, color: C.muted }}>Place: <span style={{ color: C.text }}>{p.location_name}</span></span>}
                            </div>
                          )}

                          {p.quote && (
                            <div style={{ marginTop: 10, padding: "10px 12px", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 13, color: C.text, fontStyle: "italic" }}>
                              {"\u201c"}{p.quote}{"\u201d"}
                            </div>
                          )}
                          {p.detail && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>{p.detail}</div>}

                          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                            <button type="button" onClick={() => reviewGm(p, "approve")} disabled={busy} style={btn(C.good, SAX.inkDeep)}>Accept</button>
                            {isNpc && p.npc_name && (
                              <button type="button" onClick={() => reviewGm(p, "approve", true)} disabled={busy} style={btn(C.sun, SAX.inkDeep)}>Accept + create NPC</button>
                            )}
                            <button type="button" onClick={() => reviewGm(p, "reject")} disabled={busy} style={{ background: "transparent", color: C.warn, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Reject</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
    </PageShell>
  );
}
