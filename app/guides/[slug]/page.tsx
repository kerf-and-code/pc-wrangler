import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GuideLayout from "@/components/guides/guide-layout";
import { GUIDES, getGuide } from "@/lib/guides/guides";

// app/guides/[slug]/page.tsx
//
// One guide. Statically generated from the GUIDES registry (generateStaticParams), with per-guide
// metadata. Public, allowlisted in proxy.ts. Next 16: params is async.

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const g = getGuide(slug);
  if (!g) return {};
  return {
    title: g.title,
    description: g.description,
    alternates: { canonical: `/guides/${g.slug}` },
    openGraph: { type: "article", title: g.title, description: g.description },
  };
}

export default async function GuidePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const g = getGuide(slug);
  if (!g) notFound();
  const { Body } = g;
  return (
    <GuideLayout slug={g.slug} title={g.title} description={g.description} excerpt={g.excerpt} updated={g.updated}>
      <Body />
    </GuideLayout>
  );
}
