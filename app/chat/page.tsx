"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

type Msg = { id: string; author_profile: string; display_name: string | null; body: string; created_at: string };
type Grant = { id: string; from_ts: string; to_ts: string };

export default function ChatPage() {
  const supabase = useMemo(() => createClient(), []);
  const [code, setCode] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState<string | null>(null);
  const [locked, setLocked] = useState<boolean>(false);
  const [status, setStatus] = useState<"loading" | "ready" | "invalid">("loading");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [name, setName] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [gFrom, setGFrom] = useState<string>("");
  const [gTo, setGTo] = useState<string>("");
  const [showGrant, setShowGrant] = useState<boolean>(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  async function refresh(shareCode: string) {
    const { data: ctx } = await supabase.rpc("chat_context", { code: shareCode });
    if (ctx && ctx.length) {
      setCampaignName(ctx[0].campaign_name);
      setLocked(ctx[0].locked);
      if (!ctx[0].locked) {
        const { data: msgs } = await supabase.rpc("chat_fetch", { code: shareCode });
        setMessages((msgs as Msg[]) || []);
        const { data: gr } = await supabase.rpc("chat_grants_mine", { code: shareCode });
        setGrants((gr as Grant[]) || []);
      } else {
        setMessages([]);
      }
    }
  }

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const shareCode = new URLSearchParams(window.location.search).get("share");
      try {
        const saved = window.localStorage.getItem("wrangler_player_name");
        if (saved && active) setName(saved);
      } catch (e) { /* no window */ }
      if (!shareCode) { if (active) setStatus("invalid"); return; }
      if (active) setCode(shareCode);

      let { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) { if (active) setStatus("invalid"); return; }
        user = data.user;
      }
      if (active && user) setUid(user.id);

      const { data: ctx } = await supabase.rpc("chat_context", { code: shareCode });
      if (!active) return;
      if (!ctx || !ctx.length) { setStatus("invalid"); return; }
      setStatus("ready");
      await refresh(shareCode);
      timer = setInterval(() => { refresh(shareCode); }, 4000);
    })();
    return () => { active = false; if (timer) clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    if (!code || !draft.trim() || sending) return;
    setSending(true);
    try { window.localStorage.setItem("wrangler_player_name", name.trim()); } catch (e) { /* no window */ }
    const { error } = await supabase.rpc("chat_post", { code, p_body: draft.trim(), p_name: name.trim() || null });
    setSending(false);
    if (!error) { setDraft(""); refresh(code); }
  }

  async function grant() {
    if (!code || !gFrom || !gTo) return;
    const from = new Date(gFrom).toISOString();
    const to = new Date(gTo).toISOString();
    await supabase.rpc("chat_grant", { code, p_from: from, p_to: to });
    setGFrom(""); setGTo(""); setShowGrant(false);
    refresh(code);
  }
  async function revoke(id: string) {
    await supabase.rpc("chat_grant_revoke", { grant_id: id });
    if (code) refresh(code);
  }

  const fmt = (iso: string): string => { try { return new Date(iso).toLocaleString(); } catch (e) { return iso; } };
  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 } as const;
  const input = { boxSizing: "border-box" as const, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14, outline: "none" };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 20px 50px" }}>
        <WranglerNav />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <h1 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 26, margin: "8px 0 0" }}>Party chat</h1>
          {campaignName && <span style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.12em" }}>{campaignName.toUpperCase()}</span>}
        </div>
        <p style={{ color: C.muted, fontSize: 13, margin: "0 0 18px" }}>
          Just the players. Your GM can’t read this unless you grant them a time window below.
        </p>

        {status === "loading" && <div style={{ ...box, color: C.muted, fontSize: 14 }}>Loading…</div>}
        {status === "invalid" && <div style={{ ...box, color: C.muted, fontSize: 14 }}>This link looks broken. Ask your GM for the campaign link.</div>}

        {status === "ready" && locked && (
          <div style={{ ...box, textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: C.warn }}>Chat is closed</div>
            <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>A session is live right now. Eyes up, no table-talk. Chat comes back when the GM wraps the session.</div>
          </div>
        )}

        {status === "ready" && !locked && (
          <>
            <div style={{ ...box, marginBottom: 14 }}>
              <div style={{ display: "grid", gap: 10, maxHeight: 420, overflowY: "auto", marginBottom: 12 }}>
                {messages.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>No messages yet. Say hi.</p>}
                {messages.map((m) => {
                  const mine = m.author_profile === uid;
                  return (
                    <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%", background: mine ? "rgba(244,196,48,0.14)" : C.surface2, border: `1px solid ${C.line}`, borderRadius: 11, padding: "8px 12px", marginLeft: mine ? "auto" : 0 }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{m.display_name || (mine ? "You" : "Player")} · {fmt(m.created_at)}</div>
                      <div style={{ fontSize: 14, lineHeight: 1.45 }}>{m.body}</div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" style={{ ...input, width: "100%", marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Message the party…" style={{ ...input, flex: 1 }} />
                <button type="button" onClick={send} disabled={sending || !draft.trim()} style={{ background: C.sun, color: "#1B1426", border: "none", borderRadius: 9, padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: sending || !draft.trim() ? "default" : "pointer", opacity: sending || !draft.trim() ? 0.6 : 1 }}>Send</button>
              </div>
            </div>

            {/* grants */}
            <div style={box}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>What the GM can see</div>
                <button type="button" onClick={() => setShowGrant((v) => !v)} style={{ background: "transparent", color: C.plum, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
                  {showGrant ? "Cancel" : "Grant a window"}
                </button>
              </div>
              <div style={{ fontSize: 12, color: C.muted, margin: "6px 0 12px" }}>
                By default the GM sees nothing here. Grant a time range and they’ll see only your messages sent in that window.
              </div>

              {showGrant && (
                <div style={{ display: "grid", gap: 8, marginBottom: 14, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
                  <label style={{ fontSize: 12, color: C.muted }}>From
                    <input type="datetime-local" value={gFrom} onChange={(e) => setGFrom(e.target.value)} style={{ ...input, width: "100%", marginTop: 4, colorScheme: "dark" }} />
                  </label>
                  <label style={{ fontSize: 12, color: C.muted }}>To
                    <input type="datetime-local" value={gTo} onChange={(e) => setGTo(e.target.value)} style={{ ...input, width: "100%", marginTop: 4, colorScheme: "dark" }} />
                  </label>
                  <button type="button" onClick={grant} disabled={!gFrom || !gTo} style={{ background: C.good, color: "#1B1426", border: "none", borderRadius: 9, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: gFrom && gTo ? "pointer" : "default", opacity: gFrom && gTo ? 1 : 0.6, justifySelf: "start" }}>Grant this window</button>
                </div>
              )}

              {grants.length === 0 ? (
                <p style={{ color: C.muted, fontSize: 13 }}>No windows granted. Your chat is fully private.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {grants.map((g) => (
                    <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 12px" }}>
                      <span style={{ fontSize: 12.5 }}>{fmt(g.from_ts)} → {fmt(g.to_ts)}</span>
                      <button type="button" onClick={() => revoke(g.id)} style={{ background: "transparent", color: C.warn, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Revoke</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
