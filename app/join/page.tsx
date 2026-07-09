"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const C = {
  bg: "#1B1426", surface: "#251B33", line: "#3D2F52",
  text: "#F4EEFA", muted: "#A597BD", sun: "#F4C430", plum: "#9B7BD4", warn: "#E07A5F", good: "#8FBF8F",
};

type Status = "working" | "invalid" | "consent" | "saving";

export default function JoinPage() {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<Status>("working");
  const [name, setName] = useState<string>("");
  const [share, setShare] = useState<string>("");
  const [charId, setCharId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const code = new URLSearchParams(window.location.search).get("c");
      if (!code) { if (active) setStatus("invalid"); return; }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) { if (active) setStatus("invalid"); return; }
      }

      const { data, error } = await supabase.rpc("claim_character_invite", { p_code: code });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row?.campaign_share_code) { if (active) setStatus("invalid"); return; }

      if (!active) return;
      // Claim succeeded. Hold here for a one-time recording-consent decision
      // before entering the portal (blanket, campaign-wide; can be opted out later).
      setName(row.character_name || "");
      setShare(row.campaign_share_code);
      setCharId(row.character_id);
      setStatus("consent");
    })();
    return () => { active = false; };
  }, [supabase]);

  const go = () => window.location.replace(`/play?share=${encodeURIComponent(share)}`);

  async function agree() {
    setStatus("saving"); setError(null);
    const { error } = await supabase.rpc("record_consent_for_share", {
      code: share,
      p_session_number: null,      // null -> a standing (blanket) consent, not tied to a session
      p_character_id: charId,
      p_consented: true,
      p_method: "web_claim",
    });
    if (error) { setError("Could not save your choice. Try again."); setStatus("consent"); return; }
    go();
  }

  const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16,
    padding: "32px 28px", maxWidth: 460, width: "100%", textAlign: "center" as const };
  const title = { fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 22 };

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100dvh",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={card}>
        {status === "working" && (
          <>
            <div style={{ ...title, color: C.sun }}>Joining the table&hellip;</div>
            <p style={{ color: C.muted, marginTop: 12, fontSize: 15 }}>Binding your character to this link.</p>
          </>
        )}

        {status === "invalid" && (
          <>
            <div style={{ ...title, color: C.warn }}>This invite link isn&rsquo;t valid.</div>
            <p style={{ color: C.muted, marginTop: 12, fontSize: 15 }}>Ask your GM to resend your personal link.</p>
          </>
        )}

        {(status === "consent" || status === "saving") && (
          <>
            <div style={{ ...title, color: C.plum }}>Welcome{name ? `, ${name}` : ""}.</div>
            <p style={{ color: C.text, marginTop: 16, fontSize: 14.5, lineHeight: 1.65, textAlign: "left" }}>
              This campaign records its sessions so your GM can get recaps and table analytics.
              By continuing, you agree to have your voice recorded and processed for this campaign.
              You can opt out at any time, just tell your GM, and they can exclude you from any session.
              You can also ask your GM to delete your recordings.
            </p>
            <p style={{ color: C.muted, marginTop: 10, fontSize: 12.5, textAlign: "left" }}>
              <a href="/ai-recording" target="_blank" rel="noreferrer" style={{ color: C.sun }}>How recording works &amp; your choices</a>
            </p>
            <button type="button" onClick={agree} disabled={status === "saving"}
              style={{ width: "100%", marginTop: 18, background: C.good, color: "#12210f", border: "none",
                borderRadius: 12, padding: "14px 18px", fontSize: 15, fontWeight: 700,
                cursor: status === "saving" ? "default" : "pointer", opacity: status === "saving" ? 0.6 : 1 }}>
              {status === "saving" ? "Saving\u2026" : "I agree \u00b7 enter the table"}
            </button>
            <button type="button" onClick={go} disabled={status === "saving"}
              style={{ width: "100%", marginTop: 10, background: "transparent", color: C.muted,
                border: "none", fontSize: 13, cursor: "pointer" }}>
              Continue without agreeing for now
            </button>
            {error && <p style={{ color: C.warn, fontSize: 13, marginTop: 12 }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
