import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";
import { SYSTEM_ATTRIBUTIONS } from "@/lib/systems/attribution";

export const metadata: Metadata = {
  title: "Game System Licenses",
  description: "The publisher license notices for the tabletop game systems Six Axes supports.",
  alternates: { canonical: "/licenses" },
};

// The user-visible home for the game-system license attributions. Push 48 (audit round 2, T4): the page
// used to say Six Axes ships only open mechanics; it also ships statistics from D&D books outside the
// SRD, in its own words, which are not open content, and the page now says so. Where a license requires a specific notice, it appears verbatim here. The notices are sourced
// from lib/systems/attribution.ts, the same data the in-Forge attribution line reads, so the two can
// never drift. A summary of these also appears in the Terms of Service (Section 8).
export default function LicensesPage() {
  return (
    <LegalPage>
      <h1>Game System Licenses</h1>
      <p className="meta">Last updated: November 12, 2026</p>

      <p>
        Six Axes supports several tabletop roleplaying systems. For each, Six Axes ships the game
        <strong> mechanics</strong> (the numbers and structure a creator or tool needs), written in its own
        words, not the publishers&rsquo; artwork or setting. Most of it comes from open content released
        under the licenses below. For Dungeons &amp; Dragons, Six Axes also includes statistics from books
        outside the System Reference Documents, from Wizards of the Coast and from third-party publishers.
        That material is <strong>not open content</strong>: Six Axes holds no license for it, every entry
        is labeled with its book, and the rights stay with each publisher. Six Axes is an independent
        product and is not an official or endorsed product of any of these publishers. Where a
        publisher&rsquo;s license requires a specific notice, that notice appears below.
      </p>

      {SYSTEM_ATTRIBUTIONS.map((a) => (
        <section key={a.system}>
          <h2>{a.system}</h2>
          <h3>{a.license}</h3>
          {a.notice.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </section>
      ))}

      <h2>Questions</h2>
      <p>
        If you believe an attribution is missing or incorrect, contact us at kncadmin@kerfandcode.com and
        we&rsquo;ll correct it promptly.
      </p>
    </LegalPage>
  );
}
