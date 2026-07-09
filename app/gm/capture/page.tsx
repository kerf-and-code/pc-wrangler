"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import GmIdentityCard from "@/components/gm-identity-card";
import { SAX, surfaces, ui } from "@/lib/theme";

const C = {
  bg: SAX.ink,
  surface: SAX.slateBg,
  surface2: "rgba(11,7,18,0.6)",
  line: SAX.line,
  text: SAX.text,
  muted: SAX.muted,
  sun: SAX.sun,
  sunSoft: "#FFD75E",
  plum: SAX.plum,
  warn: SAX.warn,
  good: SAX.good,
};

type Campaign = { id: string; name: string };
type Sess = { id: string; session_number: number | null; status: string };
type Char = { id: string; name: string; class: string | null };
type Job = { id: string; status: string; source: string };
type Track = { id: string; character_id: string | null; storage_path: string | null; status: string };

const PRESENT = ["present", "late", "partial"];

const JOB_TONE: Record<string, string> = {
  draft: "#A597BD",
  blocked_consent: "#E07A5F",
  uploading: "#F4C430",
  transcribing: "#9B7BD4",
  extracting: "#9B7BD4",
  review: "#FFD75E",
  done: "#5DBE9A",
  error: "#E07A5F",
};

export default function CapturePage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [chars, setChars] = useState<Char[]>([]);
  const [blanket, setBlanket] = useState<Record<string, boolean>>({});
  const [optout, setOptout] = useState<Record<string, boolean>>({});
  const [att, setAtt] = useState<Record<string, string>>({});
  const [consentOk, setConsentOk] = useState<boolean>(false);
  const [job, setJob] = useState<Job | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [queuing, setQueuing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSession = sessions.find((s) => s.id === sessionId) || null;
  const nameOf = (id: string | null): string => chars.find((c) => c.id === id)?.name || "Unknown";

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at", { ascending: true });
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    (async () => {
      const [{ data: sess }, { data: ch }] = await Promise.all([
        supabase.from("sessions").select("id, session_number, status").eq("campaign_id", campaignId).order("session_number", { ascending: false }),
        supabase.from("characters").select("id, name, class").eq("campaign_id", campaignId).eq("kind", "pc").order("name", { ascending: true }),
      ]);
      if (!active) return;
      const sList = (sess as Sess[]) || [];
      setSessions(sList);
      setChars((ch as Char[]) || []);
      setSessionId(sList.length ? sList[0].id : "");
    })();
    return () => { active = false; };
  }, [campaignId, supabase]);

  async function loadGate(sid: string) {
    const { data } = await supabase.rpc("session_consent_ok", { p_session: sid });
    setConsentOk(Boolean(data));
  }
  async function loadTracks(jid: string) {
    const { data } = await supabase.from("audio_tracks").select("id, character_id, storage_path, status").eq("job_id", jid).order("created_at", { ascending: true });
    setTracks((data as Track[]) || []);
  }

  useEffect(() => {
    if (!sessionId) { setBlanket({}); setOptout({}); setAtt({}); setJob(null); setTracks([]); setConsentOk(false); return; }
    let active = true;
    (async () => {
      const [{ data: bl }, { data: oo }, { data: aRows }, { data: jobs }] = await Promise.all([
        supabase.from("recording_consents").select("character_id").eq("campaign_id", campaignId).is("session_id", null).eq("consented", true),
        supabase.from("recording_consents").select("character_id").eq("session_id", sessionId).eq("consented", false),
        supabase.from("attendance").select("character_id, status").eq("session_id", sessionId),
        supabase.from("capture_jobs").select("id, status, source").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(1),
      ]);
      if (!active) return;
      const bmap: Record<string, boolean> = {};
      ((bl as { character_id: string | null }[]) || []).forEach((r) => { if (r.character_id) bmap[r.character_id] = true; });
      setBlanket(bmap);
      const omap: Record<string, boolean> = {};
      ((oo as { character_id: string | null }[]) || []).forEach((r) => { if (r.character_id) omap[r.character_id] = true; });
      setOptout(omap);
      const amap: Record<string, string> = {};
      ((aRows as { character_id: string | null; status: string }[]) || []).forEach((r) => { if (r.character_id) amap[r.character_id] = r.status; });
      setAtt(amap);
      const j = ((jobs as Job[]) || [])[0] || null;
      setJob(j);
      if (j) loadTracks(j.id); else setTracks([]);
      loadGate(sessionId);
    })();
    return () => { active = false; };
  }, [sessionId, supabase]);

  async function toggleOptOut(charId: string, out: boolean) {
    if (!sessionId || !campaignId) return;
    setOptout((p) => ({ ...p, [charId]: out }));
    if (out) {
      await supabase.from("recording_consents").upsert(
        { session_id: sessionId, campaign_id: campaignId, character_id: charId, consented: false, method: "gm_optout" },
        { onConflict: "session_id,character_id" },
      );
    } else {
      await supabase.from("recording_consents").delete()
        .eq("session_id", sessionId).eq("character_id", charId).eq("consented", false);
    }
    loadGate(sessionId);
  }

  async function createJob() {
    if (!sessionId || !campaignId) return;
    const { data, error: e } = await supabase.from("capture_jobs")
      .insert({ campaign_id: campaignId, session_id: sessionId, source: "online", status: "draft" })
      .select("id, status, source").single();
    if (e) { setError(e.message); return; }
    setJob(data as Job);
    setTracks([]);
  }

  async function uploadTrack(charId: string, file: File) {
    if (!job || !campaignId) return;
    setError(null);
    setUploading((p) => ({ ...p, [charId]: true }));
    const ext = file.name.split(".").pop() || "dat";
    const path = `${campaignId}/${job.id}/${charId}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("session-audio").upload(path, file);
    if (upErr) {
      setError(upErr.message);
    } else {
      const { error: insErr } = await supabase.from("audio_tracks")
        .insert({ job_id: job.id, campaign_id: campaignId, character_id: charId, storage_path: path, status: "pending" });
      if (insErr) setError(insErr.message);
      else await loadTracks(job.id);
    }
    setUploading((p) => ({ ...p, [charId]: false }));
  }

  async function removeTrack(t: Track) {
    if (!job) return;
    if (t.storage_path) await supabase.storage.from("session-audio").remove([t.storage_path]);
    await supabase.from("audio_tracks").delete().eq("id", t.id);
    loadTracks(job.id);
  }

  async function setJobStatus(status: string) {
    if (!job) return;
    setQueuing(true);
    const { error: e } = await supabase.from("capture_jobs").update({ status }).eq("id", job.id);
    if (e) setError(e.message);
    else setJob({ ...job, status });
    setQueuing(false);
  }

  async function submitJob() {
    if (!job) return;
    setQueuing(true);
    setError(null);
    try {
      const res = await fetch("/api/transcribe/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) setError(out.error || "Could not start transcription.");
      else setJob({ ...job, status: "transcribing" });
    } catch {
      setError("Could not start transcription.");
    }
    setQueuing(false);
  }

  const presentChars = chars.filter((c) => PRESENT.includes(att[c.id] || ""));
  const missing = presentChars.filter((c) => !blanket[c.id] && !optout[c.id]);

  const trackChars = new Set(tracks.map((t) => t.character_id));
  const isDraft = !job || job.status === "draft";

  const box = { ...surfaces.slate, padding: 20, marginBottom: 18 } as const;
  const btn = (bg: string, fg: string) => ({ background: bg, color: fg, border: "none", borderRadius: 9, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" } as const);

  return (
    <PageShell width={860}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Capture</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px" }}>
        Record consent, upload one audio track per player, and queue the session for transcription. Nothing is processed until consent is on file.
      </p>

        {/* campaign + session */}
        <div style={box}>
          <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>CAMPAIGN</label>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, marginBottom: 14, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 15 }}>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>SESSION</label>
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 15 }}>
            {sessions.length === 0 && <option value="">No sessions yet</option>}
            {sessions.map((s) => (<option key={s.id} value={s.id}>Session {s.session_number ?? "?"} ({s.status})</option>))}
          </select>
        </div>

        {/* narrator (GM) voice link — campaign-scoped, so it shows once a campaign is picked */}
        <GmIdentityCard campaignId={campaignId} />

        {selectedSession && (
          <>
            {/* consent */}
            <div style={box}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Recording this session</div>
                <span style={{ fontSize: 12, fontWeight: 700, color: consentOk ? C.good : C.warn, fontFamily: "ui-monospace, monospace", letterSpacing: "0.04em" }}>
                  {consentOk ? "CONSENT ON FILE" : "NOT CLEARED"}
                </span>
              </div>
              <div style={{ color: C.muted, fontSize: 13, marginBottom: 14 }}>
                Consent is captured when players claim their character. Opt a player out to exclude just them from this session; the gate clears once every present player is either consented or opted out.
              </div>
              {chars.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>No player characters in the roster yet.</p>}
              <div style={{ display: "grid", gap: 8 }}>
                {chars.map((ch) => {
                  const present = PRESENT.includes(att[ch.id] || "");
                  const consented = Boolean(blanket[ch.id]);
                  const out = Boolean(optout[ch.id]);
                  return (
                    <label key={ch.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: C.surface2, border: `1px solid ${out ? C.warn : consented ? C.good : C.line}`, borderRadius: 10, cursor: "pointer" }}>
                      <input type="checkbox" checked={out} onChange={(e) => toggleOptOut(ch.id, e.target.checked)}
                        style={{ width: 18, height: 18, accentColor: C.warn, cursor: "pointer" }} />
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{ch.name}{ch.class ? <span style={{ color: C.muted, fontWeight: 400 }}> · {ch.class}</span> : null}</span>
                      {out ? <span style={{ fontSize: 11, color: C.warn, fontFamily: "ui-monospace, monospace" }}>OPTED OUT</span>
                        : consented ? <span style={{ fontSize: 11, color: C.good, fontFamily: "ui-monospace, monospace" }}>CONSENTED</span>
                        : <span style={{ fontSize: 11, color: C.muted, fontFamily: "ui-monospace, monospace" }}>NO CONSENT</span>}
                      {present && <span style={{ fontSize: 11, color: C.plum, fontFamily: "ui-monospace, monospace" }}>PRESENT</span>}
                    </label>
                  );
                })}
              </div>
              {!consentOk && presentChars.length > 0 && missing.length > 0 && (
                <p style={{ color: C.warn, fontSize: 12.5, marginTop: 12 }}>Not consented, opt them out to proceed, or have them claim &amp; consent: {missing.map((c) => c.name).join(", ")}.</p>
              )}
              {!consentOk && presentChars.length === 0 && (
                <p style={{ color: C.muted, fontSize: 12.5, marginTop: 12 }}>Mark attendance on the Check-in page so the gate knows who needs to consent.</p>
              )}
            </div>

            {/* job + tracks */}
            <div style={box}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Audio tracks</div>
                {job && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: JOB_TONE[job.status] || C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.06em" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 8, background: JOB_TONE[job.status] || C.muted }} />
                    {job.status.toUpperCase().replace("_", " ")}
                  </span>
                )}
              </div>

              {!job && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>One job per recorded session. Create it, then upload each player&apos;s track.</p>
                  <button type="button" onClick={createJob} style={btn(C.sun, SAX.inkDeep)}>Create capture job</button>
                </div>
              )}

              {job && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ color: C.muted, fontSize: 13, marginBottom: 14 }}>
                    Online sessions record one stream per player, so each upload is already attributed to a speaker. Use the per-user files from your recorder (Craig and similar).
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {chars.map((ch) => {
                      const has = trackChars.has(ch.id);
                      const tk = tracks.find((t) => t.character_id === ch.id) || null;
                      const busy = Boolean(uploading[ch.id]);
                      return (
                        <div key={ch.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "10px 12px", background: C.surface2, border: `1px solid ${has ? C.good : C.line}`, borderRadius: 10 }}>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{ch.name}</div>
                          {has && tk ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontSize: 12, color: C.good }}>uploaded</span>
                              {isDraft && <button type="button" onClick={() => removeTrack(tk)} style={{ background: "transparent", color: C.warn, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Remove</button>}
                            </div>
                          ) : isDraft ? (
                            <label style={{ ...btn(busy ? C.line : C.plum, SAX.inkDeep), opacity: busy ? 0.7 : 1, display: "inline-block" }}>
                              {busy ? "Uploading…" : "Upload track"}
                              <input type="file" accept="audio/*" disabled={busy} style={{ display: "none" }}
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadTrack(ch.id, f); e.currentTarget.value = ""; }} />
                            </label>
                          ) : (
                            <span style={{ fontSize: 12, color: C.muted }}>no track</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {error && <p style={{ color: C.warn, fontSize: 13, marginTop: 12 }}>{error}</p>}

                  <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {isDraft ? (
                      <>
                        <button type="button" onClick={submitJob} disabled={!consentOk || tracks.length === 0 || queuing}
                          style={{ ...btn(C.good, SAX.inkDeep), opacity: !consentOk || tracks.length === 0 || queuing ? 0.5 : 1, cursor: !consentOk || tracks.length === 0 ? "not-allowed" : "pointer" }}>
                          {queuing ? "Queuing…" : "Queue for transcription"}
                        </button>
                        {!consentOk && <span style={{ fontSize: 12, color: C.warn }}>Consent not cleared yet.</span>}
                        {consentOk && tracks.length === 0 && <span style={{ fontSize: 12, color: C.muted }}>Upload at least one track.</span>}
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 13, color: C.muted }}>
                          Queued. Each track is being transcribed; when that finishes, proposed events appear on the Review page automatically.
                        </span>
                        <button type="button" onClick={() => setJobStatus("draft")} style={{ background: "transparent", color: C.plum, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: "pointer" }}>Back to draft</button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
    </PageShell>
  );
}
