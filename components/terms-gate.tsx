"use client";

// components/terms-gate.tsx (push 9, audit T13)
//
// Asks every signed-in account, once per terms version, to confirm it is 18 or older and agrees to the
// Terms of Service and Privacy Policy, and records the answer (accept_terms, p145). Email sign-up asks
// on the form and passes the answer in the account's metadata, so those people are recorded here
// without being asked twice; Discord and Google sign-ins, and accounts made before this existed, see
// the prompt once.
//
// It only runs on the signed-in app (the paths below) and never for guests: a player on a share link
// plays through their GM, as the Terms say. It reads the address in an effect, not with usePathname,
// so the root layout needs no Suspense boundary for it.

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { TERMS_STATEMENT, TERMS_VERSION } from "@/lib/legal";

const APP_PATHS = ["/gm", "/me", "/tabletop", "/chat", "/vibe", "/world", "/lore", "/map"];

type Terms = { accepted_at: string | null; version: string | null; is_anonymous: boolean } | null;

export default function TermsGate() {
  const [show, setShow] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const path = window.location.pathname;
    if (!APP_PATHS.some((p) => path === p || path.startsWith(p + "/"))) return;
    let active = true;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || user.is_anonymous) return;
      const { data, error: e } = await supabase.rpc("my_terms");
      if (!active || e) return; // never lock someone out over a failed read
      const t = data as Terms;
      if (!t || t.is_anonymous || t.version === TERMS_VERSION) return;
      // Agreed on the sign-up form for this same version: record it without asking again.
      if ((user.user_metadata as { terms_version?: string } | null)?.terms_version === TERMS_VERSION) {
        await supabase.rpc("accept_terms", { p_version: TERMS_VERSION });
        return;
      }
      if (active) setShow(true);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => { if (show) boxRef.current?.focus(); }, [show]);

  async function accept() {
    if (!agreed) { setError("Tick the box to carry on, or sign out."); return; }
    setBusy(true); setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("accept_terms", { p_version: TERMS_VERSION });
    setBusy(false);
    if (e) { setError("Could not save that. Check your connection and try again."); return; }
    setShow(false);
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (!show) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000, background: "rgba(8,6,4,0.82)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="terms-gate-title" style={{
        width: "100%", maxWidth: 460, background: C.surface, border: `1px solid ${C.line}`,
        borderRadius: FORGE_RADIUS, padding: "22px 22px 18px", color: C.text,
        boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
      }}>
        <h2 id="terms-gate-title" style={{ margin: "0 0 8px", fontSize: 19, color: C.brass }}>Before you carry on</h2>
        <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.55, color: C.muted }}>
          Six Axes accounts are for adults, and records voices at the table, so we ask everyone with an
          account to confirm this once. Read the{" "}
          <a href="/terms" target="_blank" rel="noreferrer" style={{ color: C.sun }}>Terms of Service</a> and the{" "}
          <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: C.sun }}>Privacy Policy</a>.
        </p>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14.5, lineHeight: 1.5, cursor: "pointer" }}>
          <input
            ref={boxRef}
            type="checkbox"
            checked={agreed}
            onChange={(e) => { setAgreed(e.target.checked); setError(null); }}
            style={{ width: 20, height: 20, marginTop: 2, flex: "0 0 auto" }}
          />
          <span>{TERMS_STATEMENT}</span>
        </label>
        {error && <p role="alert" style={{ color: C.warn, fontSize: 13, margin: "10px 0 0" }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button type="button" onClick={accept} disabled={busy} style={{
            padding: "10px 16px", minHeight: 44, border: "none", borderRadius: FORGE_RADIUS,
            background: C.brass, color: C.ink, fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: busy ? 0.6 : 1,
          }}>{busy ? "Saving…" : "Continue"}</button>
          <button type="button" onClick={signOut} style={{
            padding: "10px 16px", minHeight: 44, borderRadius: FORGE_RADIUS, background: "transparent",
            border: `1px solid ${C.line}`, color: C.muted, fontSize: 14, cursor: "pointer",
          }}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
