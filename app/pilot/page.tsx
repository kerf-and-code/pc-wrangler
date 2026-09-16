import type { Metadata } from "next";
import Link from "next/link";
import PilotForm from "@/components/pilot-form";
import SiteShell from "@/components/site/site-shell";
import { SAX } from "@/lib/theme";
import { C } from "@/lib/forge-theme";
import { FULL_TOOLSET, THEMED_TABLE, systemsAnd } from "@/lib/marketing/systems";

// app/pilot/page.tsx
//
// The pilot application page. This is where the landing page's "Join the pilot" CTA goes. It holds
// the honest, detailed pitch that used to live on the landing page (recording done properly, what you
// need, this is early), updated for the multi-system reality, and ends in an application form.
//
// WHY AN APPLICATION FORM, NOT SIGN-UP: the app is behind an access code now (see proxy.ts, the
// secondary pilot gate on profiles.access_granted), so open sign-up would just deposit people at the
// /enter code screen. Instead this collects who they are and what their table looks like and emails
// it to the admin, who invites them in. The form posts to /api/pilot-request, which must be on the
// logged-out allowlist in proxy.ts or it 307s to /auth/login.
//
// Server-rendered so the pitch is crawlable; the form itself is the only client island.

export const metadata: Metadata = {
  title: "Join the pilot",
  description:
    "Apply to run your table on Six Axes during the pilot. Tell us about your game and we will get "
    + "you in.",
  alternates: { canonical: "/pilot" },
};

export default function PilotPage() {
  return (
    <SiteShell
      title="Run your table on Six Axes."
      tagline="The pilot is invitation-based while it is small, so we can help each table get set up and hear what breaks. Tell us about your game below and we will get you in. It is free during the pilot, with no card and no commitment."
    >
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
            delete it. See the <Link href="/privacy" style={link}>Privacy</Link> and{" "}
            <Link href="/ai-recording" style={link}>recording</Link> notes for the full detail.
          </p>
        </Section>

        <Section title="What you need" lead="Being straight about the requirements.">
          <ul style={list}>
            <li style={li}>
              <strong>A Discord server</strong> if you play online, so each player is recorded on
              their own track. Or <strong>one microphone in the room</strong> if you play in person.
            </li>
            <li style={li}>
              <strong>A supported system.</strong> The record, recap, wiki and player insight work on
              any table. The deeper rules tools vary by system: {systemsAnd(FULL_TOOLSET)} have the
              full toolset; {systemsAnd(THEMED_TABLE)} have a themed table and the right dice. Not sure
              where yours lands? Pick "Other or not sure" below and ask.
            </li>
            <li style={li}>
              <strong>Nothing from your players.</strong> No accounts and no installs, unless they
              roll on a supported virtual tabletop and want those rolls captured.
            </li>
          </ul>
        </Section>

        <Section title="This is early" lead="So you know what you are signing up for.">
          <p style={body}>
            It works, it is in use at real tables, and it is not finished. What it needs most is more
            campaigns and honest feedback, including the unflattering kind. If you want a polished
            finished product, this is not that yet. If you want to shape one, this is a good moment.
          </p>
        </Section>

        <section style={card}>
          <h2 style={h2}>Tell us about your table</h2>
          <p style={sectionLead}>We read every one of these. Nothing here is stored in an account.</p>
          <PilotForm />
        </section>
    </SiteShell>
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

// Content styles for the dark forge chrome (SiteShell). The page frame, title, tagline, and footer
// now come from SiteShell; these style only the body sections.
const card: React.CSSProperties = { padding: "26px 0", borderTop: `1px solid ${C.line}` };
const h2: React.CSSProperties = { fontSize: 26, margin: "0 0 4px", fontWeight: 600, lineHeight: 1.2, color: C.text, fontFamily: SAX.serif };
const sectionLead: React.CSSProperties = {
  fontSize: 14.5, color: C.muted, margin: "0 0 14px", fontStyle: "italic",
};
const body: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.72, margin: "0 0 14px", color: C.text };
const list: React.CSSProperties = { margin: "4px 0 0", paddingLeft: 20 };
const li: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.72, marginBottom: 10, color: C.text };
const link: React.CSSProperties = { color: C.plum };
