import type { Metadata } from "next";
import Link from "next/link";
import SiteShell from "@/components/site/site-shell";

// app/pricing/page.tsx
//
// There is one real offer today (the pilot, free), so the page leads with it as one statement instead of
// three equal cards. No invented numbers: it says what is true (free in pilot, the tools free for good,
// later pricing not set) and nothing it cannot back up. Allowlisted in proxy.ts.

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Six Axes is free during the pilot, and the no-login tools are free for good. Longer-term pricing is "
    + "still being worked out; pilot tables will hear first.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <SiteShell title="Free while in pilot." tagline="The tools are free for good. Longer-term pricing is still being worked out, and pilot tables hear first.">
      <section className="sn-card" style={{ maxWidth: 760 }} data-reveal>
        <h2>The pilot</h2>
        <ul style={{ margin: "0 0 4px", paddingLeft: 22, display: "grid", gap: 8, color: "var(--sn-dim)" }}>
          <li>The full product: recording, the recap, the campaign wiki, and player insight.</li>
          <li>No card and no commitment.</li>
          <li>You can take all your data out again, whenever you like.</li>
        </ul>
        <div className="sn-ctas">
          <Link href="/pilot" className="sn-btn sn-btn-fill">Apply to the pilot</Link>
        </div>
      </section>

      <div style={{ marginTop: 48, display: "grid", gap: 36, maxWidth: 760 }} data-reveal>
        <section>
          <h2 className="sn-h3">The tools stay free</h2>
          <p className="sn-p">
            The no-login tools (the encounter balancer, the dice roller, the map generator and the rest) store
            nothing and need no account. They stay free. <Link href="/tools">Open the tools</Link>
          </p>
        </section>
        <section>
          <h2 className="sn-h3">Later pricing</h2>
          <p className="sn-p">
            We are not going to invent a number here. When there is real pricing, it will be on this page, and
            it will not be a surprise to anyone already at the table: pilot tables hear first and are treated
            well. Questions? <Link href="/contact">Get in touch.</Link>
          </p>
        </section>
      </div>
    </SiteShell>
  );
}
