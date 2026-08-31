import type { Metadata } from "next";
import Link from "next/link";

// app/page.tsx
//
// The landing page. Server-rendered, because this is the URL every Reddit post, every published
// codex footer and every search result points at, and a client-side splash gives a crawler nothing
// to read. The pull-to-enter moment that used to live here is preserved at /enter and linked below.
//
// WHAT IT LEADS WITH, AND WHY
//   Mechanical capture. Every competitor in this space transcribes audio and summarises it; the one
//   thing they structurally cannot do from a microphone is know what was ROLLED. Leading with
//   "session notes" would mean competing on their strongest ground with a feature they already have.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   No pricing table, no testimonials, no invented numbers. This is recruiting pilots, and a page
//   that oversells is worse than a plain one: a GM promised a finished product finds a pilot, and
//   does not come back. The requirements section exists for the same reason. Saying up front that
//   this needs Discord or a microphone, and only does 5e, costs one visitor and saves a
//   disappointed one.

export const metadata: Metadata = {
  title: "Six Axes: session analytics for D&D",
  description:
    "Records your table, writes the recap, builds the campaign wiki, and tracks what was actually "
    + "rolled. For D&D games on Discord or in person.",
  openGraph: {
    title: "Six Axes: session analytics for D&D",
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
          <p style={{ margin: "2px 0 0", fontSize: 12 }}>
            <a href="https://kerfandcode.com" target="_blank" rel="noopener noreferrer" style={link}>by Kerf &amp; Code &#8599;</a>
          </p>
          <h1 style={h1}>Your table already tells the story. This writes it down.</h1>
          <p style={lede}>
            Six Axes sits in your session, transcribes it, and turns it into the work you would do
            afterwards if you ever had the time: the recap, the campaign wiki, and a record of what
            actually happened at the table.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26 }}>
            <Link href="/auth/sign-up" style={cta}>Join the pilot</Link>
            <Link href="/enter" style={ctaGhost}>I have an account</Link>
          </div>
          <p style={{ ...small, marginTop: 14 }}>
            Free while in pilot. No card, no commitment, and you can take all your data out again.
          </p>
        </header>

        <Section title="It knows what you rolled" lead="This is the part other tools cannot do.">
          <p style={body}>
            Most session tools listen and summarise. Six Axes also captures the mechanics: attacks,
            saves, damage, hit points, who rolled what and when. Playing on D&amp;D Beyond, that
            arrives automatically. Playing in person with real dice, it reads the numbers your table
            says out loud.
          </p>
          <p style={body}>
            Which lets it do arithmetic nobody else can. It knows the encounter it called Moderate
            left the party at a third of their hit points, and it can tell you that your Moderate
            fights land like Hard ones, at your table specifically, across a whole campaign.
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

        <Section title="Recording other people, done properly" lead="The part worth reading before you sign up.">
          <p style={body}>
            Every player consents once, when they claim their character, and is never asked again
            mid-game in front of the whole table. If someone present has not consented, the pipeline
            stops rather than transcribing them anyway. It is not a warning you can click past.
          </p>
          <p style={body}>
            Audio is deleted after 60 days, automatically, and nobody can extend that, including
            you. The transcript and the moments drawn from it stay; the recording of a
            person&apos;s voice does not. Any player can export everything held about them, or
            delete it.
          </p>
        </Section>

        <Section title="What you need" lead="Being straight about the requirements.">
          <ul style={list}>
            <li style={li}>
              <strong>A Discord server</strong> if you play online, so each player is recorded on
              their own track. Or <strong>one microphone in the room</strong> if you play in person.
            </li>
            <li style={li}>
              <strong>D&amp;D 5e.</strong> The character tools, monster stat blocks and encounter
              maths are 5e-native today. Other systems are not supported yet.
            </li>
            <li style={li}>
              <strong>Nothing from your players.</strong> No accounts and no installs, unless they
              roll on D&amp;D Beyond and want those rolls captured.
            </li>
          </ul>
        </Section>

        <section style={card}>
          <h2 style={h2}>Looking for pilot tables</h2>
          <p style={body}>
            This is early. It works, it is in use at real tables, and it is not finished. What it
            needs most is more campaigns and honest feedback, including the unflattering kind.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 18 }}>
            <Link href="/auth/sign-up" style={cta}>Start a campaign</Link>
          </div>
        </section>

        <footer style={footer}>
          <p style={{ margin: 0 }}>
            Six Axes is made by{" "}
            <a href="https://kerfandcode.com" target="_blank" rel="noopener noreferrer" style={link}>Kerf and Code &#8599;</a>, a studio building other tools too.{" "}
            <Link href="/privacy" style={link}>Privacy</Link>
            {" \u00B7 "}
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
const list: React.CSSProperties = { margin: "4px 0 0", paddingLeft: 20 };
const li: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.72, marginBottom: 10, color: "#3a352c" };
const small: React.CSSProperties = { fontSize: 13.5, color: "#8a8069", margin: 0 };
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
