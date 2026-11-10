"use client";

// app/gm/tonight/page.tsx
//
// Game night on one page. Running a session used to mean visiting the Session Log (go live, close),
// Check-in (attendance), Capture (consent) and Record, each with its own pickers and no links between
// them, and afterwards Review, Speakers and the recap, also unlinked. This page walks the night top to
// bottom and reuses the same writes and routes those pages use, so nothing here is a second
// implementation that can drift:
//   attendance        upsert into attendance (as Check-in does)
//   consent           session_consent_ok RPC (as Capture does)
//   go live / start   POST /api/session/reopen, or the live-session insert the Session Log uses
//   quick log         insert into events with source "manual" (as the Session Log does)
//   end and process   POST /api/session/close { process: true } (the guarded close route)
// Each step links to the full page for anything beyond the common case.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "@/components/page-shell";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";
import { initialCampaignId, useRememberCampaign, useRememberSession, urlParam, gmHref } from "@/lib/campaign-context";
import { friendlyError } from "@/lib/friendly-error";
import { openTabletop, tabletopUrl } from "@/lib/tabletop/open";

type Campaign = { id: string; name: string; system: string | null; share_code: string | null; discord_channel_id: string | null };
type Sess = { id: string; session_number: number | null; status: string | null; scheduled_at: string | null; recap: string | null; started_at: string | null; ended_at: string | null; capture_modality: string | null };
type Pc = { id: string; name: string };
type Rsvp = { status: string; display_name: string | null; character_name: string | null };
type EventType = { key: string; label: string; category: string; default_axis: string | null; default_frame: string | null; default_target: string | null };
type Job = { id: string; status: string; source: string | null };

const ATT = [{ v: "present", l: "Present" }, { v: "late", l: "Late" }, { v: "absent", l: "Absent" }];

/** Tonight's session: live, else open, else the next scheduled one, else the last one played. */
function pickTonight(rows: Sess[]): Sess | undefined {
  const now = Date.now();
  const upcoming = rows
    .filter((r) => r.status === "scheduled")
    .sort((a, b) => {
      const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity;
      const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity;
      // Soonest still-ahead first; ones whose time has passed go after the future ones.
      const fa = ta >= now - 12 * 3600 * 1000 ? 0 : 1, fb = tb >= now - 12 * 3600 * 1000 ? 0 : 1;
      return fa - fb || ta - tb;
    });
  return rows.find((r) => r.status === "live") ?? rows.find((r) => r.status === "open") ?? upcoming[0] ?? rows.find((r) => r.status !== "scheduled") ?? rows[0];
}

