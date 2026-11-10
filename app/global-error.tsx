"use client";

// app/global-error.tsx (2026-11-09)
//
// Audit T1: the last-resort screen when a page crashes outright (an error in the root layout or one no
// nearer boundary caught). It replaces the whole page, so it brings its own html and body and plain
// styles. It says what happened, offers a retry and a way home, and shows the error's digest so a report
// can be matched to the server log. Nothing is sent anywhere from here.

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[global-error]", error); }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#14121a", color: "#ece6d8", fontFamily: "Georgia, serif", padding: 16 }}>
        <main style={{ maxWidth: 460, textAlign: "center" }}>
          <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#c9a44c", marginBottom: 10 }}>Six Axes</div>
          <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>This page hit a problem</h1>
          <p style={{ lineHeight: 1.6, color: "#bdb5a6", margin: "0 0 22px" }}>
            Something went wrong while loading it. Anything you already saved is safe. Try again, and if it keeps
            happening, send this code to support so we can find it:{" "}
            <code style={{ color: "#ece6d8" }}>{error.digest || "no code"}</code>
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => reset()} style={{ background: "#c9a44c", color: "#14121a", border: 0, borderRadius: 8, padding: "10px 18px", fontSize: 15, cursor: "pointer" }}>Try again</button>
            <a href="/" style={{ color: "#ece6d8", border: "1px solid #4a4458", borderRadius: 8, padding: "10px 18px", fontSize: 15, textDecoration: "none" }}>Go to the home page</a>
          </div>
        </main>
      </body>
    </html>
  );
}
