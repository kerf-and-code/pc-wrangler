"use client";

// app/x/[code]/page.tsx
// The one-tap onboarding link a GM shares with a player: pc-wrangler.vercel.app/x/<code>.
// If the Six Axes Capture extension is installed, its link-capture content script
// saves the code silently and posts a confirmation this page listens for. If not,
// this page shows what to install. Either way the player pastes nothing.

import { useEffect, useState } from "react";

const BEYOND20_CHROME =
  "https://chrome.google.com/webstore/detail/beyond20/aibeceakhehbogooeplpapmbmknmdmpb";
// Replace with the real Chrome Web Store URL once Six Axes Capture is published.
const CAPTURE_STORE_URL = "";

export default function LinkLandingPage({
  params,
}: {
  params: { code: string };
}) {
  const code = (params?.code || "").toLowerCase();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== window) return;
      const d = e.data as { __sixaxesLink?: boolean; ok?: boolean };
      if (d && d.__sixaxesLink === true && d.ok === true) setSaved(true);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "#140f1f",
        color: "#efe9f7",
        fontFamily: "system-ui, sans-serif",
        padding: 20,
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#1e1730",
          border: "1px solid #3a2f52",
          borderRadius: 16,
          padding: 28,
        }}
      >
        <h1 style={{ fontSize: 20, margin: "0 0 6px", color: "#f4c430" }}>
          Join your table on Six Axes
        </h1>
        <p style={{ color: "#a597bd", fontSize: 14, lineHeight: 1.55, margin: "0 0 20px" }}>
          Your rolls on D&amp;D Beyond flow to your GM&apos;s table analytics. Two
          browser extensions, then you&apos;re done. No codes to type.
        </p>

        <div
          style={{
            background: saved ? "#173026" : "#241b33",
            border: `1px solid ${saved ? "#2f7d4f" : "#3a2f52"}`,
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
          }}
        >
          {saved ? (
            <>
              <div style={{ color: "#9fe0ae", fontWeight: 700, fontSize: 15 }}>
                You&apos;re all set.
              </div>
              <div style={{ color: "#a597bd", fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
                Your table code is saved. Open your character on D&amp;D Beyond and
                roll while your GM has a session open.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Table code</div>
              <div
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 18,
                  letterSpacing: "0.08em",
                  marginTop: 6,
                  color: "#f4c430",
                }}
              >
                {code || "unknown"}
              </div>
              <div style={{ color: "#a597bd", fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
                Install Six Axes Capture below and this code saves itself when you
                reopen this link.
              </div>
            </>
          )}
        </div>

        <ol style={{ margin: 0, paddingLeft: 20, color: "#efe9f7", fontSize: 14, lineHeight: 1.7 }}>
          <li>
            Install{" "}
            <a href={BEYOND20_CHROME} target="_blank" rel="noreferrer" style={{ color: "#c9a6ff" }}>
              Beyond20
            </a>{" "}
            (rolls your dice on D&amp;D Beyond).
          </li>
          <li>
            Install{" "}
            {CAPTURE_STORE_URL ? (
              <a href={CAPTURE_STORE_URL} target="_blank" rel="noreferrer" style={{ color: "#c9a6ff" }}>
                Six Axes Capture
              </a>
            ) : (
              <span style={{ color: "#c9a6ff" }}>Six Axes Capture</span>
            )}{" "}
            (sends your rolls to the table).
          </li>
          <li>Reopen this link. The code saves on its own.</li>
        </ol>
      </section>
    </main>
  );
}
