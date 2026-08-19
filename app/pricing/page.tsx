import type { Metadata } from "next";
import Link from "next/link";
import SiteShell from "@/components/site/site-shell";
import { SAX, STONE } from "@/lib/theme";
import { stonePanel, forgeLabel, stoneButton } from "@/lib/forge-theme";

// app/pricing/page.tsx
//
// A placeholder, structured and styled so real tiers slot straight in when they exist. No invented
// numbers: it says what is true today (free in pilot, the tools always free) and nothing it cannot back
// up. Allowlisted in proxy.ts.

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Six Axes is free during the pilot, and the no-login tools are free for good. Longer-term pricing is "
    + "still being worked out; pilot tables will hear first.",
  alternates: { canonical: "/pricing" },
};

const CARDS = [
  {
    label: "Free tools",
    price: "Free",
    note: "For good.",
    body: "The no-login tools, the encounter balancer, dice roller, map generator, and the rest, store nothing and need no account. They stay free.",
    cta: { href: "/tools", text: "Open the tools", variant: "stone" as const },
  },
  {
    label: "The pilot",
    price: "Free",
    note: "While it lasts.",
    body: "The full product during the pilot: recording, recap, the campaign wiki, and player insight. No card, no commitment, and you can take all your data out again.",
    cta: { href: "/pilot", text: "Join the pilot", variant: "primary" as const },
  },
  {
    label: "Later",
    price: "TBD",
    note: "When it is ready.",
    body: "Longer-term pricing is still being worked out. We are not going to invent a number here. When it lands, pilot tables hear first and are treated well.",
    cta: { href: "/contact", text: "Ask us", variant: "ghost" as const },
  },
];

export default function PricingPage() {
  return (
    <SiteShell title="Pricing" tagline="Free while in pilot. The tools are free for good. The rest is still being worked out.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 }}>
        {CARDS.map((c) => (
          <div key={c.label} style={{ ...stonePanel(), padding: "22px 22px", display: "flex", flexDirection: "column" }}>
            <div style={forgeLabel}>{c.label}</div>
            <div style={price}>{c.price}</div>
            <div style={priceNote}>{c.note}</div>
            <p style={cardBody}>{c.body}</p>
            <div style={{ marginTop: "auto", paddingTop: 14 }}>
              <Link href={c.cta.href} className={`forge-btn${c.cta.variant === "primary" ? " is-primary" : c.cta.variant === "ghost" ? " is-ghost" : ""}`} style={stoneButton(c.cta.variant)}>
                {c.cta.text}
              </Link>
            </div>
          </div>
        ))}
      </div>
      <p style={foot}>
        Honest about it: this is a placeholder. When there is real pricing to show, it will be here, and it
        will not be a surprise to anyone already at the table. Questions? <Link href="/contact" style={linkS}>Get in touch.</Link>
      </p>
    </SiteShell>
  );
}

const price: React.CSSProperties = {
  fontFamily: "var(--forge-display, 'Cinzel', serif)", fontWeight: 700, fontSize: 34, color: STONE.ink, marginTop: 8, lineHeight: 1,
};
const priceNote: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 12, color: STONE.inkFaint, marginTop: 4, letterSpacing: "0.04em" };
const cardBody: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.62, color: STONE.inkDim, margin: "12px 0 0", fontFamily: SAX.serif };
const foot: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.6, color: STONE.inkFaint, margin: "24px 0 0", fontFamily: SAX.serif };
const linkS: React.CSSProperties = { color: STONE.brassHi, textDecoration: "none" };
