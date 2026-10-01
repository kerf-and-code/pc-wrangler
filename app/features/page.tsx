import type { Metadata } from "next";
import Link from "next/link";
import SiteShell from "@/components/site/site-shell";
import FeaturesExplorer from "@/components/features-explorer";

// app/features/page.tsx
//
// The features page. Server shell + the client card-switching explorer. Allowlisted in proxy.ts.

export const metadata: Metadata = {
  title: "Features",
  description:
    "What Six Axes does: mechanical capture of what was rolled, a self-writing campaign wiki, player "
    + "insight across six axes, and multi-system support.",
  alternates: { canonical: "/features" },
};

export default function FeaturesPage() {
  return (
    <SiteShell layout="wide" title="What Six Axes does" tagline="Six pillars. Pick one, and see it on its own.">
      <div data-reveal><FeaturesExplorer /></div>

      <div className="sn-ctas" style={{ marginTop: 48 }}>
        <Link href="/pilot" className="sn-btn sn-btn-fill">Apply to the pilot</Link>
        <Link href="/tools" className="sn-btn sn-btn-ghost">Try the free tools</Link>
        <Link href="/faq" className="sn-textlink">Questions? Read the FAQ</Link>
      </div>
    </SiteShell>
  );
}
