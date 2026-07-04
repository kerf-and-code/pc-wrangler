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
  sunSoft: "#FFD75E",
  plum: SAX.plum,
  warn: SAX.warn,
  good: SAX.good,
};

type Campaign = { id: string; name: string; share_code: string };
type Sess = { id: string; session_number: number | null; status: string; recap: string | null };
type Char = { id: string; name: string; class: string | null };
type Vibe = {
  id: string;
  player_name: string | null;
  satisfaction: number | null;
  spotlight_feeling: string | null;
  note: string | null;
};
type ChatRead = { display_name: string | null; body: string; created_at: string };

const STATUSES: { v: string; l: string }[] = [
  { v: "present", l: "Present" },
  { v: "late", l: "Late" },
  { v: "partial", l: "Partial" },
  { v: "absent", l: "Absent" },
];

const SPOTLIGHT_LABEL: Record<string, string> = {
  wanted_more: "Wanted more spotlight",
  about_right: "Felt about right",
  wanted_less: "Wanted less spotlight",
};

const STATUS_TONE: Record<string, string> = {
  scheduled: "#A597BD",
  live: "#E07A5F",
  completed: "#9B7BD4",
  processed: "#5DBE9A",
  cancelled: "#A597BD",
};

export default function CheckInPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [chars, setChars] = useState<Char[]>([]);
  const [selected, setSelected] = useState<Sess | null>(null);
  const [att, setAtt] = useState<Record<string, string>>({});
  const [vibes, setVibes] = useState<Vibe[]>([]);
  const [copied, setCopied] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);
  const [chatReads, setChatReads] = useState<ChatRead[]>([]);

  const campaign = campaigns.find((c) => c.id === campaignId) || null;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name, share_code").order("created_at", { ascending: true });
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  async function loadChat(cid: string) {
    const { data } = await supabase.rpc("gm_chat_read", { p_campaign: cid });
    setChatReads((data as ChatRead[]) || []);
  }

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    (async () => {
      const [{ data: sess }, { data: ch }] = await Promise.all([
        supabase.from("sessions").select("id, session_number, status, recap").eq("campaign_id", campaignId).order("session_number", { ascending: false }),
        supabase.from("characters").select("id, name, class").eq("campaign_id", campaignId).eq("kind", "pc").order("name", { ascending: true }),
      ]);
      if (!active) return;
      const sList = (sess as Sess[]) || [];
      setSessions(sList);
      setChars((ch as Char[]) || []);
      setSelected(sList.length ? sList[0] : null);
      loadChat(campaignId);
    })();
    return () => { active = false; };
  }, [campaignId, supabase]);

  useEffect(() => {
    if (!selected) {
      setAtt({}); setVibes([]);
      return;
    }
    let active = true;
    (async () => {
      const [{ data: aRows }, { data: vRows }] = await Promise.all([
        supabase.from("attendance").select("character_id, status").eq("session_id", selected.id),
        supabase.from("vibe_checks").select("id, player_name, satisfaction, spotlight_feeling, note").eq("session_id", selected.id).order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      const map: Record<string, string> = {};
      ((aRows as { character_id: string | null; status: string }[]) || []).forEach((r) => { if (r.character_id) map[r.character_id] = r.status; });
      setAtt(map);
      setVibes((vRows as Vibe[]) || []);
    })();
    return () => { active = false; };
  }, [selected, supabase]);

  async function mark(charId: string, status: string) {
    if (!selected || !campaignId) return;
    setAtt((prev) => ({ ...prev, [charId]: status }));
    await supabase.from("attendance").upsert(
      { campaign_id: campaignId, session_id: selected.id, character_id: charId, status },
      { onConflict: "session_id,character_id" },
    );
  }

  function patchSession(next: Sess) {
    setSelected(next);
    setSessions((prev) => prev.map((s) => (s.id === next.id ? next : s)));
  }

  async function goLive() {
    if (!selected) return;
    await supabase.from("sessions").update({ status: "live" }).eq("id", selected.id);
    patchSession({ ...selected, status: "live" });
  }

  async function processSession() {
    if (!selected) return;
    setProcessing(true);
    await supabase.from("sessions").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", selected.id);
    patchSession({ ...selected, status: "processed" });
    setProcessing(false);
  }

  function portalLink(): string {
    if (!campaign) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/play?share=${campaign.share_code}`;
  }
  async function copyLink() {
    const link = portalLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) { /* clipboard blocked */ }
  }

  const box = { ...surfaces.slate, padding: 20 } as const;
  const btn = (bg: string, fg: string) => ({ background: bg, color: fg, border: "none", borderRadius: 9, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" } as const);

  return (
    <PageShell width={920}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Run the session</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px" }}>
        Go live when play starts (chat hides), mark attendance, then process to open player check-in.
      </p>

        {/* campaign + portal link */}
        <div style={{ ...box, marginBottom: 18 }}>
          <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>CAMPAIGN</label>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 15 }}>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>

          <div style={{ fontSize: 12, color: C.muted, marginTop: 14, marginBottom: 6 }}>
            One link for your players: Inventory, Check-in, and Chat. Check-in auto-shows the latest processed session.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input readOnly value={portalLink()} style={{ flex: 1, minWidth: 220, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 13, fontFamily: "ui-monospace, monospace" }} />
            <button type="button" onClick={copyLink} style={btn(C.sun, SAX.inkDeep)}>{copied ? "Copied" : "Copy"}</button>
          </div>

          {sessions.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", margin: "16px 0 8px" }}>SESSION</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {sessions.map((s) => {
                  const on = selected && selected.id === s.id;
                  return (
                    <button key={s.id} type="button" onClick={() => setSelected(s)}
                      style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${on ? C.sun : C.line}`, background: on ? C.sun : C.surface2, color: on ? SAX.inkDeep : C.text, fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 7, background: STATUS_TONE[s.status] || C.muted }} />
                      Session {s.session_number ?? "?"}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {campaignId && sessions.length === 0 && (
            <p style={{ color: C.muted, fontSize: 13, marginTop: 14 }}>No sessions yet. Create one in the Session Log first.</p>
          )}
        </div>

        {selected && (
          <div style={{ display: "grid", gap: 18, gridTemplateColumns: "1fr", alignItems: "start" }}>
            {/* lifecycle */}
            <div style={box}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 9, background: STATUS_TONE[selected.status] || C.muted }} />
                  <span style={{ fontSize: 16, fontWeight: 700 }}>Session {selected.session_number ?? "?"}</span>
                  <span style={{ fontSize: 12, color: STATUS_TONE[selected.status] || C.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "ui-monospace, monospace" }}>{selected.status}</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selected.status !== "live" && selected.status !== "processed" && (
                    <button type="button" onClick={goLive} style={btn(C.warn, SAX.inkDeep)}>Go live</button>
                  )}
                  {selected.status === "live" && (
                    <span style={{ fontSize: 12, color: C.warn, alignSelf: "center" }}>Live — chat is hidden</span>
                  )}
                  <button type="button" onClick={processSession} disabled={processing} style={{ ...btn(C.good, SAX.inkDeep), opacity: processing ? 0.7 : 1 }}>
                    {processing ? "Processing…" : selected.status === "processed" ? "Re-process" : "End & process"}
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>
                Processing marks the session done and opens it for player check-in. The recap is drafted on Review and edited or sent from the Session Log.
              </div>
            </div>

            {/* attendance */}
            <div style={box}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Attendance</div>
              <div style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>Who was present for Session {selected.session_number ?? "?"}.</div>
              {chars.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>No player characters in the roster yet.</p>}
              <div style={{ display: "grid", gap: 10 }}>
                {chars.map((ch) => (
                  <div key={ch.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{ch.name}</div>
                      {ch.class && <div style={{ fontSize: 12, color: C.muted }}>{ch.class}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {STATUSES.map((st) => {
                        const on = att[ch.id] === st.v;
                        const tone = st.v === "absent" ? C.warn : st.v === "present" ? C.good : C.plum;
                        return (
                          <button key={st.v} type="button" onClick={() => mark(ch.id, st.v)}
                            style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${on ? tone : C.line}`, background: on ? tone : "transparent", color: on ? SAX.inkDeep : C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            {st.l}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* vibe results */}
            <div style={box}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>What players said {vibes.length > 0 ? `(${vibes.length})` : ""}</div>
              {vibes.length === 0 ? (
                <p style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>No check-ins yet for this session.</p>
              ) : (
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  {vibes.map((v) => (
                    <div key={v.id} style={{ padding: "12px 14px", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{v.player_name || "Anonymous player"}</span>
                        {v.satisfaction !== null && <span style={{ color: C.sun, fontSize: 13, fontWeight: 700 }}>{v.satisfaction}/5</span>}
                      </div>
                      {v.spotlight_feeling && <div style={{ fontSize: 13, color: C.plum, marginTop: 4 }}>{SPOTLIGHT_LABEL[v.spotlight_feeling] || v.spotlight_feeling}</div>}
                      {v.note && <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>{"\u201c"}{v.note}{"\u201d"}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* GM chat read (campaign-level) */}
        {campaignId && (
          <div style={{ ...box, marginTop: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Player chat {chatReads.length > 0 ? `(${chatReads.length})` : ""}</div>
              <button type="button" onClick={() => loadChat(campaignId)} style={{ background: "transparent", color: C.plum, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Refresh</button>
            </div>
            <div style={{ fontSize: 12, color: C.muted, margin: "6px 0 12px" }}>
              You only see what players choose to share, the messages inside time windows they grant you. Everything else stays private.
            </div>
            {chatReads.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13 }}>No shared messages. Ask your players to grant a window from their Chat tab.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {chatReads.map((m, i) => (
                  <div key={i} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 12px" }}>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>
                      {m.display_name || "Player"} · {new Date(m.created_at).toLocaleString()}
                    </div>
                    <div style={{ fontSize: 14 }}>{m.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
    </PageShell>
  );
}
