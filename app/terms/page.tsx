import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of Six Axes.",
};

export default function TermsOfServicePage() {
  return (
    <LegalPage>
      <h1>Terms of Service</h1>
      <p className="meta">Effective date: [DATE]</p>

      <p>
        These Terms govern your use of Six Axes, operated by Kerf and Code, LLC (&ldquo;we,&rdquo; &ldquo;us&rdquo;). By
        creating an account, joining through a share link, or otherwise using the service, you agree to these Terms and to
        our Privacy Policy. If you don&rsquo;t agree, don&rsquo;t use Six Axes.
      </p>

      <h2>1. Eligibility</h2>
      <p>You must be at least 18 years old to create an account. By using Six Axes you represent that you meet this requirement and can form a binding contract. Minors may participate at a table only through a GM&rsquo;s share link, with the GM or a parent/guardian responsible for their participation and consent (see Section 6).</p>

      <h2>2. The service</h2>
      <p>Six Axes provides campaign-management, session-capture, transcription, AI-assisted summarization and event extraction, analytics, scheduling, and player-facing tools for tabletop RPGs. Features may change, and some depend on third-party services we don&rsquo;t control.</p>

      <h2>3. Accounts and security</h2>
      <p>You&rsquo;re responsible for your account credentials and for activity under your account. Sign-in may be handled by a third-party provider (for example Discord or Google) subject to their terms. Notify us promptly of any unauthorized use.</p>

      <h2>4. Your content and the license you grant us</h2>
      <p>You keep ownership of the content you create or upload (campaign notes, audio, characters, messages, and so on). To run the service, you grant us a worldwide, non-exclusive, royalty-free license to host, store, process, transcribe, analyze, display, and transmit your content <strong>solely to provide and improve Six Axes for you and your table</strong>. This license ends when you delete the content or your account, except for residual copies in backups purged on our normal cycle. You&rsquo;re responsible for having the rights to the content you upload.</p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to: use Six Axes for anything illegal; upload content you don&rsquo;t have the rights to; record anyone without the consent required by law; harass, abuse, or harm others; upload malware or attempt to breach or overload the service; scrape or reverse-engineer it except as the law allows; or resell the service without our permission.</p>

      <h2>6. Recording responsibility</h2>
      <p>Six Axes can record and transcribe session audio. <strong>You are solely responsible for obtaining the consent of every person recorded and for complying with all applicable recording and privacy laws</strong>, including &ldquo;all-party consent&rdquo; jurisdictions and special protections for minors. We provide consent tooling and a visible recording indicator, but the legal obligation to get consent is yours. You agree to indemnify us for claims arising from recordings you make.</p>

      <h2>7. AI-generated output</h2>
      <p>Transcripts, extracted events, recaps, dispositions, and other analytics are generated with automated and AI systems and <strong>may be incomplete or inaccurate</strong>. They are assistive, not authoritative. You should review them before relying on them, and you remain responsible for decisions you make based on them. We don&rsquo;t warrant the accuracy of AI output.</p>

      <h2>8. Third-party services and game content</h2>
      <p>Six Axes integrates with third parties (for example Discord, and virtual tabletops). Your use of those is governed by their terms, and their availability is outside our control. Six Axes is <strong>not affiliated with, endorsed by, or sponsored by Wizards of the Coast or any virtual-tabletop provider.</strong> You&rsquo;re responsible for using game content consistent with the rights you hold and applicable content policies.</p>

      <h2>9. Payments and subscriptions</h2>
      <p>Paid plans are billed through Stripe on the cycle shown at purchase and renew automatically until cancelled. You can cancel anytime, effective at the end of the current period. Fees are [non-refundable except where required by law / your refund policy]. Usage-metered features (such as transcription minutes or model runs) are subject to the limits shown in-app. We may change pricing with prior notice for future periods.</p>

      <h2>10. Intellectual property</h2>
      <p>We own Six Axes itself, our software, design, and trademarks. These Terms don&rsquo;t grant you rights in them beyond using the service. If you send us feedback or suggestions, you grant us a perpetual, royalty-free license to use them without obligation to you.</p>

      <h2>11. Termination</h2>
      <p>You may stop using Six Axes and delete your account anytime. We may suspend or terminate access if you violate these Terms, if required by law, or to protect the service or others. Provisions that by their nature should survive (ownership, disclaimers, liability limits, indemnities) survive termination.</p>

      <h2>12. Disclaimers</h2>
      <p>Six Axes is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We don&rsquo;t warrant that the service will be uninterrupted, error-free, or that AI output will be accurate.</p>

      <h2>13. Limitation of liability</h2>
      <p>To the fullest extent permitted by law, we will not be liable for indirect, incidental, special, consequential, or punitive damages, or for lost data, profits, or goodwill. Our total liability for any claim relating to the service is limited to the greater of the amount you paid us in the 12 months before the claim or [USD AMOUNT, e.g. $100]. Some jurisdictions don&rsquo;t allow these limits, so they may not fully apply to you.</p>

      <h2>14. Indemnification</h2>
      <p>You agree to indemnify and hold us harmless from claims arising out of your content, your recordings, your use of the service, or your violation of these Terms or the law.</p>

      <h2>15. Governing law and disputes</h2>
      <p>These Terms are governed by the laws of the State of Washington, without regard to conflict-of-laws rules. The state and federal courts located in [COUNTY] County, Washington have exclusive jurisdiction over disputes, except where applicable law provides otherwise.</p>

      <h2>16. Changes to these Terms</h2>
      <p>We may update these Terms and will post the new effective date. Material changes will be communicated by [email / in-app notice]. Continued use after changes means you accept them.</p>

      <h2>17. Contact</h2>
      <p>[LEGAL/SUPPORT CONTACT EMAIL], Kerf and Code, LLC, [MAILING ADDRESS].</p>
    </LegalPage>
  );
}
