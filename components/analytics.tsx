"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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

declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

export default function Analytics({ id }: { id: string }) {
  const pathname = usePathname() || "/";
  const ok = isTrackable(pathname);
  const [load, setLoad] = useState(false);

  useEffect(() => {
    if (!ok) return;
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
  }, [ok, pathname, id]);

  return load ? <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" /> : null;
}
