"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

const SPOTLIGHT: { value: string; label: string; hint: string }[] = [
  { value: "wanted_more", label: "Wanted more", hint: "I was in the background" },
  { value: "about_right", label: "About right", hint: "Felt balanced" },
  { value: "wanted_less", label: "Wanted less", hint: "Too much was on me" },
];

export default function VibeCheckPage() {
  const supabase = useMemo(() => createClient(), []);
  const [code, setCode] = useState<string | null>(null);
  const [sessionNo, setSessionNo] = useState<number | null>(null);
  const [campaignName, setCampaignName] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "none" | "invalid">("loading");

  const [playerName, setPlayerName] = useState<string>("");
  const [satisfaction, setSatisfaction] = useState<number | null>(null);
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [anonymous, setAnonymous] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const shareCode = params.get("share");
      const sParam = params.get("s");
      try {
        const saved = window.localStorage.getItem("wrangler_player_name");
        if (saved && active) setPlayerName(saved);
      } catch (e) { /* no window */ }
      if (!shareCode) { if (active) setStatus("invalid"); return; }
      if (active) setCode(shareCode);

      let { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { data, error: signErr } = await supabase.auth.signInAnonymously();
        if (signErr) { if (active) setStatus("invalid"); return; }
        user = data.user;
      }

      if (sParam) {
        const sNum = parseInt(sParam, 10);
        const { data } = await supabase.rpc("vibe_target", { code: shareCode, p_session_number: sNum });
        if (!active) return;
        if (data && data.length) { setCampaignName(data[0].campaign_name); setSessionNo(sNum); setStatus("ready"); }
        else setStatus("invalid");
      } else {
        const { data } = await supabase.rpc("latest_processed_session", { code: shareCode });
        if (!active) return;
        if (data && data.length && data[0].session_number !== null) {
          setCampaignName(data[0].campaign_name); setSessionNo(data[0].session_number); setStatus("ready");
        } else {
          // resolve campaign name for a friendlier empty state
          const { data: ctx } = await supabase.rpc("chat_context", { code: shareCode });
          if (active && ctx && ctx.length) setCampaignName(ctx[0].campaign_name);
          if (active) setStatus("none");
        }
      }
    })();
    return () => { active = false; };
  }, [supabase]);

  async function submit() {
    if (!code || sessionNo === null) return;
    if (satisfaction === null && spotlight === null && !note.trim()) { setError("Pick at least one answer first."); return; }
    setSubmitting(true);
    setError(null);
    // Only remember the name on an attributed submission. Storing it during an anonymous one would
    // leave it sitting in the browser ready to be attached next time without being asked again.
    if (!anonymous) {
      try { window.localStorage.setItem("wrangler_player_name", playerName.trim()); } catch (e) { /* no window */ }
    }
    const { error: rpcErr } = await supabase.rpc("submit_vibe_check", {
      code, p_session_number: sessionNo, p_satisfaction: satisfaction, p_spotlight: spotlight,
      p_note: note.trim() || null,
      // Not sent at all when anonymous. The function forces it null regardless, but a client that
      // transmits a name it has promised not to use is still transmitting it.
      p_player_name: anonymous ? null : (playerName.trim() || null),
      p_anonymous: anonymous,
    });
    setSubmitting(false);
    if (rpcErr) setError(rpcErr.message);
    else setSubmitted(true);
  }

  const card = { width: "100%", maxWidth: 460, margin: "0 auto", background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "32px 28px" } as const;

  return (
    <PageShell width={920}>
        <div style={card}>
          <div style={{ textAlign: "center", marginBottom: 4 }}>
            <span style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 26, fontWeight: 700 }}>Session check-in</span>
          </div>
          <div style={{ textAlign: "center", fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.28em", color: C.muted, marginBottom: 18 }}>
            {status === "ready" && campaignName ? `SESSION ${sessionNo} \u00b7 ${campaignName.toUpperCase()}` : campaignName ? campaignName.toUpperCase() : "SIX AXES"}
          </div>
          <div style={{ height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${C.sun}, ${C.plum})`, marginBottom: 24 }} />

          {status === "loading" && <p style={{ textAlign: "center", color: C.muted, fontSize: 14 }}>Loading…</p>}

          {status === "invalid" && (
            <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>This link looks broken. Ask your GM for the campaign link.</p>
          )}

          {status === "none" && (
            <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
              No session is ready for check-in yet. Once your GM wraps and processes a session, it’ll show up here.
            </p>
          )}

          {status === "ready" && submitted && (
            <div style={{ textAlign: "center", padding: "10px 0" }}>
              <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: C.good }}>Thanks{!anonymous && playerName.trim() ? `, ${playerName.trim()}` : ""}!</div>
              <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
                {anonymous
                  ? "Your check-in is saved, with nothing linking it to you. That also means it cannot be edited now."
                  : "Your check-in is saved. You can change an answer and submit again."}
              </div>
              {!anonymous && (
                <button type="button" onClick={() => setSubmitted(false)} style={{ marginTop: 18, background: "transparent", color: C.plum, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>Edit my answers</button>
              )}
            </div>
          )}

          {status === "ready" && !submitted && (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>How was this session for you?</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = satisfaction === n;
                  return (
                    <button key={n} type="button" onClick={() => setSatisfaction(n)}
                      style={{ flex: 1, padding: "12px 0", borderRadius: FORGE_RADIUS, border: `1px solid ${on ? C.sun : C.line}`, background: on ? C.sun : C.surface2, color: on ? C.ink : C.text, fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>{n}</button>
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 11, marginBottom: 22 }}>
                <span>rough</span><span>great</span>
              </div>

              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>How much of the spotlight did you get?</div>
              <div style={{ color: C.muted, fontSize: 12, marginBottom: 10 }}>Your honest read, not what the dice did.</div>
              <div style={{ display: "grid", gap: 8, marginBottom: 22 }}>
                {SPOTLIGHT.map((opt) => {
                  const on = spotlight === opt.value;
                  return (
                    <button key={opt.value} type="button" onClick={() => setSpotlight(opt.value)}
                      style={{ textAlign: "left", padding: "12px 14px", borderRadius: FORGE_RADIUS, border: `1px solid ${on ? C.plum : C.line}`, background: on ? "rgba(155,123,212,0.16)" : C.surface2, color: C.text, cursor: "pointer", boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{opt.label}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{opt.hint}</div>
                    </button>
                  );
                })}
              </div>

              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything you want the GM to know? (optional)" rows={3}
                style={{ width: "100%", boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "10px 12px", color: C.text, fontSize: 14, outline: "none", resize: "vertical", marginBottom: 14, fontFamily: "inherit", boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }} />
              {!anonymous && (
                <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Your name (so the GM knows who)"
                  style={{ width: "100%", boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "10px 12px", color: C.text, fontSize: 14, outline: "none", marginBottom: 14, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }} />
              )}

              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", marginBottom: 10 }}>
                <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} style={{ marginTop: 3 }} />
                <span style={{ fontSize: 13.5, color: C.text, lineHeight: 1.5 }}>Send this anonymously</span>
              </label>
              <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, margin: "0 0 18px" }}>
                {anonymous
                  ? "Your name will not be attached and we will not record that it came from you. Two things worth knowing: you will not be able to edit it afterwards, because there is nothing linking it back to you to find. And at a small table your GM may still work out who wrote it from what it says."
                  : "Your GM will see this with your name on it. You can change an answer and submit again."}
              </p>

              <button type="button" onClick={submit} disabled={submitting}
                style={{ width: "100%", background: `linear-gradient(90deg, ${C.sun}, ${C.sunSoft})`, color: C.ink, border: "none", borderRadius: FORGE_RADIUS, padding: "13px 16px", fontSize: 15, fontWeight: 700, letterSpacing: "0.02em", cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
                {submitting ? "Saving…" : "Submit check-in"}
              </button>
              {error && <p style={{ color: C.warn, fontSize: 13, textAlign: "center", marginTop: 14 }}>{error}</p>}
            </>
          )}
        </div>
    </PageShell>
  );
}
