"use client";

import React, { useState } from "react";
import { createClient } from "@/lib/supabase/client";

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
};

export default function LoginPage() {
  const [email, setEmail] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [sent, setSent] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/gm` },
    });
    if (error) setError("Could not start Google sign-in. Try again.");
  }

  async function signInWithDiscord() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/gm`,
        scopes: "identify email",
      },
    });
    if (error) setError("Could not start Discord sign-in. Try again.");
  }

  async function sendMagicLink() {
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setSending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/gm`,
      },
    });
    setSending(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        color: C.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: C.surface,
          border: `1px solid ${C.line}`,
          borderRadius: 16,
          padding: "40px 32px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
        }}
      >
        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <span
            style={{
              fontFamily: "'Iowan Old Style', Georgia, serif",
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            Six Axes
          </span>
        </div>
        <div
          style={{
            textAlign: "center",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 11,
            letterSpacing: "0.32em",
            color: C.muted,
            marginBottom: 22,
          }}
        >
          RUN THE TABLE
        </div>

        {/* Sunflower divider */}
        <div
          style={{
            height: 3,
            borderRadius: 3,
            background: `linear-gradient(90deg, ${C.sun}, ${C.plum})`,
            marginBottom: 26,
          }}
        />

        <p
          style={{
            textAlign: "center",
            color: C.muted,
            fontSize: 14,
            lineHeight: 1.5,
            margin: "0 0 26px",
          }}
        >
          Sign in to your GM workspace. Track spotlight, arcs, loot, and
          table health across your campaigns.
        </p>

        {/* Google */}
        <button
          type="button"
          onClick={signInWithGoogle}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: "#fff",
            color: "#1f1f1f",
            border: "none",
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continue with Google
        </button>

        {/* Discord */}
        <button
          type="button"
          onClick={signInWithDiscord}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: "#5865F2",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            marginTop: 12,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 127.14 96.36" fill="#fff" aria-hidden="true">
            <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z" />
          </svg>
          Continue with Discord
        </button>

        <p style={{ textAlign: "center", color: C.muted, fontSize: 12, lineHeight: 1.5, margin: "10px 4px 0" }}>
          We use these only to sign you in. We never see your password.
        </p>

        {/* OR divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0" }}>
          <div style={{ flex: 1, height: 1, background: C.line }} />
          <span style={{ color: C.muted, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>or</span>
          <div style={{ flex: 1, height: 1, background: C.line }} />
        </div>

        {sent ? (
          <div
            style={{
              background: C.surface2,
              border: `1px solid ${C.line}`,
              borderRadius: 10,
              padding: "18px 16px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Check your email</div>
            <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.5 }}>
              We sent a sign-in link to <strong style={{ color: C.text }}>{email}</strong>. Open it
              on this device to finish signing in.
            </div>
          </div>
        ) : (
          <>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendMagicLink(); }}
              placeholder="you@example.com"
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: C.surface2,
                border: `1px solid ${C.line}`,
                borderRadius: 10,
                padding: "12px 14px",
                color: C.text,
                fontSize: 15,
                outline: "none",
                marginBottom: 12,
              }}
            />
            <button
              type="button"
              onClick={sendMagicLink}
              disabled={sending}
              style={{
                width: "100%",
                background: `linear-gradient(90deg, ${C.sun}, ${C.sunSoft})`,
                color: "#1B1426",
                border: "none",
                borderRadius: 10,
                padding: "12px 16px",
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: "0.03em",
                cursor: sending ? "default" : "pointer",
                opacity: sending ? 0.7 : 1,
              }}
            >
              {sending ? "Sending..." : "Email me a sign-in link"}
            </button>
            <p style={{ textAlign: "center", color: C.muted, fontSize: 12, lineHeight: 1.5, margin: "10px 4px 0" }}>
              No password needed. We email you a link that signs you in.
            </p>
          </>
        )}

        {error && (
          <p style={{ color: C.warn, fontSize: 13, textAlign: "center", marginTop: 16 }}>{error}</p>
        )}
      </div>
    </div>
  );
}
