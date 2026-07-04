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

export default function PrepPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [threads, setThreads] = useState<GmEvent[]>([]);
  const [recent, setRecent] = useState<GmEvent[]>([]);
  const [busyId, setBusyId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
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
    const [{ data: ss }, { data: th }, { data: rc }] = await Promise.all([
      supabase.from("sessions").select("id, session_number").eq("campaign_id", cid),
      supabase.from("gm_events").select(cols).eq("campaign_id", cid).eq("thread_status", "open").order("created_at", { ascending: false }),
      supabase.from("gm_events").select(cols).eq("campaign_id", cid).order("created_at", { ascending: false }).limit(150),
    ]);
    setSessions((ss as Sess[]) || []);
    setThreads((th as GmEvent[]) || []);
    setRecent((rc as GmEvent[]) || []);
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

      {sectionTitle("Open threads", "framing, hooks, and quests you approved that are still dangling. Resolve when paid off, drop when abandoned.")}
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
