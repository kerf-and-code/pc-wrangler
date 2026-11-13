"use client";

// app/x/[code]/page.tsx
// The one-tap onboarding link a GM shares with a player: pc-wrangler.vercel.app/x/<code>.
// If the Six Axes Capture extension is installed, its link-capture content script
// saves the code silently and posts a confirmation this page listens for. If not,
// this page shows what to install. Either way the player pastes nothing.
//
// Push 7 (audit B12): a signed-in player can also connect the extension to their account here, so
// their rolls count as verified (components/roll-key.tsx). Extension 2.3 and later marks the page with
// data-sixaxes-capture="<version>" so the page knows it is there even if its message came first.
// The code now comes from useParams: a client page's params prop is a Promise in this Next version,
// so params.code read as undefined and the card showed "unknown". useParams reads the request, which
// cacheComponents only allows inside a Suspense boundary, so the default export wraps the page in one
// (the build refused the page without it).

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { RollKeyForExtension } from "@/components/roll-key";
import { CAPTURE_NOT_LISTED, CAPTURE_STORE_URL } from "@/lib/capture";

const BEYOND20_CHROME =
  "https://chrome.google.com/webstore/detail/beyond20/aibeceakhehbogooeplpapmbmknmdmpb";
// The Six Axes Capture store link lives in lib/capture.ts (push 49).

export default function LinkLandingPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", background: C.bg }} />}>
      <LinkLanding />
    </Suspense>
  );
}

function LinkLanding() {
  const params = useParams<{ code: string }>();
  const code = String(params?.code || "").toLowerCase();
  const [saved, setSaved] = useState(false);
  // null: no extension seen; "old": an extension before 2.3; otherwise its version
  const [extVersion, setExtVersion] = useState<string | null>(null);

  useEffect(() => {
    const marked = document.documentElement.dataset.sixaxesCapture;
    if (marked) { setExtVersion(marked); setSaved(true); }
    function onMessage(e: MessageEvent) {
      if (e.source !== window) return;
      const d = e.data as { __sixaxesLink?: boolean; ok?: boolean; version?: string };
      if (d && d.__sixaxesLink === true && d.ok === true) {
        setSaved(true);
        setExtVersion((v) => (typeof d.version === "string" ? d.version : v ?? "old"));
      }
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
        background: C.bg,
        color: C.text,
        fontFamily: "system-ui, sans-serif",
        padding: 20,
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 440,
          background: C.panel,
          border: `1px solid ${C.line}`,
          borderRadius: FORGE_RADIUS,
          padding: 28, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}
      >
        <h1 style={{ fontSize: 20, margin: "0 0 6px", color: C.brass }}>
          Join your table on Six Axes
        </h1>
        <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.55, margin: "0 0 20px" }}>
          Your rolls on D&amp;D Beyond or in Roll20 flow to your GM&apos;s table analytics. One or
          two browser extensions, then you&apos;re done. No codes to type.
        </p>

        <div
          style={{
            background: saved ? "rgba(122,138,94,0.22)" : C.surface2,
            border: `1px solid ${saved ? "#2f7d4f" : C.line}`,
            borderRadius: FORGE_RADIUS,
            padding: 16,
            marginBottom: 20, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}
        >
          {saved ? (
            <>
              <div role="status" aria-live="polite" style={{ color: C.good, fontWeight: 700, fontSize: 15 }}>
                You&apos;re all set.
              </div>
              <div style={{ color: C.muted, fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
                Your table code is saved. Open your character on D&amp;D Beyond, or your
                Roll20 game, and roll while your GM has a session open.
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
                  color: C.brass,
                }}
              >
                {code || "unknown"}
              </div>
              <div style={{ color: C.muted, fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
                Install Six Axes Capture below and this code saves itself when you
                reopen this link.
              </div>
            </>
          )}
        </div>

        <ol style={{ margin: 0, paddingLeft: 20, color: C.text, fontSize: 14, lineHeight: 1.7 }}>
          <li>
            Install{" "}
            <a href={BEYOND20_CHROME} target="_blank" rel="noreferrer" style={{ color: C.sun }}>
              Beyond20
            </a>{" "}
            (rolls your dice on D&amp;D Beyond; skip it if you only play in Roll20).
          </li>
          <li>
            Install{" "}
            {CAPTURE_STORE_URL ? (
              <a href={CAPTURE_STORE_URL} target="_blank" rel="noreferrer" style={{ color: C.sun }}>
                Six Axes Capture
              </a>
            ) : (
              <span style={{ color: C.text }}>Six Axes Capture</span>
            )}
            , which sends your rolls to the table.{CAPTURE_STORE_URL ? "" : ` It is ${CAPTURE_NOT_LISTED}.`}
          </li>
          <li>Reopen this link. The code saves on its own.</li>
          <li>
            Playing in Roll20? Open Six Axes Capture from the browser toolbar and turn on Roll20. It
            then reads the rolls in your Roll20 game&apos;s chat, which includes other players&apos;
            rolls and the names they roll under.
          </li>
        </ol>

        <RollKeyForExtension code={code} extensionVersion={extVersion} />
      </section>
    </main>
  );
}