export default function TonightPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [campaignId, setCampaignId] = useState("");
  useRememberCampaign(campaignId, campaigns ?? []);
  const [sessions, setSessions] = useState<Sess[]>([]);
  // Which campaign `sessions` (and pcs, combat) belong to. Until it matches campaignId nothing that
  // writes is rendered: otherwise "No session yet" and its Start buttons flash while a campaign loads
  // (a click there made a duplicate session), and after a campaign switch the old campaign's session
  // briefly sat beside the new campaign id, so attendance could be written against the wrong pair.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  useRememberSession(campaignId, sessionId);
  const [pcs, setPcs] = useState<Pc[]>([]);
  const [types, setTypes] = useState<EventType[]>([]);
  const [att, setAtt] = useState<Record<string, string>>({});
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [consentOk, setConsentOk] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pendingReview, setPendingReview] = useState<number | null>(null);
  const [roomTracks, setRoomTracks] = useState(0);
  const [activeCombat, setActiveCombat] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [entry, setEntry] = useState({ typeKey: "", characterId: "", note: "" });
  const [logged, setLogged] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setErr("Sign in to run your session."); setCampaigns([]); return; }
      const [{ data: camps }, { data: t }] = await Promise.all([
        supabase.from("campaigns").select("id, name, system, share_code, discord_channel_id").eq("gm_id", user.id).order("created_at", { ascending: false }),
        supabase.from("event_types").select("key,label,category,default_axis,default_frame,default_target"),
      ]);
      const list = (camps as Campaign[]) || [];
      setCampaigns(list);
      setTypes((t as EventType[]) || []);
      setCampaignId(initialCampaignId(list));
    })();
  }, [supabase]);

  // The campaign most recently asked for; a slower, older load that resolves late is dropped.
  const wantCampaign = useRef("");
  const loadCampaign = useCallback(async (cid: string, keep?: string) => {
    wantCampaign.current = cid;
    const [{ data: s }, { data: p }, { data: cb }] = await Promise.all([
      supabase.from("sessions").select("id, session_number, status, scheduled_at, recap, started_at, ended_at, capture_modality").eq("campaign_id", cid).order("session_number", { ascending: false }),
      supabase.from("characters").select("id, name").eq("campaign_id", cid).eq("kind", "pc").eq("active", true).is("alter_ego_of", null).order("name"),
      supabase.from("combats").select("id, name").eq("campaign_id", cid).eq("status", "active").order("updated_at", { ascending: false }).limit(1),
    ]);
    if (wantCampaign.current !== cid) return;
    const rows = (s as Sess[]) || [];
    setSessions(rows);
    setLoadedFor(cid);
    setPcs((p as Pc[]) || []);
    setActiveCombat(((cb as { id: string; name: string }[]) || [])[0] ?? null);
    const fromUrl = urlParam("session");
    const pick = (keep && rows.find((r) => r.id === keep)) || (fromUrl && rows.find((r) => r.id === fromUrl)) || pickTonight(rows);
    setSessionId(pick?.id ?? "");
  }, [supabase]);
  useEffect(() => { if (campaignId) void loadCampaign(campaignId); }, [campaignId, loadCampaign]);

  const ready = !!campaignId && loadedFor === campaignId;
  const session = ready ? sessions.find((s) => s.id === sessionId) ?? null : null;

  const loadSession = useCallback(async (sid: string) => {
    const [{ data: a }, { data: r }, { data: ok }, { data: j }] = await Promise.all([
      supabase.from("attendance").select("character_id, status").eq("session_id", sid),
      supabase.rpc("rsvps_for_gm", { p_session_id: sid }),
      supabase.rpc("session_consent_ok", { p_session: sid }),
      supabase.from("capture_jobs").select("id, status, source").eq("session_id", sid).order("created_at", { ascending: false }),
    ]);
    const map: Record<string, string> = {};
    ((a as { character_id: string | null; status: string }[]) || []).forEach((x) => { if (x.character_id) map[x.character_id] = x.status; });
    setAtt(map);
    setRsvps((r as Rsvp[]) || []);
    setConsentOk(typeof ok === "boolean" ? ok : null);
    const jl = (j as Job[]) || [];
    setJobs(jl);
    if (jl.length) {
      const ids = jl.map((x) => x.id);
      const [pe, ge, rt] = await Promise.all([
        supabase.from("proposed_events").select("id", { count: "exact", head: true }).in("job_id", ids).eq("status", "proposed"),
        supabase.from("gm_proposed_events").select("id", { count: "exact", head: true }).in("job_id", ids).eq("status", "proposed"),
        supabase.from("audio_tracks").select("id", { count: "exact", head: true }).in("job_id", ids).eq("kind", "room"),
      ]);
      setPendingReview((pe.count ?? 0) + (ge.count ?? 0));
      setRoomTracks(rt.count ?? 0);
    } else { setPendingReview(null); setRoomTracks(0); }
  }, [supabase]);
  useEffect(() => { if (sessionId) void loadSession(sessionId); }, [sessionId, loadSession]);

  // ---- actions ----
  async function mark(charId: string, status: string) {
    if (!session) return;
    const before = att[charId];
    setAtt((prev) => ({ ...prev, [charId]: status }));
    const { error } = await supabase.from("attendance").upsert(
      { campaign_id: campaignId, session_id: session.id, character_id: charId, status },
      { onConflict: "session_id,character_id" },
    );
    if (error) {
      setAtt((prev) => { const n = { ...prev }; if (before) n[charId] = before; else delete n[charId]; return n; });
      setErr(`Attendance not saved: ${error.message}`);
    }
  }
  async function markAllPresent() {
    if (!session || !pcs.length) return;
    setAtt(Object.fromEntries(pcs.map((p) => [p.id, "present"])));
    const { error } = await supabase.from("attendance").upsert(
      pcs.map((p) => ({ campaign_id: campaignId, session_id: session.id, character_id: p.id, status: "present" })),
      { onConflict: "session_id,character_id" },
    );
    if (error) setErr(`Attendance not saved: ${error.message}`);
  }

  async function goLive() {
    if (!session) return;
    setBusy(true); setErr(null); setMsg(null);
    const res = await fetch("/api/session/reopen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id }) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(out?.error || "Could not go live."); return; }
    setMsg("Session is live. Table rolls land here, and party chat stays open for the players.");
    void loadCampaign(campaignId, session.id);
  }

  async function startNew(modality: "in_person" | "online") {
    if (!campaignId) return;
    setBusy(true); setErr(null); setMsg(null);
    const nextNum = (sessions.reduce((m, s) => Math.max(m, s.session_number ?? 0), 0)) + 1;
    // The same live-session insert the Session Log's "new session" uses: status live, started now.
    const { data, error } = await supabase.from("sessions").insert({
      campaign_id: campaignId, session_number: nextNum, status: "live",
      capture_modality: modality, consent_recorded: false, started_at: new Date().toISOString(),
    }).select("id").single();
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    setMsg(`Session ${nextNum} is live.`);
    void loadCampaign(campaignId, (data as { id: string }).id);
  }

  async function logEvent() {
    if (!session || !entry.typeKey) return;
    const t = types.find((x) => x.key === entry.typeKey);
    setBusy(true); setErr(null);
    const { error } = await supabase.from("events").insert({
      campaign_id: campaignId, session_id: session.id, character_id: entry.characterId || null, actor_profile_id: null,
      event_type: entry.typeKey, axis: t?.default_axis || null, frame: t?.default_frame || null, target: t?.default_target || null,
      source: "manual", payload: entry.note.trim() ? { note: entry.note.trim() } : null,
    });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    setEntry((e) => ({ ...e, note: "" }));
    setLogged((n) => n + 1);
  }

  async function endAndProcess() {
    if (!session) return;
    if (!window.confirm("End this session and open player check-in? Players can then rate the session, and the recap pipeline starts. You can reopen it later from the Session Log.")) return;
    setBusy(true); setErr(null); setMsg(null);
    const res = await fetch("/api/session/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id, force: false, process: true }) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 409 && out?.recording) {
      setErr(out?.captureAlive
        ? "Six Axes is still finishing the recording and saving the audio. Give it a minute, then try again. On a long session this can take a couple of minutes."
        : "A Discord recording is still open for this session. Run /stop in Discord first. If the bot crashed, close the session from the Session Log, which can force it.");
      return;
    }
    if (!res.ok) { setErr(out?.error || "Could not end the session."); return; }
    setMsg("Session ended. Transcription and extraction start on their own; this page shows what is waiting below.");
    void loadCampaign(campaignId, session.id);
  }

  // ---- derived ----
  const campaign = (campaigns ?? []).find((c) => c.id === campaignId);
  const isOpen = !!session && (session.status === "live" || session.status === "open");
  const isOver = !!session && !!session.ended_at && !isOpen;
  const presentCount = pcs.filter((p) => att[p.id] === "present" || att[p.id] === "late").length;
  const going = rsvps.filter((r) => r.status === "going").length;
  const hasFuture = sessions.some((s) => s.status === "scheduled" && s.scheduled_at && new Date(s.scheduled_at).getTime() > Date.now() && s.id !== session?.id);
  // capture_jobs.status runs draft (recording open) -> transcribing -> extracting -> done, or error.
  const transcribing = jobs.some((j) => j.status === "transcribing" || j.status === "extracting");
  const recordingOpen = jobs.some((j) => j.status === "draft");
  const jobError = jobs.some((j) => j.status === "error");
  const typeGroups = useMemo(() => {
    const m: Record<string, EventType[]> = {};
    for (const t of types) (m[t.category] ||= []).push(t);
    return m;
  }, [types]);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null);

  // ---- styles ----
  const card = (on = false): React.CSSProperties => ({ background: C.panel, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: FORGE_RADIUS, padding: "14px 16px", marginBottom: 14 });
  const input: React.CSSProperties = { background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "7px 9px", fontSize: 13.5 };
  const btn = (primary = false): React.CSSProperties => ({ background: primary ? C.brass : "transparent", color: primary ? C.ink : C.text, border: primary ? "none" : `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, fontFamily: SAX.mono, cursor: "pointer", textDecoration: "none", display: "inline-block" });
  const h2 = (n: number, t: string, done?: boolean) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <span style={{ width: 24, height: 24, borderRadius: FORGE_RADIUS, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, background: done ? C.good : "transparent", color: done ? C.ink : C.muted, border: done ? "none" : `1.5px solid ${C.line}` }}>{done ? "✓" : n}</span>
      <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{t}</span>
    </div>
  );
  const link = (href: string, text: string) => <a href={href} style={{ color: C.sun }}>{text}</a>;
  const q = { campaign: campaignId, session: sessionId };

  return (
    <PageShell width={860}>
      <h1 style={{ fontFamily: SAX.serif, fontSize: 30, margin: "4px 0 2px", color: C.text }}>Tonight</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 14px", lineHeight: 1.6 }}>
        Game night from start to finish: who is here, consent, start recording, log as you play, wrap up, and what is waiting afterwards.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={input} aria-label="Campaign">
          {campaigns === null && <option value="">Loading…</option>}
          {campaigns !== null && campaigns.length === 0 && <option value="">No campaigns yet</option>}
          {(campaigns ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={ready ? sessionId : ""} onChange={(e) => setSessionId(e.target.value)} style={input} aria-label="Session" disabled={!ready}>
          {!ready && <option value="">Loading…</option>}
          {ready && sessions.length === 0 && <option value="">No sessions yet</option>}
          {ready && sessions.map((s) => <option key={s.id} value={s.id}>Session {s.session_number ?? "?"} ({s.status}{s.scheduled_at && s.status === "scheduled" ? `, ${when(s.scheduled_at)}` : ""})</option>)}
        </select>
      </div>

      {err && <p role="alert" style={{ color: C.warn, fontSize: 13.5, margin: "0 0 12px" }}>{err}</p>}
      {msg && <p role="status" style={{ color: C.good, fontSize: 13.5, margin: "0 0 12px" }}>{msg}</p>}

      {campaigns !== null && campaigns.length === 0 && (
        <p style={{ color: C.muted, fontSize: 14 }}>No campaigns yet. Create one in the {link("/gm", "Workspace")} first.</p>
      )}

      {campaignId && !ready && <p style={{ color: C.muted, fontSize: 14 }}>Loading tonight…</p>}

      {ready && !session && (
        <div style={card(true)}>
          {h2(1, "No session yet")}
          <p style={{ color: C.muted, fontSize: 13.5, margin: "0 0 10px" }}>Start one now, live, and the rest of this page fills in.</p>
          <button type="button" style={btn(true)} disabled={busy} onClick={() => void startNew("in_person")}>Start session, in person</button>{" "}
          <button type="button" style={btn()} disabled={busy} onClick={() => void startNew("online")}>Start session, online</button>
        </div>
      )}

      {session && (
        <>
          <div style={card(!isOpen && !isOver)}>
            {h2(1, "Who is here", pcs.length > 0 && presentCount === pcs.length)}
            {rsvps.length > 0 && (
              <p style={{ color: C.muted, fontSize: 13, margin: "0 0 8px" }}>
                RSVPs: {going} going · {rsvps.filter((r) => r.status === "maybe").length} maybe · {rsvps.filter((r) => r.status === "declined").length} out
              </p>
            )}
            {pcs.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13.5, margin: 0 }}>No player characters yet. Add them in the {link(gmHref("/gm", { campaign: campaignId }), "Workspace")}.</p>
            ) : (
              <>
                <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  {pcs.map((p) => (
                    <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ color: C.text, fontSize: 14, minWidth: 150 }}>{p.name}</span>
                      {ATT.map((a) => {
                        const on = att[p.id] === a.v;
                        const tone = a.v === "absent" ? C.warn : a.v === "present" ? C.good : C.plum;
                        return <button key={a.v} type="button" onClick={() => void mark(p.id, a.v)} aria-pressed={on}
                          style={{ ...btn(), padding: "3px 10px", fontSize: 12, color: on ? C.ink : tone, background: on ? tone : "transparent", borderColor: tone }}>{a.l}</button>;
                      })}
                    </div>
                  ))}
                </div>
                <button type="button" style={btn()} onClick={() => void markAllPresent()}>Mark everyone present</button>
                <span style={{ color: C.muted, fontSize: 12.5, marginLeft: 10 }}>{presentCount} of {pcs.length} here</span>
              </>
            )}
          </div>

          <div style={card()}>
            {h2(2, "Recording consent", consentOk === true)}
            <p style={{ color: C.muted, fontSize: 13.5, margin: 0, lineHeight: 1.55 }}>
              {consentOk === true && "Consent is on file for everyone in this session, so recordings can be processed."}
              {consentOk === false && <>Consent is not complete for this session, so nothing will be transcribed yet. Check who is opted out on {link(gmHref("/gm/capture", q), "Capture")}.</>}
              {consentOk === null && <>Consent status is not available. See {link(gmHref("/gm/capture", q), "Capture")}.</>}
              {" "}Recording in person? You confirm the room agrees on the Record page before it starts.
            </p>
          </div>

          <div style={card(!isOpen && !isOver)}>
            {h2(3, "Start", isOpen || isOver)}
            {isOpen ? (
              <p style={{ color: C.good, fontSize: 13.5, margin: "0 0 10px" }}>Session {session.session_number} is {session.status}.</p>
            ) : isOver ? (
              <p style={{ color: C.muted, fontSize: 13.5, margin: "0 0 10px" }}>This session has ended. Reopen it from the {link(gmHref("/gm/sessions", q), "Session Log")} to record more into it.</p>
            ) : (
              <p style={{ margin: "0 0 10px" }}>
                <button type="button" style={btn(true)} disabled={busy} onClick={() => void goLive()}>Go live with session {session.session_number}</button>
                <span style={{ color: C.muted, fontSize: 12.5, marginLeft: 10 }}>Opens it so table rolls land here and party chat opens.</span>
              </p>
            )}
            {!isOver && (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ color: C.text, fontSize: 13.5 }}>
                  <strong>Online:</strong> everyone joins voice, then run <code style={{ fontFamily: SAX.mono }}>/record</code> in Discord, and <code style={{ fontFamily: SAX.mono }}>/stop</code> when you wrap.
                  {!campaign?.discord_channel_id && <> Discord is not set up for this campaign yet ({link("/gm/help", "setup steps")}).</>}
                </div>
                <div style={{ color: C.text, fontSize: 13.5 }}>
                  <strong>In person:</strong> <a href={gmHref("/gm/record", q)} style={btn()}>Record the room</a>
                  <span style={{ color: C.muted, fontSize: 12.5, marginLeft: 8 }}>one laptop or tablet in the middle of the table</span>
                </div>
              </div>
            )}
          </div>

          <div style={card(isOpen)}>
            {h2(4, "During play")}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {activeCombat
                ? <a href={gmHref("/gm/combat", { campaign: campaignId, combat: activeCombat.id })} style={btn(true)}>Back to the fight: {activeCombat.name}</a>
                : <a href={gmHref("/gm/encounters", { campaign: campaignId })} style={btn()}>Start a fight</a>}
              <a href={gmHref("/gm/compendium", {})} style={btn()}>Compendium</a>
              <a href={tabletopUrl(campaignId)} onClick={(e) => { e.preventDefault(); openTabletop(campaignId); }} style={btn()} title="The shared table in its own window, for a second screen">Open the tabletop</a>
              <a href="/gm/screen" style={btn()}>GM screen</a>
              <a href={gmHref("/gm/roll", { campaign: campaignId })} style={btn()}>Roll</a>
              <a href={gmHref("/gm/prep", { campaign: campaignId })} style={btn()}>Prep sheet</a>
            </div>
            <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 6 }}>Quick log: something happened worth remembering</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <select value={entry.typeKey} onChange={(e) => setEntry({ ...entry, typeKey: e.target.value })} style={input} aria-label="Event type">
                <option value="">What happened…</option>
                {Object.entries(typeGroups).map(([cat, list]) => (
                  <optgroup key={cat} label={cat}>{list.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>
                ))}
              </select>
              <select value={entry.characterId} onChange={(e) => setEntry({ ...entry, characterId: e.target.value })} style={input} aria-label="Who">
                <option value="">Who (optional)</option>
                {pcs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} placeholder="Note (optional)" style={{ ...input, flex: "1 1 180px" }}
                onKeyDown={(e) => { if (e.key === "Enter" && entry.typeKey) void logEvent(); }} />
              <button type="button" style={btn()} disabled={busy || !entry.typeKey} onClick={() => void logEvent()}>Log it</button>
            </div>
            {logged > 0 && <p style={{ color: C.muted, fontSize: 12.5, margin: "6px 0 0" }}>{logged} logged tonight. Edit or remove them on the {link(gmHref("/gm/sessions", q), "Session Log")}.</p>}
          </div>

          <div style={card(isOpen)}>
            {h2(5, "Wrap up", isOver)}
            {isOver ? (
              <p style={{ color: C.muted, fontSize: 13.5, margin: 0 }}>Ended {when(session.ended_at)}.</p>
            ) : isOpen ? (
              <>
                <p style={{ color: C.muted, fontSize: 13.5, margin: "0 0 10px" }}>Online: run <code style={{ fontFamily: SAX.mono }}>/stop</code> first. In person: press Stop and Upload on the Record page first.</p>
                <button type="button" style={btn(true)} disabled={busy} onClick={() => void endAndProcess()}>End and process</button>
              </>
            ) : (
              <p style={{ color: C.muted, fontSize: 13.5, margin: 0 }}>Go live first; End and process appears here once the session is underway.</p>
            )}
          </div>

          <div style={card(isOver)}>
            {h2(6, "After the session", isOver && pendingReview === 0 && !!session.recap && hasFuture)}
            <div style={{ display: "grid", gap: 8, fontSize: 13.5, color: C.text }}>
              <div>
                {jobs.length === 0 ? <span style={{ color: C.muted }}>No recording for this session yet.</span>
                  : jobError ? <span style={{ color: C.warn }}>A recording hit an error while processing. See {link(gmHref("/gm/capture", q), "Capture")} to retry it.</span>
                  : recordingOpen && !transcribing ? <>A recording is still open. It starts processing when you stop it and end the session.</>
                  : transcribing ? <>Transcribing and extracting. Proposed events appear in {link(gmHref("/gm/review", q), "Review")} when it finishes.</>
                  : pendingReview && pendingReview > 0 ? <><strong>{pendingReview}</strong> proposal{pendingReview === 1 ? "" : "s"} waiting in {link(gmHref("/gm/review", q), "Review")}. The recap writes itself once every one is decided.</>
                  : <>Review is clear for this session.</>}
              </div>
              {roomTracks > 0 && <div>In-person recording: map who was speaking on {link(gmHref("/gm/speakers", q), "Speakers")}, then review.</div>}
              <div>{session.recap ? <>Recap is drafted. Edit, email or post it on the {link(gmHref("/gm/sessions", q), "Session Log")}.</> : <span style={{ color: C.muted }}>No recap yet. It drafts after review, or write one on the {link(gmHref("/gm/sessions", q), "Session Log")}.</span>}</div>
              <div>{hasFuture ? <>The next session is scheduled.</> : <span style={{ color: C.muted }}>Nothing scheduled next. Set a time on the {link(gmHref("/gm/sessions", q), "Session Log")} so players can RSVP.</span>}</div>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
