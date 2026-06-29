"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// recharts needs real hex/rgba, not CSS vars; mapped onto the cellar theme.
const T = {
  bg: SAX.inkDeep, surface: SAX.slateBg, surface2: "rgba(36,27,52,0.92)", line: SAX.line,
  text: SAX.text, muted: SAX.muted, sun: SAX.sun, sunSoft: "#FFD75E",
  plum: SAX.plum, warn: SAX.warn, good: SAX.good,
};

const CSS = `
.wg-scope{--bg:${SAX.inkDeep};--surface:${SAX.slateBg};--surface2:rgba(36,27,52,0.92);--line:${SAX.line};
  --text:${SAX.text};--muted:${SAX.muted};--sun:${SAX.sun};--sunSoft:#FFD75E;--plum:${SAX.plum};--warn:${SAX.warn};--good:${SAX.good};
  color:var(--text);font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;}
.wg-serif{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;}
.wg-mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;}

.wg-camprow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:22px;}
.wg-eyebrow{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);}
.wg-pills{display:flex;gap:8px;flex-wrap:wrap;flex:1;}
.wg-pill{font-size:14px;background:none;color:var(--muted);border:1px solid var(--line);border-radius:999px;
  padding:8px 16px;cursor:pointer;transition:all .15s;}
.wg-pill:hover{color:var(--text);border-color:var(--plum);}
.wg-pill.on{background:var(--surface2);color:var(--text);border-color:var(--plum);}

.wg-btn{font-size:14px;font-weight:600;background:var(--sun);color:var(--bg);border:none;border-radius:10px;
  padding:10px 18px;cursor:pointer;text-decoration:none;display:inline-block;transition:background .15s,transform .15s;}
.wg-btn:hover{background:var(--sunSoft);}
.wg-btn:active{transform:translateY(1px);}
.wg-link{color:var(--sun);text-decoration:none;border-bottom:1px solid transparent;transition:border-color .15s;}
.wg-link:hover{border-bottom-color:var(--sun);}

.wg-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px;}
.wg-card-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;}
.wg-card-t{font-size:15px;font-weight:600;color:var(--text);}
.wg-card-s{font-size:12px;color:var(--muted);}
.wg-err{border-color:var(--warn);color:#F2C6BC;font-size:13px;}

/* health hero */
.wg-health{border-left:3px solid var(--sun);}
.wg-flag{display:flex;align-items:flex-start;gap:11px;padding:9px 0;font-size:14.5px;line-height:1.5;
  border-bottom:1px solid var(--line);}
.wg-flag:last-child{border-bottom:none;}
.wg-dot{margin-top:6px;width:7px;height:7px;border-radius:50%;flex:none;}

/* kpi strip */
.wg-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px;}
.wg-kpi{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px;}
.wg-kpi-l{font-size:11px;letter-spacing:0.04em;color:var(--muted);text-transform:uppercase;margin-bottom:8px;}
.wg-kpi-n{font-family:ui-monospace,Menlo,monospace;font-size:30px;font-weight:600;color:var(--sun);line-height:1;
  display:flex;align-items:baseline;gap:8px;}
.wg-kpi-sub{font-size:12px;color:var(--muted);margin-top:7px;}

/* bars */
.wg-row{display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:5px;}
.wg-track{height:7px;background:var(--line);border-radius:5px;overflow:hidden;}
.wg-fill{height:100%;border-radius:5px;}
.wg-item{margin-bottom:13px;}

.wg-list-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13.5px;}
.wg-list-row:last-child{border-bottom:none;}

.wg-twocol{display:grid;grid-template-columns:1fr;gap:16px;}
@media(min-width:760px){.wg-twocol{grid-template-columns:1fr 1fr;}.wg-twocol .wg-card{margin-bottom:0;}}

.wg-sel{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:8px 11px;font-size:13.5px;}
.wg-empty{color:var(--muted);font-size:14px;line-height:1.6;}

.wg-scope a:focus-visible,.wg-scope button:focus-visible,.wg-scope select:focus-visible{outline:2px solid var(--sun);outline-offset:2px;}
@media(prefers-reduced-motion:reduce){.wg-scope *{transition:none!important;}}
`;

