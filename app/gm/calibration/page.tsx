"use client";

// app/gm/calibration/page.tsx (2026-11-11, push 39: encounter calibration)
//
// Does the encounter math match your table? Every finished D&D fight since p161 is measured in the
// database (who started at what HP, who dropped, where everyone ended). This page sets each fight's
// predicted DMG band against how it went (rounds, the party's net HP lost, characters dropped) and,
// once there are enough fights, says whether harder predictions went with harder fights. The maths is
// in lib/calibration.ts.

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { ui } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { initialCampaignId, useRememberCampaign } from "@/lib/campaign-context";
import { LoadingState } from "@/components/ui-forge/States";
import CampaignPicker from "@/components/ui-forge/CampaignPicker";
import { byBand, fightResult, reading, MIN_FIGHTS_TO_JUDGE, type FightResult, type FightRow } from "@/lib/calibration";

type Campaign = { id: string; name: string };
const pct = (x: number | null) => (x === null ? "not tracked" : `${Math.round(x * 100)}%`);
const PAGE = 1000;

export default function CalibrationPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  useRememberCampaign(campaignId, campaigns);
  const [rows, setRows] = useState<FightRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at", { ascending: true });
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(initialCampaignId(list)); else setRows([]);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) return;
    let off = false;
    (async () => {
      setRows(null); setErr(null);
      // every finished fight, paged past the 1000-row cap
      const all: FightRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from("combats")
          .select("id, name, rules, status, round, created_at, ended_at, encounter_id, calibration")
          .eq("campaign_id", campaignId).eq("status", "ended")
          .order("created_at", { ascending: false }).order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) {
          if (!off) setErr(/calibration/.test(error.message) ? "Calibration is not set up on the server yet (the p161 migration)." : error.message);
          return;
        }
        all.push(...((data ?? []) as FightRow[]));
        if (!data || data.length < PAGE) break;
      }
      if (!off) setRows(all);
    })();
    return () => { off = true; };
  }, [supabase, campaignId]);

  const results = useMemo(() => (rows ?? []).map(fightResult).filter((r): r is FightResult => r !== null), [rows]);
  const unmeasured = (rows?.length ?? 0) - results.length;
  const bands = useMemo(() => byBand(results), [results]);
  const methods = useMemo(() => [...new Set(results.map((r) => r.method))].sort(), [results]);

  const box: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "14px 16px", marginBottom: 14 };
  const th: React.CSSProperties = { textAlign: "left", color: C.muted, fontWeight: 600, fontSize: 12, padding: "6px 8px", borderBottom: `1px solid ${C.line}` };
  const td: React.CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${C.line}`, fontSize: 13.5, color: C.text, verticalAlign: "top" };

  return (
    <PageShell width={920}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Calibration</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px", lineHeight: 1.55 }}>
        Does the encounter math match your table? Each finished fight is set against the difficulty the DMG math gives it (the monsters&apos; CR against the characters&apos; levels), next to how it actually went: how many rounds it took, how much of the party&apos;s HP it cost, and how often someone dropped.
      </p>

      <div style={box}>
        <CampaignPicker campaigns={campaigns} value={campaignId} onChange={setCampaignId} />
      </div>

      {err ? <p role="alert" style={{ color: C.warn }}>{err}</p>
        : rows === null ? <LoadingState />
        : results.length === 0 ? (
          <div style={{ ...box, color: C.muted, fontSize: 14, lineHeight: 1.55 }}>
            No measured fights yet. Every D&amp;D fight you run on the Combat page or the tabletop is measured from now on; end it with End fight and it appears here.
            {unmeasured > 0 && <> {unmeasured} earlier finished {unmeasured === 1 ? "fight was" : "fights were"} run before measuring started, so {unmeasured === 1 ? "it is" : "they are"} left out: where everyone ended says nothing about what the fight cost them.</>}
          </div>
        ) : (
          <>
            {methods.map((m) => {
              const r = reading(results, m);
              return (
                <div key={m} style={{ ...box, borderColor: r.n >= MIN_FIGHTS_TO_JUDGE ? C.sun : C.line }}>
                  <div style={{ color: C.sun, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 4 }}>{m === "2024" ? "2024 XP BUDGET" : "2014 THRESHOLDS"}</div>
                  <div style={{ color: C.text, fontSize: 14.5, lineHeight: 1.5 }}>{r.text}</div>
                </div>
              );
            })}

            <div style={box}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>By predicted difficulty</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead><tr>
                    <th style={th}>Predicted</th><th style={th}>Fights</th><th style={th}>Median rounds</th>
                    <th style={th}>Party HP lost (mean)</th><th style={th}>Drops per fight</th><th style={th}>Fights with a drop</th>
                  </tr></thead>
                  <tbody>
                    {bands.map((b) => (
                      <tr key={`${b.method}-${b.band}`}>
                        <td style={td}><b>{b.band}</b> <span style={{ color: C.muted, fontSize: 12 }}>{b.method}</span></td>
                        <td style={td}>{b.n}</td>
                        <td style={td}>{b.medianRounds}</td>
                        <td style={td}>{pct(b.meanHpLost)}</td>
                        <td style={td}>{b.downsPerFight.toFixed(1)}</td>
                        <td style={td}>{b.fightsWithADown} of {b.n}</td>
                      </tr>
                    ))}
                    {bands.length === 0 && <tr><td style={td} colSpan={6}><span style={{ color: C.muted }}>No fight could be predicted yet; the list below says why for each.</span></td></tr>}
                  </tbody>
                </table>
              </div>
              <p style={{ color: C.muted, fontSize: 12, margin: "8px 0 0", lineHeight: 1.5 }}>
                Party HP lost is HP at the start minus HP at the end, over the party&apos;s maximum, so healing during the fight counts against it. A drop is a character going from above 0 HP to 0. With a handful of fights per band these are anecdotes, not rates.
              </p>
            </div>

            <div style={box}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Every measured fight</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead><tr>
                    <th style={th}>Fight</th><th style={th}>Predicted</th><th style={th}>Rounds</th><th style={th}>HP lost</th><th style={th}>Drops</th><th style={th}>Down at the end</th>
                  </tr></thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.id}>
                        <td style={td}>{r.name}<div style={{ color: C.muted, fontSize: 11.5 }}>{new Date(r.when).toLocaleDateString()} · {r.pcs} PC{r.pcs === 1 ? "" : "s"}, {r.monsters} monster{r.monsters === 1 ? "" : "s"}</div></td>
                        <td style={td}>{r.predicted ? <>{r.predicted.band}<div style={{ color: C.muted, fontSize: 11.5 }}>{r.predicted.foeXp.toLocaleString()} XP</div></> : <span style={{ color: C.muted }}>none: {r.why}</span>}</td>
                        <td style={td}>{r.rounds}</td>
                        <td style={td}>{pct(r.hpLost)}</td>
                        <td style={td}>{r.downs}</td>
                        <td style={td}>{r.stillDown}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {unmeasured > 0 && <p style={{ color: C.muted, fontSize: 12, margin: "8px 0 0" }}>{unmeasured} finished {unmeasured === 1 ? "fight is" : "fights are"} not shown: run before measuring started, or not D&amp;D.</p>}
            </div>
          </>
        )}
    </PageShell>
  );
}
