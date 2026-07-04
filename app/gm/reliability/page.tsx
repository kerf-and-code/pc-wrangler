"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX, surfaces, ui, AXES, type AxisKey } from "@/lib/theme";

const C = {
  bg: SAX.ink, surface: SAX.slateBg, surface2: "rgba(11,7,18,0.6)", line: SAX.line,
  text: SAX.text, muted: SAX.muted, sun: SAX.sun, plum: SAX.plum, warn: SAX.warn, good: SAX.good,
};

type Campaign = { id: string; name: string };
type PE = { status: string; event_type: string; axis: string | null; confidence: number | null; extractor_version: string | null };
type Group = { k: string; n: number; rate: number };
type JobRow = { id: string; status: string; session: { session_number: number | null } | null };

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const rateColor = (r: number): string => (r >= 0.7 ? "#5DBE9A" : r >= 0.4 ? "#F4C430" : "#E07A5F");
const kappaLabel = (k: number): string =>
  k < 0 ? "poor" : k < 0.2 ? "slight" : k < 0.4 ? "fair" : k < 0.6 ? "moderate" : k < 0.8 ? "substantial" : "almost perfect";

export default function ReliabilityPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<PE[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // double-coding state
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobId, setJobId] = useState<string>("");
  const [segN, setSegN] = useState<number | null>(null);
  const [codingA, setCodingA] = useState<Record<string, string>>({});
  const [codingB, setCodingB] = useState<Record<string, string>>({});
  const [recoding, setRecoding] = useState<boolean>(false);
  const [recodeProg, setRecodeProg] = useState<{ processed: number; total: number } | null>(null);
  const [agreeErr, setAgreeErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: camps }, { data: ets }] = await Promise.all([
        supabase.from("campaigns").select("id, name").order("created_at", { ascending: true }),
        supabase.from("event_types").select("key, label"),
      ]);
      const list = (camps as Campaign[]) || [];
      setCampaigns(list);
      const lab: Record<string, string> = {};
      ((ets as { key: string; label: string }[]) || []).forEach((e) => { lab[e.key] = e.label; });
      setLabels(lab);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    setLoading(true);
    (async () => {
      const [{ data: pe }, { data: jb }] = await Promise.all([
        supabase.from("proposed_events").select("status, event_type, axis, confidence, extractor_version").eq("campaign_id", campaignId),
        supabase.from("capture_jobs").select("id, status, session:sessions(session_number)").eq("campaign_id", campaignId).in("status", ["review", "done"]).order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      setRows((pe as PE[]) || []);
      const jlist = (jb as unknown as JobRow[]) || [];
      setJobs(jlist);
      setJobId(jlist.length ? jlist[0].id : "");
      setLoading(false);
    })();
    return () => { active = false; };
  }, [campaignId, supabase]);

  async function loadCodings(jid: string) {
    setAgreeErr(null);
    const [{ count }, { data: aRows }, { data: bRows }] = await Promise.all([
      supabase.from("transcript_segments").select("*", { count: "exact", head: true }).eq("job_id", jid),
      supabase.from("proposed_events").select("segment_id, event_type, confidence").eq("job_id", jid),
      supabase.from("recodings").select("segment_id, event_type, confidence").eq("job_id", jid),
    ]);
    setSegN(count ?? 0);
    const build = (data: { segment_id: string | null; event_type: string | null; confidence: number | null }[] | null): Record<string, string> => {
      const map: Record<string, string> = {};
      const conf: Record<string, number> = {};
      (data || []).forEach((r) => {
        if (!r.segment_id || !r.event_type) return;
        const c = r.confidence ?? 0;
        if (map[r.segment_id] === undefined || c > conf[r.segment_id]) { map[r.segment_id] = r.event_type; conf[r.segment_id] = c; }
      });
      return map;
    };
    setCodingA(build(aRows as { segment_id: string | null; event_type: string | null; confidence: number | null }[]));
    setCodingB(build(bRows as { segment_id: string | null; event_type: string | null; confidence: number | null }[]));
  }

  useEffect(() => {
    if (jobId) loadCodings(jobId);
    else { setSegN(null); setCodingA({}); setCodingB({}); }
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runRecode() {
    if (!jobId) return;
    setRecoding(true); setAgreeErr(null); setRecodeProg(null);
    let done = false;
    while (!done) {
      const res = await fetch("/api/recode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setAgreeErr(out.error || "Second coding failed."); break; }
      setRecodeProg({ processed: out.processed, total: out.total });
      done = Boolean(out.done);
    }
    setRecoding(false);
    await loadCodings(jobId);
  }

  const stats = useMemo(() => {
    const reviewed = rows.filter((r) => r.status === "accepted" || r.status === "rejected");
    const accepted = reviewed.filter((r) => r.status === "accepted").length;
    const pending = rows.filter((r) => r.status === "proposed").length;
    const acceptRate = reviewed.length ? accepted / reviewed.length : 0;
    const bucketDefs: [number, number][] = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 101]];
    const calib = bucketDefs.map(([lo, hi]) => {
      const inb = reviewed.filter((r) => { const c = (r.confidence ?? 0) * 100; return c >= lo && c < hi; });
      const acc = inb.filter((r) => r.status === "accepted").length;
      return { lo, hi: Math.min(hi, 100), n: inb.length, rate: inb.length ? acc / inb.length : 0, mid: (lo + Math.min(hi, 100)) / 2 / 100 };
    });
    const byGroup = (keyFn: (r: PE) => string | null): Group[] => {
      const m = new Map<string, { n: number; acc: number }>();
      reviewed.forEach((r) => {
        const k = keyFn(r);
        if (!k) return;
        const e = m.get(k) || { n: 0, acc: 0 };
        e.n += 1;
        if (r.status === "accepted") e.acc += 1;
        m.set(k, e);
      });
      return Array.from(m.entries()).map(([k, v]) => ({ k, n: v.n, rate: v.acc / v.n })).sort((a, b) => b.n - a.n);
    };
    return {
      reviewed: reviewed.length, accepted, pending, acceptRate, calib,
      byType: byGroup((r) => r.event_type), byAxis: byGroup((r) => r.axis), byVer: byGroup((r) => r.extractor_version),
    };
  }, [rows]);

  const agree = useMemo(() => {
    const empty = { ready: false, needRecode: false, N: 0, po: 0, kappa: 0, flaggedN: 0, flaggedAgree: 0, cats: [] as string[], M: [] as number[][] };
    if (segN === null || segN === 0) return empty;
    if (Object.keys(codingB).length === 0) return { ...empty, needRecode: true };
    const N = segN;
    const aKeys = Object.keys(codingA);
    const bKeys = Object.keys(codingB);
    const U = new Set([...aKeys, ...bKeys]);
    const typeSet = new Set<string>();
    aKeys.forEach((k) => typeSet.add(codingA[k]));
    bKeys.forEach((k) => typeSet.add(codingB[k]));
    const cats = ["none", ...Array.from(typeSet).sort((x, y) => (labels[x] || x).localeCompare(labels[y] || y))];
    const idx: Record<string, number> = {};
    cats.forEach((c, i) => { idx[c] = i; });
    const M: number[][] = cats.map(() => cats.map(() => 0));
    let agreeU = 0;
    U.forEach((seg) => {
      const a = codingA[seg] || "none";
      const b = codingB[seg] || "none";
      M[idx[a]][idx[b]] += 1;
      if (a === b) agreeU += 1;
    });
    const noneNone = N - U.size;
    M[0][0] += noneNone;
    const rowSum = cats.map((_, i) => M[i].reduce((s, v) => s + v, 0));
    const colSum = cats.map((_, j) => cats.reduce((s, _2, i) => s + M[i][j], 0));
    const po = (agreeU + noneNone) / N;
    let pe = 0;
    for (let i = 0; i < cats.length; i++) pe += (rowSum[i] / N) * (colSum[i] / N);
    const kappa = pe >= 1 ? 1 : (po - pe) / (1 - pe);
    return { ready: true, needRecode: false, N, po, kappa, flaggedN: U.size, flaggedAgree: agreeU, cats, M };
  }, [segN, codingA, codingB, labels]);

  const box = { ...surfaces.slate, padding: 20, marginBottom: 18 } as const;

  const Bar = ({ rate }: { rate: number }) => (
    <div style={{ flex: 1, height: 8, background: C.surface2, borderRadius: 8, overflow: "hidden", minWidth: 60 }}>
      <div style={{ height: "100%", width: pct(rate), background: rateColor(rate) }} />
    </div>
  );
  const Row = ({ label, chip, n, rate }: { label: string; chip?: string; n: number; rate: number }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 150, fontSize: 13, display: "flex", alignItems: "center", gap: 7 }}>
        {chip && <span style={{ width: 9, height: 9, borderRadius: 9, background: chip, flexShrink: 0 }} />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      <Bar rate={rate} />
      <div style={{ width: 78, textAlign: "right", fontSize: 13 }}>
        <span style={{ color: rateColor(rate), fontWeight: 700 }}>{pct(rate)}</span>
        <span style={{ color: C.muted }}> · {n}</span>
      </div>
    </div>
  );

  return (
    <PageShell width={880}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Reliability</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px" }}>
        How well the extractor codes. Precision and calibration come from your review decisions; the agreement section double-codes a session and compares the two passes.
      </p>

        <div style={box}>
          <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>CAMPAIGN</label>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 15 }}>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </div>

        {loading ? (
          <div style={{ ...box, color: C.muted, fontSize: 14 }}>Loading…</div>
        ) : stats.reviewed === 0 ? (
          <div style={{ ...box, color: C.muted, fontSize: 14 }}>
            No reviewed proposals yet. As you accept and reject in the Review queue, precision and calibration fill in.
            {stats.pending > 0 && <> There {stats.pending === 1 ? "is" : "are"} {stats.pending} awaiting review.</>}
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 18 }}>
              <div style={{ ...box, marginBottom: 0, textAlign: "center" }}>
                <div style={{ fontSize: 34, fontWeight: 800, color: rateColor(stats.acceptRate) }}>{pct(stats.acceptRate)}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>accept rate (precision)</div>
              </div>
              <div style={{ ...box, marginBottom: 0, textAlign: "center" }}>
                <div style={{ fontSize: 34, fontWeight: 800 }}>{stats.reviewed}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>reviewed ({stats.accepted} accepted)</div>
              </div>
              <div style={{ ...box, marginBottom: 0, textAlign: "center" }}>
                <div style={{ fontSize: 34, fontWeight: 800, color: C.sun }}>{stats.pending}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>still awaiting review</div>
              </div>
            </div>

            <div style={box}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Calibration</div>
              <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 16 }}>
                Is the extractor&apos;s confidence honest? In a well-calibrated model the accept rate in each band lands near the band itself; the trailing number is the gap from the band midpoint.
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {stats.calib.map((b) => {
                  const delta = b.n ? b.rate - b.mid : 0;
                  return (
                    <div key={b.lo} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 150, fontSize: 13, color: C.muted, fontFamily: "ui-monospace, monospace" }}>conf {b.lo}-{b.hi}%</div>
                      <Bar rate={b.rate} />
                      <div style={{ width: 120, textAlign: "right", fontSize: 13 }}>
                        {b.n === 0 ? <span style={{ color: C.muted }}>no data</span> : (
                          <>
                            <span style={{ color: rateColor(b.rate), fontWeight: 700 }}>{pct(b.rate)}</span>
                            <span style={{ color: C.muted }}> · {b.n}</span>
                            <span style={{ color: Math.abs(delta) <= 0.15 ? C.good : C.warn, fontSize: 11, marginLeft: 6 }}>{delta >= 0 ? "+" : ""}{Math.round(delta * 100)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={box}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Accept rate by event type</div>
              <div style={{ display: "grid", gap: 12 }}>{stats.byType.map((g) => (<Row key={g.k} label={labels[g.k] || g.k} n={g.n} rate={g.rate} />))}</div>
            </div>

            <div style={box}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Accept rate by axis</div>
              <div style={{ display: "grid", gap: 12 }}>{stats.byAxis.map((g) => (<Row key={g.k} label={AXES[g.k as AxisKey]?.tavernName || g.k} chip={AXES[g.k as AxisKey]?.color} n={g.n} rate={g.rate} />))}</div>
            </div>

            <div style={box}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Accept rate by extractor version</div>
              <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 16 }}>When you revise the prompt or model the version string changes, so you can see whether reliability moved.</div>
              <div style={{ display: "grid", gap: 12 }}>{stats.byVer.map((g) => (<Row key={g.k} label={g.k} n={g.n} rate={g.rate} />))}</div>
            </div>
          </>
        )}

        {/* double-coding / inter-version agreement */}
        <div style={box}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Inter-version agreement (double-coding)</div>
          <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 14 }}>
            Runs the extractor a second, independent time over the same transcript and measures how reproducible the coding is, with Cohen&apos;s kappa over per-segment labels.
          </div>

          {jobs.length === 0 ? (
            <p style={{ color: C.muted, fontSize: 13 }}>No transcribed-and-extracted sessions in this campaign yet.</p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
                <select value={jobId} onChange={(e) => setJobId(e.target.value)}
                  style={{ flex: 1, minWidth: 180, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14 }}>
                  {jobs.map((j) => (<option key={j.id} value={j.id}>Session {j.session?.session_number ?? "?"} ({j.status})</option>))}
                </select>
                <button type="button" onClick={runRecode} disabled={recoding || !jobId}
                  style={{ background: C.plum, color: SAX.inkDeep, border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: recoding ? "default" : "pointer", opacity: recoding ? 0.7 : 1 }}>
                  {recoding ? "Coding…" : agree.needRecode ? "Run second coding" : "Re-run second coding"}
                </button>
              </div>

              {recoding && recodeProg && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ height: 6, background: C.surface2, borderRadius: 6, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${recodeProg.total ? Math.round((recodeProg.processed / recodeProg.total) * 100) : 0}%`, background: C.plum }} />
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{recodeProg.processed} / {recodeProg.total} transcript lines</div>
                </div>
              )}
              {agreeErr && <p style={{ color: C.warn, fontSize: 13, marginBottom: 10 }}>{agreeErr}</p>}

              {agree.needRecode && !recoding && (
                <p style={{ color: C.muted, fontSize: 13 }}>No second coding yet for this session. Run it to compute agreement.</p>
              )}

              {agree.ready && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
                    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 30, fontWeight: 800, color: rateColor(Math.max(0, agree.kappa)) }}>{agree.kappa.toFixed(2)}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Cohen&apos;s kappa ({kappaLabel(agree.kappa)})</div>
                    </div>
                    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 30, fontWeight: 800 }}>{pct(agree.po)}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>raw agreement, all {agree.N} lines</div>
                    </div>
                    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 30, fontWeight: 800 }}>{agree.flaggedN ? pct(agree.flaggedAgree / agree.flaggedN) : "—"}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>agreement on flagged ({agree.flaggedN})</div>
                    </div>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Confusion matrix (rows = pass A, columns = pass B)</div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
                    {agree.cats.map((c, i) => `${i} = ${c === "none" ? "(none)" : (labels[c] || c)}`).join("   ")}
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: "4px 8px", color: C.muted }}></th>
                          {agree.cats.map((_, j) => (<th key={j} style={{ padding: "4px 8px", color: C.muted, fontWeight: 600 }}>{j}</th>))}
                        </tr>
                      </thead>
                      <tbody>
                        {agree.cats.map((_, i) => (
                          <tr key={i}>
                            <td style={{ padding: "4px 8px", color: C.muted, fontWeight: 600 }}>{i}</td>
                            {agree.cats.map((_2, j) => {
                              const v = agree.M[i][j];
                              const diag = i === j;
                              return (
                                <td key={j} style={{ padding: "4px 10px", textAlign: "center", background: diag && v > 0 ? "rgba(93,190,154,0.18)" : "transparent", color: v === 0 ? C.line : C.text, border: `1px solid ${C.line}` }}>{v}</td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ color: C.muted, fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>
                    Note: each event is pinned to the single transcript line it cites, so when the two passes cite adjacent lines for the same beat it counts as a disagreement. This makes kappa a conservative lower bound on true agreement.
                  </p>
                </>
              )}
            </>
          )}
        </div>
    </PageShell>
  );
}
