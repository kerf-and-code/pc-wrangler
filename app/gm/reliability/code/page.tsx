"use client";

// app/gm/reliability/code/page.tsx
//
// The blind coding screen for the human second coder (2026-11-03). Opened from Reliability with
// ?job=<capture job id>. Shows one sampled transcript line at a time with two lines of context either
// side, and asks one question: which single event does this line show, or nothing? The page never
// receives the extractor's codes or which sample group a line came from (see /api/coding-sample), so
// the person coding cannot be steered by them.
//
// Keys: 1-9 pick the first nine event types shown, N or 0 = nothing here, left and right arrows move
// between lines. Every answer saves immediately, so leaving halfway loses nothing.
//
// The job id is read from window.location in an effect rather than useSearchParams, because
// cacheComponents would otherwise require a Suspense boundary around the whole page.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageShell from "@/components/page-shell";
import { surfaces, ui } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

type Line = { speaker: string; text: string; start_ms: number | null };
type Item = { id: string; order: number; line: Line | null; before: Line[]; after: Line[]; human_event: string | null; coded: boolean };
type EventType = { key: string; label: string; category: string };
type Payload = { session: number | null; status: string | null; total: number; coded: number; items: Item[]; eventTypes: EventType[] };

const clock = (ms: number | null) => {
  if (ms == null) return "";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function CodingPage() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(true);

  useEffect(() => {
    setJobId(new URLSearchParams(window.location.search).get("job"));
    try { if (window.localStorage.getItem("sax_coding_help_seen") === "1") setShowHelp(false); } catch { /* storage blocked: keep it open */ }
  }, []);

  const load = useCallback(async (jid: string) => {
    setErr(null);
    const res = await fetch(`/api/coding-sample?jobId=${encodeURIComponent(jid)}`);
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(out.error || "Could not load the sample."); return; }
    const p = out as Payload;
    setData(p);
    const firstOpen = p.items.findIndex((x) => !x.coded);
    setIdx(firstOpen === -1 ? 0 : firstOpen);
  }, []);

  useEffect(() => { if (jobId) void load(jobId); }, [jobId, load]);

  const items = data?.items ?? [];
  const item = items[idx];
  const coded = items.filter((x) => x.coded).length;
  const allDone = items.length > 0 && coded === items.length;

  const groups = useMemo(() => {
    const m = new Map<string, EventType[]>();
    for (const e of data?.eventTypes ?? []) m.set(e.category || "Other", [...(m.get(e.category || "Other") || []), e]);
    return Array.from(m.entries());
  }, [data]);
  const flat = useMemo(() => groups.flatMap(([, list]) => list), [groups]);
  const labelOf = useMemo(() => new Map((data?.eventTypes ?? []).map((e) => [e.key, e.label])), [data]);

  const answer = useCallback(async (event: string | null) => {
    if (!jobId || !item || saving) return;
    setSaving(true); setErr(null);
    const res = await fetch("/api/coding-sample", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, action: "code", id: item.id, event }),
    });
    const out = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setErr(out.error || "Not saved. Try again."); return; }
    const next = items.map((x) => (x.id === item.id ? { ...x, human_event: event, coded: true } : x));
    setData((d) => (d ? { ...d, items: next, coded: next.filter((x) => x.coded).length } : d));
    const after = next.findIndex((x, i) => i > idx && !x.coded);
    const any = next.findIndex((x) => !x.coded);
    setIdx(after !== -1 ? after : any !== -1 ? any : Math.min(idx + 1, next.length - 1));
  }, [jobId, item, saving, items, idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") { setIdx((i) => Math.min(i + 1, items.length - 1)); return; }
      if (e.key === "ArrowLeft") { setIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "n" || e.key === "N" || e.key === "0") { void answer(null); return; }
      const d = Number(e.key);
      if (d >= 1 && d <= 9 && flat[d - 1]) void answer(flat[d - 1].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, flat, items.length]);

  const box = { ...surfaces.slate, padding: 18, marginBottom: 14 } as const;
  const btn = (on: boolean) => ({
    background: on ? C.brass : C.surface2, color: on ? C.ink : C.text, border: `1px solid ${on ? C.brass : C.line}`,
    borderRadius: FORGE_RADIUS, padding: "8px 12px", fontSize: 13.5, cursor: saving ? "default" : "pointer", textAlign: "left" as const,
  });
  const ctx = (l: Line, k: string) => (
    <div key={k} style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.55, margin: "4px 0" }}>
      <span style={{ fontWeight: 700 }}>{l.speaker}:</span> {l.text}
    </div>
  );

  return (
    <PageShell width={880}>
      <a href="/gm/reliability" style={{ fontSize: 13, color: C.muted }}>{"←"} Back to Reliability</a>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "8px 0 4px" }}>Second coding{data?.session != null ? `: session ${data.session}` : ""}</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 16px" }}>
        You are the second coder. For each line, pick the one event it shows, or Nothing here. You never see what Six Axes&apos; automatic notes said, which is the point.
      </p>

      <details open={showHelp} onToggle={(e) => {
        const open = (e.currentTarget as HTMLDetailsElement).open;
        setShowHelp(open);
        if (!open) { try { window.localStorage.setItem("sax_coding_help_seen", "1"); } catch { /* fine */ } }
      }} style={box}>
        <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 700, color: C.text }}>How to code (read this once, about two minutes)</summary>
        <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.65, marginTop: 10 }}>
          <p style={{ margin: "0 0 10px" }}>
            <strong style={{ color: C.text }}>Why this exists.</strong> Six Axes builds its spotlight and play-style numbers from events an AI pulls out of the transcript. To know whether those events can be trusted, someone has to code a sample of the same lines independently and see how often the two of you agree. Agreement is reported as Cohen&apos;s kappa: 0 means no better than chance, 1 means identical. A human is a truly independent second opinion; a second AI pass would share the first one&apos;s blind spots.
          </p>
          <p style={{ margin: "0 0 6px" }}><strong style={{ color: C.text }}>For each line:</strong></p>
          <ol style={{ margin: "0 0 10px", paddingLeft: 20 }}>
            <li>Read the highlighted line. The grey lines above and below are context only; you are coding the highlighted one.</li>
            <li>Ask: does this line itself show one of the listed events (a player doing something, or the GM giving them an opening)? If yes, pick it. If it shows several, pick the most important one.</li>
            <li>If nothing in the line is an event, press <strong style={{ color: C.text }}>Nothing here</strong>. Most lines are table talk, and that is the expected answer for many of them.</li>
            <li>Code what the line says, not what you remember about the night. If the event happens on the next line, this line is Nothing here.</li>
            <li>Unsure? Make your best call rather than skipping. You can go back with the arrow keys and change any answer.</li>
          </ol>
          <p style={{ margin: "0 0 6px" }}><strong style={{ color: C.text }}>Keep it blind:</strong></p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
            <li>Do not open this session in Review, the Session log or Mechanics until you finish. Agreement only means something if you have not seen the automatic notes.</li>
            <li>The best coder is someone who has not reviewed the session yet. If you already reviewed it, your memory of its suggestions will push the numbers up; a co-GM or a friend who knows the game is better.</li>
            <li>Results stay hidden until every line is coded, so you cannot check your score halfway through.</li>
          </ul>
          <p style={{ margin: 0 }}>
            <strong style={{ color: C.text }}>Keys:</strong> 1 to 9 pick the first nine event types in the order shown, N (or 0) is Nothing here, and the left and right arrows move between lines. Every answer saves as you go, so you can stop and come back.
          </p>
        </div>
      </details>

      {err && <p role="alert" style={{ color: C.warn, fontSize: 13, margin: "0 0 12px" }}>{err}</p>}
      {!jobId && <div style={{ ...box, color: C.muted }}>No session chosen. Start from the Reliability page.</div>}
      {jobId && !data && !err && <div style={{ ...box, color: C.muted }}>Loading the sample{"…"}</div>}
      {data && data.items.length === 0 && (
        <div style={{ ...box, color: C.muted }}>This session has no coding sample yet. Draw one on the Reliability page.</div>
      )}

      {data && data.status === "done" && !allDone && (
        <p style={{ color: C.sun, fontSize: 13, margin: "0 0 12px" }}>
          This session has already been through Review. If you were the one who reviewed it, you have seen the automatic notes, so this check will not be fully blind.
        </p>
      )}

      {data && items.length > 0 && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div style={{ height: 6, background: C.surface2, borderRadius: FORGE_RADIUS, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round((coded / items.length) * 100)}%`, background: C.good }} />
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
              {coded} of {items.length} lines coded{allDone ? ". All done." : ""} {"·"} line {idx + 1} of {items.length}
            </div>
          </div>

          {allDone && (
            <div style={{ ...box, borderColor: C.good }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>Every line is coded.</div>
              <div style={{ fontSize: 13.5, color: C.muted }}>
                The agreement figures are on <a href="/gm/reliability" style={{ color: C.brass }}>Reliability</a>. You can still revise any answer below; the figures update when you reload that page.
              </div>
            </div>
          )}

          {item && (
            <div style={box}>
              {item.before.map((l, i) => ctx(l, `b${i}`))}
              {item.line ? (
                <div style={{ margin: "10px 0", padding: "12px 14px", background: C.surface2, border: `1px solid ${C.brass}`, borderRadius: FORGE_RADIUS }}>
                  <div style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", marginBottom: 4 }}>{clock(item.line.start_ms)}</div>
                  <div style={{ fontSize: 16, color: C.text, lineHeight: 1.6 }}>
                    <span style={{ fontWeight: 700 }}>{item.line.speaker}:</span> {item.line.text}
                  </div>
                </div>
              ) : (
                <div style={{ color: C.warn, fontSize: 13 }}>This line is no longer in the transcript. Code it as Nothing here.</div>
              )}
              {item.after.map((l, i) => ctx(l, `a${i}`))}
              {item.coded && (
                <div style={{ fontSize: 12.5, color: C.good, marginTop: 8 }}>
                  Your answer: {item.human_event ? labelOf.get(item.human_event) || item.human_event : "Nothing here"}
                </div>
              )}
            </div>
          )}

          {item && (
            <div style={box}>
              <button type="button" onClick={() => void answer(null)} disabled={saving}
                style={{ ...btn(item.coded && item.human_event === null), width: "100%", textAlign: "center", fontWeight: 700, marginBottom: 14 }}>
                Nothing here (N)
              </button>
              {groups.map(([cat, list]) => (
                <div key={cat} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, fontFamily: "ui-monospace, monospace", marginBottom: 6 }}>{cat}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6 }}>
                    {list.map((e) => {
                      const n = flat.indexOf(e) + 1;
                      return (
                        <button key={e.key} type="button" onClick={() => void answer(e.key)} disabled={saving} style={btn(item.coded && item.human_event === e.key)}>
                          {n <= 9 ? <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, opacity: 0.7, marginRight: 6 }}>{n}</span> : null}
                          {e.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <button type="button" onClick={() => setIdx((i) => Math.max(i - 1, 0))} disabled={idx === 0} style={btn(false)}>{"←"} Previous</button>
                <button type="button" onClick={() => setIdx((i) => Math.min(i + 1, items.length - 1))} disabled={idx >= items.length - 1} style={btn(false)}>Next {"→"}</button>
              </div>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
