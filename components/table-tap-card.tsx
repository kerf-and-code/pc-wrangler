"use client";

// Table Tap card for GM-facing campaign pages. Extension-primary: the headline
// path is the one-tap /x/<code> onboarding link that auto-saves the code into
// the Six Axes Capture extension, so players paste nothing. The old tab-capture
// path (keep a page open, add a Beyond20 custom domain) is kept as a quieter
// fallback for players who would rather not install a second extension.
// Drop in with: <TableTapCard shareCode={campaign.share_code} />

import { useEffect, useState } from "react";

const BRASS = "#c8a24b";

// Real Chrome Web Store URL once Six Axes Capture is published. Empty until then;
// the install step renders as plain text rather than a dead link.
const CAPTURE_STORE_URL = "";
const BEYOND20_URL =
  "https://chrome.google.com/webstore/detail/beyond20/aibeceakhehbogooeplpapmbmknmdmpb";

export default function TableTapCard({ shareCode }: { shareCode: string }) {
  const [origin, setOrigin] = useState("https://pc-wrangler.vercel.app");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const setupUrl = `${origin}/x/${shareCode}`; // one-tap extension onboarding
  const tabUrl = `${origin}/record?share=${shareCode}`; // fallback: keep-a-tab-open

  const [copied, setCopied] = useState<"" | "setup" | "tab">("");
  const [showFallback, setShowFallback] = useState(false);

  const copy = async (which: "setup" | "tab", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(""), 2000);
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
      <h2 style={{ color: BRASS, fontSize: 16, margin: "0 0 4px" }}>
        Capture rolls from D&amp;D Beyond
      </h2>
      <p style={{ color: "#9a8fb0", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
        Send each player one link. They install the Six Axes Capture extension once,
        and their rolls flow to this table automatically while a session is open. No
        codes to type, no tab to keep open.
      </p>

      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#8a7fa8", marginBottom: 6 }}>
        PLAYER SETUP LINK
      </div>
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
          {setupUrl}
        </code>
        <button
          onClick={() => copy("setup", setupUrl)}
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
          {copied === "setup" ? "Copied" : "Copy player setup link"}
        </button>
      </div>
      <p style={{ color: "#8a7fa8", fontSize: 12, margin: "8px 0 0", lineHeight: 1.5 }}>
        Opening this link saves the table code into the player&apos;s extension. They&apos;ll
        need{" "}
        {CAPTURE_STORE_URL ? (
          <a href={CAPTURE_STORE_URL} target="_blank" rel="noreferrer" style={{ color: "#c9a6ff" }}>
            Six Axes Capture
          </a>
        ) : (
          <span style={{ color: "#c9a6ff" }}>Six Axes Capture</span>
        )}{" "}
        and{" "}
        <a href={BEYOND20_URL} target="_blank" rel="noreferrer" style={{ color: "#c9a6ff" }}>
          Beyond20
        </a>{" "}
        installed; the link walks them through it.
      </p>

      <button
        onClick={() => setShowFallback((s) => !s)}
        style={{
          background: "transparent",
          color: "#b7aed1",
          border: 0,
          padding: 0,
          marginTop: 14,
          fontSize: 13,
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        {showFallback ? "Hide the no-install option" : "Prefer not to install an extension?"}
      </button>

      {showFallback && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 12,
            borderTop: "1px solid #37304a",
          }}
        >
          <p style={{ color: "#9a8fb0", fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>
            A player can instead keep a capture tab open during the session. It works
            the same way, but they have to add a Beyond20 custom domain once and leave
            the tab running while they play.
          </p>

          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#8a7fa8", marginBottom: 6 }}>
            CAPTURE TAB LINK
          </div>
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
              {tabUrl}
            </code>
            <button
              onClick={() => copy("tab", tabUrl)}
              style={{
                background: "transparent",
                color: "#b7aed1",
                border: "1px solid #37304a",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {copied === "tab" ? "Copied" : "Copy tab link"}
            </button>
          </div>

          <ol style={{ color: "#b7aed1", fontSize: 13, margin: "10px 0 0", paddingLeft: 20, lineHeight: 1.7 }}>
            <li>
              In the Beyond20 extension options, add{" "}
              <code style={{ color: "#9fe0ae" }}>{origin}/*</code> to Custom Domains and press Apply.
            </li>
            <li>Enable D&amp;D Beyond digital dice in Beyond20 so captured numbers match what the table sees.</li>
            <li>Open the capture tab link above and keep it in the background while you play.</li>
          </ol>
        </div>
      )}
    </section>
  );
}
