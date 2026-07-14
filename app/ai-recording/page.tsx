import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "AI & Recording Disclosure",
  description: "How recording and AI work in Six Axes, in plain language.",
};

export default function AiRecordingDisclosurePage() {
  return (
    <LegalPage>
      <h1>AI &amp; Recording Disclosure</h1>
      <p className="meta">Last updated: July 14, 2026</p>

      <h2>What this is</h2>
      <p>Six Axes can record your game session, turn it into a transcript, and use AI to pull out what happened so you get a recap and table analytics without taking notes. This page explains exactly what that involves, so everyone at the table can make an informed choice before anything is recorded.</p>

      <h2>What gets recorded</h2>
      <ul>
        <li><strong>Session audio</strong>, only when your GM starts a recording, and only after consent has been given for every player present. If you are recording your own track in the app, you will see the recorder running. <strong>If your table records through Discord, the bot joining the voice channel is the signal that recording has started</strong> &mdash; there is no separate badge, so your GM should say so out loud.</li>
        <li>Where supported, audio is captured as a <strong>separate track per speaker</strong> (from our recorder or, if your GM enables it, a Discord voice channel).</li>
        <li>You can <strong>decline</strong> to be recorded. If you do, your track is excluded from transcription and from analysis, and the rest of the table can still record. Withdraw at any time by telling your GM, and you are excluded from that session onward.</li>
      </ul>

      <h2>What happens to the audio</h2>
      <ol>
        <li><strong>Transcription.</strong> Your audio is sent to our transcription provider (Deepgram) to convert speech to text.</li>
        <li><strong>Extraction.</strong> The transcript is sent to our AI provider (Anthropic&rsquo;s Claude) to draft a recap and propose structured &ldquo;events&rdquo; (who did what, which threads moved, loot, and so on).</li>
        <li><strong>Review.</strong> Your GM reviews the proposed events and decides what becomes part of the campaign record. Nothing is treated as canon until the GM accepts it.</li>
        <li><strong>Analytics.</strong> Accepted events feed the dashboards and the disposition model, which runs a statistical computation on a cloud server.</li>
        <li><strong>Deletion.</strong> <strong>The audio is deleted 60 days after it is recorded, automatically, whether or not anyone asks.</strong> The transcript and the moments drawn from it remain, because that is the campaign&rsquo;s record. The recording of your voice does not.</li>
      </ol>
      <p>That last step is not a policy we might follow. It runs every day, on its own, and there is no button anyone can press to keep the audio longer.</p>

      <h2>Who can see it</h2>
      <ul>
        <li>Your <strong>GM</strong> can see your campaign&rsquo;s audio, transcripts, recaps, and analytics.</li>
        <li><strong>Players</strong> see what the GM shares, plus their own inputs.</li>
        <li><strong>Party chat is private to players</strong> unless a player grants the GM a specific time window.</li>
        <li>Our <strong>service providers</strong> (listed in the Privacy Policy) process this data only to run the service.</li>
        <li>We <strong>don&rsquo;t sell your data</strong>, we <strong>don&rsquo;t show ads</strong>, and our AI providers <strong>don&rsquo;t use your content to train their models</strong> under their commercial terms.</li>
      </ul>

      <h2>How accurate is the AI?</h2>
      <p>The transcript and the AI&rsquo;s proposed events and recaps <strong>can be wrong</strong>, mishearing a name, miscoding an event, missing something. They&rsquo;re a starting point that the GM reviews and edits, not an authoritative record. Treat them as a helpful assistant, not a court reporter.</p>

      <h2>Your control</h2>
      <ul>
        <li><strong>Consent is required</strong> before audio is processed, and it&rsquo;s recorded so it&rsquo;s clear who agreed.</li>
        <li>You can <strong>export everything we hold about you</strong> and <strong>delete your account</strong>, from Your account &rarr; Settings. Deleting your account removes your recordings, your transcribed words, your self-reports, and your notes. Your characters stay in their campaigns with your personal link severed, because the story your table told together is theirs as well as yours.</li>
        <li>Turning on &ldquo;auto&rdquo; capture (where the tool records and processes automatically) doesn&rsquo;t change any of this: the consent and the visible indicator still apply, and you can turn it off.</li>
      </ul>

      <h2>Consent at the table</h2>
      <p><strong>The GM is responsible for getting everyone&rsquo;s consent and for following the recording laws where the players are.</strong> Some places require every person to agree before a conversation is recorded. Be especially careful recording <strong>minors</strong>: a parent or guardian should consent, and if you run games for kids, talk to a lawyer about the extra rules that apply.</p>
      <p>When you consent to recording in Six Axes, this is what you are agreeing to:</p>
      <blockquote>
        I understand this session will be recorded and that the audio will be transcribed and analyzed by AI (Deepgram and Anthropic) to generate a recap and analytics for my table. I consent to being recorded. The audio is deleted 60 days after recording. I can withdraw my consent at any time, and I can delete my account and my data whenever I choose.
      </blockquote>

      <h2>Questions</h2>
      <p>kncadmin@kerfandcode.com &middot; Kerf and Code, LLC &middot; 739 N 95th St Apt 103, Seattle, WA 98103.</p>
    </LegalPage>
  );
}
