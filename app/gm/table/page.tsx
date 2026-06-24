"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import WranglerNav from "@/components/wrangler-nav";

const C = {
  bg: "#1B1426",
  surface: "#251B33",
  surface2: "#2F2340",
  line: "#3D2F52",
  text: "#F4EEFA",
  muted: "#A597BD",
  sun: "#F4C430",
  sunSoft: "#FFD75E",
  plum: "#9B7BD4",
  warn: "#E07A5F",
  good: "#5DBE9A",
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
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Sess | null>(null);
  const [att, setAtt] = useState<Record<string, string>>({});
  const [vibes, setVibes] = useState<Vibe[]>([]);
  const [copied, setCopied] = useState<boolean>(false);
  const [recapDraft, setRecapDraft] = useState<string>("");
  const [processing, setProcessing] = useState<boolean>(false);
  const [recapSaving, setRecapSaving] = useState<boolean>(false);
  const [chatReads, setChatReads] = useState<ChatRead[]>([]);

  const campaign = campaigns.find((c) => c.id === campaignId) || null;
  const nameOf = (id: string | null): string => (id ? nameMap[id] || "" : "");

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
      const [{ data: sess }, { data: ch }, { data: all }] = await Promise.all([
        supabase.from("sessions").select("id, session_number, status, recap").eq("campaign_id", campaignId).order("session_number", { ascending: false }),
        supabase.from("characters").select("id, name, class").eq("campaign_id", campaignId).eq("kind", "pc").order("name", { ascending: true }),
        supabase.from("characters").select("id, name").eq("campaign_id", campaignId),
      ]);
      if (!active) return;
      const sList = (sess as Sess[]) || [];
      setSessions(sList);
      setChars((ch as Char[]) || []);
      const nm: Record<string, string> = {};
      ((all as { id: string; name: string }[]) || []).forEach((c) => { nm[c.id] = c.name; });
      setNameMap(nm);
      setSelected(sList.length ? sList[0] : null);
      loadChat(campaignId);
    })();
    return () => { active = false; };
  }, [campaignId, supabase]);

  useEffect(() => {
    if (!selected) {
      setAtt({}); setVibes([]); setRecapDraft("");
      return;
    }
    setRecapDraft(selected.recap || "");
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

  async function buildRecap(s: Sess): Promise<string> {
    const lines: string[] = [`# Session ${s.session_number ?? "?"} recap`];
    const { data: spot } = await supabase.from("v_session_spotlight").select("character_name, share").eq("session_id", s.id).order("share", { ascending: false });
    const sp = (spot as { character_name: string | null; share: number | null }[]) || [];
    if (sp.length) lines.push("", "Spotlight: " + sp.map((r) => `${r.character_name ?? "?"} ${Math.round((r.share ?? 0) * 100)}%`).join(", ") + ".");

    const { data: opened } = await supabase.from("arcs").select("title").eq("opened_session_id", s.id);
    const op = ((opened as { title: string }[]) || []).map((a) => a.title);
    const { data: tch } = await supabase.from("arc_touches").select("arc_id").eq("session_id", s.id);
    const tIds = ((tch as { arc_id: string }[]) || []).map((t) => t.arc_id);
    let touched: string[] = [];
    if (tIds.length) {
      const { data: ta } = await supabase.from("arcs").select("title").in("id", tIds);
      touched = ((ta as { title: string }[]) || []).map((a) => a.title);
    }
    if (op.length || touched.length) {
      const parts: string[] = [];
      if (op.length) parts.push("opened " + op.map((t) => `\u201c${t}\u201d`).join(", "));
      if (touched.length) parts.push("advanced " + touched.map((t) => `\u201c${t}\u201d`).join(", "));
      lines.push("", "Threads: " + parts.join("; ") + ".");
    }

    const { data: lt } = await supabase.from("loot_grants").select("item_name, est_value, character_id").eq("session_id", s.id);
    const loot = (lt as { item_name: string; est_value: number | null; character_id: string | null }[]) || [];
    if (loot.length) lines.push("", "Loot: " + loot.map((g) => `${g.item_name}${g.character_id ? " \u2192 " + (nameOf(g.character_id) || "?") : ""}${g.est_value ? ` (${g.est_value} gp)` : ""}`).join("; ") + ".");

    const present = Object.values(att).filter((v) => v === "present").length;
    const absent = Object.values(att).filter((v) => v === "absent").length;
    if (present || absent) lines.push("", `Attendance: ${present} present, ${absent} absent.`);

    if (vibes.length) {
      const sats = vibes.map((v) => v.satisfaction).filter((x): x is number => x !== null);
      const avg = sats.length ? (sats.reduce((a, b) => a + b, 0) / sats.length).toFixed(1) : null;
      const more = vibes.filter((v) => v.spotlight_feeling === "wanted_more").length;
      const ok = vibes.filter((v) => v.spotlight_feeling === "about_right").length;
      const less = vibes.filter((v) => v.spotlight_feeling === "wanted_less").length;
      lines.push("", `Player check-ins: ${vibes.length} in${avg ? `, avg ${avg}/5` : ""}. Spotlight feel: ${more} wanted more, ${ok} about right, ${less} wanted less.`);
    }
    return lines.join("\n");
  }

  async function processSession() {
    if (!selected) return;
    setProcessing(true);
    const text = await buildRecap(selected);
    await supabase.from("sessions").update({ status: "processed", processed_at: new Date().toISOString(), recap: text }).eq("id", selected.id);
    const next = { ...selected, status: "processed", recap: text };
    patchSession(next);
    setRecapDraft(text);
    setProcessing(false);
  }

  async function saveRecap() {
    if (!selected) return;
    setRecapSaving(true);
    await supabase.from("sessions").update({ recap: recapDraft }).eq("id", selected.id);
    patchSession({ ...selected, recap: recapDraft });
    setRecapSaving(false);
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

  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 20 } as const;
  const btn = (bg: string, fg: string) => ({ background: bg, color: fg, border: "none", borderRadius: 9, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" } as const);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "0 20px 60px" }}>
        <WranglerNav />

        <h1 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 28, margin: "8px 0 4px" }}>Run the session</h1>
        <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px" }}>
          Go live when play starts (chat hides), mark attendance, then process to write the recap and open player check-in.
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
            <button type="button" onClick={copyLink} style={btn(C.sun, "#1B1426")}>{copied ? "Copied" : "Copy"}</button>
          </div>

          {sessions.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", margin: "16px 0 8px" }}>SESSION</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {sessions.map((s) => {
                  const on = selected && selected.id === s.id;
                  return (
                    <button key={s.id} type="button" onClick={() => setSelected(s)}
                      style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${on ? C.sun : C.line}`, background: on ? C.sun : C.surface2, color: on ? "#1B1426" : C.text, fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
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
                    <button type="button" onClick={goLive} style={btn(C.warn, "#1B1426")}>Go live</button>
                  )}
                  {selected.status === "live" && (
                    <span style={{ fontSize: 12, color: C.warn, alignSelf: "center" }}>Live — chat is hidden</span>
                  )}
                  <button type="button" onClick={processSession} disabled={processing} style={{ ...btn(C.good, "#1B1426"), opacity: processing ? 0.7 : 1 }}>
                    {processing ? "Processing…" : selected.status === "processed" ? "Re-process" : "End & process"}
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>
                Processing writes the recap below from this session’s spotlight, threads, loot, attendance, and check-ins, and makes it the session players check in on.
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
                            style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${on ? tone : C.line}`, background: on ? tone : "transparent", color: on ? "#1B1426" : C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            {st.l}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* recap */}
            <div style={box}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Recap</div>
              <div style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>
                {recapDraft ? "Auto-drafted from the session. Edit freely, then save." : "Process the session to generate a draft, or write one yourself."}
              </div>
              <textarea value={recapDraft} onChange={(e) => setRecapDraft(e.target.value)} rows={8} placeholder="No recap yet."
                style={{ width: "100%", boxSizing: "border-box", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14, fontFamily: "inherit", resize: "vertical", marginBottom: 10 }} />
              <button type="button" onClick={saveRecap} disabled={recapSaving} style={{ ...btn(C.sun, "#1B1426"), opacity: recapSaving ? 0.7 : 1 }}>
                {recapSaving ? "Saving…" : "Save recap"}
              </button>
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
      </div>
    </div>
  );
}
