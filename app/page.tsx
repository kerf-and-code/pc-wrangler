import type { Metadata } from "next";
import Link from "next/link";

// app/page.tsx
//
// The landing page. Server-rendered, because this is the URL every Reddit post, every published
// codex footer and every search result points at, and a client-side splash gives a crawler nothing
// to read. The pull-to-enter moment that used to live here is preserved at /enter and linked below.
//
// REPOSITIONED (2026-08): from a single-system pilot pitch into a product landing. The old page said
// "only does 5e" and titled itself "for D&D", which is now false: Six Axes runs across several
// systems. This page leads with the product (mechanical capture, the self-writing wiki, player
// insight), states honestly which systems have real tools vs a themed table and roller, teases the
// free no-login tools, and routes serious readers to /pilot to apply. The detailed honest pitch
// (consent, retention, requirements, "this is early") lives on /pilot now, one click behind the CTA.
//
// WHAT IT STILL LEADS WITH, AND WHY
//   Mechanical capture. Every competitor transcribes audio and summarises it; the one thing they
//   structurally cannot do from a microphone is know what was ROLLED. Leading with "session notes"
//   would mean competing on their strongest ground with a feature they already have.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   No pricing table, no testimonials, no invented numbers, no publisher logos. This recruits pilots,
//   and a page that oversells is worse than a plain one. System names are referenced for
//   compatibility only; licensed-system attributions live on /terms.

export const metadata: Metadata = {
  title: "Six Axes: session analytics for tabletop RPGs",
  description:
    "Records your table, writes the recap, builds the campaign wiki, and tracks what was actually "
    + "rolled. Works across D&D 5e, Pathfinder 2e, Lancer and more, on Discord or in person.",
  openGraph: {
    title: "Six Axes: session analytics for tabletop RPGs",
    description:
      "Records your table, writes the recap, builds the campaign wiki, and tracks what was actually rolled.",
    type: "website",
  },
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <main style={page}>
      <div style={wrap}>

        <header style={{ marginBottom: 44 }}>
          <p style={eyebrow}>Six Axes</p>
          <h1 style={h1}>Your table already tells the story. This writes it down.</h1>
          <p style={lede}>
            Six Axes sits in your session, transcribes it, and turns it into the work you would do
            afterwards if you ever had the time: the recap, the campaign wiki, and a record of what
            actually happened at the table. Across your system, not just one.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26 }}>
            <Link href="/pilot" style={cta}>Join the pilot</Link>
            <Link href="/tools" style={ctaGhost}>Free tools</Link>
            <Link href="/enter" style={ctaGhost}>I have an account</Link>
          </div>
          <p style={{ ...small, marginTop: 14 }}>
            Free while in pilot. No card, no commitment, and you can take all your data out again.
          </p>
        </header>

        <Section title="It knows what you rolled" lead="This is the part other tools cannot do.">
          <p style={body}>
            Most session tools listen and summarise. Six Axes also captures the mechanics: attacks,
            saves, damage, hit points, who rolled what and when. On a supported virtual tabletop those
            numbers arrive automatically; playing in person with real dice, it reads the numbers your
            table says out loud.
          </p>
          <p style={body}>
            Which lets it do arithmetic nobody else can. It knows the fight it called Moderate left the
            party at a third of their hit points, and it can tell you that your Moderate encounters land
            like Hard ones, at your table specifically, across a whole campaign.
          </p>
        </Section>

        <Section title="A campaign wiki that writes itself" lead="Because nobody has ever kept one up to date by hand.">
          <p style={body}>
            Every NPC the party meets, every place they go, every faction and thread and piece of
            loot gets captured from what was narrated and filed where you can find it. You approve
            what goes in. By session five you have the campaign bible you were never going to write.
          </p>
          <p style={body}>
            When it is worth sharing, publish it as a page anyone can read, no account needed. You
            choose exactly what appears, so the setting and the cast can go public while the things
            your players have not found yet stay yours.
          </p>
        </Section>

        <Section title="It tells you how your table is doing" lead="In plain language, not charts.">
          <p style={body}>
            Which threads you have left hanging for four sessions. Who has not had a scene in a
            while. That one character is quietly holding two thirds of the party&apos;s loot. The
            things you half-notice on the night and have forgotten by the next one.
          </p>
          <p style={body}>
            It also builds a read of how each player engages, across six axes: tactics, rules,
            character voice, exploration, table rapport, and how far forward they lean. It is not a
            score and no axis is the good one. It exists so you can notice you have not given
            someone a scene that plays to what they actually enjoy.
          </p>
        </Section>

        <Section title="Works with your system" lead="Honestly, because the depth varies by system.">
          <p style={body}>
            The tool now reskins and re-rules itself around the system your campaign runs on. What
            that means concretely, and we would rather be straight about it than imply eight finished
            systems:
          </p>
          <ul style={list}>
            <li style={li}>
              <strong>Full toolset</strong> (character builder, monsters or NPCs, encounter maths,
              system-correct dice): Dungeons &amp; Dragons 5e (2014 and 2024), Pathfinder 2e, Lancer,
              and Dark Matter.
            </li>
            <li style={li}>
              <strong>Building out:</strong> Draw Steel has monster and encounter tools and its dice
              today; the character builder is next.
            </li>
            <li style={li}>
              <strong>Themed table and the right dice</strong> (no character or monster builders yet):
              Daggerheart, Call of Cthulhu, and a generic d10 pool for gothic games. More on the way.
            </li>
          </ul>
          <p style={small}>
            The record, recap, wiki and player insight work the same on every system. System names are
            referenced for compatibility only; see the <Link href="/terms" style={link}>Terms</Link>{" "}
            for the Lancer, Daggerheart and Draw Steel attributions.
          </p>
        </Section>

        <Section title="Free tools, no login" lead="A growing set, no account required.">
          <p style={body}>
            Some of what Six Axes does inside a campaign is useful on its own, so there is a growing
            set of free, no-account tools you can use right now: an encounter balancer, a fair dice
            roller, a hex and battle map generator, a party coverage check, a session-zero charter, a
            session and arc pacing planner, a magic item price calculator, and the player-type quiz.
            Each picks the system it applies to where that matters. They store nothing and need no
            sign-up.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "4px 0 16px" }}>
            <Link href="/tools" style={cta}>Open the free tools</Link>
          </div>
          <p style={small}>
            These are a taste. The real work, transcription, table management and the player insight
            that comes from a whole campaign, is what the pilot is for.
          </p>
        </Section>

        <section style={card}>
          <h2 style={h2}>Looking for pilot tables</h2>
          <p style={body}>
            This is early. It works, it is in use at real tables, and it is not finished. What it
            needs most is more campaigns and honest feedback, including the unflattering kind. The
            pilot is invitation-based right now, so tell us about your table and we will get you in.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 18 }}>
            <Link href="/pilot" style={cta}>Apply to the pilot</Link>
          </div>
        </section>

        <footer style={footer}>
          <p style={{ margin: 0 }}>
            Six Axes is made by Kerf and Code.{" "}
            <Link href="/privacy" style={link}>Privacy</Link>
            {" · "}
            <Link href="/terms" style={link}>Terms</Link>
          </p>
        </footer>
      </div>
    </main>
  );
}

