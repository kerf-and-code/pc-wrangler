import type { Metadata } from "next";
import Link from "next/link";
import SiteShell from "@/components/site/site-shell";
import { SAX, STONE } from "@/lib/theme";
import { stonePanel, forgeLabel, stoneButton } from "@/lib/forge-theme";

// app/about/page.tsx
//
// The story and the principles. Honest register: what it is, why it exists, and the three commitments
// (consent, honesty, you own your data) that the product is actually built around. Allowlisted in proxy.ts.

export const metadata: Metadata = {
  title: "About",
  description:
    "Six Axes records your table, writes the recap, and keeps the campaign wiki. Built by Kerf and Code "
    + "on consent, honesty, and you owning your data.",
  alternates: { canonical: "/about" },
};

const PRINCIPLES = [
  {
    label: "Consent first",
    body: "Recording starts only when the whole room agrees, and any player can withdraw at any time. Session audio is deleted after 60 days; the transcript stays, the recording does not.",
  },
  {
    label: "Honest by default",
    body: "No invented numbers, no testimonials we do not have, no publisher logos we are not entitled to. The analytics even show their own uncertainty, so a thin read reads as thin.",
  },
  {
    label: "You own your data",
    body: "Export everything in one file, any time. Delete your account and everything about you goes, while your characters stay in the campaigns your table built together.",
  },
];

export default function AboutPage() {
  return (
    <SiteShell title="About Six Axes" tagline="What it is, why it exists, and the lines we hold.">
      <p style={body}>
        Six Axes sits in your session, transcribes it, and turns it into the work you would do afterwards
        if you ever had the time: the recap, the campaign wiki, and a record of what actually happened at
        the table. It works across whatever system your campaign runs on, on a virtual tabletop or in a
        room with real dice.
      </p>
      <p style={body}>
        The thing it does that other session tools cannot is <strong>mechanical capture</strong>. Everyone
        can transcribe audio and summarise it; what a microphone cannot tell you is what was <em>rolled</em>.
        Six Axes knows, and that unlocks arithmetic nobody else can do, like telling you that your Moderate
        encounters land like Hard ones at your table specifically, across a whole campaign. Session notes
        are the easy part; the mechanics are the point.
      </p>
      <p style={body}>
        It is made by <strong>Kerf and Code</strong>, and it is early. It works, it is in use at real
        tables, and it is not finished. The way it gets better is more campaigns and honest feedback,
        which is what the pilot is for.
      </p>

      <h2 style={h2}>What we hold to</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 6 }}>
        {PRINCIPLES.map((p) => (
          <div key={p.label} style={{ ...stonePanel(), padding: "18px 20px" }}>
            <div style={forgeLabel}>{p.label}</div>
            <p style={cardBody}>{p.body}</p>
          </div>
        ))}
      </div>

      <h2 style={h2}>Who&apos;s behind it</h2>
      <p style={body}>
        Kerf and Code is <strong>Terry Mickail</strong>, working out of Seattle. By day he is an educational
        research analyst; his training is in measurement and applied statistics, a master&apos;s in the field
        and doctoral work at the University of Washington on how people learn and how you measure it honestly,
        with peer-reviewed research along the way.
      </p>
      <p style={body}>
        That background is not incidental to Six Axes. The disposition model, the encounter math that
        calibrates to your table, the read on how each player engages, is psychometrics pointed at game night:
        measuring something real without pretending the measurement is more certain than it is. The analytics
        show their own uncertainty because the person who built them spent years learning why that matters.
      </p>
      <p style={body}>
        He also runs games, and built the thing he wished existed on his side of the screen.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26 }}>
        <Link href="/pilot" className="forge-btn is-primary" style={stoneButton("primary")}>Join the pilot</Link>
        <Link href="/tools" className="forge-btn is-ghost" style={stoneButton("ghost")}>Try the free tools</Link>
        <Link href="/contact" className="forge-btn" style={stoneButton("stone")}>Contact us</Link>
      </div>
    </SiteShell>
  );
}

const body: React.CSSProperties = { fontSize: 17, lineHeight: 1.72, color: STONE.ink, margin: "0 0 16px", fontFamily: SAX.serif };
const h2: React.CSSProperties = {
  fontFamily: "var(--forge-display, 'Cinzel', serif)", fontWeight: 700, fontSize: 24, color: STONE.ink,
  margin: "30px 0 4px", letterSpacing: "0.03em",
};
const cardBody: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.62, color: STONE.inkDim, margin: "6px 0 0", fontFamily: SAX.serif };
