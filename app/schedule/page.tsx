"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";

const C = {
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

type Sched = { session_id: string; session_number: number | null; scheduled_at: string; campaign_name: string };

const OPTIONS: { value: string; label: string; color: string }[] = [
  { value: "going", label: "I'm in", color: SAX.good },
  { value: "maybe", label: "Maybe", color: SAX.sun },
  { value: "declined", label: "Can't make it", color: SAX.warn },
];

export default function PlayerSchedulePage() {
  const supabase = useMemo(() => createClient(), []);
  const [code, setCode] = useState<string | null>(null);
  const [sched, setSched] = useState<Sched | null>(null);
  const [displayName, setDisplayName] = useState<string>("");
  const [status, setStatus] = useState<"loading" | "gate" | "ready" | "none" | "invalid">("loading");
  const [choice, setChoice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const shareCode = params.get("share");
      if (!shareCode) { if (active) setStatus("invalid"); return; }
      if (active) setCode(shareCode);

      const { data: { user } } = await supabase.auth.getUser();
      // RSVP needs a real (Discord) identity, not an anonymous session.
      if (!user || user.is_anonymous) { if (active) setStatus("gate"); return; }

      const m = user.user_metadata || {};
      if (active) setDisplayName(m.full_name || m.name || m.user_name || m.preferred_username || "");

      const { data } = await supabase.rpc("next_scheduled_for_share", { code: shareCode });
      if (!active) return;
      if (data && data.length) { setSched(data[0]); setStatus("ready"); }
      else setStatus("none");
    })();
    return () => { active = false; };
  }, [supabase]);

  async function signInDiscord() {
    const back = `/schedule${window.location.search}`;
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(back)}`,
        scopes: "identify email",
      },
    });
  }

  async function rsvp(value: string) {
    if (!code || !sched || saving) return;
    setChoice(value);
    setSaving(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("rsvp_for_share", {
      code, p_session_id: sched.session_id, p_status: value, p_display_name: displayName.trim() || null,
    });
    setSaving(false);
    if (rpcErr) setError(rpcErr.message);
    else setSaved(true);
  }

  const card = { width: "100%", maxWidth: 460, margin: "0 auto", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "32px 28px" } as const;
  const when = sched?.scheduled_at
    ? new Date(sched.scheduled_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <PageShell width={920}>
      <div style={card}>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <span style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 26, fontWeight: 700 }}>Next session</span>
        </div>
        <div style={{ textAlign: "center", fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.28em", color: C.muted, marginBottom: 18 }}>
          {sched?.campaign_name ? sched.campaign_name.toUpperCase() : "SIX AXES"}
        </div>
        <div style={{ height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${C.sun}, ${C.plum})`, marginBottom: 24 }} />

        {status === "loading" && <p style={{ textAlign: "center", color: C.muted, fontSize: 14 }}>Loading…</p>}

        {status === "invalid" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>This link looks broken. Ask your GM for the campaign link.</p>
        )}

        {status === "none" && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>No session is on the calendar yet. Check back once your GM sets a time.</p>
        )}

        {status === "gate" && (
          <div style={{ textAlign: "center" }}>
            <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
              Sign in with Discord to RSVP. We use it to know who&rsquo;s coming and to send you a reminder.
            </p>
            <button type="button" onClick={signInDiscord}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "#5865F2", color: "#fff", border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
              <svg width="18" height="18" viewBox="0 0 127.14 96.36" fill="#fff" aria-hidden="true">
                <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z" />
              </svg>
              Continue with Discord
            </button>
          </div>
        )}

        {status === "ready" && sched && (
          <>
            <div style={{ textAlign: "center", marginBottom: 22 }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
                {sched.session_number != null ? `Session ${sched.session_number}` : "Next session"}
              </div>
              <div style={{ color: C.sun, fontSize: 15 }}>{when}</div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {OPTIONS.map((o) => {
                const on = choice === o.value;
                return (
                  <button key={o.value} type="button" onClick={() => rsvp(o.value)} disabled={saving}
                    style={{ padding: "13px 16px", borderRadius: 10, border: `1px solid ${on ? o.color : C.line}`, background: on ? "rgba(255,255,255,0.06)" : C.surface2, color: C.text, fontSize: 15, fontWeight: 600, cursor: saving ? "default" : "pointer", textAlign: "left" }}>
                    {o.label}
                  </button>
                );
              })}
            </div>

            {saved && (
              <p style={{ textAlign: "center", color: C.good, fontSize: 14, marginTop: 18 }}>
                Got it{displayName ? `, ${displayName}` : ""}. You can change your answer anytime.
              </p>
            )}
            {error && <p style={{ color: C.warn, fontSize: 13, textAlign: "center", marginTop: 14 }}>{error}</p>}
          </>
        )}
      </div>
    </PageShell>
  );
}
