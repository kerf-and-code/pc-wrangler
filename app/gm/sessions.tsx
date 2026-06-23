"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

const C = {
  ink: "#15131E", panel: "#211D30", line: "#332C46", vellum: "#ECE3CF",
  muted: "#8B85A0", brass: "#C8A24B", brassDim: "#8A7335", accent: "#6C76B0", warn: "#A8493E",
};
const AXIS_COLOR: Record<string, string> = { N: "#B7615A", T: "#C8A24B", O: "#4E8077", S: "#CE8A42", E: "#6C76B0", I: "#9A93B0" };
const AXIS_NAME: Record<string, string> = { N: "Character", T: "Encounter", O: "System", S: "Table", E: "World", I: "Presence" };

const box = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, marginBottom: 16 };
const inputStyle = { background: C.ink, color: C.vellum, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 11px", fontSize: 14 };
const btn = { background: C.brass, color: C.ink, border: "none", borderRadius: 9, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { background: "none", color: C.brass, border: `1px solid ${C.brassDim}`, borderRadius: 9, padding: "9px 16px", fontSize: 13, cursor: "pointer" };
const CAT_ORDER = ["opportunity", "response", "reward", "meta"];
const CAT_LABEL: Record<string, string> = { opportunity: "Opportunities", response: "Responses", reward: "Rewards", meta: "Notes" };

export default function SessionWorkspace() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [eventTypes, setEventTypes] = useState<any[]>([]);
  const [campaign, setCampaign] = useState<string | null>(null);
  const [characters, setCharacters] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [session, setSession] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);

  // forms
  const [newSession, setNewSession] = useState({ modality: "in_person", consent: false, notes: "" });
  const [entry, setEntry] = useState({ characterId: "", typeKey: "", axis: "", frame: "", target: "", note: "" });

  // ---- initial load ----
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) { setErr("Please sign in to use the session workspace."); setLoading(false); } return; }
      if (!active) return;
      setUserId(user.id);
      const [{ data: camps }, { data: types }] = await Promise.all([
        supabase.from("campaigns").select("id,name,system").order("created_at", { ascending: false }),
        supabase.from("event_types").select("key,label,category,default_axis,default_frame,default_target"),
      ]);
      if (!active) return;
      setCampaigns(camps || []);
      setEventTypes(types || []);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [supabase]);

  const loadCampaignData = useCallback(async (campaignId: string) => {
    const [{ data: chars }, { data: sess }] = await Promise.all([
      supabase.from("characters").select("id,name,class,subclass,kind,active")
        .eq("campaign_id", campaignId).eq("active", true).order("kind").order("name"),
      supabase.from("sessions").select("id,session_number,status,capture_modality,consent_recorded,notes,created_at")
        .eq("campaign_id", campaignId).order("session_number", { ascending: false, nullsFirst: false }),
    ]);
    setCharacters(chars || []);
    setSessions(sess || []);
  }, [supabase]);

  useEffect(() => { if (campaign) loadCampaignData(campaign); }, [campaign, loadCampaignData]);

  const loadEvents = useCallback(async (sessionId: string) => {
    const { data } = await supabase.from("events")
      .select("id,character_id,event_type,axis,frame,target,payload,created_at")
      .eq("session_id", sessionId).order("created_at", { ascending: false });
    setEvents(data || []);
  }, [supabase]);

  useEffect(() => { if (session) loadEvents(session); else setEvents([]); }, [session, loadEvents]);

  // ---- mutations ----
  async function createSession() {
    if (!campaign || busy) return;
    setBusy(true); setErr(null);
    const nextNum = (sessions[0]?.session_number || 0) + 1;
    const { data, error } = await supabase.from("sessions").insert({
      campaign_id: campaign, session_number: nextNum, status: "scheduled",
      capture_modality: newSession.modality, consent_recorded: newSession.consent,
      notes: newSession.notes.trim() || null, started_at: new Date().toISOString(),
    }).select().single();
    if (error) setErr(error.message);
    else { setSessions((s) => [data, ...s]); setSession(data.id); setNewSession({ modality: "in_person", consent: false, notes: "" }); }
    setBusy(false);
  }

  async function completeSession() {
    if (!session) return;
    const { error } = await supabase.from("sessions")
      .update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", session);
    if (error) setErr(error.message); else if (campaign) loadCampaignData(campaign);
  }

  function pickType(key: string) {
    const t = eventTypes.find((x) => x.key === key);
    setEntry((e) => ({
      ...e, typeKey: key,
      axis: t?.default_axis || "", frame: t?.default_frame || "", target: t?.default_target || "",
    }));
  }

  async function logEvent() {
    if (!session || !entry.typeKey || busy) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("events").insert({
      campaign_id: campaign, session_id: session,
      character_id: entry.characterId || null, actor_profile_id: null,
      event_type: entry.typeKey,
      axis: entry.axis || null, frame: entry.frame || null, target: entry.target || null,
      source: "manual", payload: entry.note.trim() ? { note: entry.note.trim() } : null,
    });
    if (error) setErr(error.message);
    else { setEntry((e) => ({ ...e, note: "" })); await loadEvents(session); }
    setBusy(false);
  }

  async function deleteEvent(id: string) {
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) setErr(error.message); else if (session) loadEvents(session);
  }

  // ---- derived ----
  const charName = useCallback((id: string) => characters.find((c) => c.id === id)?.name || "— table —", [characters]);
  const typeLabel = useCallback((k: string) => eventTypes.find((t) => t.key === k)?.label || k, [eventTypes]);

  // live tally: events per character this session (spotlight preview)
  const tally = useMemo(() => {
    const perChar: Record<string, number> = {};
    for (const ev of events) {
      const key = ev.character_id || "__table__";
      perChar[key] = (perChar[key] || 0) + 1;
    }
    const total = events.length || 1;
    return Object.entries(perChar)
      .map(([k, n]) => ({ key: k, name: k === "__table__" ? "— table —" : charName(k), n, share: n / total }))
      .sort((a, b) => b.n - a.n);
  }, [events, charName]);

  const typesByCat = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const t of eventTypes) (m[t.category] ||= []).push(t);
    return m;
  }, [eventTypes]);

  if (loading) return <Shell><p style={{ color: C.muted }}>Loading...</p></Shell>;

  return (
    <Shell>
      <div className="mono" style={{ fontSize: 11, letterSpacing: "0.22em", color: C.brass, textTransform: "uppercase", marginBottom: 18 }}>
        Session Log
      </div>
      {err && <div style={{ ...box, borderColor: C.warn, color: "#E7B7B0", fontSize: 13 }}>{err}</div>}

      {/* campaign + session pickers */}
      <div style={box}>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>Campaign</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: campaign ? 16 : 0 }}>
          {campaigns.length === 0 && <span style={{ color: C.muted, fontSize: 13 }}>No campaigns. Create one in the GM workspace first.</span>}
          {campaigns.map((c) => (
            <button key={c.id} onClick={() => { setCampaign(c.id); setSession(null); }}
              style={campaign === c.id ? btn : btnGhost}>{c.name}</button>
          ))}
        </div>

        {campaign && (
          <>
            <div style={{ fontSize: 13, color: C.muted, margin: "8px 0 10px" }}>Sessions</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {sessions.map((s) => (
                <button key={s.id} onClick={() => setSession(s.id)}
                  style={session === s.id ? btn : btnGhost}>
                  #{s.session_number ?? "?"} <span style={{ opacity: 0.6, fontSize: 11 }}>{s.status}</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select style={inputStyle} value={newSession.modality}
                onChange={(e) => setNewSession({ ...newSession, modality: e.target.value })}>
                <option value="in_person">In person</option>
                <option value="online">Online</option>
                <option value="mixed">Mixed</option>
                <option value="manual">Manual only</option>
              </select>
              <label style={{ fontSize: 13, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={newSession.consent}
                  onChange={(e) => setNewSession({ ...newSession, consent: e.target.checked })} />
                consent recorded
              </label>
              <button style={btn} onClick={createSession} disabled={busy}>Start new session</button>
            </div>
          </>
        )}
      </div>

      {session && (
        <>
          {/* event logger */}
          <div style={box}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: C.muted }}>Log an event</div>
              <button style={btnGhost} onClick={completeSession}>Mark session complete</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select style={inputStyle} value={entry.characterId}
                onChange={(e) => setEntry({ ...entry, characterId: e.target.value })}>
                <option value="">— table / none —</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.kind === "npc" ? " (NPC)" : ""}</option>
                ))}
              </select>

              <select style={inputStyle} value={entry.typeKey} onChange={(e) => pickType(e.target.value)}>
                <option value="">Event type...</option>
                {CAT_ORDER.filter((cat) => typesByCat[cat]).map((cat) => (
                  <optgroup key={cat} label={CAT_LABEL[cat]}>
                    {typesByCat[cat].map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </optgroup>
                ))}
              </select>

              {/* defaults, editable */}
              <select style={{ ...inputStyle, maxWidth: 120 }} value={entry.axis}
                onChange={(e) => setEntry({ ...entry, axis: e.target.value })}>
                <option value="">axis —</option>
                {Object.keys(AXIS_NAME).map((a) => <option key={a} value={a}>{a} · {AXIS_NAME[a]}</option>)}
              </select>
              <select style={{ ...inputStyle, maxWidth: 90 }} value={entry.frame}
                onChange={(e) => setEntry({ ...entry, frame: e.target.value })}>
                <option value="">frame —</option><option value="ic">in-char</option><option value="ooc">out-of-char</option>
              </select>
              <select style={{ ...inputStyle, maxWidth: 110 }} value={entry.target}
                onChange={(e) => setEntry({ ...entry, target: e.target.value })}>
                <option value="">target —</option><option value="fiction">fiction</option><option value="player">player</option><option value="system">system</option>
              </select>

              <input style={{ ...inputStyle, flex: 1, minWidth: 180 }} placeholder="Note (optional)"
                value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") logEvent(); }} />
              <button style={btn} onClick={logEvent} disabled={busy || !entry.typeKey}>Log</button>
            </div>
          </div>

          {/* live tally */}
          <div style={box}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
              This session · {events.length} event{events.length === 1 ? "" : "s"} (spotlight preview)
            </div>
            {tally.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>No events yet.</p>}
            {tally.map((t) => (
              <div key={t.key} style={{ marginBottom: 9 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span>{t.name}</span>
                  <span className="mono" style={{ color: C.muted }}>{t.n} · {Math.round(t.share * 100)}%</span>
                </div>
                <div style={{ height: 5, background: C.line, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${t.share * 100}%`, height: "100%", background: C.accent }} />
                </div>
              </div>
            ))}
          </div>

          {/* event list */}
          <div style={box}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Logged events</div>
            {events.map((ev) => (
              <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.line}`, gap: 10 }}>
                <div style={{ fontSize: 13, minWidth: 0 }}>
                  {ev.axis && (
                    <span className="mono" style={{ color: AXIS_COLOR[ev.axis] || C.muted, border: `1px solid ${AXIS_COLOR[ev.axis] || C.muted}`, borderRadius: 5, padding: "1px 6px", fontSize: 11, marginRight: 8 }}>{ev.axis}</span>
                  )}
                  <span style={{ fontWeight: 600 }}>{charName(ev.character_id)}</span>
                  <span style={{ color: C.muted }}>{"  "}{typeLabel(ev.event_type)}</span>
                  {ev.payload?.note && <span style={{ color: C.muted, fontStyle: "italic" }}>{"  — "}{ev.payload.note}</span>}
                </div>
                <button onClick={() => deleteEvent(ev.id)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>delete</button>
              </div>
            ))}
            {events.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>Nothing logged yet. Pick an actor and an event type above.</p>}
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: C.ink, color: C.vellum, minHeight: "100vh", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <style>{`.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;}`}</style>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "32px 20px" }}>{children}</div>
    </div>
  );
}
