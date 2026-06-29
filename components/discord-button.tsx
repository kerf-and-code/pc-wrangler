"use client";

import React, { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function DiscordButton({ next }: { next?: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signIn() {
    setLoading(true);
    setErr(null);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo, scopes: "identify email" },
    });
    if (error) {
      setErr("Could not start Discord sign-in. Try again.");
      setLoading(false);
    }
    // on success the browser is redirected to Discord, so no further state needed
  }

  return (
    <div style={{ width: "100%" }}>
      <button
        type="button"
        onClick={signIn}
        disabled={loading}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          background: "#5865F2", color: "#fff", border: "none", borderRadius: 8,
          padding: "10px 16px", fontSize: 14, fontWeight: 600, cursor: loading ? "default" : "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 127.14 96.36" fill="#fff" aria-hidden="true">
          <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z" />
        </svg>
        {loading ? "Redirecting..." : "Continue with Discord"}
      </button>
      {err && <p style={{ color: "#c0392b", fontSize: 13, marginTop: 8 }}>{err}</p>}
    </div>
  );
}
