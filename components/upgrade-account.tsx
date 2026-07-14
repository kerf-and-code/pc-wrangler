"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SAX as C } from "@/lib/theme";

// Upgrade a guest to a durable account.
//
// WHY THIS IS SAFE. Everything in this app keys on auth.uid(): profiles.id,
// characters.profile_id, tpdi_responses.respondent_id, dispositions.profile_id.
// Supabase's linkIdentity() attaches a Google or Discord identity to the EXISTING
// anonymous user and preserves that id. So upgrading changes nothing downstream:
// the player keeps every character, every response, every disposition. There is no
// migration and nothing to lose. The copy below can promise that honestly.
//
// TWO VARIANTS.
//   "card" - the full pitch. For /me and the player hub.
//   "nag"  - a slim dismissible banner. For session start (decision 4). Dismissal
//            is scoped to the session id, so it comes back next session rather than
//            being silenced forever.
//
// ADAPTIVE COPY. If the player already holds characters, the pitch names them:
// "you have 3 characters across 2 campaigns, keep them." That is a concrete thing
// they lose by staying a guest. If they have none yet, it pitches forward instead.
// Reading my_characters() costs one RPC and makes the difference between a real
// offer and a generic one.

type Stable = { characters: number; campaigns: number; names: string[] };

export function useAccountStatus() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [stable, setStable] = useState<Stable | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;

      // No session at all: nothing to upgrade, and no prompt to show.
      if (!user) { setLoading(false); return; }

      const guest = Boolean((user as { is_anonymous?: boolean }).is_anonymous);
      setIsGuest(guest);

      if (guest) {
        const { data } = await supabase.rpc("my_characters");
        if (!active) return;
        const rows = (data as Array<{ name: string; campaign_id: string }> | null) || [];
        if (rows.length > 0) {
          setStable({
            characters: rows.length,
            campaigns: new Set(rows.map((r) => r.campaign_id)).size,
            names: rows.map((r) => r.name),
          });
        }
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [supabase]);

  return { loading, isGuest, stable };
}

