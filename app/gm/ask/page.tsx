"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { surfaces, ui, SAX } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { initialCampaignId, useRememberCampaign, gmHref } from "@/lib/campaign-context";
import { gmCampaignsFilter } from "@/lib/campaign-gm";
import CampaignPicker from "@/components/ui-forge/CampaignPicker";
import { useMomentPlayer, MomentButton } from "@/components/moment-player";
import { QUESTION_MAX, answerPieces, sourceLabel, type AskSource } from "@/lib/ask";

// /gm/ask (2026-11-10, push 27, audit P1): Ask the campaign.
//
// The GM asks a question in their own words; /api/ask searches the campaign's record and Claude
// answers with numbered citations. Each citation jumps to its source, and each source opens the thing
// it came from (the Codex entry, the cast member, the session) or plays the moment it was said.
// The questions and answers live on this page only; nothing is saved.

type Campaign = { id: string; name: string };
type Turn = {
  key: number;
  campaignId: string;
  question: string;
  busy: boolean;
  answer: string | null;
  sources: AskSource[];
  cited: number[];
  empty: boolean;
  terms: string[];
  error: string | null;
};

const EXAMPLES = [
  "What did the party promise the harbourmaster?",
  "Who is Lady Vex and what do we know about her?",
  "What happened last session?",
];

