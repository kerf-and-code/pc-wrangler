import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { GUIDES } from "@/lib/guides/guides";
import { SITE_URL } from "@/lib/seo";

// app/sitemap.ts
//
// Lists only campaigns whose GM opted IN to being listed. Publishing alone is not enough: a link
// you can share and a page you are asking to be indexed forever are different consents, and p24
// keeps them apart.
//
// A plain anon client, not the cookie-reading server one. A sitemap has no visitor and no session,
// and reading cookies here would make the route request-bound for no reason - the same mistake that
// took four attempts to find on the codex page itself.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // One source of host truth: SITE_URL resolves NEXT_PUBLIC_SITE_URL first, then VERCEL_URL, exactly
  // like layout.tsx's metadataBase and the JSON-LD @ids. That keeps canonical tags, structured data,
  // and this sitemap from ever disagreeing on host (the old hardcoded pc-wrangler.vercel.app default
  // could split authority if the env var was ever missing).
  const base = SITE_URL;

  // The free, no-login tools. These exist to be found in search, so they belong in the sitemap; the
  // hub ranks a touch higher than the individual tools.
  const toolPaths = [
    "/tools",
    "/tools/encounter-balancer",
    "/tools/player-quiz",
    "/tools/map-generator",
    "/tools/party-coverage",
    "/tools/session-zero",
    "/tools/pacing",
    "/tools/magic-item-price",
    "/tools/dice-roller",
  ];

  const statics: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: "monthly", priority: 1 },
    ...toolPaths.map((p) => ({
      url: `${base}${p}`,
      changeFrequency: "monthly" as const,
      priority: p === "/tools" ? 0.8 : 0.7,
    })),
    { url: `${base}/features`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/players`, changeFrequency: "monthly", priority: 0.8 },
    // The guides content layer: the hub plus each article, enumerated from the GUIDES registry.
    { url: `${base}/guides`, changeFrequency: "weekly", priority: 0.6 },
    ...GUIDES.map((g) => ({
      url: `${base}/guides/${g.slug}`,
      lastModified: new Date(g.updated),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/faq`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/about`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.4 },
    // The pilot application (public conversion page) and the Foundry install docs (public), both linked
    // from the site but previously absent from the sitemap.
    { url: `${base}/pilot`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/foundry`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data } = await supabase.rpc("public_listed_campaigns");
    const rows = (data as { slug: string; published_at: string }[]) ?? [];
    return [
      ...statics,
      ...rows.map((r) => ({
        url: `${base}/c/${r.slug}`,
        lastModified: r.published_at ? new Date(r.published_at) : new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.7,
      })),
    ];
  } catch {
    // A sitemap that throws takes the whole route down. The static entries are always correct, so
    // degrade to them rather than serving a 500 to a crawler.
    return statics;
  }
}
