"use client";

// Table Tap card for GM-facing campaign pages. Shows the shareable Table Tap
// link with a copy button and the one-time player setup steps. Drop in with:
//   <TableTapCard shareCode={campaign.share_code} />

import { useEffect, useState } from "react";

const BRASS = "#c8a24b";

export default function TableTapCard({ shareCode }: { shareCode: string }) {
  const [origin, setOrigin] = useState("https://pc-wrangler.vercel.app");
  const url = `${origin}/record?share=${shareCode}`;
  const [copied, setCopied] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable; the URL is still visible to select manually.
    }
  };

  return (
    <section
      style={{
        background: "#221c31",
        border: "1px solid #37304a",
        borderRadius: 12,
        padding: 16,
        color: "#e8e2f0",
      }}
    >
      <h2 style={{ color: BRASS, fontSize: 16, margin: "0 0 4px" }}>Table Tap: capture rolls from D&amp;D Beyond</h2>
      <p style={{ color: "#9a8fb0", fontSize: 13, margin: "0 0 12px" }}>
        Players who use Beyond20 can keep this page open during sessions. Their attacks,
        saves, checks, damage, and HP changes are captured for recaps and analytics.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <code
          style={{
            background: "#1a1526",
            border: "1px solid #37304a",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 13,
            color: "#9fe0ae",
            flex: 1,
            minWidth: 240,
            overflowWrap: "anywhere",
          }}
        >
          {url}
        </code>
        <button
          onClick={copy}
          style={{
            background: BRASS,
            color: "#1a1626",
            border: 0,
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <button
        onClick={() => setShowSteps((s) => !s)}
        style={{
          background: "transparent",
          color: "#b7aed1",
          border: 0,
          padding: 0,
          marginTop: 12,
          fontSize: 13,
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        {showSteps ? "Hide player setup" : "Show player setup (one time, per player)"}
      </button>

      {showSteps && (
        <ol style={{ color: "#b7aed1", fontSize: 13, margin: "10px 0 0", paddingLeft: 20, lineHeight: 1.7 }}>
          <li>
            In the Beyond20 extension options, add{" "}
            <code style={{ color: "#9fe0ae" }}>{origin}/*</code> to Custom Domains and press Apply.
          </li>
          <li>Enable D&amp;D Beyond digital dice in Beyond20 so captured numbers match what the table sees.</li>
          <li>During sessions, open your session link and keep the tab in the background while you play.</li>
        </ol>
      )}
    </section>
  );
}
