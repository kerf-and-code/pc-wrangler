"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX, surfaces, ui } from "@/lib/theme";

const C = {
  bg: SAX.ink,
  surface: SAX.slateBg,
  surface2: "rgba(11,7,18,0.6)",
  line: SAX.line,
  text: SAX.text,
  muted: SAX.muted,
  sun: SAX.sun,
  plum: SAX.plum,
  warn: SAX.warn,
};

type Campaign = { id: string; name: string };
type Sess = { id: string; session_number: number | null; status: string };
type Track = { id: string; character_id: string | null; gm_identity_id: string | null };
type Seg = { id: string; track_id: string | null; character_id: string | null; start_ms: number | null; text: string };
type Speaker = { key: string; name: string };

const fmtTime = (ms: number | null): string => {
  if (ms === null || ms === undefined) return "";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

export default function TranscriptsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [charName, setCharName] = useState<Record<string, string>>({});
  const [gmName, setGmName] = useState<Record<string, string>>({});
  const [tracks, setTracks] = useState<Track[]>([]);
  const [segments, setSegments] = useState<Seg[]>([]);
  const [speaker, setSpeaker] = useState<string>(""); // "" = all speakers
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Campaigns (RLS scopes this to the signed-in GM, same as every other page).
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at");
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  // On campaign: its sessions, plus the name maps used to resolve each speaker.
  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    (async () => {
      const [{ data: sess }, { data: chs }, { data: gms }] = await Promise.all([
        supabase.from("sessions").select("id, session_number, status").eq("campaign_id", campaignId).order("session_number", { ascending: false, nullsFirst: false }),
        supabase.from("characters").select("id, name").eq("campaign_id", campaignId),
        supabase.from("gm_identities").select("id, display_name").eq("campaign_id", campaignId),
      ]);
      if (!active) return;
      const sList = (sess as Sess[]) || [];
      setSessions(sList);
      setSessionId(sList.length ? sList[0].id : "");
      const cm: Record<string, string> = {};
      ((chs as { id: string; name: string }[]) || []).forEach((c) => { cm[c.id] = c.name; });
      setCharName(cm);
      const gm: Record<string, string> = {};
      ((gms as { id: string; display_name: string | null }[]) || []).forEach((g) => { if (g.display_name) gm[g.id] = g.display_name; });
      setGmName(gm);
    })();
    return () => { active = false; };
  }, [campaignId, supabase]);

  // On session: resolve its capture jobs, then the tracks (for speaker names) and
  // every transcript segment. Segments are paginated so a long session is never
  // capped by the API's default row limit; completeness is the whole point here.
  useEffect(() => {
    if (!sessionId) { setTracks([]); setSegments([]); setSpeaker(""); return; }
    let active = true;
    (async () => {
      setLoading(true); setError(null); setSpeaker("");
      const { data: jobs, error: je } = await supabase.from("capture_jobs").select("id").eq("session_id", sessionId);
      if (je) { if (active) { setError(je.message); setLoading(false); } return; }
      const jobIds = ((jobs as { id: string }[]) || []).map((j) => j.id);
      if (jobIds.length === 0) { if (active) { setTracks([]); setSegments([]); setLoading(false); } return; }

      const { data: trk } = await supabase.from("audio_tracks").select("id, character_id, gm_identity_id").in("job_id", jobIds);
      if (!active) return;
      setTracks((trk as Track[]) || []);

      const all: Seg[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: segs, error: se } = await supabase
          .from("transcript_segments")
          .select("id, track_id, character_id, start_ms, text")
          .in("job_id", jobIds)
          .order("start_ms", { ascending: true, nullsFirst: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (se) { if (active) setError(se.message); break; }
        const batch = (segs as Seg[]) || [];
        all.push(...batch);
        if (batch.length < PAGE) break;
        if (from > 60000) break; // hard safety against a runaway loop
      }
      if (active) { setSegments(all); setLoading(false); }
    })();
    return () => { active = false; };
  }, [sessionId, supabase]);

  // track_id -> speaker. Resolving through the track (not segment.character_id)
  // is what labels the GM correctly: a GM track has a null character_id and is
  // identified by gm_identity_id instead.
  const trackInfo = useMemo(() => {
    const m: Record<string, Speaker> = {};
    for (const t of tracks) {
      if (t.character_id) m[t.id] = { key: `c:${t.character_id}`, name: charName[t.character_id] || "Unknown" };
      else if (t.gm_identity_id) m[t.id] = { key: `g:${t.gm_identity_id}`, name: gmName[t.gm_identity_id] || "the GM" };
      else m[t.id] = { key: "unknown", name: "Unknown speaker" };
    }
    return m;
  }, [tracks, charName, gmName]);

  const speakerOf = useMemo(() => {
    return (seg: Seg): Speaker => {
      if (seg.track_id && trackInfo[seg.track_id]) return trackInfo[seg.track_id];
      if (seg.character_id) return { key: `c:${seg.character_id}`, name: charName[seg.character_id] || "Unknown" };
      return { key: "unknown", name: "Unknown speaker" };
    };
  }, [trackInfo, charName]);

  // Dropdown options: the speakers who actually have lines in this session.
  const speakers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const seg of segments) { const sp = speakerOf(seg); if (!seen.has(sp.key)) seen.set(sp.key, sp.name); }
    return Array.from(seen, ([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [segments, speakerOf]);

  const shown = useMemo(
    () => (speaker ? segments.filter((s) => speakerOf(s).key === speaker) : segments),
    [segments, speaker, speakerOf],
  );

  const sessLabel = (): string => { const s = sessions.find((x) => x.id === sessionId); return s ? `Session ${s.session_number ?? "?"}` : "session"; };
  const campLabel = (): string => campaigns.find((c) => c.id === campaignId)?.name || "campaign";

  const asText = (): string =>
    shown.map((s) => {
      const sp = speakerOf(s);
      const t = s.start_ms !== null ? `[${fmtTime(s.start_ms)}] ` : "";
      return `${t}${sp.name}: ${s.text}`;
    }).join("\n");

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(asText()); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setError("Could not copy to clipboard."); }
  };

  const download = () => {
    const blob = new Blob([asText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const who = speaker ? `-${(speakers.find((s) => s.key === speaker)?.name || "speaker").replace(/\s+/g, "_")}` : "";
    a.href = url;
    a.download = `transcript-${campLabel().replace(/\s+/g, "_")}-${sessLabel().replace(/\s+/g, "_")}${who}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const box = { ...surfaces.slate, padding: 18 } as const;
  const input = { width: "100%", boxSizing: "border-box" as const, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 13px", fontSize: 15, outline: "none" };
  const label = { fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" } as const;
  const btn = (bg: string, fg: string) => ({ background: bg, color: fg, border: "none", borderRadius: 9, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" } as const);

  return (
    <PageShell width={880}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Transcripts</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 18px" }}>
        The full, unedited transcript of a session, straight from the recording. Read-only. Filter to one speaker to follow a single voice, or read the whole table.
      </p>

      <div style={{ ...box, marginBottom: 16 }}>
        <label style={label}>CAMPAIGN</label>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...input, marginTop: 6, marginBottom: 14 }}>
          {campaigns.length === 0 && <option value="">No campaigns yet</option>}
          {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        <label style={label}>SESSION</label>
        <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={{ ...input, marginTop: 6, marginBottom: 14 }}>
          {sessions.length === 0 && <option value="">No sessions yet</option>}
          {sessions.map((s) => (<option key={s.id} value={s.id}>Session {s.session_number ?? "?"} ({s.status})</option>))}
        </select>
        <label style={label}>SPEAKER</label>
        <select value={speaker} onChange={(e) => setSpeaker(e.target.value)} style={{ ...input, marginTop: 6 }}>
          <option value="">All speakers</option>
          {speakers.map((s) => (<option key={s.key} value={s.key}>{s.name}</option>))}
        </select>
      </div>

      {segments.length > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <button type="button" onClick={copyAll} style={btn(C.plum, SAX.inkDeep)}>{copied ? "Copied" : "Copy"}</button>
          <button type="button" onClick={download} style={btn(C.plum, SAX.inkDeep)}>Download .txt</button>
          <span style={{ fontSize: 12, color: C.muted }}>{shown.length} line{shown.length === 1 ? "" : "s"}{speaker ? " (filtered)" : ""}</span>
        </div>
      )}

      {error && <div style={{ ...box, color: C.warn, marginBottom: 14, fontSize: 13 }}>{error}</div>}

      {loading ? (
        <div style={{ ...box, color: C.muted }}>Loading transcript...</div>
      ) : segments.length === 0 ? (
        <div style={{ ...box, color: C.muted, fontSize: 14 }}>No transcript for this session. It may have been recorded by hand, or not yet transcribed.</div>
      ) : (
        <div style={box}>
          {!speaker && (
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
              Across speakers, the order is approximate for sessions recorded before the timeline update. Filter to a single speaker for exact order within that voice.
            </div>
          )}
          <div style={{ display: "grid", gap: 9 }}>
            {shown.map((s) => {
              const sp = speakerOf(s);
              return (
                <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: C.muted, minWidth: 54, flexShrink: 0 }}>
                    {s.start_ms !== null ? fmtTime(s.start_ms) : ""}
                  </span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.55 }}>
                    <span style={{ fontWeight: 700, color: C.sun }}>{sp.name}: </span>
                    <span style={{ color: C.text }}>{s.text}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </PageShell>
  );
}
