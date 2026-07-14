import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Six Axes collects, uses, and protects your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage>
      <h1>Privacy Policy</h1>
      <p className="meta">Effective date: July 14, 2026</p>
      <p className="meta">Last updated: July 14, 2026</p>

      <p>
        Six Axes (&ldquo;Six Axes,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is operated by Kerf and Code, LLC,
        a Washington limited liability company, contact kncadmin@kerfandcode.com, 739 N 95th St Apt 103, Seattle, WA 98103. This policy explains what we collect,
        why, who we share it with, and your choices.
      </p>
      <p>
        Six Axes is a session-analytics and campaign tool for tabletop RPG game masters (&ldquo;GMs&rdquo;) and their
        players. Some of you create an account (typically GMs); some of you join through a share link from your GM
        (typically players). This policy covers both, plus our website, our Discord integration, and any companion apps.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>We collect the campaign data you create, optional session audio and the transcripts and analytics derived from it, and the inputs players give us (a play-style inventory, post-session check-ins, party chat).</li>
        <li>We <strong>never sell your data</strong> and we <strong>do not run ads</strong>.</li>
        <li>We use third-party services to run the product (database, hosting, transcription, AI, payments). They process your data on our behalf and, under their commercial terms, <strong>do not use it to train their own models</strong>.</li>
        <li>Audio is <strong>only recorded with consent</strong>, and the GM is responsible for getting consent from everyone at the table.</li>
        <li>You can export or delete your data yourself, from Settings.</li>
      </ul>

      <h2>Information we collect</h2>
      <p><strong>Account and identity.</strong> If you create an account or sign in, we collect your email and display name, and the basic profile your sign-in provider shares (for example, your Discord user ID and avatar, or your Google profile). Players who join only through a share link may be assigned a temporary identifier without a full account.</p>
      <p><strong>Campaign content you create.</strong> Campaigns, characters, rosters, codex notes, lore, locations, story threads, loot, sessions, attendance, and similar records you enter.</p>
      <p><strong>Session audio (optional).</strong> Audio you or your players upload or record for a session, including per-speaker tracks captured through our recorder or, where you enable it, a Discord voice channel. Audio is processed only with consent (see &ldquo;Recording and consent&rdquo;).</p>
      <p><strong>Derived data.</strong> Transcripts produced from session audio, the structured events our AI proposes from those transcripts and that the GM accepts, session recaps, and the analytics computed from this (engagement, spotlight balance, dispositions, and so on).</p>
      <p><strong>Player inputs.</strong> Responses to the Player Disposition Inventory, post-session check-ins (a satisfaction rating, a spotlight question, and an optional note), and party chat messages.</p>
      <p><strong>Payment information.</strong> If you subscribe, our payment processor (Stripe) handles your card details. We receive confirmation and limited billing metadata; <strong>we do not store full card numbers.</strong></p>
      <p><strong>Technical and usage data.</strong> Log data, approximate location from IP address, device and browser information, and essential cookies used to keep you signed in. We do not use advertising or cross-site tracking cookies.</p>

      <h2>How we use your information</h2>
      <ul>
        <li>To provide the product: store your campaign, transcribe audio, generate recaps and analytics, run dispositions, and power scheduling and chat.</li>
        <li>To communicate with you: session recaps, reminders, and service notices. You can opt out of non-essential email.</li>
        <li>To operate, secure, debug, and improve the service.</li>
        <li>To process payments and manage subscriptions.</li>
        <li>To comply with law and enforce our Terms.</li>
      </ul>
      <p>We do not use your campaign content, audio, or transcripts to build advertising profiles, and we do not sell any of it.</p>

      <h2>AI processing and service providers (sub-processors)</h2>
      <p>We rely on the following providers to run Six Axes. They process your data only to perform their function for us, under contracts that restrict their use of it:</p>
      <table>
        <thead>
          <tr><th>Provider</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <tr><td>Supabase</td><td>Database, authentication, and file (audio) storage</td></tr>
          <tr><td>Vercel</td><td>Application hosting</td></tr>
          <tr><td>Deepgram</td><td>Speech-to-text transcription of session audio</td></tr>
          <tr><td>Anthropic (Claude)</td><td>AI extraction of events from transcripts and recap drafting</td></tr>
          <tr><td>Google Cloud</td><td>Statistical computation for disposition modeling</td></tr>
          <tr><td>Resend</td><td>Transactional and reminder email</td></tr>
          <tr><td>Discord</td><td>Authentication, and (if enabled) bot and voice features</td></tr>
          <tr><td>Google</td><td>Authentication</td></tr>
        </tbody>
      </table>
      <p>Most providers process and store data in the United States. Our AI providers (Deepgram, Anthropic) process your content to perform the service and, under their commercial terms, <strong>do not use it to train their models</strong>. The table above is our current sub-processor list. If it changes, we will update it here.</p>

      <h2>Recording and consent</h2>
      <p>Session audio is processed only after consent is recorded. When recording is active there is a clear, visible indicator, and any participant may decline. <strong>The GM is responsible for obtaining consent from everyone at the table and for complying with the recording laws that apply where their players are</strong>, including jurisdictions that require all parties to consent. We store consent records so it is clear who agreed. You can stop a recording and request deletion of audio at any time. Take particular care recording minors (see &ldquo;Children&rsquo;s privacy&rdquo;).</p>

      <h2>How your group sees your data</h2>
      <p>Six Axes is collaborative, so some data is shared <strong>within your table</strong> by design:</p>
      <ul>
        <li>The GM can see the campaign data, accepted events, analytics, audio, and transcripts for their campaign.</li>
        <li>Players see what the GM shares with them, plus their own inputs.</li>
        <li><strong>Party chat is private to players by default.</strong> The GM cannot read it unless a player grants a specific time-window of access, and the player can revoke that.</li>
      </ul>
      <p>We also share data with the service providers listed above, when required by law or to protect rights and safety, and in connection with a merger or sale of the business (you&rsquo;ll be notified). That&rsquo;s it, no other sharing, and no sale.</p>

      <h2>Data retention and deletion</h2>
      <p>We keep your data while your account is active and as needed to provide the service. Session audio is deleted automatically 60 days after it is recorded, whether or not you ask. You can export everything we hold about you, and delete your account, from Settings. Deleting your account removes your recordings, your transcribed words, your self-reports, your dispositions, your notes and your check-ins. Your characters remain in their campaigns with your personal link severed, because the story your table told together is theirs as well as yours. We aim to delete or anonymize data within 30 days of an account-deletion request. Backups are purged on a rolling 7-day schedule.</p>

      <h2>Your rights and choices</h2>
      <p>Depending on where you live (for example under GDPR or the CCPA/CPRA), you may have the right to access, correct, export, delete, or restrict processing of your personal data, and to object to certain uses. You can exercise these yourself in the app, under Your account → Settings, where you can export everything we hold about you and delete your account. You can also email kncadmin@kerfandcode.com. We will not discriminate against you for exercising them. We do not sell or &ldquo;share&rdquo; personal information for cross-context behavioral advertising.</p>
      <p>If you are in the EEA/UK, our legal bases are: performing our contract with you, your consent (for audio recording and non-essential email), and our legitimate interests in operating and securing the service.</p>

      <h2>Children&rsquo;s privacy</h2>
      <p>Six Axes accounts are intended for adults 18 and older. Tabletop games are often played by minors, so a minor may participate at a table through a GM&rsquo;s share link. In that case the <strong>GM or the child&rsquo;s parent or guardian is responsible for any consent</strong>, especially for audio recording. We do not knowingly collect personal information from children under 13 without verifiable parental consent as required by COPPA, and we do not knowingly direct the service to them. If you believe a child under 13 has provided us personal information without that consent, contact kncadmin@kerfandcode.com and we will delete it.</p>

      <h2>Security</h2>
      <p>We protect data with encryption in transit, row-level security in our database, scoped access controls, and least-privilege service credentials. No system is perfectly secure, so we cannot guarantee absolute security.</p>

      <h2>International users</h2>
      <p>We operate in the United States and process data there. If you access Six Axes from outside the US, you consent to that transfer and processing, subject to the protections described here.</p>

      <h2>Changes</h2>
      <p>We will update this policy as the product evolves and post the new effective date. Material changes will be communicated by [email / in-app notice].</p>

      <h2>Contact</h2>
      <p>Questions or requests: kncadmin@kerfandcode.com, Kerf and Code, LLC, 739 N 95th St Apt 103, Seattle, WA 98103.</p>
    </LegalPage>
  );
}
