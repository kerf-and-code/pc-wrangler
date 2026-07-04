"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX, surfaces, ui } from "@/lib/theme";

const C = {
  bg: SAX.ink,
  surface: SAX.slateBg,
  surface2: "rgba(11,7,18,0.6)",
  line: SAX.line,
  text: SAX.text,
  muted: SAX.muted,
  sun: SAX.sun,
  plum: SAX.plum,
  good: SAX.good,
  warn: SAX.warn,
};

type Campaign = { id: string; name: string };
type Sess = { id: string; session_number: number | null; status: string; started_at: string | null; scheduled_at: string | null };
type Arc = { id: string; title: string; status: string; character_id: string | null; opened_session_id: string | null };
type Touch = { id: string; arc_id: string; session_id: string | null };
type Loot = { id: string; session_id: string | null; character_id: string | null; item_name: string; rarity: string | null; est_value: number | null };
type Char = { id: string; name: string; kind: string };

export default function TimelinePage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [touches, setTouches] = useState<Touch[]>([]);
  const [loot, setLoot] = useState<Loot[]>([]);
  const [chars, setChars] = useState<Char[]>([]);
  const [pc, setPc] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at");
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    (async () => {
      const [{ data: s }, { data: a }, { data: t }, { data: l }, { data: c }] = await Promise.all([
        supabase.from("sessions").select("id, session_number, status, started_at, scheduled_at").eq("campaign_id", campaignId).order("session_number", { ascending: true }),
        supabase.from("arcs").select("id, title, status, character_id, opened_session_id").eq("campaign_id", campaignId),
        supabase.from("arc_touches").select("id, arc_id, session_id").eq("campaign_id", campaignId),
        supabase.from("loot_grants").select("id, session_id, character_id, item_name, rarity, est_value").eq("campaign_id", campaignId),
        supabase.from("characters").select("id, name, kind").eq("campaign_id", campaignId),
      ]);
      if (!active) return;
      setSessions((s as Sess[]) || []);
      setArcs((a as Arc[]) || []);
      setTouches((t as Touch[]) || []);
      setLoot((l as Loot[]) || []);
      setChars((c as Char[]) || []);
    })();
    return () => { active = false; };
  }, [campaignId, supabase]);

  const nameOf = (id: string | null): string => {
    if (!id) return "";
    const c = chars.find((x) => x.id === id);
    return c ? c.name : "";
  };
  const arcById = (id: string): Arc | undefined => arcs.find((a) => a.id === id);

  const pcs = chars.filter((c) => c.kind === "pc");
  const dateOf = (s: Sess): string => {
    const d = s.started_at || s.scheduled_at;
    if (!d) return "";
    try { return new Date(d).toLocaleDateString(); } catch (e) { return ""; }
  };

  // build per-session bundles, honoring the PC filter
  const nodes = sessions.map((s) => {
    let opened = arcs.filter((a) => a.opened_session_id === s.id);
    let touched = touches.filter((t) => t.session_id === s.id).map((t) => arcById(t.arc_id)).filter((a): a is Arc => !!a);
    let grants = loot.filter((g) => g.session_id === s.id);
    if (pc) {
      opened = opened.filter((a) => a.character_id === pc);
      touched = touched.filter((a) => a.character_id === pc);
      grants = grants.filter((g) => g.character_id === pc);
    }
    return { s, opened, touched, grants };
  }).filter((n) => !pc || n.opened.length > 0 || n.touched.length > 0 || n.grants.length > 0);

  const box = { ...surfaces.slate, padding: 18 } as const;
  const input = { width: "100%", boxSizing: "border-box" as const, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 13px", fontSize: 15, outline: "none" };

  const Row = ({ color, children }: { color: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13, marginTop: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: 7, background: color, flexShrink: 0, transform: "translateY(2px)" }} />
      <span>{children}</span>
    </div>
  );

  return (
    <PageShell width={820}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Timeline</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 6px" }}>
        The campaign session by session: arcs opened and advanced, loot handed out. Filter to one PC to follow their arc.
      </p>
      <p style={{ color: C.muted, fontSize: 12.5, margin: "0 0 18px" }}>
        Loose ends captured from your narration (framing, hooks, quests) live on the <a href="/gm/prep" style={{ color: C.plum, textDecoration: "none", borderBottom: `1px solid ${C.plum}` }}>Prep sheet</a>.
      </p>

        <div style={{ ...box, marginBottom: 18 }}>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...input, marginBottom: 12 }}>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: C.muted }}>Trace:</span>
            <select value={pc} onChange={(e) => setPc(e.target.value)} style={{ ...input, width: "auto", flex: "0 1 200px", padding: "8px 10px", fontSize: 13 }}>
              <option value="">the whole party</option>
              {pcs.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>
        </div>

        {nodes.length === 0 ? (
          <div style={{ ...box, color: C.muted, fontSize: 14 }}>
            {sessions.length === 0 ? "No sessions logged yet." : "Nothing for that PC yet."}
          </div>
        ) : (
          <div style={{ position: "relative", paddingLeft: 20 }}>
            <div style={{ position: "absolute", left: 6, top: 6, bottom: 6, width: 2, background: C.line }} />
            <div style={{ display: "grid", gap: 14 }}>
              {nodes.map(({ s, opened, touched, grants }) => (
                <div key={s.id} style={{ position: "relative" }}>
                  <div style={{ position: "absolute", left: -17, top: 18, width: 11, height: 11, borderRadius: 11, background: C.sun, border: `2px solid ${C.bg}` }} />
                  <div style={box}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16, fontWeight: 700 }}>Session {s.session_number ?? "?"}</span>
                      <span style={{ fontSize: 12, color: C.muted }}>{dateOf(s)}{dateOf(s) ? " · " : ""}{s.status}</span>
                    </div>
                    {opened.length === 0 && touched.length === 0 && grants.length === 0 && (
                      <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>No threads or loot recorded.</div>
                    )}
                    {opened.map((a) => (
                      <Row key={a.id} color={C.plum}>
                        Opened arc <strong>{a.title}</strong>{a.character_id ? <span style={{ color: C.muted }}> · {nameOf(a.character_id)}</span> : null}
                      </Row>
                    ))}
                    {touched.map((a) => (
                      <Row key={a.id} color={C.good}>
                        Advanced <strong>{a.title}</strong>{a.character_id ? <span style={{ color: C.muted }}> · {nameOf(a.character_id)}</span> : null}
                      </Row>
                    ))}
                    {grants.map((g) => (
                      <Row key={g.id} color={C.sun}>
                        Loot: <strong>{g.item_name}</strong>{g.character_id ? <span style={{ color: C.muted }}> → {nameOf(g.character_id)}</span> : null}{g.est_value ? <span style={{ color: C.muted }}> ({g.est_value} gp)</span> : null}
                      </Row>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
    </PageShell>
  );
}
