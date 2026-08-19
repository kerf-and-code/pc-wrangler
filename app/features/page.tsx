import type { Metadata } from "next";
import Link from "next/link";
import SiteShell from "@/components/site/site-shell";
import FeaturesExplorer from "@/components/features-explorer";
import { stoneButton } from "@/lib/forge-theme";

// app/features/page.tsx
//
// The features page. Server shell + the client card-switching explorer. Allowlisted in proxy.ts.

export const metadata: Metadata = {
  title: "Features",
  description:
    "What Six Axes does: mechanical capture of what was rolled, a self-writing campaign wiki, player "
    + "insight across six axes, multi-system support, and world and map building. One feature at a time.",
  alternates: { canonical: "/features" },
};

export default function FeaturesPage() {
  return (
    <SiteShell title="What Six Axes does" tagline="Five pillars. Pick one, and see it on its own.">
      <FeaturesExplorer />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 28 }}>
        <Link href="/pilot" className="forge-btn is-primary" style={stoneButton("primary")}>Join the pilot</Link>
        <Link href="/tools" className="forge-btn" style={stoneButton("stone")}>Try the free tools</Link>
        <Link href="/faq" className="forge-btn is-ghost" style={stoneButton("ghost")}>Questions?</Link>
      </div>
    </SiteShell>
  );
}
