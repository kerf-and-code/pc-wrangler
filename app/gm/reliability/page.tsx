"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { surfaces, ui, AXES, type AxisKey } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { initialCampaignId, useRememberCampaign } from "@/lib/campaign-context";

type Campaign = { id: string; name: string };
type PE = { status: string; event_type: string; axis: string | null; confidence: number | null; extractor_version: string | null };
type Group = { k: string; n: number; rate: number };
type JobRow = { id: string; status: string; session: { session_number: number | null } | null };

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const rateColor = (r: number): string => (r >= 0.7 ? C.good : r >= 0.4 ? C.brass : C.warn);
const kappaLabel = (k: number): string =>
  k < 0 ? "poor" : k < 0.2 ? "slight" : k < 0.4 ? "fair" : k < 0.6 ? "moderate" : k < 0.8 ? "substantial" : "almost perfect";
// Kappa is not a percentage and should not be coloured like one. 0.6 is the conventional
// floor for "substantial", which is where these numbers start being safe to build on.
const kappaColor = (k: number): string => (k >= 0.6 ? C.good : k >= 0.4 ? C.brass : C.warn);

// Agreement between the extractor (coder A) and a human coding a blind, stratified sample (coder B).
// See computeAgreement for the weighting and readAgreement for what the numbers mean to a GM.
type SampleItem = { a: string | null; b: string | null; stratum: string; stratum_size: number; inclusion_prob: number };
type Agreement = {
  n: number; nFlagged: number; nUnflagged: number; linesInSession: number;
  detectKappa: number; detectLo: number; detectHi: number; detectPo: number;
  classN: number; classAgree: number; classKappa: number; classLo: number; classHi: number;
  prevalence: number;
  cats: string[]; M: number[][];
};

const kappa2x2 = (n11: number, n10: number, n01: number, n00: number): number => {
  const T = n11 + n10 + n01 + n00;
  if (T <= 0) return 0;
  const po = (n11 + n00) / T;
  const pA = (n11 + n10) / T;
  const pB = (n11 + n01) / T;
  const pe = pA * pB + (1 - pA) * (1 - pB);
  return pe >= 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
};

// Weighted detection kappa: each sampled line stands for 1 / inclusion_prob lines of its stratum, so the
// 2x2 is an estimate for the WHOLE session even though the sample is half flagged lines by design.
function detection(items: SampleItem[]): { kappa: number; po: number; prevalence: number } {
  let n11 = 0, n10 = 0, n01 = 0, n00 = 0;
  for (const it of items) {
    const w = 1 / it.inclusion_prob;
    const a = it.a !== null, b = it.b !== null;
    if (a && b) n11 += w; else if (a) n10 += w; else if (b) n01 += w; else n00 += w;
  }
  const T = n11 + n10 + n01 + n00;
  return { kappa: kappa2x2(n11, n10, n01, n00), po: T ? (n11 + n00) / T : 0, prevalence: T ? (n11 + n01) / T : 0 };
}

// Classification kappa over lines BOTH coders flagged. Those lines all come from the flagged stratum,
// which has one inclusion probability, so equal weights are correct here and no weighting is needed.
function classification(items: SampleItem[]): { kappa: number; n: number; agree: number } {
  const shared = items.filter((it) => it.a !== null && it.b !== null);
  const n = shared.length;
  if (!n) return { kappa: 0, n: 0, agree: 0 };
  const types = Array.from(new Set(shared.flatMap((it) => [it.a as string, it.b as string])));
  const ix = new Map(types.map((t, i) => [t, i]));
  const M = types.map(() => types.map(() => 0));
  let agree = 0;
  for (const it of shared) { M[ix.get(it.a as string)!][ix.get(it.b as string)!] += 1; if (it.a === it.b) agree += 1; }
  const po = agree / n;
  let pe = 0;
  for (let i = 0; i < types.length; i++) {
    const r = M[i].reduce((s, v) => s + v, 0);
    const c = M.reduce((s, row) => s + row[i], 0);
    pe += (r / n) * (c / n);
  }
  return { kappa: pe >= 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe), n, agree };
}

