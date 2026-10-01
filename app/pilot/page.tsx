import type { Metadata } from "next";
import Link from "next/link";
import PilotForm from "@/components/pilot-form";
import SiteShell from "@/components/site/site-shell";
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
//
// LAYOUT (2026-10): the home page's 40/60 split. The three reading sections sit in the 40% column and the
// application form in the 60% column, so the form is in the first screen on desktop. On phones the
// sections stack first, with a jump link to the form under the lead. The header's pilot button points
// at #apply here, since this page is where it would otherwise go.

export const metadata: Metadata = {
  title: "Apply to the pilot",
  description:
    "Apply to run your table on Six Axes during the pilot. Tell us about your game and we will get "
    + "you in.",
  alternates: { canonical: "/pilot" },
};

export default function PilotPage() {
  return (
    <SiteShell
      layout="wide"
      ctaHref="#apply"
      title="Run your table on Six Axes."
      tagline="The pilot is invitation-based while it is small, so we can help each table get set up and hear what breaks. It is free during the pilot, with no card and no commitment."
    >
      <p className="sn-mobile-only" style={{ margin: "-12px 0 32px" }}>
        <a href="#apply" className="sn-btn sn-btn-fill">Apply to the pilot</a>
      </p>

      <div className="sn-split">
        <div style={{ display: "grid", gap: 48 }} data-reveal>
          <section>
            <h2 className="sn-h3">Recording other people, done properly</h2>
            <p className="sn-p">
              Every player consents once, when they claim their character, and is never asked again mid-game in
              front of the whole table. If someone present has not consented, the pipeline stops rather than
              transcribing them anyway. It is not a warning you can click past.
            </p>
            <p className="sn-p">
              Audio is deleted after 60 days, automatically, and nobody can extend that, including you. The
              transcript and the moments drawn from it stay; the recording of a person&apos;s voice does not. Any
              player can export everything held about them, or delete it. See the{" "}
              <Link href="/privacy">privacy policy</Link> and the <Link href="/ai-recording">recording notes</Link>{" "}
              for the full detail.
            </p>
          </section>

          <section>
            <h2 className="sn-h3">What you need</h2>
            <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 12, color: "var(--sn-dim)" }}>
              <li>
                <strong style={{ color: "var(--sn-ink)" }}>A Discord server</strong> if you play online, so each
                player is recorded on their own track. Or <strong style={{ color: "var(--sn-ink)" }}>one microphone
                in the room</strong> if you play in person.
              </li>
              <li>
                <strong style={{ color: "var(--sn-ink)" }}>A supported system.</strong> The record, recap, wiki and
                player insight work on any table. The deeper rules tools vary by system: {systemsAnd(FULL_TOOLSET)}{" "}
                have the full toolset; {systemsAnd(THEMED_TABLE)} have a themed table and the right dice. Not sure
                where yours lands? Pick &quot;Other or not sure&quot; in the form and ask.
              </li>
              <li>
                <strong style={{ color: "var(--sn-ink)" }}>Nothing from your players.</strong> No accounts and no
                installs, unless they roll on a supported virtual tabletop and want those rolls captured.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="sn-h3">This is early</h2>
            <p className="sn-p">
              It works, it is in use at real tables, and it is not finished. What it needs most is more campaigns
              and honest feedback, including the unflattering kind. If you want a polished finished product, this
              is not that yet. If you want to shape one, this is a good moment.
            </p>
          </section>
        </div>

        <section id="apply" className="sn-card" style={{ scrollMarginTop: 96 }} data-reveal>
          <h2 style={{ fontSize: 34 }}>Tell us about your table</h2>
          <p>We read every one of these, and nothing here is stored in an account.</p>
          <PilotForm />
        </section>
      </div>
    </SiteShell>
  );
}
