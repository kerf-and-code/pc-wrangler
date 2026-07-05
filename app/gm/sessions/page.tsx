"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";

const C = {
  ink: SAX.inkDeep, panel: SAX.slateBg, line: SAX.line, vellum: SAX.text,
  muted: SAX.muted, brass: SAX.brass, brassDim: SAX.brassDim, accent: SAX.plum, warn: SAX.warn,
};
const AXIS_COLOR: Record<string, string> = { N: "#B7615A", T: "#C8A24B", O: "#4E8077", S: "#CE8A42", E: "#6C76B0", I: "#9A93B0" };
const AXIS_NAME: Record<string, string> = { N: "Voice", T: "Tactics", O: "Arcana", S: "Rapport", E: "Exploration", I: "Nerve" };

const box = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, marginBottom: 16 };
const inputStyle = { background: C.ink, color: C.vellum, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 11px", fontSize: 14 };
const btn = { background: C.brass, color: C.ink, border: "none", borderRadius: 9, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { background: "none", color: C.brass, border: `1px solid ${C.brassDim}`, borderRadius: 9, padding: "9px 16px", fontSize: 13, cursor: "pointer" };
const CAT_ORDER = ["opportunity", "response", "reward", "meta"];
const CAT_LABEL: Record<string, string> = { opportunity: "Opportunities", response: "Responses", reward: "Rewards", meta: "Notes" };
// Test default for the recipients field; clear or change per campaign.
const DEFAULT_RECIPIENTS = "terry.mickail@gmail.com";

// Convert a stored ISO timestamp to a value for <input type="datetime-local"> in local time.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

type ActivePoll = { id: string; slots: string[]; recurring: boolean; status: string };
type PollResp = { character_id: string | null; discord_user_id: string | null; available: number[] };
type RecurRule = { interval?: string; anchor?: string } | null;

export default function SessionWorkspace() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // recap (Phase 1 hero)
  const [recap, setRecap] = useState("");
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapSaving, setRecapSaving] = useState(false);
  const [recapMsg, setRecapMsg] = useState<string | null>(null);
  const [recipients, setRecipients] = useState("");
  const [recapSending, setRecapSending] = useState(false);
  const [schedDraft, setSchedDraft] = useState("");
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedMsg, setSchedMsg] = useState<string | null>(null);
  const [pollSlots, setPollSlots] = useState<string[]>([""]);
  const [pollRecurring, setPollRecurring] = useState(false);
  const [pollBusy, setPollBusy] = useState(false);
  const [pollMsg, setPollMsg] = useState<string | null>(null);
  const [activePoll, setActivePoll] = useState<ActivePoll | null>(null);
  const [pollResp, setPollResp] = useState<PollResp[]>([]);
  const [pollNames, setPollNames] = useState<Record<string, string>>({});
  const [recurRule, setRecurRule] = useState<RecurRule>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [rsvps, setRsvps] = useState<{ status: string; display_name: string | null; character_name: string | null }[]>([]);

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [eventTypes, setEventTypes] = useState<any[]>([]);
  const [campaign, setCampaign] = useState<string | null>(null);
  const [characters, setCharacters] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [session, setSession] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [arcs, setArcs] = useState<any[]>([]);
  const [loot, setLoot] = useState<any[]>([]);

  // forms
  const [newSession, setNewSession] = useState({ modality: "in_person", consent: false, notes: "" });
  const [entry, setEntry] = useState({ characterId: "", typeKey: "", axis: "", frame: "", target: "", note: "" });
  const [newLoot, setNewLoot] = useState({ characterId: "", item: "", rarity: "", value: "" });
  const [newArc, setNewArc] = useState({ title: "", characterId: "" });

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
    const [{ data: chars }, { data: sess }, { data: arcRows }] = await Promise.all([
      supabase.from("characters").select("id,name,class,subclass,kind,active")
        .eq("campaign_id", campaignId).eq("active", true).order("kind").order("name"),
      supabase.from("sessions").select("id,session_number,status,capture_modality,consent_recorded,notes,recap,scheduled_at,created_at")
        .eq("campaign_id", campaignId).order("session_number", { ascending: false, nullsFirst: false }),
      supabase.from("arcs").select("id,title,status,character_id,last_touched_session_id")
        .eq("campaign_id", campaignId).order("created_at", { ascending: true }),
    ]);
    setCharacters(chars || []);
    setSessions(sess || []);
    setArcs(arcRows || []);
  }, [supabase]);

  useEffect(() => { if (campaign) loadCampaignData(campaign); }, [campaign, loadCampaignData]);

  useEffect(() => {
    if (!campaign) { setActivePoll(null); setPollResp([]); setRecurRule(null); return; }
    (async () => {
      const rule = await loadPoll(campaign);
      await ensureRecurrence(campaign, rule);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign]);

  const loadEvents = useCallback(async (sessionId: string) => {
    const [{ data: evs }, { data: lootRows }] = await Promise.all([
      supabase.from("events")
        .select("id,character_id,event_type,axis,frame,target,payload,created_at")
        .eq("session_id", sessionId).order("created_at", { ascending: false }),
      supabase.from("loot_grants").select("id,character_id,item_name,rarity,est_value")
        .eq("session_id", sessionId).order("created_at", { ascending: false }),
    ]);
    setEvents(evs || []);
    setLoot(lootRows || []);
  }, [supabase]);

  useEffect(() => { if (session) loadEvents(session); else setEvents([]); }, [session, loadEvents]);

  // keep the recap textarea in sync with the selected session
  useEffect(() => {
    const s = sessions.find((x) => x.id === session);
    setRecap(s?.recap || "");
    setSchedDraft(s?.scheduled_at ? toLocalInput(s.scheduled_at) : "");
    setRecapMsg(null);
    setSchedMsg(null);
  }, [session, sessions]);

  // load saved recipient list for the selected campaign
  useEffect(() => {
    if (!campaign) return;
    try {
      const saved = window.localStorage.getItem(`six_axes_recap_recipients_${campaign}`);
      setRecipients(saved || DEFAULT_RECIPIENTS);
    } catch { setRecipients(DEFAULT_RECIPIENTS); }
  }, [campaign]);

  // load who has RSVP'd for the selected session
  useEffect(() => {
    if (!session) { setRsvps([]); return; }
    let active = true;
    (async () => {
      const { data } = await supabase.rpc("rsvps_for_gm", { p_session_id: session });
      if (active) setRsvps((data as any[]) || []);
    })();
    return () => { active = false; };
  }, [session, supabase]);

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

  async function generateRecap() {
    if (!session || recapLoading) return;
    setRecapLoading(true); setRecapMsg(null); setErr(null);
    try {
      const res = await fetch("/api/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session }),
      });
      const data = await res.json();
      if (!res.ok) setRecapMsg(data.error || "Could not generate recap.");
      else { setRecap(data.recap || ""); setRecapMsg("Draft generated. Edit, then Save."); }
    } catch {
      setRecapMsg("Could not generate recap. Try again.");
    }
    setRecapLoading(false);
  }

  async function saveRecap() {
    if (!session || recapSaving) return;
    setRecapSaving(true); setRecapMsg(null);
    const { error } = await supabase.from("sessions")
      .update({ recap: recap.trim() || null }).eq("id", session);
    if (error) setRecapMsg(error.message);
    else {
      setSessions((arr) => arr.map((s) => (s.id === session ? { ...s, recap: recap.trim() || null } : s)));
      setRecapMsg("Saved.");
    }
    setRecapSaving(false);
  }

  async function copyRecap() {
    try { await navigator.clipboard.writeText(recap); setRecapMsg("Copied to clipboard."); }
    catch { setRecapMsg("Copy failed; select the text and copy manually."); }
  }

  async function sendRecap() {
    if (!session || recapSending) return;
    setRecapSending(true); setRecapMsg(null);
    // save the current text first so we send exactly what is shown
    const { error: saveErr } = await supabase.from("sessions")
      .update({ recap: recap.trim() || null }).eq("id", session);
    if (saveErr) { setRecapMsg(saveErr.message); setRecapSending(false); return; }
    setSessions((arr) => arr.map((s) => (s.id === session ? { ...s, recap: recap.trim() || null } : s)));

    const emails = recipients.split(",").map((e) => e.trim()).filter(Boolean);
    try {
      const res = await fetch("/api/recap/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session, emails }),
      });
      const data = await res.json();
      if (!res.ok) setRecapMsg(data.error || "Could not send recap.");
      else {
        try { window.localStorage.setItem(`six_axes_recap_recipients_${campaign}`, recipients.trim()); } catch {}
        const failedNote = data.failed?.length ? ` (${data.failed.length} failed)` : "";
        setRecapMsg(`Sent to ${data.sent} recipient${data.sent === 1 ? "" : "s"}${failedNote}.`);
      }
    } catch {
      setRecapMsg("Could not send recap. Try again.");
    }
    setRecapSending(false);
  }

  async function saveSchedule() {
    if (!session || schedSaving) return;
    setSchedSaving(true); setSchedMsg(null);
    const iso = schedDraft ? new Date(schedDraft).toISOString() : null;
    const { error } = await supabase.from("sessions").update({ scheduled_at: iso }).eq("id", session);
    if (error) setSchedMsg(error.message);
    else {
      setSessions((arr) => arr.map((s) => (s.id === session ? { ...s, scheduled_at: iso } : s)));
      setSchedMsg(iso ? "Time saved." : "Time cleared.");
    }
    setSchedSaving(false);
  }

  async function postPoll() {
    if (!campaign || pollBusy) return;
    const slots = pollSlots.filter((s) => s).map((s) => new Date(s).toISOString());
    if (slots.length === 0) { setPollMsg("Add at least one time slot."); return; }
    setPollBusy(true); setPollMsg(null);
    try {
      const res = await fetch("/api/schedule/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign, slots, recurring: pollRecurring }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok) { setPollMsg("Poll posted to Discord. Players can respond there."); setPollSlots([""]); setPollRecurring(false); }
      else setPollMsg(out.error || "Could not post the poll.");
    } catch {
      setPollMsg("Could not post the poll.");
    }
    setPollBusy(false);
  }

  async function loadPoll(cid: string): Promise<RecurRule> {
    const [{ data: polls }, { data: chs }, { data: camp }] = await Promise.all([
      supabase.from("session_polls").select("id, slots, recurring, status").eq("campaign_id", cid).eq("status", "open").order("created_at", { ascending: false }).limit(1),
      supabase.from("characters").select("id, name").eq("campaign_id", cid),
      supabase.from("campaigns").select("recur_rule").eq("id", cid).maybeSingle(),
    ]);
    const nm: Record<string, string> = {};
    ((chs as { id: string; name: string }[]) || []).forEach((c) => { nm[c.id] = c.name; });
    setPollNames(nm);
    const rule = ((camp as { recur_rule: RecurRule } | null)?.recur_rule) ?? null;
    setRecurRule(rule);
    const poll = ((polls as ActivePoll[]) || [])[0] || null;
    setActivePoll(poll);
    if (poll) {
      const { data: resp } = await supabase.from("poll_responses").select("character_id, discord_user_id, available").eq("poll_id", poll.id);
      setPollResp((resp as PollResp[]) || []);
    } else {
      setPollResp([]);
    }
    return rule;
  }

  // Rolling weekly recurrence: if a rule is set and nothing is scheduled ahead,
  // create the next occurrence. Guarded, so it only fills a gap, never stacks.
  async function ensureRecurrence(cid: string, rule: RecurRule) {
    if (!rule?.anchor) return;
    const anchor = new Date(rule.anchor).getTime();
    if (!Number.isFinite(anchor)) return;
    const { data: rows } = await supabase.from("sessions").select("id, session_number, scheduled_at").eq("campaign_id", cid);
    const list = (rows as { id: string; session_number: number | null; scheduled_at: string | null }[]) || [];
    const hasFuture = list.some((s) => s.scheduled_at && new Date(s.scheduled_at).getTime() > Date.now());
    if (hasFuture) return;
    let t = anchor;
    const week = 7 * 24 * 3600 * 1000;
    while (t <= Date.now()) t += week;
    const nextNum = list.reduce((m, s) => Math.max(m, s.session_number || 0), 0) + 1;
    const { data } = await supabase.from("sessions")
      .insert({ campaign_id: cid, session_number: nextNum, status: "scheduled", scheduled_at: new Date(t).toISOString() })
      .select("id,session_number,status,capture_modality,consent_recorded,notes,recap,scheduled_at,created_at").single();
    if (data) setSessions((s) => [data, ...s]);
  }

  async function confirmSlot(i: number) {
    if (!activePoll || confirmBusy) return;
    setConfirmBusy(true); setConfirmMsg(null);
    try {
      const res = await fetch("/api/schedule/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pollId: activePoll.id, slotIdx: i }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok) {
        setConfirmMsg("Locked in. The next session is scheduled.");
        setActivePoll(null); setPollResp([]);
        if (campaign) loadCampaignData(campaign);
      } else {
        setConfirmMsg(out.error || "Could not confirm.");
      }
    } catch {
      setConfirmMsg("Could not confirm.");
    }
    setConfirmBusy(false);
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

  async function addLoot() {
    if (!session || !campaign || !newLoot.item.trim() || busy) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("loot_grants").insert({
      campaign_id: campaign, session_id: session,
      character_id: newLoot.characterId || null,
      item_name: newLoot.item.trim(),
      rarity: newLoot.rarity.trim() || null,
      est_value: newLoot.value ? Number(newLoot.value) : null,
    });
    if (error) setErr(error.message);
    else { setNewLoot({ characterId: "", item: "", rarity: "", value: "" }); if (session) await loadEvents(session); }
    setBusy(false);
  }

  async function removeLoot(id: string) {
    const { error } = await supabase.from("loot_grants").delete().eq("id", id);
    if (error) setErr(error.message); else if (session) loadEvents(session);
  }

  async function addArc() {
    if (!campaign || !newArc.title.trim() || busy) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("arcs").insert({
      campaign_id: campaign, title: newArc.title.trim(),
      character_id: newArc.characterId || null, status: "open",
      opened_session_id: session || null,
    });
    if (error) setErr(error.message);
    else { setNewArc({ title: "", characterId: "" }); if (campaign) await loadCampaignData(campaign); }
    setBusy(false);
  }

  async function touchArc(arcId: string) {
    if (!session || !campaign) return;
    setErr(null);
    const { error } = await supabase.from("arc_touches").insert({
      campaign_id: campaign, arc_id: arcId, session_id: session,
    });
    if (error) setErr(error.message); else if (campaign) await loadCampaignData(campaign);
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
          {/* recap (Phase 1 hero) */}
          <div style={box}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: C.muted }}>Session recap</div>
              <button style={btnGhost} onClick={generateRecap} disabled={recapLoading}>
                {recapLoading ? "Generating..." : recap ? "Regenerate" : "Generate recap"}
              </button>
            </div>
            <textarea
              value={recap}
              onChange={(e) => setRecap(e.target.value)}
              placeholder="Generate a recap from this session's notes and logged events, or write your own. This is the 'previously on...' your players see."
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", minHeight: 160, lineHeight: 1.6, resize: "vertical", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button style={btn} onClick={saveRecap} disabled={recapSaving || !recap.trim()}>
                {recapSaving ? "Saving..." : "Save recap"}
              </button>
              <button style={btnGhost} onClick={copyRecap} disabled={!recap.trim()}>Copy</button>
              {recapMsg && <span style={{ fontSize: 12, color: C.muted }}>{recapMsg}</span>}
            </div>
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
                Email this recap to players (comma-separated). Saves and sends the current text.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  style={{ ...inputStyle, flex: 1, minWidth: 220 }}
                  placeholder="player1@example.com, player2@example.com"
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                />
                <button style={btn} onClick={sendRecap} disabled={recapSending || !recap.trim() || !recipients.trim()}>
                  {recapSending ? "Sending..." : "Send to players"}
                </button>
              </div>
            </div>
          </div>

          {/* propose times (poll) */}
          <div style={box}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>Propose times {"\u00b7"} poll your table on Discord</div>
            <div style={{ display: "grid", gap: 8 }}>
              {pollSlots.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="datetime-local" value={s}
                    onChange={(e) => setPollSlots((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                    style={{ ...inputStyle, colorScheme: "dark" }} />
                  {pollSlots.length > 1 && (
                    <button style={btnGhost} onClick={() => setPollSlots((arr) => arr.filter((_, j) => j !== i))}>Remove</button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              {pollSlots.length < 5 && (
                <button style={btnGhost} onClick={() => setPollSlots((arr) => [...arr, ""])}>Add a slot</button>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.muted, cursor: "pointer" }}>
                <input type="checkbox" checked={pollRecurring} onChange={(e) => setPollRecurring(e.target.checked)} />
                Make recurring (weekly)
              </label>
              <button style={btn} onClick={postPoll} disabled={pollBusy}>
                {pollBusy ? "Posting\u2026" : "Post poll to Discord"}
              </button>
              {pollMsg && <span style={{ fontSize: 12, color: C.muted }}>{pollMsg}</span>}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
              Players tap the times they can make in Discord; their availability shows below.
            </div>
          </div>

          {activePoll && (
            <div style={box}>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
                Availability {"\u00b7"} pick a time to lock it in{activePoll.recurring ? " (recurring weekly)" : ""}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {activePoll.slots.map((iso, i) => {
                  const yes = pollResp.filter((r) => (r.available || []).includes(i));
                  const names = yes.map((r) => (r.character_id && pollNames[r.character_id]) || "a player");
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 11px", background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, color: C.vellum }}>{new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{yes.length} available{names.length ? `: ${names.join(", ")}` : ""}</div>
                      </div>
                      <button style={btn} onClick={() => confirmSlot(i)} disabled={confirmBusy}>Confirm</button>
                    </div>
                  );
                })}
              </div>
              {confirmMsg && <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>{confirmMsg}</div>}
            </div>
          )}

          {/* schedule */}
          <div style={box}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>Next session time</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="datetime-local"
                value={schedDraft}
                onChange={(e) => setSchedDraft(e.target.value)}
                style={{ ...inputStyle, colorScheme: "dark" }}
              />
              <button style={btn} onClick={saveSchedule} disabled={schedSaving}>
                {schedSaving ? "Saving..." : "Save time"}
              </button>
              {schedDraft && <button style={btnGhost} onClick={() => setSchedDraft("")}>Clear</button>}
              {schedMsg && <span style={{ fontSize: 12, color: C.muted }}>{schedMsg}</span>}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
              Players RSVP to this at the share link. A reminder emails those who said yes the day before.
            </div>
            {rsvps.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
                  Who's coming: {rsvps.filter((r) => r.status === "going").length} in
                  {" \u00b7 "}{rsvps.filter((r) => r.status === "maybe").length} maybe
                  {" \u00b7 "}{rsvps.filter((r) => r.status === "declined").length} out
                </div>
                <div style={{ display: "grid", gap: 5 }}>
                  {rsvps.map((r, i) => (
                    <div key={i} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 8, flexShrink: 0,
                        background: r.status === "going" ? SAX.good : r.status === "maybe" ? C.brass : C.warn }} />
                      <span style={{ color: C.vellum }}>{r.display_name || "A player"}{r.character_name ? ` (${r.character_name})` : ""}</span>
                      <span style={{ color: C.muted, fontSize: 11 }}>{r.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* event logger */}
          <div style={box}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: C.muted }}>Log an event</div>
              <button style={btnGhost} onClick={completeSession}>Mark session complete</button>
            </div>
            <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, margin: "0 0 12px" }}>
              The by-hand path. If you record over Discord, events fill in automatically, approve them on the Review page instead of logging here.
            </p>
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

          {/* loot */}
          <div style={box}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Loot this session</div>
            {loot.map((l) => (
              <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{l.item_name}</span>
                  {l.rarity && <span style={{ color: C.muted }}>{"  "}· {l.rarity}</span>}
                  <span style={{ color: C.muted }}>{"  -> "}{charName(l.character_id)}</span>
                  {l.est_value != null && <span className="mono" style={{ color: C.muted }}>{"  "}{l.est_value} gp</span>}
                </div>
                <button onClick={() => removeLoot(l.id)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>delete</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <select style={inputStyle} value={newLoot.characterId} onChange={(e) => setNewLoot({ ...newLoot, characterId: e.target.value })}>
                <option value="">recipient...</option>
                {characters.filter((c) => c.kind !== "npc").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input style={{ ...inputStyle, flex: 1, minWidth: 140 }} placeholder="Item" value={newLoot.item} onChange={(e) => setNewLoot({ ...newLoot, item: e.target.value })} />
              <input style={{ ...inputStyle, maxWidth: 110 }} placeholder="Rarity" value={newLoot.rarity} onChange={(e) => setNewLoot({ ...newLoot, rarity: e.target.value })} />
              <input style={{ ...inputStyle, maxWidth: 90 }} type="number" placeholder="Value" value={newLoot.value} onChange={(e) => setNewLoot({ ...newLoot, value: e.target.value })} />
              <button style={btn} onClick={addLoot} disabled={busy || !newLoot.item.trim()}>Add</button>
            </div>
          </div>

          {/* arcs */}
          <div style={box}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Character arcs</div>
            {arcs.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{a.title}</span>
                  {a.character_id && <span style={{ color: C.muted }}>{"  "}· {charName(a.character_id)}</span>}
                  <span style={{ color: C.muted }}>{"  "}· {a.status}</span>
                </div>
                <button onClick={() => touchArc(a.id)} style={btnGhost}>Touch this session</button>
              </div>
            ))}
            {arcs.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>No arcs yet.</p>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <input style={{ ...inputStyle, flex: 1, minWidth: 160 }} placeholder="New arc title" value={newArc.title} onChange={(e) => setNewArc({ ...newArc, title: e.target.value })} />
              <select style={inputStyle} value={newArc.characterId} onChange={(e) => setNewArc({ ...newArc, characterId: e.target.value })}>
                <option value="">whose arc (optional)...</option>
                {characters.filter((c) => c.kind !== "npc").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button style={btn} onClick={addArc} disabled={busy || !newArc.title.trim()}>Add arc</button>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PageShell width={880}>
      <style>{`.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;}`}</style>
      {children}
    </PageShell>
  );
}
