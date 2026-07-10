"use client";

import React, { useEffect, useMemo, useState } from "react";

// Self-serve Beyond20 setup wizard. Browser-aware steps, one-tap copy of the
// custom-domain URL, and a LIVE connection check: once the player adds the URL
// and reloads, Beyond20 activates on this page and fires its events, which we
// listen for to flip the status to connected, no GM hand-holding required.

type Browser = "edge" | "chrome" | "firefox" | "brave" | "other";

function detectBrowser(ua: string): Browser {
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Brave\//.test(ua) || (navigator as unknown as { brave?: unknown }).brave) return "brave";
  if (/Chrome\//.test(ua)) return "chrome";
  return "other";
}

const C = {
  bg: "#1B1426", surface: "#251B33", surface2: "rgba(11,7,18,0.55)", line: "#3D2F52",
  text: "#F4EEFA", muted: "#A597BD", sun: "#F4C430", plum: "#9B7BD4", warn: "#E07A5F", good: "#8FBF8F",
};

export default function Beyond20Setup() {
  const [browser, setBrowser] = useState<Browser>("other");
  const [origin, setOrigin] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);   // Beyond20 is active on this page
  const [rolled, setRolled] = useState(false);   // a real roll came through
  const [share, setShare] = useState<string>("");

  const url = useMemo(() => (origin ? `${origin}/*` : "https://pc-wrangler.vercel.app/*"), [origin]);

  useEffect(() => {
    setBrowser(detectBrowser(navigator.userAgent));
    setOrigin(window.location.origin);
    setShare(new URLSearchParams(window.location.search).get("share") || "");

    const onLoaded = () => setLoaded(true);
    const onRoll = () => { setLoaded(true); setRolled(true); };
    // Beyond20 fires these on any page it is active on (i.e. once the domain is added).
    document.addEventListener("Beyond20_Loaded", onLoaded);
    document.addEventListener("Beyond20_NewSettings", onLoaded);
    document.addEventListener("Beyond20_Roll", onRoll);
    document.addEventListener("Beyond20_RenderedRoll", onRoll);
    return () => {
      document.removeEventListener("Beyond20_Loaded", onLoaded);
      document.removeEventListener("Beyond20_NewSettings", onLoaded);
      document.removeEventListener("Beyond20_Roll", onRoll);
      document.removeEventListener("Beyond20_RenderedRoll", onRoll);
    };
  }, []);

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* clipboard blocked; the field is selectable as a fallback */ }
  }

  const steps: Record<Browser, string[]> = {
    chrome: [
      "Click the puzzle-piece (Extensions) icon at the top-right of Chrome, then the three dots next to Beyond20 and choose Options.",
      "Scroll to Custom Domains.",
      "Paste the URL below into the box and click Add.",
      "Come back to this tab and reload it (Ctrl/Cmd + R).",
    ],
    edge: [
      "Click the puzzle-piece (Extensions) icon at the top-right of Edge, then the three dots next to Beyond20 and choose Extension options.",
      "Scroll to Custom Domains.",
      "Paste the URL below and click Add. Make sure it appears in the list, if it vanishes, try once more, or use Chrome (Edge occasionally drops the entry).",
      "Come back to this tab and reload it (Ctrl/Cmd + R).",
    ],
    brave: [
      "Click the Extensions icon (or go to brave://extensions), find Beyond20, and open its Options / Details.",
      "Scroll to Custom Domains.",
      "Paste the URL below and click Add.",
      "Come back to this tab and reload it (Ctrl/Cmd + R).",
    ],
    firefox: [
      "Open the menu → Add-ons and themes → Extensions, click Beyond20, then the Preferences/Options tab.",
      "Scroll to Custom Domains.",
      "Paste the URL below and click Add.",
      "Come back to this tab and reload it (Ctrl/Cmd + R).",
    ],
    other: [
      "Open your browser's Extensions page and find Beyond20, then open its Options.",
      "Scroll to Custom Domains.",
      "Paste the URL below and click Add.",
      "Come back to this tab and reload it (Ctrl/Cmd + R).",
    ],
  };

  const status = rolled ? "rolling" : loaded ? "connected" : "waiting";
  const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "24px 22px" } as const;

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.text, padding: "32px 20px",
      fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 620, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 28, margin: 0 }}>Connect your dice</h1>
        <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.6, marginTop: 8 }}>
          One-time setup so your D&amp;D Beyond rolls reach your GM. Takes about a minute. You&rsquo;ll need the free{" "}
          <a href="https://beyond20.here-for-more.info/" target="_blank" rel="noreferrer" style={{ color: C.sun }}>Beyond20 extension</a> installed first.
        </p>

        {/* Live status */}
        <div style={{ ...card, marginTop: 18, borderColor: status === "rolling" ? C.good : status === "connected" ? C.plum : C.line,
          display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: 12, flex: "0 0 auto",
            background: status === "rolling" ? C.good : status === "connected" ? C.sun : C.muted,
            boxShadow: status !== "waiting" ? `0 0 10px ${status === "rolling" ? C.good : C.sun}` : "none" }} />
          <div style={{ fontSize: 14.5 }}>
            {status === "rolling" && <><b style={{ color: C.good }}>Rolls are flowing!</b> You&rsquo;re fully set up.</>}
            {status === "connected" && <><b style={{ color: C.sun }}>Beyond20 connected.</b> Roll once on your character sheet to confirm rolls come through.</>}
            {status === "waiting" && <>Waiting for Beyond20&hellip; follow the steps below, then reload this page.</>}
          </div>
        </div>

        {/* The URL + copy */}
        <div style={{ ...card, marginTop: 14 }}>
          <div style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em" }}>THE URL TO ADD</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()}
              style={{ flex: 1, minWidth: 220, background: C.surface2, color: C.text, border: `1px solid ${C.line}`,
                borderRadius: 9, padding: "11px 12px", fontFamily: "ui-monospace, monospace", fontSize: 14 }} />
            <button type="button" onClick={copy}
              style={{ background: copied ? C.good : C.sun, color: "#1a1206", border: "none", borderRadius: 9,
                padding: "11px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              {copied ? "Copied ✓" : "Copy URL"}
            </button>
          </div>
        </div>

        {/* Steps */}
        <div style={{ ...card, marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Add it to Beyond20</div>
            <div style={{ fontSize: 12, color: C.muted }}>Detected: {browser === "other" ? "your browser" : browser[0].toUpperCase() + browser.slice(1)}</div>
          </div>
          <ol style={{ margin: "12px 0 0", paddingLeft: 20, color: C.text, fontSize: 14.5, lineHeight: 1.7 }}>
            {steps[browser].map((s, i) => (<li key={i} style={{ marginBottom: 6 }}>{s}</li>))}
          </ol>
          {browser === "edge" && (
            <p style={{ color: C.warn, fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
              Edge tip: if the URL won&rsquo;t stay in the list after clicking Add, Chrome is the most reliable choice for this step.
            </p>
          )}
        </div>

        {/* Onward */}
        {share && (
          <div style={{ marginTop: 18, textAlign: "center" }}>
            <a href={`/record?share=${encodeURIComponent(share)}`}
              style={{ display: "inline-block", background: status === "waiting" ? "transparent" : C.good,
                color: status === "waiting" ? C.muted : "#12210f", border: `1px solid ${status === "waiting" ? C.line : C.good}`,
                borderRadius: 12, padding: "13px 22px", fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
              {status === "waiting" ? "Go to your table (set this up first)" : "Go to your table →"}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
