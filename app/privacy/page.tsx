import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";
import AnalyticsChoiceButton from "@/components/analytics-choice-button";

// app/privacy/page.tsx
//
// Updated 2026-11-03 to match what the app actually does. Every provider row below was checked against
// the code: Groq (Discord audio, the main path since 2026-10-13), Replicate (in-person room audio),
// Deepgram (backup for both), Anthropic (seven features), Google Gemini (map renders and tracing, plus the
// free no-login map tool), Google Analytics (app/layout.tsx, production only). The no-training promise
// names only the providers whose terms Terry has confirmed (Deepgram, Anthropic); do not widen it without
// confirming the others' terms for the plan actually in use.
// Push 10 (2026-11-10): Sentry added for error reporting (lib/sentry-server.ts, components/sentry-client.tsx),
// which strip personal data and share codes before sending.
// Push 43 (2026-11-12, audit round 2): online consent now happens as audio arrives (sidecar refresh_permits
// and TimelineSink.write), so the recording promise is worded to match; Roll20 capture and what it reads;
// the Discord Activity's sign-in (identify and guilds scopes); Google Analytics only after the visitor
// allows it (components/analytics.tsx).

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Six Axes collects, uses, and protects your data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage>
      <h1>Privacy Policy</h1>
      <p className="meta">Effective date: July 14, 2026</p>
      <p className="meta">Last updated: November 12, 2026</p>

      <p>
        Six Axes (&ldquo;Six Axes,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is operated by Kerf and Code, LLC,
        a Washington limited liability company, contact kncadmin@kerfandcode.com, 739 N 95th St Apt 103, Seattle, WA 98103. This policy explains what we collect,
        why, who we share it with, and your choices.
      </p>
      <p>
        Six Axes is a session-analytics and campaign tool for tabletop RPG game masters (&ldquo;GMs&rdquo;) and their
        players. Some of you create an account (typically GMs); some of you join through a share link from your GM
        (typically players). This policy covers both, plus our website and free tools, our Discord integration, our
        browser extension and Foundry VTT module, and any companion apps.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>We collect the campaign data you create, optional session audio and the transcripts and analytics derived from it, the dice rolls your table chooses to send us, and the inputs players give us (a play-style inventory, post-session check-ins, party chat, notes).</li>
        <li>We <strong>never sell your data</strong> and we <strong>do not run ads</strong>.</li>
        <li>We use named third-party services to run the product (database, hosting, transcription, AI, email). They process your data on our behalf. Two of our AI providers, Deepgram and Anthropic, <strong>do not use it to train their models</strong> under their commercial terms; the others are named below and are bound by their own terms.</li>
        <li>Audio is <strong>only recorded with consent</strong>. Online, consent is <strong>per person</strong>: if you decline, the recorder throws your audio away the moment it arrives, so it is never saved, uploaded or transcribed, and the rest of your table can still record theirs. In person, one microphone hears the whole room, so <strong>everyone present must agree</strong> or that session is not recorded. The GM is responsible for obtaining consent at their table.</li>
        <li>Session audio is deleted automatically 60 days after it is recorded.</li>
        <li>You can export or delete your data yourself, from Settings.</li>
      </ul>

      <h2>Information we collect</h2>
      <p><strong>Account and identity.</strong> If you create an account or sign in, we collect your email and display name, and the basic profile your sign-in provider shares (for example, your Discord user ID and avatar, or your Google profile). Players who join only through a share link may be assigned a temporary identifier without a full account.</p>
      <p><strong>Campaign content you create.</strong> Campaigns, characters, rosters, codex notes, lore, locations, story threads, loot, maps, encounters, combats, sessions, attendance, and similar records you enter. If a GM imports earlier campaign notes, we receive the text they upload.</p>
      <p><strong>Session audio (optional).</strong> Audio recorded for a session: per-speaker tracks from a Discord voice channel when the GM enables our bot, or a single room recording from a laptop or tablet when a table plays in person. Audio is processed only with consent (see &ldquo;Recording and consent&rdquo;). Online, our recorder receives every voice in the channel, because that is how Discord voice works, but it keeps only the speakers who have consented: anyone else&rsquo;s audio is discarded as it arrives and is never written to disk, uploaded, stored or transcribed.</p>
      <p><strong>Dice rolls and game data.</strong> If your table uses them, our browser extension reads rolls made on D&amp;D Beyond and, if a player turns it on, the rolls posted in the chat of a Roll20 game they have open, our Foundry VTT module sends rolls made in Foundry, and the GM&rsquo;s dice roller and combat tracker log the rolls made there. Rolls said out loud may also be picked out of a session transcript. We receive the roll, who made it, and when. In Roll20 the extension reads every roll shown in that game&rsquo;s chat, so it also sends the rolls of other people in the game, with the name they roll under and Roll20&rsquo;s ids for the player and character; a roll made privately to the GM is shown only to the GM in Six Axes.</p>
      <p><strong>Derived data.</strong> Transcripts produced from session audio, the structured events our AI proposes from those transcripts and that the GM accepts, session recaps, the campaign journal, and the analytics computed from all of this (engagement, spotlight balance, dispositions, roll statistics, and so on).</p>
      <p><strong>Player inputs.</strong> Responses to the Player Disposition Inventory, post-session check-ins (a satisfaction rating, a spotlight question, and an optional note), party chat messages, character pages, and private notes.</p>
      <p><strong>Messages you send us.</strong> If you use the contact form or apply to the pilot, we receive your name, email address, and what you write.</p>
      <p><strong>Payment information.</strong> Paid plans are not live yet. When they launch, our payment processor (Stripe) will handle your card details. We will receive confirmation and limited billing metadata; <strong>we will not store full card numbers.</strong></p>
      <p><strong>Technical and usage data.</strong> Log data, approximate location from IP address, device and browser information, and essential cookies used to keep you signed in. Our website uses Google Analytics, which sets its own cookies, to count visits and see which pages are used, <strong>only if you allow it</strong> when the site asks; you can <AnalyticsChoiceButton /> at any time. It never runs on player, share-link or sign-in pages. When you use the free map generator&rsquo;s AI render without an account, we log your IP address and the time so we can enforce its daily limit. We do not use advertising cookies.</p>

      <h2>How we use your information</h2>
      <ul>
        <li>To provide the product: store your campaign, transcribe audio, generate recaps, the journal and analytics, run dispositions, render maps, and power scheduling, combat, and chat.</li>
        <li>To communicate with you: session recaps, reminders, replies to your messages, and service notices. You can opt out of non-essential email.</li>
        <li>To operate, secure, debug, and improve the service, and to understand how the website is used.</li>
        <li>To process payments and manage subscriptions, once paid plans exist.</li>
        <li>To comply with law and enforce our Terms.</li>
      </ul>
      <p>We do not use your campaign content, audio, or transcripts to build advertising profiles, and we do not sell any of it.</p>

      <h2>AI processing and service providers (sub-processors)</h2>
      <p>We rely on the following providers to run Six Axes. They process your data only to perform their function for us:</p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr><th>Provider</th><th>Purpose</th></tr>
          </thead>
          <tbody>
            <tr><td>Supabase</td><td>Database, authentication, and file (audio and image) storage</td></tr>
            <tr><td>Vercel</td><td>Application hosting</td></tr>
            <tr><td>Fly.io</td><td>Hosting for the Discord voice recorder, which receives and processes session audio</td></tr>
            <tr><td>Groq</td><td>Speech-to-text transcription of Discord session audio</td></tr>
            <tr><td>Replicate</td><td>Speech-to-text transcription of in-person room recordings, including telling the voices in one recording apart</td></tr>
            <tr><td>Deepgram</td><td>Backup speech-to-text transcription, used when the providers above are unavailable</td></tr>
            <tr><td>Anthropic (Claude)</td><td>AI analysis of transcripts and text: drafting recaps and the campaign journal, proposing events and codex entries (people, places, lore), and reading campaign notes a GM imports</td></tr>
            <tr><td>Google (Gemini)</td><td>AI map images: turning a GM&rsquo;s colour-coded map, with the style and text they choose, into a finished map image, and reading a map image a GM uploads back into editable terrain. The free map generator sends the same kind of colour-coded map, without an account</td></tr>
            <tr><td>Google Cloud</td><td>Statistical computation for disposition modeling</td></tr>
            <tr><td>Google Analytics</td><td>Website usage measurement</td></tr>
            <tr><td>Resend</td><td>Transactional and reminder email, and delivering contact and pilot messages to us</td></tr>
            <tr><td>Sentry</td><td>Error reporting: when a page or server job fails, the error message, the kind of page it happened on, and your browser and device type, so we can fix it. No names, emails, recordings or share codes are sent</td></tr>
            <tr><td>Discord</td><td>Authentication, and (if enabled) bot and voice features, including posting recaps to a channel the GM chooses. When you open the Six Axes Activity inside Discord, Discord tells us who you are (user id, name and avatar) and the list of servers you are in; we use that list only to confirm you are in the server you opened it from, and do not store it</td></tr>
            <tr><td>Google</td><td>Authentication</td></tr>
          </tbody>
        </table>
      </div>
      <p>Most providers process and store data in the United States. Deepgram and Anthropic process your content to perform the service and, under their commercial terms, <strong>do not use it to train their models</strong>. Groq, Replicate, Google, and Sentry process it under their own terms. The table above is our current sub-processor list. If it changes, we will update it here.</p>
      <p>Not everything that sounds like AI is. The rules compendium&rsquo;s voice lookup runs speech recognition inside your browser, so that audio never leaves your device. The disposition model, roll statistics, encounter maths, and dice roller are ordinary statistics and code, not AI.</p>

      <h2>Recording and consent</h2>
      <p><strong>Online, consent is per person, not per table.</strong> When a session is recorded over Discord, each speaker is captured as a separate stream. If you have not given consent, or your GM has excluded you from a particular session, the recorder discards your stream as it arrives: it is never written to disk, never uploaded to us, never transcribed, and never used in recaps, statistics, or any analytics. The same applies to anyone in the voice channel who is not linked to a character in the campaign. If you give consent partway through a session, recording of your voice starts within about a minute; nothing from before is kept. One person declining does not stop the rest of the table from recording.</p>
      <p><strong>In person, consent is for the whole room.</strong> A single microphone cannot leave one voice out, so the GM confirms before recording that everyone present agrees, and that agreement is stored with the session. If anyone at the table says no, that session should not be recorded. Telling voices apart in a room recording happens within that one recording; we do not build or keep a voiceprint of anyone.</p>
      <p><strong>What declining does not do.</strong> It removes your voice, not your presence. Other people at the table who did consent may still say your name, quote you, or describe what your character did, and those references will appear in their transcripts and in any recap or analytics built from them. If you want no record of your participation at all, talk to your GM about not recording that session.</p>
      <p>While the Discord recorder is running, the Six Axes bot is visibly present in the voice channel, and the GM can end the recording at any time with the <code>/stop</code> command. <strong>The GM is responsible for obtaining consent from everyone at the table and for complying with the recording laws that apply where their players are</strong>, including jurisdictions that require all parties to consent. We store consent records so it is clear who agreed. You can request deletion of audio at any time. Take particular care recording minors (see &ldquo;Children&rsquo;s privacy&rdquo;).</p>

      <h2>How your group sees your data</h2>
      <p>Six Axes is collaborative, so some data is shared <strong>within your table</strong> by design:</p>
      <ul>
        <li>The GM can see the campaign data, accepted events, analytics, rolls, audio, and transcripts for their campaign.</li>
        <li>Players see what the GM shares with them, plus their own inputs. During a fight, players see the turn order but not monster hit points or monsters the GM has hidden.</li>
        <li><strong>Party chat is private to players by default.</strong> The GM cannot read it unless a player grants a specific time-window of access, and the player can revoke that.</li>
        <li><strong>Private notes are private to the player who writes them.</strong> The GM cannot read them. On a character page, the player chooses which sections are shared with the GM.</li>
      </ul>
      <p><strong>Public pages.</strong> A GM can publish a campaign wiki. Only entries the GM marks public appear on it, and anyone with the link can read them without an account. If the GM also lists the campaign, the page can be found by search engines, and a search engine may keep a copy for a while after it is unpublished.</p>
      <p>We also share data with the service providers listed above, when required by law or to protect rights and safety, and in connection with a merger or sale of the business (you&rsquo;ll be notified). That&rsquo;s it, no other sharing, and no sale.</p>

      <h2>Data retention and deletion</h2>
      <p>We keep your data while your account is active and as needed to provide the service. Session audio is deleted automatically 60 days after it is recorded, whether or not you ask. You can export everything we hold about you, and delete your account, from Settings. Deleting your account removes your recordings, your transcribed words, your self-reports, your dispositions, your notes and your check-ins. Your characters remain in their campaigns with your personal link severed, because the story your table told together is theirs as well as yours. We aim to delete or anonymize data within 30 days of an account-deletion request. Backups are purged on a rolling 7-day schedule.</p>

      <h2>Your rights and choices</h2>
      <p>Depending on where you live (for example under GDPR or the CCPA/CPRA), you may have the right to access, correct, export, delete, or restrict processing of your personal data, and to object to certain uses. You can exercise these yourself in the app, under Your account, Settings, where you can export everything we hold about you and delete your account. You can also email kncadmin@kerfandcode.com. We will not discriminate against you for exercising them. We do not sell or &ldquo;share&rdquo; personal information for cross-context behavioral advertising.</p>
      <p>If you are in the EEA/UK, our legal bases are: performing our contract with you, your consent (for audio recording, analytics cookies, and non-essential email), and our legitimate interests in operating and securing the service.</p>

      <h2>Children&rsquo;s privacy</h2>
      <p>Six Axes accounts are intended for adults 18 and older. Tabletop games are often played by minors, so a minor may participate at a table through a GM&rsquo;s share link. In that case the <strong>GM or the child&rsquo;s parent or guardian is responsible for any consent</strong>, especially for audio recording. We do not knowingly collect personal information from children under 13 without verifiable parental consent as required by COPPA, and we do not knowingly direct the service to them. If you believe a child under 13 has provided us personal information without that consent, contact kncadmin@kerfandcode.com and we will delete it.</p>

      <h2>Security</h2>
      <p>We protect data with encryption in transit, row-level security in our database, scoped access controls, and least-privilege service credentials. No system is perfectly secure, so we cannot guarantee absolute security.</p>

      <h2>International users</h2>
      <p>We operate in the United States and process data there. If you access Six Axes from outside the US, you consent to that transfer and processing, subject to the protections described here.</p>

      <h2>Changes</h2>
      <p>We will update this policy as the product evolves and post the new date at the top. Material changes will be communicated by email to account holders and by notice in the app.</p>

      <h2>Contact</h2>
      <p>Questions or requests: kncadmin@kerfandcode.com, Kerf and Code, LLC, 739 N 95th St Apt 103, Seattle, WA 98103.</p>
    </LegalPage>
  );
}
