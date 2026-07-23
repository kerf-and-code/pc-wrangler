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
// Kappa is not a percentage and should not be coloured like one. 0.6 is the conventional
// floor for "substantial", which is where these numbers start being safe to build on.
const kappaColor = (k: number): string => (k >= 0.6 ? "#5DBE9A" : k >= 0.4 ? "#F4C430" : "#E07A5F");

type Agreement = {
  ready: boolean; needRecode: boolean;
  N: number; flaggedA: number; flaggedB: number; flaggedBoth: number; flaggedEither: number;
  prevalence: number;
  detectPo: number; detectKappa: number;
  classN: number; classAgree: number; classPo: number; classKappa: number;
  cats: string[]; M: number[][];
};

// Plain language for a GM, not a methods section. Every line is about what the number
// means for their session rather than what it is.
//
// The interpretation is generated rather than left to the reader on purpose: a GM reading
// "kappa 0.41" has no way to know whether to trust the spotlight chart, and guessing wrong
// in either direction is worse than not showing the number at all.
function readAgreement(a: Agreement): { headline: string; points: string[] } {
  const points: string[] = [];

  if (a.detectKappa >= 0.6) {
    points.push("It picks out the same moments from one run to the next, so the review queue you see is close to the one you would get on a re-run.");
  } else if (a.detectKappa >= 0.4) {
    points.push("It is only moderately consistent about which lines are worth flagging. A second pass would surface a noticeably different queue, so treat counts per session as approximate rather than exact.");
  } else {
    points.push("It is inconsistent about which lines contain anything at all. A second pass would flag substantially different moments, so per-session counts are not yet dependable on their own.");
  }

  if (a.classN === 0) {
    points.push("The two passes never flagged the same line, so there is nothing to compare on the question of what kind of moment it was.");
  } else if (a.classKappa >= 0.6) {
    points.push("When both passes flag the same moment they usually agree on what kind it was, so the axis and spotlight breakdowns rest on solid ground.");
  } else if (a.classKappa >= 0.4) {
    points.push("When both passes flag the same moment they often disagree about what kind it was. Totals per character hold up better than the breakdown by axis.");
  } else {
    points.push("Even when both passes flag the same moment they rarely agree on what kind it was. Read the axis labels as suggestions and lean on your own review decisions.");
  }

  if (a.classN > 0 && a.classN < 20) {
    points.push(`Only ${a.classN} moment${a.classN === 1 ? " was" : "s were"} flagged by both passes, so the second figure is a rough indication rather than a measurement. Record a longer session to firm it up.`);
  }

  if (a.prevalence < 0.05) {
    points.push(`Only ${pct(a.prevalence)} of lines were flagged by either pass. When events are this rare, the first figure swings a lot on a handful of lines.`);
  }

  const worst = Math.min(a.detectKappa, a.classN > 0 ? a.classKappa : 1);
  const headline =
    worst >= 0.6 ? "The extractor is reproducing itself well. Numbers built on these events are safe to act on."
    : worst >= 0.4 ? "The extractor is reasonably reproducible, with room to improve. Use the totals with some caution and your own review as the final word."
    : "The extractor is not yet reproducing itself reliably. Your review decisions are the trustworthy part; the automatic numbers are a starting point.";

  return { headline, points };
}

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

  // Every query on this page reads a table that grows with play, and every number shown
  // is computed from ALL the rows rather than a sample. An unbounded select silently stops
  // at PostgREST's 1000-row cap, so a large campaign would have its accept rate,
  // calibration and kappa computed from a prefix and report them as if they were the whole
  // picture. A reliability page that is itself unreliable is worse than no page.
  //
  // Crowned Calamity already has 6767 transcript segments, so this is not hypothetical.
  //
  // apply is typed loosely on purpose. supabase-js builders are generic over the schema and
  // the row shape, and select() returns a FILTER builder rather than the query builder
  // from() gives you, so threading the real types through a helper like this costs more
  // than it proves. The callers only ever add plain filters.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function pageAll<T>(
    table: string,
    columns: string,
    apply: (q: any) => any,
  ): Promise<T[]> {
    const PAGE = 1000;
    const out: T[] = [];
    for (let page = 0; page < 100; page++) {
      const from = page * PAGE;
      const { data, error } = await apply(supabase.from(table).select(columns))
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) break;
      const rows = (data as T[]) || [];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    setLoading(true);
    (async () => {
      const [pe, { data: jb }] = await Promise.all([
        pageAll<PE>(
          "proposed_events",
          "id, status, event_type, axis, confidence, extractor_version",
          (q) => q.eq("campaign_id", campaignId),
        ),
        supabase.from("capture_jobs").select("id, status, session:sessions(session_number)").eq("campaign_id", campaignId).in("status", ["review", "done"]).order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      setRows(pe);
      const jlist = (jb as unknown as JobRow[]) || [];
      setJobs(jlist);
      setJobId(jlist.length ? jlist[0].id : "");
      setLoading(false);
    })();
    return () => { active = false; };
  }, [campaignId, supabase]);

  async function loadCodings(jid: string) {
    setAgreeErr(null);
    // head:true returns a count and no rows, so the segment total is not subject to the cap.
    // The two coding passes very much are: a busy session can propose more than 1000 events
    // on its own, and a truncated pass would look like an extractor that simply stopped
    // finding things, which reads as poor recall rather than a missing page.
    type CodeRow = { segment_id: string | null; event_type: string | null; confidence: number | null };
    const [{ count }, aRows, bRows] = await Promise.all([
      supabase.from("transcript_segments").select("*", { count: "exact", head: true }).eq("job_id", jid),
      pageAll<CodeRow>(
        "proposed_events",
        "id, segment_id, event_type, confidence",
        (q) => q.eq("job_id", jid),
      ),
      pageAll<CodeRow>(
        "recodings",
        "id, segment_id, event_type, confidence",
        (q) => q.eq("job_id", jid),
      ),
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
    setCodingA(build(aRows));
    setCodingB(build(bRows));
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

  // TWO QUESTIONS, NOT ONE.
  //
  // The previous version reported a single kappa over every transcript segment with
  // "none" as a category. On a real session that is dominated by the cell where both
  // passes agree nothing happened: 3146 segments with roughly 250 ever flagged puts about
  // 92 percent of the matrix in one corner, so the headline number was mostly a measure of
  // agreement about silence.
  //
  // Splitting it separates two failure modes that need different fixes:
  //
  //   detection       over ALL segments, binary. Do the passes flag the same lines? The
  //                   rare-positive skew is legitimate here, because that IS the question.
  //   classification  over the intersection only. Given both flagged a line, do they agree
  //                   what kind of moment it was? No "none" category, so nothing is
  //                   inflated by empty segments.
  //
  // An extractor unsure what counts as an event is a different problem from one that
  // agrees something happened but not what, and the old single number could not tell them
  // apart.
  const agree = useMemo<Agreement>(() => {
    const empty: Agreement = {
      ready: false, needRecode: false,
      N: 0, flaggedA: 0, flaggedB: 0, flaggedBoth: 0, flaggedEither: 0, prevalence: 0,
      detectPo: 0, detectKappa: 0,
      classN: 0, classAgree: 0, classPo: 0, classKappa: 0,
      cats: [], M: [],
    };
    if (segN === null || segN === 0) return empty;
    if (Object.keys(codingB).length === 0) return { ...empty, needRecode: true };

    const N = segN;
    const aKeys = Object.keys(codingA);
    const bKeys = Object.keys(codingB);
    const U = new Set([...aKeys, ...bKeys]);

    // ---- detection: a 2x2 over every segment ----
    const both = aKeys.filter((k) => codingB[k] !== undefined).length;
    const aOnly = aKeys.length - both;
    const bOnly = bKeys.length - both;
    const neither = N - U.size;
    const detectPo = (both + neither) / N;
    const detectPe =
      ((both + aOnly) / N) * ((both + bOnly) / N) +
      ((bOnly + neither) / N) * ((aOnly + neither) / N);
    const detectKappa = detectPe >= 1 ? 1 : (detectPo - detectPe) / (1 - detectPe);

    // ---- classification: types, over the intersection only ----
    const shared = aKeys.filter((k) => codingB[k] !== undefined);
    const classN = shared.length;
    const classTypes = new Set<string>();
    shared.forEach((k) => { classTypes.add(codingA[k]); classTypes.add(codingB[k]); });
    const cTypes = Array.from(classTypes);
    const cIdx: Record<string, number> = {};
    cTypes.forEach((t, i) => { cIdx[t] = i; });
    const cM: number[][] = cTypes.map(() => cTypes.map(() => 0));
    let classAgree = 0;
    shared.forEach((k) => {
      const a = codingA[k];
      const b = codingB[k];
      cM[cIdx[a]][cIdx[b]] += 1;
      if (a === b) classAgree += 1;
    });
    const classPo = classN ? classAgree / classN : 0;
    let classPe = 0;
    if (classN) {
      for (let i = 0; i < cTypes.length; i++) {
        const r = cM[i].reduce((sm, v) => sm + v, 0);
        const c = cM.reduce((sm, row) => sm + row[i], 0);
        classPe += (r / classN) * (c / classN);
      }
    }
    const classKappa = !classN || classPe >= 1 ? (classPo === 1 ? 1 : 0) : (classPo - classPe) / (1 - classPe);

    // ---- the full matrix is kept for anyone who wants to look ----
    const typeSet = new Set<string>();
    aKeys.forEach((k) => typeSet.add(codingA[k]));
    bKeys.forEach((k) => typeSet.add(codingB[k]));
    const cats = ["none", ...Array.from(typeSet).sort((x, y) => (labels[x] || x).localeCompare(labels[y] || y))];
    const idx: Record<string, number> = {};
    cats.forEach((c, i) => { idx[c] = i; });
    const M: number[][] = cats.map(() => cats.map(() => 0));
    U.forEach((seg) => {
      M[idx[codingA[seg] || "none"]][idx[codingB[seg] || "none"]] += 1;
    });
    M[0][0] += neither;

    return {
      ready: true, needRecode: false,
      N, flaggedA: aKeys.length, flaggedB: bKeys.length, flaggedBoth: both,
      flaggedEither: U.size, prevalence: U.size / N,
      detectPo, detectKappa,
      classN, classAgree, classPo, classKappa,
      cats, M,
    };
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
        <span title={label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
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
            Runs the extractor a second, independent time over the same transcript and asks two separate questions: does it pick out the same moments, and does it call them the same thing. Both are Cohen&apos;s kappa, which is agreement corrected for what you would get by chance, so 0 means no better than guessing and 1 means identical.
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
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
                    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 30, fontWeight: 800, color: kappaColor(agree.detectKappa) }}>{agree.detectKappa.toFixed(2)}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>Spots the same moments</div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{kappaLabel(agree.detectKappa)} · {agree.N} lines</div>
                    </div>
                    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 30, fontWeight: 800, color: agree.classN ? kappaColor(agree.classKappa) : C.muted }}>
                        {agree.classN ? agree.classKappa.toFixed(2) : "n/a"}
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>Calls them the same thing</div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>
                        {agree.classN ? `${kappaLabel(agree.classKappa)} · ${agree.classN} shared` : "no shared moments"}
                      </div>
                    </div>
                    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: 30, fontWeight: 800 }}>{pct(agree.prevalence)}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>Of the session is eventful</div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{agree.flaggedEither} of {agree.N} lines flagged</div>
                    </div>
                  </div>

                  {/* The reading. A GM should not have to know what kappa is to know whether
                      to trust the spotlight chart. */}
                  {(() => {
                    const r = readAgreement(agree);
                    return (
                      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>{r.headline}</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.65, color: C.muted }}>
                          {r.points.map((t, i) => (<li key={i}>{t}</li>))}
                        </ul>
                      </div>
                    );
                  })()}

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
