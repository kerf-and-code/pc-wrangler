"use client";

// components/usage-panel.tsx (push 16, audits T22 and F11)
//
// What a campaign has used in the last 30 days: AI calls and tokens, image renders, and transcription
// minutes, read from usage_events (p147) through row level security (the campaign's GMs only). Record
// only for now: nothing is capped. Counts start when p147 runs, so the first weeks are partial.
//
// Push 46 (audit round 2, R1, B9): the totals are counted in the database (campaign_usage_summary,
// p169). Reading the rows here stopped at 1,000, whatever limit was asked for, and the sum of those was
// shown as the whole month. Also an estimated cost at the settled costing-model rates (lib/costing.ts).

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { C } from "@/lib/forge-theme";
import { surfaces } from "@/lib/theme";
import { COSTING, dollars, estimateCost } from "@/lib/costing";

type Row = { kind: "ai" | "image" | "transcription"; route: string | null; input_tokens: number | null; output_tokens: number | null; images: number | null; audio_seconds: number | null };
type Sum = { aiCalls: number; tokensIn: number; tokensOut: number; images: number; minutes: number; byRoute: [string, number][];
  speakerMinutes?: number; roomSessions?: number; sessions?: number; exact?: boolean };

const DAYS = 30;

function summarise(rows: Row[]): Sum {
  const s: Sum = { aiCalls: 0, tokensIn: 0, tokensOut: 0, images: 0, minutes: 0, byRoute: [] };
  const routes = new Map<string, number>();
  for (const r of rows) {
    if (r.kind === "ai") { s.aiCalls++; s.tokensIn += r.input_tokens ?? 0; s.tokensOut += r.output_tokens ?? 0; }
    if (r.kind === "image") { s.images += r.images ?? 1; s.tokensIn += r.input_tokens ?? 0; s.tokensOut += r.output_tokens ?? 0; }
    if (r.kind === "transcription") s.minutes += Number(r.audio_seconds ?? 0) / 60;
    if (r.kind !== "transcription" && r.route) routes.set(r.route, (routes.get(r.route) ?? 0) + 1);
  }
  s.byRoute = [...routes.entries()].sort((a, b) => b[1] - a[1]);
  return s;
}

const ROUTE_LABEL: Record<string, string> = {
  extract: "Automatic notes (players)", "extract-gm": "Automatic notes (GM)", recap: "Recaps", journal: "Campaign journal",
  import: "Importing notes", "battle-map/paint": "Painted battle maps", "world-map/imagine": "Painted world maps", "world-map/trace": "Tracing a map",
};

export default function UsagePanel({ supabase, campaignId }: { supabase: SupabaseClient; campaignId: string }) {
  const [sum, setSum] = useState<Sum | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none" | "error">("loading");

  useEffect(() => {
    if (!campaignId) return;
    let live = true;
    setState("loading");
    (async () => {
      const since = new Date(Date.now() - DAYS * 86400 * 1000).toISOString();
      // counted in the database (p169)
      const { data: agg, error: aggErr } = await supabase.rpc("campaign_usage_summary", { p_campaign: campaignId, p_since: since });
      if (!live) return;
      if (!aggErr && agg) {
        const a = agg as { rows: number; aiCalls: number; tokensIn: number; tokensOut: number; images: number; minutes: number; speakerMinutes: number; roomSessions: number; sessions: number; byRoute: [string, number][] };
        setSum({ aiCalls: Number(a.aiCalls), tokensIn: Number(a.tokensIn), tokensOut: Number(a.tokensOut), images: Number(a.images), minutes: Number(a.minutes),
          byRoute: a.byRoute ?? [], speakerMinutes: Number(a.speakerMinutes), roomSessions: Number(a.roomSessions), sessions: Number(a.sessions), exact: true });
        setState(Number(a.rows) ? "ready" : "none");
        return;
      }
      // before p169: the old read, which stops at 1,000 rows; the panel says so
      const { data, error } = await supabase.from("usage_events")
        .select("kind, route, input_tokens, output_tokens, images, audio_seconds")
        .eq("campaign_id", campaignId).gte("created_at", since).limit(1000);
      if (!live) return;
      if (error) { setState(/usage_events/.test(error.message) ? "none" : "error"); return; }
      const rows = (data as Row[] | null) ?? [];
      setSum({ ...summarise(rows), exact: rows.length < 1000 });
      setState(rows.length ? "ready" : "none");
    })();
    return () => { live = false; };
  }, [supabase, campaignId]);

  const n = (v: number) => Math.round(v).toLocaleString();
  const stat = (label: string, value: string) => (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
    </div>
  );

  return (
    <div style={{ ...surfaces.slate, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>What this campaign used, last {DAYS} days</div>
      <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 14 }}>
        Transcription, automatic notes, recaps and painted maps cost money to run. Nothing here is limited during the pilot; these
        counts are what fair pricing will be based on. Counting started on 10 November 2026.
      </div>
      {state === "loading" && <p role="status" style={{ color: C.muted, fontSize: 13, margin: 0 }}>Loading…</p>}
      {state === "error" && <p role="alert" style={{ color: C.warn, fontSize: 13, margin: 0 }}>Could not read the usage. Try again later.</p>}
      {state === "none" && <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Nothing used in the last {DAYS} days.</p>}
      {state === "ready" && sum && (
        <>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
            {stat("minutes transcribed", n(sum.minutes))}
            {stat("AI calls", n(sum.aiCalls))}
            {stat("images painted", n(sum.images))}
            {stat("AI tokens (in / out)", `${n(sum.tokensIn)} / ${n(sum.tokensOut)}`)}
          </div>
          {!sum.exact && <p role="note" style={{ fontSize: 12.5, color: C.warn, margin: "10px 0 0" }}>These are the first 1,000 records only, so the real totals are higher. The p169 database update counts all of them.</p>}
          {sum.exact && sum.sessions != null && (() => {
            const e = estimateCost({ speakerMinutes: sum.speakerMinutes ?? 0, roomSessions: sum.roomSessions ?? 0, sessions: sum.sessions ?? 0 });
            return (
              <div style={{ marginTop: 14, fontSize: 13, color: C.text, lineHeight: 1.6 }}>
                <b>Estimated cost: {dollars(e.total)}</b>{e.perSession != null ? ` (${dollars(e.perSession)} a session over ${sum.sessions} transcribed session${sum.sessions === 1 ? "" : "s"})` : ""}.
                <div style={{ fontSize: 12, color: C.muted }}>
                  At the rates in {COSTING.source}: transcription {dollars(e.transcription)} (about {Math.round(COSTING.keptAfterTrim * 100)}% of recorded speaker audio is billed after silence is trimmed){e.room ? `, in-person rooms ${dollars(e.room)}` : ""}, recaps and notes {dollars(e.ai)}, storage and compute {dollars(e.overhead)}. An estimate, not a bill.
                </div>
              </div>
            );
          })()}
          {sum.byRoute.length > 0 && (
            <div style={{ marginTop: 14, fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
              {sum.byRoute.map(([r, c]) => <div key={r}>{ROUTE_LABEL[r] ?? r}: {c.toLocaleString()} call{c === 1 ? "" : "s"}</div>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
