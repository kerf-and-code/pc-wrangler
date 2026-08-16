"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

// The secondary access gate. A user who has signed in with Google but has not yet entered the pilot
// code lands here (the proxy redirects /gm and /me to it until profiles.access_granted is true). The
// code is checked server-side by /api/gate; this page only collects it.
export default function EnterGate() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (res.ok && data.ok) {
        router.push("/gm");
        router.refresh();
      } else {
        setError(data.error || "That code isn't right.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.surface, padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 380, textAlign: "center" }}>
        <div style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 8 }}>
          Six Axes
        </div>
        <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.6, margin: "0 0 22px" }}>
          Six Axes is in a private pilot. Enter the access code you were given to continue.
        </p>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          placeholder="Access code"
          autoFocus
          style={{
            width: "100%", padding: "12px 14px", fontSize: 16, background: C.surface2, color: C.text,
            border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, outline: "none", marginBottom: 12,
          }}
        />
        <button
          onClick={() => void submit()}
          disabled={busy || !code.trim()}
          style={{
            width: "100%", padding: 12, fontSize: 15, fontWeight: 600, background: C.sun, color: "#1b1712",
            border: "none", borderRadius: FORGE_RADIUS, cursor: busy || !code.trim() ? "default" : "pointer",
            opacity: busy || !code.trim() ? 0.7 : 1,
          }}
        >
          {busy ? "Checking\u2026" : "Enter"}
        </button>
        {error && <p style={{ color: "#c98a7a", fontSize: 13, margin: "12px 0 0" }}>{error}</p>}
      </div>
    </div>
  );
}
