"use client";

// Insight > Mechanics: descriptive statistics over captured table rolls
// (vtt_events) for one session. Reads with the GM's own client; the
// "gm reads vtt events" RLS policy scopes rows to campaigns they run.

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";

const C = {
  surface: SAX.slateBg, surface2: "rgba(11,7,18,0.6)", line: SAX.line,
  text: SAX.text, muted: SAX.muted, sun: SAX.sun, brass: SAX.brass,
  plum: SAX.plum, warn: SAX.warn, good: SAX.good,
};

type Campaign = { id: string; name: string };
type Session = { id: string; session_number: number | null; created_at: string; scheduled_at: string | null };
type DiceGroup = { faces: number | null; results: number[] };
type Rolls = {
  total?: number | null;
  dice?: DiceGroup[];
  advantage?: number;
  discarded?: boolean;
  critical_success?: boolean | null;
  critical_failure?: boolean | null;
  damage_type?: string | null;
};
type VttEvent = {
  id: string;
  character_id: string | null;
  actor_name: string | null;
  event_type: string;
  name: string | null;
  rolls: Rolls | null;
  state: { hp?: number | null; max_hp?: number | null } | null;
  fidelity: string;
  rolled_at: string | null;
  received_at: string;
};

const D20_TYPES = new Set(["to-hit", "saving-throw", "skill", "ability", "initiative", "death-save"]);

type CharStats = {
  key: string;
  label: string;
  linked: boolean;
  d20Count: number;
  natSum: number;
  natCount: number;
  nat20s: number;
  nat1s: number;
  advantage: number;
  damage: number;
  hpSeries: { t: number; hp: number }[];
  maxHp: number | null;
};

function natD20(r: Rolls | null): number | null {
  const d = (r?.dice ?? []).find((g) => g.faces === 20);
  const v = d?.results?.[0];
  return typeof v === "number" ? v : null;
}

function Spark({ series, maxHp }: { series: { t: number; hp: number }[]; maxHp: number | null }) {
  if (series.length < 2) return <span style={{ color: C.muted, fontSize: 12 }}>{series.length === 1 ? `${series[0].hp} hp` : "no data"}</span>;
  const w = 120, h = 26, pad = 2;
  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const top = maxHp ?? Math.max(...series.map((p) => p.hp), 1);
  const x = (t: number) => (t1 === t0 ? pad : pad + ((t - t0) / (t1 - t0)) * (w - pad * 2));
  const y = (hp: number) => h - pad - (Math.max(0, Math.min(hp, top)) / top) * (h - pad * 2);
  const pts = series.map((p) => `${x(p.t).toFixed(1)},${y(p.hp).toFixed(1)}`).join(" ");
  const minHp = Math.min(...series.map((p) => p.hp));
  const last = series[series.length - 1].hp;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg width={w} height={h} style={{ display: "block" }}>
        <polyline points={pts} fill="none" stroke={minHp <= top * 0.25 ? C.warn : C.good} strokeWidth={1.6} />
      </svg>
      <span style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace" }}>
        min {minHp}{maxHp ? `/${maxHp}` : ""} {"\u00b7"} now {last}
      </span>
    </span>
  );
}