export function UpgradeAccount({
  variant = "card",
  sessionId,
  next = "/me",
}: {
  variant?: "card" | "nag";
  // Scopes a "nag" dismissal to one session, so it reappears next session rather
  // than being dismissed permanently. Ignored for the card variant.
  sessionId?: string | null;
  // Where to land after the provider round-trip.
  next?: string;
}) {
  const supabase = createClient();
  const { loading, isGuest, stable } = useAccountStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const dismissKey = sessionId ? `sixaxes.upgrade-dismissed.${sessionId}` : null;

  useEffect(() => {
    if (!dismissKey) return;
    try {
      if (window.localStorage.getItem(dismissKey) === "1") setDismissed(true);
    } catch {
      // Storage can be unavailable (private mode, blocked). Showing the nag is the
      // safe failure: an extra prompt is better than silently never asking.
    }
  }, [dismissKey]);

  function dismiss() {
    setDismissed(true);
    if (!dismissKey) return;
    try { window.localStorage.setItem(dismissKey, "1"); } catch { /* see above */ }
  }

  async function linkOAuth(provider: "google" | "discord") {
    setBusy(provider);
    setError(null);
    // linkIdentity, NOT signInWithOAuth. signInWithOAuth would create a NEW user and
    // strand every character on the old anonymous one. linkIdentity attaches the
    // identity to the current user and keeps auth.uid() intact.
    const { error: e } = await supabase.auth.linkIdentity({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?upgrade=1&next=${encodeURIComponent(next)}`,
      },
    });
    if (e) {
      setBusy(null);
      setError(
        e.message?.toLowerCase().includes("already")
          ? "That account is already linked to a different player. Sign in with it instead."
          : "Could not start the link. Try again.",
      );
    }
    // On success the browser navigates away; the callback finishes the upgrade.
  }

  async function linkEmail() {
    const addr = email.trim();
    if (!addr) return;
    setBusy("email");
    setError(null);
    // updateUser({ email }) on an anonymous user sends a confirmation link. Clicking
    // it converts the SAME user to a permanent one, so auth.uid() survives here too.
    const { error: e } = await supabase.auth.updateUser({ email: addr });
    setBusy(null);
    if (e) {
      setError(
        e.message?.toLowerCase().includes("already")
          ? "That email is already in use. Sign in with it instead."
          : "Could not send the confirmation email. Check the address and try again.",
      );
      return;
    }
    setSent(true);
  }

  // Nothing to offer: still loading, already durable, or dismissed for this session.
  if (loading || !isGuest || dismissed) return null;

  const pitch = stable
    ? `You have ${stable.characters} character${stable.characters === 1 ? "" : "s"}` +
      (stable.campaigns > 1 ? ` across ${stable.campaigns} campaigns` : "") +
      `. Save ${stable.characters === 1 ? "it" : "them"} to an account so you keep ${stable.characters === 1 ? "it" : "them"} on any device.`
    : "Save your characters to an account so they follow you to any device, and so your play history builds up over time.";

  const sub = stable
    ? `Right now ${stable.names.slice(0, 3).join(", ")}${stable.names.length > 3 ? ", and more" : ""} live only in this browser. Clear your history and they are gone.`
    : "Right now you are playing as a guest, and everything lives only in this browser.";

  // ---- NAG ----------------------------------------------------------------
  if (variant === "nag") {
    return (
      <div
        style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          background: C.slateBg, border: `1px solid ${C.line}`,
          borderRadius: 10, padding: "10px 14px", marginBottom: 14,
        }}
      >
        <span style={{ color: C.text, fontSize: 13.5, flex: "1 1 260px", lineHeight: 1.45 }}>
          {pitch}
        </span>
        <button
          type="button"
          onClick={() => linkOAuth("discord")}
          disabled={busy !== null}
          style={btn(C.plum, C.text)}
        >
          {busy === "discord" ? "..." : "Save with Discord"}
        </button>
        <button
          type="button"
          onClick={() => linkOAuth("google")}
          disabled={busy !== null}
          style={btn("transparent", C.text, C.line)}
        >
          {busy === "google" ? "..." : "Google"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          style={{
            background: "transparent", border: "none", color: C.muted,
            fontSize: 12.5, cursor: "pointer", padding: "6px 4px",
            fontFamily: C.mono, letterSpacing: "0.04em",
          }}
        >
          Not now
        </button>
        {error && (
          <p style={{ color: C.warn, fontSize: 12.5, width: "100%", margin: "4px 0 0" }}>{error}</p>
        )}
      </div>
    );
  }

  // ---- CARD ---------------------------------------------------------------
  return (
    <section
      style={{
        background: C.panelBg, border: `1px solid ${C.line}`,
        borderRadius: 12, padding: 20, marginBottom: 18,
      }}
    >
      <p style={{
        fontFamily: C.mono, fontSize: 11, letterSpacing: "0.22em",
        textTransform: "uppercase", color: C.muted, margin: "0 0 8px",
      }}>
        Playing as a guest
      </p>

      <h2 style={{
        fontFamily: C.serif, fontSize: 20, color: C.text, margin: "0 0 6px", fontWeight: 600,
      }}>
        {pitch}
      </h2>

      <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.55, margin: "0 0 16px" }}>
        {sub} Linking an account keeps everything exactly as it is: same characters,
        same history, same dispositions. Nothing is reset.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => linkOAuth("discord")}
          disabled={busy !== null}
          style={btn(C.plum, C.text)}
        >
          {busy === "discord" ? "Opening Discord..." : "Continue with Discord"}
        </button>
        <button
          type="button"
          onClick={() => linkOAuth("google")}
          disabled={busy !== null}
          style={btn("transparent", C.text, C.line)}
        >
          {busy === "google" ? "Opening Google..." : "Continue with Google"}
        </button>
      </div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
        {sent ? (
          <p style={{ color: C.good, fontSize: 13.5, margin: 0 }}>
            Check your email. Click the link to finish, and you will come back to
            everything just as you left it.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="or use your email"
              style={{
                flex: "1 1 220px", background: C.slateBg, color: C.text,
                border: `1px solid ${C.line}`, borderRadius: 8,
                padding: "9px 12px", fontSize: 14,
              }}
            />
            <button
              type="button"
              onClick={linkEmail}
              disabled={busy !== null || !email.trim()}
              style={btn("transparent", C.text, C.line)}
            >
              {busy === "email" ? "Sending..." : "Send link"}
            </button>
          </div>
        )}
      </div>

      {error && <p style={{ color: C.warn, fontSize: 13, margin: "12px 0 0" }}>{error}</p>}
    </section>
  );
}

function btn(bg: string, fg: string, border?: string): React.CSSProperties {
  return {
    background: bg,
    color: fg,
    border: `1px solid ${border ?? bg}`,
    borderRadius: 8,
    padding: "9px 15px",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: C.mono,
    letterSpacing: "0.04em",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
