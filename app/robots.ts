import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// app/robots.ts
//
// Published codexes are the only part of this app a crawler has any business in. Everything else is
// either behind auth or is a link a GM handed to specific people, and neither belongs in an index.
//
// /journal/[share], /play, /table and /x are all UNGUESSABLE share links rather than secrets, but
// "not secret" is not "please index this": a crawler that finds one in a forum post should not put
// a table's private chronicle into public search results. Disallowing them is a courtesy that costs
// nothing, and the real gate remains the RPC each of those pages reads through.
//
// Push 55 (2026-11-12): the sitemap address comes from SITE_URL (lib/seo.ts), the same host the sitemap
// and canonical tags use, instead of a pc-wrangler.vercel.app fallback. /docs/ (the six documents) is
// covered by the "/" allow, and /me/help stays out with the rest of /me/.
//
// Push 56 (2026-11-12): "Disallow: /play" matched every path starting with /play, so it also blocked
// /players. Robots rules are prefixes; the single pages are now matched with $ (exact), ? (with a query)
// and / (below it), which Google and Bing both honour.

// Player-only pages kept out of search. Each becomes three rules below, never a bare prefix.
const EXACT_PAGES = ["/play", "/record", "/chat", "/claim", "/join", "/setup", "/vibe"];

export default function robots(): MetadataRoute.Robots {
  const base = SITE_URL;
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/c/"],
        disallow: [
          "/api/", "/auth/", "/gm/", "/me/",
          "/journal/", "/table/", "/x/",
          // Single pages, matched exactly: the page itself, the page with a query (?share=...), and anything
          // under it. A bare "/play" is a prefix rule, and it blocked /players (the public For players page).
          ...EXACT_PAGES.flatMap((p) => [`${p}$`, `${p}?`, `${p}/`]),
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