export default function AskPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  useRememberCampaign(campaignId, campaigns);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const nextKey = useRef(1);
  const player = useMomentPlayer();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoaded(true); return; }
      const { data } = await supabase.from("campaigns").select("id, name").or(await gmCampaignsFilter(supabase, user.id)).order("created_at");
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(initialCampaignId(list));
      setLoaded(true);
    })();
  }, [supabase]);

  const busy = turns.some((t) => t.busy);

  async function ask(question: string) {
    const text = question.trim();
    if (!campaignId || text.length < 3 || busy) return;
    const key = nextKey.current++;
    const turn: Turn = { key, campaignId, question: text, busy: true, answer: null, sources: [], cited: [], empty: false, terms: [], error: null };
    setTurns((all) => [turn, ...all]);
    setQ("");
    const patch = (p: Partial<Turn>) => setTurns((all) => all.map((t) => (t.key === key ? { ...t, ...p } : t)));
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, question: text }),
      });
      const out = (await res.json().catch(() => ({}))) as {
        answer?: string | null; sources?: AskSource[]; cited?: number[]; empty?: boolean; terms?: string[];
        remaining?: number; error?: string;
      };
      if (!res.ok) { patch({ busy: false, error: out.error || "Could not answer that. Try again." }); return; }
      if (typeof out.remaining === "number") setRemaining(out.remaining);
      patch({
        busy: false, answer: out.answer ?? null, sources: out.sources || [], cited: out.cited || [],
        empty: !!out.empty, terms: out.terms || [],
      });
    } catch {
      patch({ busy: false, error: "Could not reach Six Axes. Check your connection and try again." });
    }
  }

  const box = { ...surfaces.slate, padding: 18 } as const;
  const input = { width: "100%", boxSizing: "border-box" as const, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "11px 13px", fontSize: 15 };
  const cardInner = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "11px 13px" } as const;
  const sectionLabel = { fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", marginBottom: 8 } as const;
  const linkStyle: React.CSSProperties = { color: SAX.brass, fontSize: 12.5, fontWeight: 700, textDecoration: "none" };
  const btn: React.CSSProperties = {
    background: SAX.brass, color: C.ink, border: "none", borderRadius: FORGE_RADIUS, padding: "11px 18px",
    fontSize: 14.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap",
  };

  const openHref = (t: Turn, s: AskSource): { href: string; label: string } | null => {
    if (s.kind === "entry") return { href: gmHref("/gm/codex", { campaign: t.campaignId, entry: s.id }), label: "Open in Codex" };
    if (s.kind === "character") return { href: gmHref("/gm/codex", { campaign: t.campaignId, character: s.id }), label: "Open in Codex" };
    if (s.session_id) return { href: gmHref("/gm/sessions", { campaign: t.campaignId, session: s.session_id }), label: `Open session ${s.session_number ?? ""}`.trim() };
    return null;
  };

  const sourceCard = (t: Turn, s: AskSource) => {
    const open = openHref(t, s);
    const rowId = `${t.key}-${s.n}`;
    return (
      <div key={s.n} id={`ask-${t.key}-${s.n}`} style={{ ...cardInner, scrollMarginTop: 90 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: C.text, fontWeight: 700 }}>
            <span style={{ fontFamily: SAX.mono, color: SAX.brass, marginRight: 8 }}>[{s.n}]</span>{sourceLabel(s)}
          </span>
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
            {s.track_id && s.t_seconds !== null && (
              <MomentButton active={player.activeId === rowId} loading={player.loadingId === rowId} tStart={s.t_seconds}
                expired={player.isPurged(s.track_id)} onClick={() => player.play(rowId, s.track_id, s.t_seconds)} />
            )}
            {open && <a href={open.href} style={linkStyle}>{open.label}</a>}
          </span>
        </div>
        {s.snippet && (
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto" }}>
            {s.snippet}
          </div>
        )}
      </div>
    );
  };

  const answerView = (t: Turn) => (
    <div style={{ fontSize: 15, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
      {answerPieces(t.answer || "", t.sources.length).map((p, i) =>
        "cite" in p ? (
          <a key={i} href={`#ask-${t.key}-${p.cite}`} title={sourceLabel(t.sources[p.cite - 1])}
            style={{ fontFamily: SAX.mono, fontSize: 11.5, color: SAX.brass, textDecoration: "none", verticalAlign: "super", padding: "0 1px" }}>
            [{p.cite}]
          </a>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </div>
  );

  return (
    <PageShell width={880}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Ask the campaign</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 18px", lineHeight: 1.5 }}>
        Ask anything about what has happened so far. Answers come only from this campaign&apos;s transcripts, story beats, Codex, cast and recaps,
        and every claim links to where it came from. It finds things by the words you use, so name the person, place or thing as your notes would.
      </p>

      <div style={{ ...box, marginBottom: 16 }}>
        {loaded && campaigns.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 14 }}>
            You don&apos;t run a campaign yet. <a href="/gm/start" style={linkStyle}>Start one</a>, play a session, and ask about it here.
          </div>
        ) : (
          <>
            <CampaignPicker campaigns={campaigns} value={campaignId} onChange={setCampaignId} label={null} selectStyle={{ ...input, marginBottom: 12 }} />
            <label htmlFor="ask-q" style={{ display: "block", fontSize: 13, color: C.muted, marginBottom: 6 }}>Your question</label>
            <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input id="ask-q" autoFocus value={q} maxLength={QUESTION_MAX} onChange={(e) => setQ(e.target.value)}
                placeholder="What did the party promise the harbourmaster?" style={{ ...input, flex: "1 1 320px" }} />
              <button type="submit" disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}>
                {busy ? "Asking..." : "Ask"}
              </button>
            </form>
            {q.trim().length > 0 && q.trim().length < 3 && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Type a few more words.</div>}
            {remaining !== null && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>{remaining} question{remaining === 1 ? "" : "s"} left today</div>
            )}
            {turns.length === 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: C.muted }}>For example:</span>
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => setQ(ex)}
                    style={{ background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 11px", fontSize: 12.5, cursor: "pointer" }}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {turns.map((t) => {
        const citedSet = new Set(t.cited);
        const citedSources = t.cited.map((n) => t.sources[n - 1]).filter(Boolean);
        const others = t.sources.filter((s) => !citedSet.has(s.n));
        const campName = campaigns.find((c) => c.id === t.campaignId)?.name;
        return (
          <div key={t.key} style={{ ...box, marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>{t.question}</div>
            {campName && campaigns.length > 1 && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{campName}</div>}

            <div role="status" aria-live="polite">
              {t.busy && <div style={{ color: C.muted, fontSize: 14, marginTop: 8 }}>Searching the record and writing an answer. This usually takes 5 to 15 seconds.</div>}
              {t.error && (
                <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: C.text, fontSize: 14 }}>{t.error}</span>
                  <button type="button" onClick={() => { setTurns((all) => all.filter((x) => x.key !== t.key)); void ask(t.question); }} disabled={busy}
                    style={{ background: "transparent", color: SAX.brass, border: `1px solid ${SAX.brass}`, borderRadius: FORGE_RADIUS, padding: "5px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    Try again
                  </button>
                </div>
              )}
              {t.empty && (
                <div style={{ color: C.muted, fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>
                  Nothing in this campaign&apos;s record uses those words{t.terms.length ? ` (searched for: ${t.terms.join(", ")})` : ""}.
                  Try the name of a person, place or item the way it appears in your notes or was said at the table. Nothing was counted against your daily questions.
                </div>
              )}
            </div>

            {t.answer && (
              <div style={{ marginTop: 10 }}>
                {answerView(t)}
                {citedSources.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={sectionLabel}>SOURCES</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {citedSources.map((s) => sourceCard(t, s))}
                    </div>
                  </div>
                )}
                {others.length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ fontSize: 13, color: C.muted, cursor: "pointer" }}>
                      {citedSources.length ? `Also searched, not cited (${others.length})` : `What was searched (${others.length})`}
                    </summary>
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      {others.map((s) => sourceCard(t, s))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}

      {player.error && <div role="alert" style={{ color: C.text, fontSize: 13, marginTop: 6 }}>{player.error}</div>}
    </PageShell>
  );
}