// 95% intervals by stratified bootstrap: resample lines with replacement WITHIN each stratum, keeping
// each stratum's size, and recompute. Percentile interval over 2000 replicates.
function bootstrap(items: SampleItem[]): { dLo: number; dHi: number; cLo: number; cHi: number } {
  const strata = new Map<string, SampleItem[]>();
  for (const it of items) strata.set(it.stratum, [...(strata.get(it.stratum) || []), it]);
  const d: number[] = [], c: number[] = [];
  for (let r = 0; r < 2000; r++) {
    const rs: SampleItem[] = [];
    for (const list of strata.values()) for (let i = 0; i < list.length; i++) rs.push(list[Math.floor(Math.random() * list.length)]);
    d.push(detection(rs).kappa);
    const cl = classification(rs);
    if (cl.n) c.push(cl.kappa);
  }
  const q = (xs: number[], p: number) => { if (!xs.length) return 0; const s = xs.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; };
  return { dLo: q(d, 0.025), dHi: q(d, 0.975), cLo: q(c, 0.025), cHi: q(c, 0.975) };
}

function computeAgreement(items: SampleItem[], labels: Record<string, string>): Agreement {
  const det = detection(items);
  const cl = classification(items);
  const bs = bootstrap(items);
  const sizes = new Map<string, number>();
  items.forEach((it) => sizes.set(it.stratum, it.stratum_size));
  const typeSet = new Set<string>();
  items.forEach((it) => { if (it.a) typeSet.add(it.a); if (it.b) typeSet.add(it.b); });
  const cats = ["none", ...Array.from(typeSet).sort((x, y) => (labels[x] || x).localeCompare(labels[y] || y))];
  const idx: Record<string, number> = {};
  cats.forEach((c, i) => { idx[c] = i; });
  const M: number[][] = cats.map(() => cats.map(() => 0));
  items.forEach((it) => { M[idx[it.a || "none"]][idx[it.b || "none"]] += 1; });
  return {
    n: items.length,
    nFlagged: items.filter((it) => it.stratum === "flagged").length,
    nUnflagged: items.filter((it) => it.stratum === "unflagged").length,
    linesInSession: Array.from(sizes.values()).reduce((s, v) => s + v, 0),
    detectKappa: det.kappa, detectLo: bs.dLo, detectHi: bs.dHi, detectPo: det.po,
    classN: cl.n, classAgree: cl.agree, classKappa: cl.kappa, classLo: bs.cLo, classHi: bs.cHi,
    prevalence: det.prevalence,
    cats, M,
  };
}

// Plain language for a GM, not a methods section. Every line is about what the number means for their
// session, and the uncertainty is said out loud rather than hidden behind two decimal places.
function readAgreement(a: Agreement): { headline: string; points: string[] } {
  const points: string[] = [];
  if (a.detectKappa >= 0.6) {
    points.push("You and the extractor mostly agree on which lines hold a moment worth counting, so its per-session counts track what a person would count.");
  } else if (a.detectKappa >= 0.4) {
    points.push("You and the extractor only moderately agree on which lines hold a moment worth counting. Treat its counts per session as approximate.");
  } else {
    points.push("You and the extractor often disagree about whether a line holds anything at all. Its per-session counts are not yet dependable on their own.");
  }
  if (a.classN === 0) {
    points.push("No line was flagged by both of you, so there is nothing to compare on what kind of moment it was.");
  } else if (a.classKappa >= 0.6) {
    points.push("When you both flag a line you usually agree on what kind of moment it was, so the axis and spotlight breakdowns rest on solid ground.");
  } else if (a.classKappa >= 0.4) {
    points.push("When you both flag a line you often disagree on what kind of moment it was. Totals per character hold up better than the breakdown by axis.");
  } else {
    points.push("Even when you both flag a line you rarely agree on what kind of moment it was. Read the axis labels as suggestions.");
  }
  if (a.detectHi - a.detectLo > 0.3 || (a.classN > 0 && a.classHi - a.classLo > 0.3)) {
    points.push("The ranges are wide because the sample is small. Code another session, or draw a bigger sample, before leaning on these figures.");
  }
  if (a.classN > 0 && a.classN < 20) {
    points.push(`Only ${a.classN} line${a.classN === 1 ? " was" : "s were"} flagged by both of you, so the second figure is a rough indication rather than a measurement.`);
  }
  const worst = Math.min(a.detectKappa, a.classN > 0 ? a.classKappa : 1);
  const headline =
    worst >= 0.6 ? "The extractor agrees with a person well. Numbers built on its events are safe to act on."
    : worst >= 0.4 ? "The extractor agrees with a person reasonably well, with room to improve. Use the totals with some caution."
    : "The extractor does not yet agree with a person reliably. Your review decisions are the trustworthy part; the automatic numbers are a starting point.";
  return { headline, points };
}