export default function MechanicsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [events, setEvents] = useState<VttEvent[]>([]);
  const [charNames, setCharNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at", { ascending: true });
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
      else setLoading(false);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      setLoading(true);
      const [{ data: sess }, { data: chars }] = await Promise.all([
        supabase.from("sessions").select("id, session_number, created_at, scheduled_at").eq("campaign_id", campaignId).order("created_at", { ascending: false }),
        supabase.from("characters").select("id, name").eq("campaign_id", campaignId),
      ]);
      const list = (sess as Session[]) || [];
      setSessions(list);
      const names: Record<string, string> = {};
      ((chars as { id: string; name: string }[]) || []).forEach((c) => { names[c.id] = c.name; });
      setCharNames(names);
      setSessionId(list.length ? list[0].id : "");
      if (!list.length) { setEvents([]); setLoading(false); }
    })();
  }, [campaignId, supabase]);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("vtt_events")
        .select("id, character_id, actor_name, event_type, name, rolls, state, fidelity, rolled_at, received_at")
        .eq("session_id", sessionId)
        .order("rolled_at", { ascending: true });
      setEvents((data as VttEvent[]) || []);
      setLoading(false);
    })();
  }, [sessionId, supabase]);

  const stats = useMemo(() => {
    const per: Record<string, CharStats> = {};
    const dist: number[] = new Array(21).fill(0);
    let d20Total = 0, dmgTotal = 0, canonical = 0;
    const typeCounts: Record<string, number> = {};
    const dmgByType: Record<string, number> = {};

    for (const e of events) {
      typeCounts[e.event_type] = (typeCounts[e.event_type] || 0) + 1;
      if (e.fidelity === "canonical") canonical += 1;
      const key = e.character_id ?? `ddb:${e.actor_name ?? "unknown"}`;
      if (!per[key]) {
        per[key] = {
          key,
          label: e.character_id ? (charNames[e.character_id] ?? "Character") : `${e.actor_name ?? "Unknown"} (unlinked)`,
          linked: Boolean(e.character_id),
          d20Count: 0, natSum: 0, natCount: 0, nat20s: 0, nat1s: 0, advantage: 0, damage: 0,
          hpSeries: [], maxHp: null,
        };
      }
      const s = per[key];
      const t = new Date(e.rolled_at ?? e.received_at).getTime();
      const hp = e.state?.hp;
      if (typeof hp === "number") {
        s.hpSeries.push({ t, hp });
        if (typeof e.state?.max_hp === "number") s.maxHp = e.state.max_hp;
      }
      const r = e.rolls;
      if (D20_TYPES.has(e.event_type) && r && r.discarded !== true) {
        s.d20Count += 1;
        d20Total += 1;
        const nat = natD20(r);
        if (nat !== null && nat >= 1 && nat <= 20) {
          s.natSum += nat; s.natCount += 1; dist[nat] += 1;
          if (nat === 20 || r.critical_success === true) s.nat20s += 1;
          if (nat === 1 || r.critical_failure === true) s.nat1s += 1;
        }
        if ((r.advantage ?? 0) !== 0) s.advantage += 1;
      }
      if (e.event_type === "damage" && r && typeof r.total === "number") {
        s.damage += r.total;
        dmgTotal += r.total;
        const dt = r.damage_type ?? "Untyped";
        dmgByType[dt] = (dmgByType[dt] || 0) + r.total;
      }
    }

    const rows = Object.values(per).sort((a, b) => b.d20Count - a.d20Count || b.damage - a.damage);
    const distMax = Math.max(1, ...dist);
    return { rows, dist, distMax, d20Total, dmgTotal, canonical, total: events.length, typeCounts, dmgByType };
  }, [events, charNames]);

  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 18px", marginBottom: 14 } as const;
  const sel = { background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 12px", fontSize: 14 } as const;
  const sessionLabel = (s: Session) =>
    `Session ${s.session_number ?? "?"} ${"\u00b7"} ${new Date(s.scheduled_at ?? s.created_at).toLocaleDateString()}`;

  return (
    <PageShell width={900}>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>
        Insight
      </div>
      <h1 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>Mechanics</h1>
      <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 18px", maxWidth: 640 }}>
        Descriptive stats from rolls captured at the table: who rolled, how the dice treated them, damage dealt, and hit points over the session. Numbers marked unverified came from players without digital dice enabled.
      </p>

      <div style={{ ...box, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <select value={campaignId} onChange={(e: any) => setCampaignId(e.target.value)} style={sel}>
          {campaigns.length === 0 && <option value="">No campaigns yet</option>}
          {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        <select value={sessionId} onChange={(e: any) => setSessionId(e.target.value)} style={sel}>
          {sessions.length === 0 && <option value="">No sessions yet</option>}
          {sessions.map((s) => (<option key={s.id} value={s.id}>{sessionLabel(s)}</option>))}
        </select>
      </div>

      {loading ? (
        <div style={{ ...box, color: C.muted, fontSize: 14 }}>Loading...</div>
      ) : events.length === 0 ? (
        <div style={{ ...box, color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
          No captured rolls for this session. Share your session link (Roster tab) and have players keep it open while they play with Beyond20.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
            {[
              { label: "events captured", value: String(stats.total) },
              { label: "d20 rolls", value: String(stats.d20Total) },
              { label: "nat 20s / nat 1s", value: `${stats.rows.reduce((a, r) => a + r.nat20s, 0)} / ${stats.rows.reduce((a, r) => a + r.nat1s, 0)}` },
              { label: "damage dealt", value: String(stats.dmgTotal) },
              { label: "verified numbers", value: `${stats.total ? Math.round((stats.canonical / stats.total) * 100) : 0}%` },
            ].map((k) => (
              <div key={k.label} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: C.sun }}>{k.value}</div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>{k.label}</div>
              </div>
            ))}
          </div>

          <div style={box}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>d20 distribution</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 56 }}>
              {stats.dist.slice(1).map((n, i) => (
                <div key={i} title={`${i + 1}: ${n}`} style={{ flex: 1, minWidth: 6, height: `${(n / stats.distMax) * 100}%`, minHeight: n > 0 ? 4 : 1, background: i + 1 === 20 ? C.good : i + 1 === 1 ? C.warn : C.plum, borderRadius: 3, opacity: n > 0 ? 1 : 0.25 }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.muted, fontFamily: "ui-monospace, monospace", marginTop: 4 }}>
              <span>1</span><span>10</span><span>20</span>
            </div>
          </div>

          <div style={{ ...box, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: C.muted, fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {["character", "d20s", "avg d20", "nat 20", "nat 1", "adv", "damage", "hit points"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 10px", borderBottom: `1px solid ${C.line}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.rows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ padding: "9px 10px", fontWeight: 600, color: r.linked ? C.text : C.muted }}>{r.label}</td>
                    <td style={{ padding: "9px 10px" }}>{r.d20Count}</td>
                    <td style={{ padding: "9px 10px" }}>{r.natCount ? (r.natSum / r.natCount).toFixed(1) : "\u2014"}</td>
                    <td style={{ padding: "9px 10px", color: r.nat20s ? C.good : C.muted }}>{r.nat20s}</td>
                    <td style={{ padding: "9px 10px", color: r.nat1s ? C.warn : C.muted }}>{r.nat1s}</td>
                    <td style={{ padding: "9px 10px" }}>{r.advantage}</td>
                    <td style={{ padding: "9px 10px" }}>{r.damage}</td>
                    <td style={{ padding: "9px 10px" }}><Spark series={r.hpSeries} maxHp={r.maxHp} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {Object.keys(stats.dmgByType).length > 0 && (
            <div style={box}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Damage by type</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(stats.dmgByType).sort((a, b) => b[1] - a[1]).map(([t, v]) => (
                  <span key={t} style={{ fontSize: 13, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 12px" }}>
                    {t}: <b style={{ color: C.sun }}>{v}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
