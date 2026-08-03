import type { MetadataRoute } from "next";

// app/robots.ts
//
// Published codexes are the only part of this app a crawler has any business in. Everything else is
// either behind auth or is a link a GM handed to specific people, and neither belongs in an index.
//
// /journal/[share], /play, /table and /x are all UNGUESSABLE share links rather than secrets, but
// "not secret" is not "please index this": a crawler that finds one in a forum post should not put
// a table's private chronicle into public search results. Disallowing them is a courtesy that costs
// nothing, and the real gate remains the RPC each of those pages reads through.

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://pc-wrangler.vercel.app";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/c/"],
        disallow: [
          "/api/", "/auth/", "/gm/", "/me/",
          "/journal/", "/play", "/table/", "/x/", "/record", "/chat",
          "/claim", "/join", "/setup", "/vibe",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