export default function ReliabilityPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  useRememberCampaign(campaignId, campaigns);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<PE[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  // Set when paging stopped early, so the numbers are visibly marked as partial rather than
  // presented as the whole campaign (the very failure the pageAll comment below exists to prevent).
  const [partial, setPartial] = useState<string | null>(null);

  // human second coding (blind sample) state
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobId, setJobId] = useState<string>("");
  const [sample, setSample] = useState<{ total: number; coded: number } | null>(null);
  const [results, setResults] = useState<SampleItem[] | null>(null);
  const [perStratum, setPerStratum] = useState<number>(40);
  const [busy, setBusy] = useState<boolean>(false);
  const [agreeErr, setAgreeErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: camps }, { data: ets }] = await Promise.all([
        supabase.from("campaigns").select("id, name, system").order("created_at", { ascending: true }),
        supabase.from("event_types").select("key, label"),
      ]);
      const list = (camps as Campaign[]) || [];
      setCampaigns(list);
      const lab: Record<string, string> = {};
      ((ets as { key: string; label: string }[]) || []).forEach((e) => { lab[e.key] = e.label; });
      setLabels(lab);
      // No campaigns: the loader effect below early-returns on the empty
      // campaignId, so clear loading here or the page shows "Loading..." forever.
      if (list.length) setCampaignId(initialCampaignId(list));
      else setLoading(false);
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
      if (error) { setPartial(`Only ${out.length} rows of ${table.replace(/_/g, " ")} loaded (${error.message}). The figures below are computed from part of the data; reload to try again.`); break; }
      const rows = (data as T[]) || [];
      out.push(...rows);
      if (rows.length < PAGE) break;
      if (page === 99) setPartial(`Stopped after ${out.length} rows of ${table.replace(/_/g, " ")}. The figures below are computed from part of the data.`);
    }
    return out;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    setLoading(true);
    setPartial(null);
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

  // The coding progress for the chosen session, and the comparison once every line is coded. Results
  // are only served after coding is complete (the route refuses earlier), so the GM cannot peek.
  async function loadSample(jid: string) {
    setAgreeErr(null); setResults(null);
    const res = await fetch(`/api/coding-sample?jobId=${encodeURIComponent(jid)}`);
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setSample(null); setAgreeErr(out.error || "Could not load the coding sample."); return; }
    const s = { total: Number(out.total) || 0, coded: Number(out.coded) || 0 };
    setSample(s);
    if (s.total > 0 && s.coded === s.total) {
      const r = await fetch(`/api/coding-sample?jobId=${encodeURIComponent(jid)}&results=1`);
      const ro = await r.json().catch(() => ({}));
      if (r.ok) setResults((ro.items as SampleItem[]) || []);
      else setAgreeErr(ro.error || "Could not load the results.");
    }
  }

  useEffect(() => {
    if (jobId) loadSample(jobId);
    else { setSample(null); setResults(null); }
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function drawSample() {
    if (!jobId || busy) return;
    setBusy(true); setAgreeErr(null);
    const res = await fetch("/api/coding-sample", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, action: "create", perStratum }) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setAgreeErr(out.error || "Could not draw the sample."); return; }
    await loadSample(jobId);
  }

  async function discardSample() {
    if (!jobId || busy) return;
    if (!window.confirm("Discard this session's coding sample and every answer in it? This cannot be undone.")) return;
    setBusy(true); setAgreeErr(null);
    const res = await fetch("/api/coding-sample", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, action: "reset" }) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setAgreeErr(out.error || "Could not discard the sample."); return; }
    await loadSample(jobId);
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

  // TWO QUESTIONS, NOT ONE, as before: detection (does a line hold an event at all, weighted to the
  // whole session) and classification (given you both flagged it, the same kind?). Coder A is the
  // extractor's top event per line; coder B is the human. The old version compared the extractor with
  // a second run of itself, which shares its biases and can agree for the wrong reasons.
  const agree = useMemo<Agreement | null>(() => (results && results.length ? computeAgreement(results, labels) : null), [results, labels]);

  const box = { ...surfaces.slate, padding: 20, marginBottom: 18 } as const;

  const Bar = ({ rate }: { rate: number }) => (
    <div style={{ flex: 1, height: 8, background: C.surface2, borderRadius: FORGE_RADIUS, overflow: "hidden", minWidth: 60 }}>
      <div style={{ height: "100%", width: pct(rate), background: rateColor(rate) }} />
    </div>
  );
  const Row = ({ label, chip, n, rate }: { label: string; chip?: string; n: number; rate: number }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 150, fontSize: 13, display: "flex", alignItems: "center", gap: 7 }}>
        {chip && <span style={{ width: 9, height: 9, borderRadius: FORGE_RADIUS, background: chip, flexShrink: 0 }} />}
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
        How well the extractor codes. Precision and calibration come from your review decisions; the agreement section compares the extractor with a person coding a blind sample of one session.
      </p>

        <div style={box}>
          <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>CAMPAIGN</label>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "10px 12px", fontSize: 15, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </div>

        {partial && !loading && <p role="alert" style={{ color: C.warn, fontSize: 13, margin: "0 0 12px" }}>{partial}</p>}
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

        {/* human second coding: agreement between the extractor and a person */}
        <div style={box}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Agreement with a human coder</div>
          <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 14 }}>
            A person codes a blind sample of lines from one session, without seeing what the extractor said, and the two are compared on two questions: do you pick out the same moments, and do you call them the same thing. Both are Cohen&apos;s kappa (0 is chance, 1 is identical), shown with a 95% range. The sample takes about fifteen minutes to code.
          </div>

          {jobs.length === 0 ? (
            <p style={{ color: C.muted, fontSize: 13 }}>No transcribed-and-extracted sessions in this campaign yet.</p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
                <select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Session"
                  style={{ flex: 1, minWidth: 180, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "10px 12px", fontSize: 14 }}>
                  {jobs.map((j) => (<option key={j.id} value={j.id}>Session {j.session?.session_number ?? "?"} ({j.status === "done" ? "reviewed" : "awaiting review"})</option>))}
                </select>
              </div>

              {agreeErr && <p role="alert" style={{ color: C.warn, fontSize: 13, marginBottom: 10 }}>{agreeErr}</p>}

              {sample && sample.total === 0 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <label style={{ fontSize: 13, color: C.muted }}>
                    Lines per group{" "}
                    <select value={perStratum} onChange={(e) => setPerStratum(Number(e.target.value))}
                      style={{ background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "6px 8px", fontSize: 13, marginLeft: 6 }}>
                      <option value={25}>25 (about 50 lines, 8 minutes)</option>
                      <option value={40}>40 (about 80 lines, 15 minutes)</option>
                      <option value={60}>60 (about 120 lines, 25 minutes)</option>
                    </select>
                  </label>
                  <button type="button" onClick={drawSample} disabled={busy}
                    style={{ background: C.plum, color: C.ink, border: "none", borderRadius: FORGE_RADIUS, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
                    {busy ? "Drawing…" : "Draw a coding sample"}
                  </button>
                  <p style={{ color: C.muted, fontSize: 12, margin: "4px 0 0", flexBasis: "100%" }}>
                    Half the lines come from moments the extractor flagged and half from the rest, so even a quiet session gives enough to measure; the figures are weighted back to the whole session. Best coded by someone who has not reviewed this session.
                  </p>
                </div>
              )}

              {sample && sample.total > 0 && sample.coded < sample.total && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <a href={`/gm/reliability/code?job=${encodeURIComponent(jobId)}`}
                    style={{ background: C.plum, color: C.ink, borderRadius: FORGE_RADIUS, padding: "10px 16px", fontWeight: 700, fontSize: 13, textDecoration: "none" }}>
                    {sample.coded === 0 ? "Start coding" : "Continue coding"}
                  </a>
                  <span style={{ fontSize: 13, color: C.muted }}>{sample.coded} of {sample.total} lines coded. Results appear here when every line is done.</span>
                  <button type="button" onClick={discardSample} disabled={busy} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>Discard sample</button>
                </div>
              )}

              {agree && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, margin: "4px 0 14px" }}>
                    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 14, textAlign: "center", boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
                      <div style={{ fontSize: 30, fontWeight: 800, color: kappaColor(agree.detectKappa) }}>{agree.detectKappa.toFixed(2)}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>Spots the same moments</div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{kappaLabel(agree.detectKappa)} {"·"} 95% range {agree.detectLo.toFixed(2)} to {agree.detectHi.toFixed(2)}</div>
                      <div style={{ fontSize: 11.5, color: C.muted }}>{agree.n} lines coded, weighted to {agree.linesInSession}</div>
                    </div>
                    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 14, textAlign: "center", boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
                      <div style={{ fontSize: 30, fontWeight: 800, color: agree.classN ? kappaColor(agree.classKappa) : C.muted }}>{agree.classN ? agree.classKappa.toFixed(2) : "n/a"}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>Calls them the same thing</div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>
                        {agree.classN ? `${kappaLabel(agree.classKappa)} · 95% range ${agree.classLo.toFixed(2)} to ${agree.classHi.toFixed(2)}` : "no line flagged by both"}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.muted }}>{agree.classN} lines flagged by both</div>
                    </div>
                    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 14, textAlign: "center", boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
                      <div style={{ fontSize: 30, fontWeight: 800 }}>{pct(agree.prevalence)}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>Of the session is eventful</div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>by the human coder, weighted estimate</div>
                    </div>
                  </div>
                  <p style={{ fontSize: 11.5, color: C.muted, margin: "0 0 14px" }}>
                    Method: human coder, blind, stratified random sample ({agree.nFlagged} lines the extractor flagged, {agree.nUnflagged} it did not), one primary event per line on both sides.
                  </p>

                  {(() => {
                    const r = readAgreement(agree);
                    return (
                      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "14px 16px", marginBottom: 16 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>{r.headline}</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.65, color: C.muted }}>
                          {r.points.map((t, i) => (<li key={i}>{t}</li>))}
                        </ul>
                      </div>
                    );
                  })()}

                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Sample counts (rows = extractor, columns = human; not weighted)</div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
                    {agree.cats.map((c, i) => `${i} = ${c === "none" ? "(nothing)" : (labels[c] || c)}`).join("   ")}
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: "4px 8px", color: C.muted }}></th>
                          {agree.cats.map((_, j) => (<th key={j} style={{ padding: "4px 8px", color: C.muted, fontWeight: 600, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{j}</th>))}
                        </tr>
                      </thead>
                      <tbody>
                        {agree.cats.map((_, i) => (
                          <tr key={i}>
                            <td style={{ padding: "4px 8px", color: C.muted, fontWeight: 600 }}>{i}</td>
                            {agree.cats.map((_2, j) => {
                              const v = agree.M[i][j];
                              return (
                                <td key={j} style={{ padding: "4px 10px", textAlign: "center", fontVariantNumeric: "tabular-nums", background: i === j && v > 0 ? "rgba(93,190,154,0.18)" : "transparent", color: v === 0 ? C.line : C.text, border: `1px solid ${C.line}` }}>{v}</td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
                    <a href={`/gm/reliability/code?job=${encodeURIComponent(jobId)}`} style={{ fontSize: 12.5, color: C.brass }}>Review or change your answers</a>
                    <button type="button" onClick={discardSample} disabled={busy} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>Discard and draw a new sample</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
    </PageShell>
  );
}