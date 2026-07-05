"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import BoundariesCard from "@/components/boundaries-card";
import { useMomentPlayer, MomentButton } from "@/components/moment-player";
import { SAX, surfaces, ui } from "@/lib/theme";

const C = {
  bg: SAX.ink, surface: SAX.slateBg, surface2: "rgba(11,7,18,0.6)", line: SAX.line,
  text: SAX.text, muted: SAX.muted, sun: SAX.sun, plum: SAX.plum, good: SAX.good, warn: SAX.warn,
};

type Campaign = { id: string; name: string };
type Sess = { id: string; session_number: number | null };
type GmEvent = {
  id: string; session_id: string | null; kind: string; summary: string;
  npc_name: string | null; location_name: string | null;
  thread_status: string | null; t_start_seconds: number | null; created_at: string;
  audio_track_id: string | null;
};

const THREAD_GROUPS: { kind: string; label: string; blurb: string }[] = [
  { kind: "framing", label: "Decisions posed", blurb: "forks put to the party, still hanging" },
  { kind: "hook", label: "Plot hooks", blurb: "offered threads not yet taken" },
  { kind: "quest_update", label: "Quests in flight", blurb: "objectives given or advanced, not closed" },
];

const NPC_KINDS = new Set(["npc_introduced", "npc_voice", "npc_action", "npc_departed"]);
const BEAT_KINDS = new Set(["narration", "scene_transition", "consequence", "quest_update", "reward", "recap"]);

