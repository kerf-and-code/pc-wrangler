import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";
import { SYSTEM_ATTRIBUTIONS } from "@/lib/systems/attribution";

export const metadata: Metadata = {
  title: "Game System Licenses",
  description: "The publisher license notices for the tabletop game systems Six Axes supports.",
};

// The user-visible home for the game-system license attributions. Six Axes ships only the game MECHANICS
// of each supported system (never the publishers' descriptive text), under the license each publisher
// grants. Where a license requires a specific notice, it appears verbatim here. The notices are sourced
// from lib/systems/attribution.ts, the same data the in-Forge attribution line reads, so the two can
// never drift. A summary of these also appears in the Terms of Service (Section 8).
export default function LicensesPage() {
  return (
    <LegalPage>
      <h1>Game System Licenses</h1>
      <p className="meta">Last updated: August 23, 2026</p>

      <p>
        Six Axes supports several tabletop roleplaying systems. For each, Six Axes ships only that
        system&rsquo;s game <strong>mechanics</strong> &mdash; the numbers and structure a creator or tool
        needs &mdash; never the publisher&rsquo;s descriptive text, artwork, or setting. Six Axes is an
        independent product and is not an official or endorsed product of any of these publishers. Where a
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
