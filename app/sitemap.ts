import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";

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
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://pc-wrangler.vercel.app";

  const statics: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: "monthly", priority: 1 },
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
