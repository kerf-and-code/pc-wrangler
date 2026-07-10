"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Pass-through claim: sign in anonymously, bind the character to this link, and
// send the player into their portal. Recording consent is captured at character
// claim (Discord /claim), so there is no consent step here (avoids the collision
// and the anon-profile FK error the web consent step hit during the pilot).
export default function JoinPage() {
  const supabase = useMemo(() => createClient(), []);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const code = new URLSearchParams(window.location.search).get("c");
      if (!code) { if (active) setFailed(true); return; }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) { if (active) setFailed(true); return; }
      }

      const { data, error } = await supabase.rpc("claim_character_invite", { p_code: code });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row?.campaign_share_code) { if (active) setFailed(true); return; }

      window.location.replace(`/play?share=${encodeURIComponent(row.campaign_share_code)}`);
    })();
    return () => { active = false; };
  }, [supabase]);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#1B1426", color: "#F4EEFA", padding: 24, textAlign: "center",
      fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 420 }}>
        {failed ? (
          <>
            <div style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 22, color: "#E07A5F" }}>
              This invite link isn&rsquo;t valid.
            </div>
            <p style={{ color: "#A597BD", marginTop: 12, fontSize: 15 }}>Ask your GM to resend your personal link.</p>
          </>
        ) : (
          <>
            <div style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 22, color: "#F4C430" }}>
              Joining the table&hellip;
            </div>
            <p style={{ color: "#A597BD", marginTop: 12, fontSize: 15 }}>Binding your character to this link.</p>
          </>
        )}
      </div>
    </div>
  );
}
