"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type React from "react";
import { bareUrl, isTrackable } from "@/lib/analytics-paths";

// components/analytics.tsx (2026-11-09)
//
// Google Analytics 4, without leaking secrets (audit T3). It used to load on every page with GA's own
// page views, which carry the full address: share codes (?share=...), /x/<code> links and sign-in
// tokens all went to Google. Now:
//   - GA never loads on player, share-code or sign-in pages (PRIVATE below); a visit that starts there
//     loads nothing at all.
//   - Page views are sent by this component, not by GA, with the path only: no query string, no hash.
//     The address and referrer GA attaches to its other events are pinned the same way.
//   - It runs only where the layout says (production deploys, not Vercel previews or local dev).
// GA's own "page changes based on browser history events" should be switched off in the GA property's
// Enhanced measurement settings, so GA does not send a second, full-address page view on its own.
//
// ASKS FIRST (push 43, audit round 2 T20): the privacy page names consent as the basis for analytics
// cookies, so GA now loads only after a visitor says yes. A small bar asks once, on a page GA could run
// on; the answer is kept in this browser (localStorage "sx-analytics": "yes" or "no"). No answer, or
// storage that cannot be read, means no analytics. The Privacy page links back here to change it.

declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

const KEY = "sx-analytics";
function readChoice(): "yes" | "no" | null {
  try { const v = window.localStorage.getItem(KEY); return v === "yes" || v === "no" ? v : null; } catch { return null; }
}
function saveChoice(v: "yes" | "no") {
  try { window.localStorage.setItem(KEY, v); } catch { /* storage blocked: the bar asks again next visit */ }
}

export default function Analytics({ id }: { id: string }) {
  const pathname = usePathname() || "/";
  const ok = isTrackable(pathname);
  const [load, setLoad] = useState(false);
  // undefined until read on the client, so the bar never flashes during the server render
  const [choice, setChoice] = useState<"yes" | "no" | null | undefined>(undefined);
  useEffect(() => {
    setChoice(readChoice());
    // the Privacy page's "Change your analytics choice" clears the answer and asks again
    const ask = () => { try { window.localStorage.removeItem(KEY); } catch { /* ignore */ } setChoice(null); };
    window.addEventListener("sx-analytics-ask", ask);
    return () => window.removeEventListener("sx-analytics-ask", ask);
  }, []);

  useEffect(() => {
    if (!ok || choice !== "yes") return;
    // every event GA sends (scrolls, clicks, engagement) carries these two, so pin both to bare addresses,
    // before GA is configured
    const location = window.location.origin + pathname;
    const bare = { page_location: location, page_referrer: bareUrl(document.referrer) };
    // gtag's own queue: calls made before the script arrives are replayed once it loads.
    window.dataLayer = window.dataLayer || [];
    if (!window.gtag) {
      window.gtag = function gtag() { window.dataLayer!.push(arguments); }; // eslint-disable-line prefer-rest-params
      window.gtag("js", new Date());
      window.gtag("set", bare);
      window.gtag("config", id, { send_page_view: false, ...bare });
    } else {
      window.gtag("set", bare);
    }
    window.gtag("event", "page_view", { page_location: location, page_path: pathname, page_title: document.title });
    setLoad(true);
  }, [ok, pathname, id, choice]);

  if (ok && choice === null) {
    const btn: React.CSSProperties = { padding: "7px 14px", fontSize: 14, borderRadius: 4, cursor: "pointer", border: "1px solid #6b5f45" };
    return (
      <div role="region" aria-label="Analytics choice" style={{
        position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 1000, maxWidth: 640, margin: "0 auto",
        background: "#1f1b16", color: "#e8dcc4", border: "1px solid #6b5f45", borderRadius: 6, padding: "12px 14px",
        display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 14, lineHeight: 1.5,
        boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
      }}>
        <span style={{ flex: "1 1 280px" }}>
          May we count your visit with Google Analytics? It sets cookies. We use it only to see which pages are read, never for ads. <a href="/privacy" style={{ color: "#e2b878" }}>Privacy</a>
        </span>
        <button type="button" style={{ ...btn, background: "#C8A24B", color: "#1b1712", border: "none", fontWeight: 600 }} onClick={() => { saveChoice("yes"); setChoice("yes"); }}>Allow</button>
        <button type="button" style={{ ...btn, background: "transparent", color: "#e8dcc4" }} onClick={() => { saveChoice("no"); setChoice("no"); }}>No thanks</button>
      </div>
    );
  }
  return load ? <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" /> : null;
}