const fmtClock = (secs: number | null): string => {
  if (secs === null || secs === undefined) return "";
  const s = Math.floor(secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type PlanItem = {
  id: string; title: string; note: string | null; kind: string; difficulty: string | null;
  linked_event_id: string | null; linked_character_id: string | null; position: number; done: boolean;
};
type NpcChar = { id: string; name: string };

const PLAN_KINDS: { v: string; l: string }[] = [
  { v: "scene", l: "Scene" }, { v: "encounter", l: "Encounter" }, { v: "social", l: "Social" }, { v: "reveal", l: "Reveal" }, { v: "other", l: "Other" },
];
const PLAN_DIFFS = ["easy", "medium", "hard", "deadly"];

export default function PrepPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [threads, setThreads] = useState<GmEvent[]>([]);
  const [recent, setRecent] = useState<GmEvent[]>([]);
  const [busyId, setBusyId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [npcChars, setNpcChars] = useState<NpcChar[]>([]);
  const [pTitle, setPTitle] = useState("");
  const [pKind, setPKind] = useState("scene");
  const [pDiff, setPDiff] = useState("");
  const [pLink, setPLink] = useState("");
  const [pNote, setPNote] = useState("");
  const [pBusy, setPBusy] = useState(false);
  const player = useMomentPlayer();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at");
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  async function load(cid: string) {
    const cols = "id, session_id, kind, summary, npc_name, location_name, thread_status, t_start_seconds, created_at, audio_track_id";
    const [{ data: ss }, { data: th }, { data: rc }, { data: pl }, { data: nc }] = await Promise.all([
      supabase.from("sessions").select("id, session_number").eq("campaign_id", cid),
      supabase.from("gm_events").select(cols).eq("campaign_id", cid).eq("thread_status", "open").order("created_at", { ascending: false }),
      supabase.from("gm_events").select(cols).eq("campaign_id", cid).order("created_at", { ascending: false }).limit(150),
      supabase.from("session_plan_items").select("id, title, note, kind, difficulty, linked_event_id, linked_character_id, position, done").eq("campaign_id", cid).order("position", { ascending: true }),
      supabase.from("characters").select("id, name").eq("campaign_id", cid).eq("kind", "npc").order("name"),
    ]);
    setSessions((ss as Sess[]) || []);
    setThreads((th as GmEvent[]) || []);
    setRecent((rc as GmEvent[]) || []);
    setPlan((pl as PlanItem[]) || []);
    setNpcChars((nc as NpcChar[]) || []);
  }

  useEffect(() => { if (campaignId) load(campaignId); }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessNo = (sid: string | null): string => {
    if (!sid) return "";
    const s = sessions.find((x) => x.id === sid);
    return s && s.session_number !== null ? `S${s.session_number}` : "";
  };

  async function setThread(id: string, status: "resolved" | "dropped") {
    setBusyId(id); setError(null);
    const res = await fetch("/api/gm-thread", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) setError(out.error || "Could not update the thread.");
    else setThreads((prev) => prev.filter((t) => t.id !== id));
    setBusyId("");
  }

  async function addPlanItem() {
    if (!campaignId || !pTitle.trim()) return;
    setPBusy(true); setError(null);
    const pos = plan.length ? Math.max(...plan.map((p) => p.position)) + 1 : 0;
    const linked_event_id = pLink.startsWith("t:") ? pLink.slice(2) : null;
    const linked_character_id = pLink.startsWith("n:") ? pLink.slice(2) : null;
    const { data, error: e } = await supabase.from("session_plan_items").insert({
      campaign_id: campaignId, title: pTitle.trim(), note: pNote.trim() || null, kind: pKind,
      difficulty: pKind === "encounter" && pDiff ? pDiff : null, linked_event_id, linked_character_id, position: pos, done: false,
    }).select("id, title, note, kind, difficulty, linked_event_id, linked_character_id, position, done").single();
    if (e) setError(e.message);
    else if (data) { setPlan((arr) => [...arr, data as PlanItem]); setPTitle(""); setPNote(""); setPLink(""); setPDiff(""); setPKind("scene"); }
    setPBusy(false);
  }

  async function removePlanItem(id: string) {
    await supabase.from("session_plan_items").delete().eq("id", id);
    setPlan((arr) => arr.filter((p) => p.id !== id));
  }

  async function togglePlanDone(id: string, done: boolean) {
    await supabase.from("session_plan_items").update({ done }).eq("id", id);
    setPlan((arr) => arr.map((p) => (p.id === id ? { ...p, done } : p)));
  }

  async function movePlan(id: string, dir: -1 | 1) {
    const idx = plan.findIndex((p) => p.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= plan.length) return;
    const a = plan[idx], b = plan[j];
    await Promise.all([
      supabase.from("session_plan_items").update({ position: b.position }).eq("id", a.id),
      supabase.from("session_plan_items").update({ position: a.position }).eq("id", b.id),
    ]);
    setPlan((arr) => arr.map((p) => (p.id === a.id ? { ...p, position: b.position } : p.id === b.id ? { ...p, position: a.position } : p)).sort((x, y) => x.position - y.position));
  }

  const planLinkLabel = (item: PlanItem): string | null => {
    if (item.linked_event_id) { const t = threads.find((x) => x.id === item.linked_event_id) || recent.find((x) => x.id === item.linked_event_id); return t ? `Thread: ${t.summary}` : "Thread"; }
    if (item.linked_character_id) { const n = npcChars.find((x) => x.id === item.linked_character_id); return n ? `NPC: ${n.name}` : "NPC"; }
    return null;
  }

  // NPCs in play: dedupe recent npc_* events by name, keeping the latest.
  const npcs = useMemo(() => {
    const seen = new Map<string, GmEvent>();
    for (const e of recent) {
      if (!NPC_KINDS.has(e.kind)) continue;
      const name = (e.npc_name || "").trim();
      if (!name || seen.has(name)) continue;
      seen.set(name, e);
    }
    return Array.from(seen.values());
  }, [recent]);

  // Where you left off: story beats from the highest-numbered session that has events.
  const beats = useMemo(() => {
    let bestSid: string | null = null;
    let bestNo = -Infinity;
    for (const e of recent) {
      const s = sessions.find((x) => x.id === e.session_id);
      const no = s?.session_number ?? -1;
      if (no > bestNo) { bestNo = no; bestSid = e.session_id; }
    }
    if (!bestSid) return [] as GmEvent[];
    return recent
      .filter((e) => e.session_id === bestSid && BEAT_KINDS.has(e.kind))
      .slice()
      .sort((a, b) => (a.t_start_seconds ?? 0) - (b.t_start_seconds ?? 0));
  }, [recent, sessions]);

  const box = { ...surfaces.slate, padding: 18 } as const;
  const input = { width: "100%", boxSizing: "border-box" as const, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 13px", fontSize: 15, outline: "none" };
  const sectionTitle = (t: string, sub: string) => (
    <div style={{ margin: "22px 0 10px" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{t}</div>
      <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{sub}</div>
    </div>
  );
  const empty = (t: string) => <div style={{ ...box, color: C.muted, fontSize: 13.5 }}>{t}</div>;
  const miniBtn = (disabled: boolean) => ({ background: "none", border: `1px solid ${C.line}`, color: disabled ? C.line : C.muted, borderRadius: 6, cursor: disabled ? "default" : "pointer", fontSize: 12, padding: "2px 7px" } as const);

  const threadsEmpty = threads.length === 0;

  return (
    <PageShell width={860}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Prep sheet</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 18px" }}>
        Everything to glance at before the next session: threads left open, who is on stage, where you left off, and the table&apos;s boundaries.
      </p>

      <div style={{ ...box, marginBottom: 4 }}>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={input}>
          {campaigns.length === 0 && <option value="">No campaigns yet</option>}
          {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
      </div>

      {player.error && <p style={{ color: C.warn, fontSize: 12.5, margin: "10px 0 0" }}>{player.error}</p>}

      {sectionTitle("Plan the next session", "Jot the scenes and encounters you mean to run, link them to open threads or NPCs, and tick them off as you prep.")}
      <div style={box}>
        <div style={{ display: "grid", gap: 8, marginBottom: plan.length ? 14 : 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input placeholder={"What happens\u2026"} value={pTitle} onChange={(e) => setPTitle(e.target.value)} style={{ ...input, flex: "1 1 220px" }} />
            <select value={pKind} onChange={(e) => setPKind(e.target.value)} style={{ ...input, width: "auto", flex: "0 0 auto" }}>
              {PLAN_KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
            </select>
            {pKind === "encounter" && (
              <select value={pDiff} onChange={(e) => setPDiff(e.target.value)} style={{ ...input, width: "auto", flex: "0 0 auto" }}>
                <option value="">difficulty</option>
                {PLAN_DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={pLink} onChange={(e) => setPLink(e.target.value)} style={{ ...input, flex: "1 1 200px" }}>
              <option value="">{"Link to\u2026 (optional)"}</option>
              {threads.length > 0 && (
                <optgroup label="Open threads">
                  {threads.map((t) => <option key={t.id} value={`t:${t.id}`}>{(t.summary || "thread").slice(0, 60)}</option>)}
                </optgroup>
              )}
              {npcChars.length > 0 && (
                <optgroup label="NPCs">
                  {npcChars.map((n) => <option key={n.id} value={`n:${n.id}`}>{n.name}</option>)}
                </optgroup>
              )}
            </select>
            <button type="button" onClick={addPlanItem} disabled={pBusy || !pTitle.trim()}
              style={{ background: C.sun, color: SAX.inkDeep, border: "none", borderRadius: 9, padding: "0 20px", fontSize: 14, fontWeight: 700, cursor: pBusy || !pTitle.trim() ? "default" : "pointer", opacity: pBusy || !pTitle.trim() ? 0.6 : 1 }}>
              Add
            </button>
          </div>
          <input placeholder="Notes (optional)" value={pNote} onChange={(e) => setPNote(e.target.value)} style={input} />
        </div>

        {plan.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Nothing planned yet. Add a scene or encounter above.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {plan.map((p, i) => {
              const link = planLinkLabel(p);
              return (
                <div key={p.id} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", opacity: p.done ? 0.55 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: C.plum }}>{p.kind}</span>
                        {p.difficulty && <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: C.warn }}>{p.difficulty}</span>}
                        <span style={{ fontSize: 14, color: C.text, fontWeight: 600, textDecoration: p.done ? "line-through" : "none" }}>{p.title}</span>
                      </div>
                      {link && <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{link}</div>}
                      {p.note && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{p.note}</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <button type="button" title="Move up" onClick={() => movePlan(p.id, -1)} disabled={i === 0} style={miniBtn(i === 0)}>{"\u2191"}</button>
                      <button type="button" title="Move down" onClick={() => movePlan(p.id, 1)} disabled={i === plan.length - 1} style={miniBtn(i === plan.length - 1)}>{"\u2193"}</button>
                      <label title="Done" style={{ display: "flex", alignItems: "center", cursor: "pointer", marginLeft: 4 }}>
                        <input type="checkbox" checked={p.done} onChange={(e) => togglePlanDone(p.id, e.target.checked)} />
                      </label>
                      <button type="button" title="Remove" onClick={() => removePlanItem(p.id)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 15, padding: "2px 6px" }}>{"\u00d7"}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {sectionTitle("Open threads", "Framing, hooks, and quests captured from your narration that are still dangling. Resolve when paid off, drop when abandoned.")}
      <p style={{ color: C.muted, fontSize: 12.5, margin: "-4px 0 12px" }}>
        Deliberate campaign arcs you track by hand live on the <a href="/gm/timeline" style={{ color: C.plum, textDecoration: "none", borderBottom: `1px solid ${C.plum}` }}>Timeline</a>.
      </p>
      {error && <p style={{ color: C.warn, fontSize: 13, marginBottom: 10 }}>{error}</p>}
      {threadsEmpty ? (
        empty("No open threads. Approve GM framing, hooks, or quest updates on the Review page and they gather here.")
      ) : (
        THREAD_GROUPS.map((g) => {
          const items = threads.filter((t) => t.kind === g.kind);
          if (!items.length) return null;
          return (
            <div key={g.kind} style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.plum, marginBottom: 8 }}>
                {g.label} <span style={{ color: C.muted, textTransform: "none", letterSpacing: 0 }}>· {g.blurb}</span>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {items.map((t) => (
                  <div key={t.id} style={box}>
                    <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>{t.summary}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11.5, color: C.muted, fontFamily: "ui-monospace, monospace" }}>{sessNo(t.session_id)}</span>
                        {t.audio_track_id ? (
                          <MomentButton active={player.activeId === t.id} loading={player.loadingId === t.id} tStart={t.t_start_seconds}
                            onClick={() => player.play(t.id, t.audio_track_id, t.t_start_seconds)} />
                        ) : (t.t_start_seconds !== null && (
                          <span style={{ fontSize: 11.5, color: C.muted, fontFamily: "ui-monospace, monospace" }}>{fmtClock(t.t_start_seconds)}</span>
                        ))}
                      </span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" onClick={() => setThread(t.id, "resolved")} disabled={busyId === t.id}
                          style={{ background: C.good, color: SAX.inkDeep, border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: busyId === t.id ? 0.6 : 1 }}>
                          Resolve
                        </button>
                        <button type="button" onClick={() => setThread(t.id, "dropped")} disabled={busyId === t.id}
                          style={{ background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                          Drop
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {sectionTitle("NPCs in play", "named characters your GM narration has put on stage, most recent first.")}
      {npcs.length === 0 ? (
        empty("No NPCs captured yet. They appear once you approve npc events on the Review page.")
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {npcs.map((n) => {
            const gone = n.kind === "npc_departed";
            return (
              <div key={n.id} style={{ ...box, padding: "12px 16px" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: gone ? C.muted : C.text }}>{n.npc_name}</span>
                {gone && <span style={{ fontSize: 11, color: C.warn, marginLeft: 8, fontFamily: "ui-monospace, monospace" }}>left</span>}
                <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>{sessNo(n.session_id)}</span>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{n.summary}</div>
              </div>
            );
          })}
        </div>
      )}

      {sectionTitle("Where you left off", "the story beats from your most recent captured session, in order.")}
      {beats.length === 0 ? (
        empty("No recent beats yet.")
      ) : (
        <div style={{ ...box }}>
          <div style={{ display: "grid", gap: 8 }}>
            {beats.map((b) => (
              <div key={b.id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 13.5, lineHeight: 1.5 }}>
                <span style={{ width: 6, height: 6, borderRadius: 6, background: C.sun, flexShrink: 0, transform: "translateY(4px)" }} />
                <span style={{ color: C.text, flex: 1 }}>{b.summary}</span>
                {b.audio_track_id && (
                  <MomentButton active={player.activeId === b.id} loading={player.loadingId === b.id} tStart={b.t_start_seconds}
                    onClick={() => player.play(b.id, b.audio_track_id, b.t_start_seconds)} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {sectionTitle("Table boundaries", "keep the safety limits in view while you prep.")}
      <BoundariesCard campaignId={campaignId} />
    </PageShell>
  );
}