function Section(
  { title, lead, children }: { title: string; lead?: string; children: React.ReactNode },
) {
  return (
    <section style={card}>
      <h2 style={h2}>{title}</h2>
      {lead && <p style={sectionLead}>{lead}</p>}
      {children}
    </section>
  );
}

/* Same register as a published codex: a reader arriving from a search result is reading, not
   playing, so this is set like a document. The dungeon chrome belongs inside a campaign. */

const page: React.CSSProperties = {
  minHeight: "100vh", background: "#f6f2e9", color: "#2a2620",
  padding: "56px 20px 64px",
  fontFamily: "'Iowan Old Style', Georgia, 'Times New Roman', serif",
};
const wrap: React.CSSProperties = { maxWidth: 720, margin: "0 auto" };
const eyebrow: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11,
  letterSpacing: "0.24em", textTransform: "uppercase", color: "#8a7a55", margin: "0 0 10px",
};
const h1: React.CSSProperties = { fontSize: 42, lineHeight: 1.12, margin: "0 0 16px", fontWeight: 600 };
const lede: React.CSSProperties = { fontSize: 19, lineHeight: 1.65, color: "#4a443a", margin: 0 };
const card: React.CSSProperties = { padding: "26px 0", borderTop: "1px solid #ddd4c2" };
const h2: React.CSSProperties = { fontSize: 27, margin: "0 0 4px", fontWeight: 600, lineHeight: 1.2 };
const sectionLead: React.CSSProperties = {
  fontSize: 14.5, color: "#8a7a55", margin: "0 0 14px", fontStyle: "italic",
};
const body: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.72, margin: "0 0 14px", color: "#3a352c" };
const list: React.CSSProperties = { margin: "4px 0 14px", paddingLeft: 20 };
const li: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.72, marginBottom: 10, color: "#3a352c" };
const small: React.CSSProperties = { fontSize: 13.5, color: "#8a8069", margin: 0, lineHeight: 1.6 };
const cta: React.CSSProperties = {
  display: "inline-block", background: "#3a352c", color: "#f6f2e9",
  padding: "12px 24px", borderRadius: 3, textDecoration: "none",
  fontFamily: "ui-monospace, monospace", fontSize: 13,
  letterSpacing: "0.08em", textTransform: "uppercase",
};
const ctaGhost: React.CSSProperties = {
  ...cta, background: "transparent", color: "#3a352c", border: "1px solid #c9bfa8",
};
const link: React.CSSProperties = { color: "#8a6a2f" };
const footer: React.CSSProperties = {
  marginTop: 40, paddingTop: 18, borderTop: "1px solid #ddd4c2",
  fontSize: 13.5, color: "#8a8069",
};