export default function Dashboard() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [campaign, setCampaign] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [equity, setEquity] = useState<any[]>([]);
  const [spotlight, setSpotlight] = useState<any[]>([]);
  const [arcs, setArcs] = useState<any[]>([]);
  const [loot, setLoot] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) { setErr("Sign in to view your dashboard."); setLoading(false); } return; }
      const { data: camps } = await supabase.from("campaigns").select("id,name,system").order("created_at", { ascending: false });
      if (!active) return;
      setCampaigns(camps || []);
      if (camps && camps.length === 1) setCampaign(camps[0].id);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [supabase]);

  const loadCampaign = useCallback(async (id: string) => {
    setErr(null);
    const [sess, eq, sp, ar, lt] = await Promise.all([
      supabase.from("sessions").select("id,session_number,status").eq("campaign_id", id).order("session_number", { ascending: false, nullsFirst: false }),
      supabase.from("v_session_equity").select("*").eq("campaign_id", id),
      supabase.from("v_session_spotlight").select("*").eq("campaign_id", id),
      supabase.from("v_arc_freshness").select("*").eq("campaign_id", id),
      supabase.from("v_loot_fairness").select("*").eq("campaign_id", id),
    ]);
    const firstErr = sess.error || eq.error || sp.error || ar.error || lt.error;
    if (firstErr) setErr(firstErr.message);
    const sessRows = sess.data || [];
    setSessions(sessRows);
    setEquity(eq.data || []);
    setSpotlight(sp.data || []);
    setArcs(ar.data || []);
    setLoot(lt.data || []);
    setSelectedSession((sessRows[0] && sessRows[0].id) || null);
  }, [supabase]);

  useEffect(() => { if (campaign) loadCampaign(campaign); }, [campaign, loadCampaign]);

  const numById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of sessions) if (s.session_number != null) m[s.id] = s.session_number;
    return m;
  }, [sessions]);

  const equityTrend = useMemo(() => {
    return equity
      .map((e) => ({ session: numById[e.session_id] ?? 0, cv: e.cv, n: e.n_active }))
      .filter((r) => r.session > 0)
      .sort((a, b) => a.session - b.session);
  }, [equity, numById]);

  const spotlightRows = useMemo(() => {
    return spotlight
      .filter((s) => s.session_id === selectedSession)
      .sort((a, b) => (b.share || 0) - (a.share || 0));
  }, [spotlight, selectedSession]);

  const arcRows = useMemo(() => {
    return [...arcs].sort((a, b) => (b.stale ? 1 : 0) - (a.stale ? 1 : 0) || (b.sessions_since_touched || 0) - (a.sessions_since_touched || 0));
  }, [arcs]);

  const lootRows = useMemo(() => {
    return [...loot].sort((a, b) => (b.total_value || 0) - (a.total_value || 0));
  }, [loot]);

  const kpis = useMemo(() => {
    const lastCv = equityTrend.length ? (equityTrend[equityTrend.length - 1].cv || 0) : null;
    const prevCv = equityTrend.length > 1 ? (equityTrend[equityTrend.length - 2].cv || 0) : null;
    const staleCount = arcs.filter((a) => a.stale).length;
    const topLoot = loot.length ? Math.max(...loot.map((l) => l.share || 0)) : null;
    return { lastCv, prevCv, staleCount, topLoot, sessionCount: sessions.length };
  }, [equityTrend, arcs, loot, sessions]);

  const health = useMemo(() => {
    const alerts: { level: string; text: string }[] = [];
    const latest = sessions[0]?.id || null;
    const sl = spotlight.filter((s) => s.session_id === latest);
    if (sl.length >= 2) {
      const even = 1 / sl.length;
      const sorted = [...sl].sort((a, b) => (b.share || 0) - (a.share || 0));
      const top = sorted[0];
      const bottom = sorted[sorted.length - 1];
      if (top && (top.share || 0) > even * 1.75)
        alerts.push({ level: "warn", text: `${top.character_name} is taking ${Math.round((top.share || 0) * 100)}% of the spotlight; an even share is ${Math.round(even * 100)}%.` });
      if (bottom && (bottom.share || 0) < even * 0.5)
        alerts.push({ level: "warn", text: `${bottom.character_name} is down at ${Math.round((bottom.share || 0) * 100)}%, well below an even ${Math.round(even * 100)}%.` });
    }
    if (equityTrend.length >= 2) {
      const first = equityTrend[0].cv || 0;
      const last = equityTrend[equityTrend.length - 1].cv || 0;
      if (last - first > 0.15)
        alerts.push({ level: "warn", text: `The table is getting less even over time (dispersion ${Number(first).toFixed(2)} to ${Number(last).toFixed(2)}).` });
      else if (first - last > 0.15)
        alerts.push({ level: "good", text: `The table is evening out over time (dispersion ${Number(first).toFixed(2)} to ${Number(last).toFixed(2)}).` });
    }
    const stale = arcs.filter((a) => a.stale);
    if (stale.length) {
      const names = stale.map((a) => a.title).slice(0, 3).join(", ");
      alerts.push({ level: "warn", text: `${stale.length} arc${stale.length > 1 ? "s" : ""} gone stale: ${names}${stale.length > 3 ? "..." : ""}.` });
    }
    if (loot.length >= 2) {
      const sortedL = [...loot].sort((a, b) => (b.share || 0) - (a.share || 0));
      const topL = sortedL[0];
      const evenL = (topL && topL.equal_share) || (1 / loot.length);
      if (topL && (topL.share || 0) > evenL * 1.75)
        alerts.push({ level: "warn", text: `${topL.character_name} holds ${Math.round((topL.share || 0) * 100)}% of loot value; an even split is ${Math.round(evenL * 100)}%.` });
    }
    return alerts;
  }, [sessions, spotlight, equityTrend, arcs, loot]);

  const dotColor = (lvl: string) => (lvl === "warn" ? T.warn : lvl === "good" ? T.good : T.plum);

  if (loading) {
    return (
      <PageShell width={980}>
        <div className="wg-scope"><style>{CSS}</style>
          <p style={{ color: T.muted }}>Loading...</p>
        </div>
      </PageShell>
    );
  }

  const spotEven = spotlightRows.length ? 1 / spotlightRows.length : 0;

  return (
    <PageShell width={980}>
      <div className="wg-scope">
        <style>{CSS}</style>

        {err && <div className="wg-card wg-err">{err}</div>}

        <div className="wg-camprow">
          <span className="wg-eyebrow">Campaign</span>
          <div className="wg-pills">
            {campaigns.length === 0 && <span style={{ color: T.muted, fontSize: 13 }}>No campaigns yet.</span>}
            {campaigns.map((c) => (
              <button key={c.id} className={`wg-pill${campaign === c.id ? " on" : ""}`} onClick={() => setCampaign(c.id)}>{c.name}</button>
            ))}
          </div>
          {campaign && <a className="wg-btn" href="/gm/sessions">Log a session</a>}
        </div>

        {!campaign ? (
          <div className="wg-card wg-empty">
            Pick a campaign to see its table health. New here? <a className="wg-link" href="/gm">Build a roster</a> first, then run a session.
          </div>
        ) : (
          <>
            {/* HERO: table health */}
            <section className="wg-card wg-health">
              <div className="wg-eyebrow" style={{ marginBottom: 12 }}>Table health</div>
              {health.length === 0 ? (
                <div className="wg-flag"><span className="wg-dot" style={{ background: T.good }} />
                  <span style={{ color: T.muted }}>No flags yet. Either the table is balanced, or there is not enough logged. <a className="wg-link" href="/gm/sessions">Log a session</a> to feed it.</span>
                </div>
              ) : (
                health.map((h, i) => (
                  <div className="wg-flag" key={i}>
                    <span className="wg-dot" style={{ background: dotColor(h.level) }} />
                    <span>{h.text}</span>
                  </div>
                ))
              )}
            </section>

            {/* KPI strip */}
            <div className="wg-kpis">
              <div className="wg-kpi">
                <div className="wg-kpi-l">Spotlight evenness</div>
                <div className="wg-kpi-n">
                  {kpis.lastCv == null ? "--" : Number(kpis.lastCv).toFixed(2)}
                  {kpis.lastCv != null && kpis.prevCv != null && (
                    <span style={{ fontSize: 15, color: kpis.lastCv > kpis.prevCv ? T.warn : T.good }}>
                      {kpis.lastCv > kpis.prevCv ? "\u25B2" : "\u25BC"}
                    </span>
                  )}
                </div>
                <div className="wg-kpi-sub">latest session · lower is even</div>
              </div>
              <div className="wg-kpi">
                <div className="wg-kpi-l">Stale arcs</div>
                <div className="wg-kpi-n" style={{ color: kpis.staleCount > 0 ? T.warn : T.sun }}>{kpis.staleCount}</div>
                <div className="wg-kpi-sub">untouched 3+ sessions</div>
              </div>
              <div className="wg-kpi">
                <div className="wg-kpi-l">Top loot share</div>
                <div className="wg-kpi-n">{kpis.topLoot == null ? "--" : `${Math.round(kpis.topLoot * 100)}%`}</div>
                <div className="wg-kpi-sub">held by one character</div>
              </div>
              <div className="wg-kpi">
                <div className="wg-kpi-l">Sessions</div>
                <div className="wg-kpi-n">{kpis.sessionCount}</div>
                <div className="wg-kpi-sub">logged</div>
              </div>
            </div>

            {/* trend */}
            <section className="wg-card">
              <div className="wg-card-h">
                <span className="wg-card-t">Spotlight evenness over time</span>
                <span className="wg-card-s">lower is more even</span>
              </div>
              {equityTrend.length === 0 ? (
                <p className="wg-empty">No session data yet. <a className="wg-link" href="/gm/sessions">Log events</a> across a couple of sessions to draw this.</p>
              ) : (
                <div style={{ width: "100%", height: 230 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={equityTrend} margin={{ top: 8, right: 16, bottom: 4, left: -18 }}>
                      <CartesianGrid stroke={T.line} strokeDasharray="3 3" />
                      <XAxis dataKey="session" stroke={T.muted} tick={{ fill: T.muted, fontSize: 12 }} />
                      <YAxis stroke={T.muted} tick={{ fill: T.muted, fontSize: 12 }} />
                      <Tooltip contentStyle={{ background: T.surface2, border: `1px solid ${T.line}`, borderRadius: 9, color: T.text }} labelStyle={{ color: T.muted }} />
                      <Line type="monotone" dataKey="cv" stroke={T.sun} strokeWidth={2.5} dot={{ fill: T.sun, r: 3 }} activeDot={{ r: 5, fill: T.sunSoft }} name="dispersion" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* spotlight share */}
            <section className="wg-card">
              <div className="wg-card-h">
                <span className="wg-card-t">Spotlight share by character</span>
                <select className="wg-sel" value={selectedSession || ""} onChange={(e) => setSelectedSession(e.target.value || null)}>
                  {sessions.map((s) => <option key={s.id} value={s.id}>Session {s.session_number ?? "?"}</option>)}
                </select>
              </div>
              {spotlightRows.length === 0 ? (
                <p className="wg-empty">Nothing logged for this session yet.</p>
              ) : (
                spotlightRows.map((r) => {
                  const share = r.share || 0;
                  const col = share > spotEven * 1.75 ? T.sun : share < spotEven * 0.5 ? T.warn : T.plum;
                  return (
                    <div className="wg-item" key={r.character_id || r.character_name}>
                      <div className="wg-row">
                        <span>{r.character_name || "table"}</span>
                        <span className="wg-mono" style={{ color: T.muted }}>{Math.round(share * 100)}%</span>
                      </div>
                      <div className="wg-track"><div className="wg-fill" style={{ width: `${share * 100}%`, background: col }} /></div>
                    </div>
                  );
                })
              )}
            </section>

            {/* arcs + loot */}
            <div className="wg-twocol">
              <section className="wg-card">
                <div className="wg-card-h"><span className="wg-card-t">Character arcs</span></div>
                {arcRows.length === 0 ? (
                  <p className="wg-empty">No arcs tracked. Add them while logging a session.</p>
                ) : (
                  arcRows.map((a) => (
                    <div className="wg-list-row" key={a.arc_id}>
                      <span>
                        {a.stale && <span style={{ color: T.warn, marginRight: 7 }}>●</span>}
                        <span style={{ fontWeight: 600 }}>{a.title}</span>
                        {a.character_name && <span style={{ color: T.muted }}>{"  ·  "}{a.character_name}</span>}
                      </span>
                      <span className="wg-mono" style={{ fontSize: 12, color: a.stale ? T.warn : T.muted, whiteSpace: "nowrap" }}>
                        {a.sessions_since_touched == null ? "--" : `${a.sessions_since_touched} ago`}
                      </span>
                    </div>
                  ))
                )}
              </section>

              <section className="wg-card">
                <div className="wg-card-h"><span className="wg-card-t">Loot distribution</span><span className="wg-card-s">vs even split</span></div>
                {lootRows.length === 0 ? (
                  <p className="wg-empty">No loot recorded.</p>
                ) : (
                  lootRows.map((r) => {
                    const dev = r.deviation || 0;
                    return (
                      <div className="wg-item" key={r.character_id || r.character_name}>
                        <div className="wg-row">
                          <span>{r.character_name || "--"}</span>
                          <span className="wg-mono" style={{ color: T.muted }}>{Math.round((r.share || 0) * 100)}% · {dev >= 0 ? "+" : ""}{Math.round(dev * 100)}</span>
                        </div>
                        <div className="wg-track" style={{ position: "relative" }}>
                          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: T.muted, opacity: 0.5 }} />
                          <div className="wg-fill" style={{ position: "absolute", top: 0,
                            background: dev >= 0 ? T.sun : T.plum,
                            left: dev >= 0 ? "50%" : `${50 + dev * 100}%`,
                            width: `${Math.min(Math.abs(dev) * 100, 50)}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
