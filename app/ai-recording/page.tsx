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
      <p className="meta">Last updated: [DATE]</p>

      <h2>What this is</h2>
      <p>Six Axes can record your game session, turn it into a transcript, and use AI to pull out what happened so you get a recap and table analytics without taking notes. This page explains exactly what that involves, so everyone at the table can make an informed choice before anything is recorded.</p>

      <h2>What gets recorded</h2>
      <ul>
        <li><strong>Session audio</strong>, only when someone starts a recording and only after consent. When a recording is active, you&rsquo;ll see a clear &ldquo;recording&rdquo; indicator.</li>
        <li>Where supported, audio is captured as a <strong>separate track per speaker</strong> (from our recorder or, if your GM enables it, a Discord voice channel).</li>
        <li>You can <strong>decline</strong> to be recorded, and you can <strong>stop</strong> a recording and ask us to delete the audio at any time.</li>
      </ul>

      <h2>What happens to the audio</h2>
      <ol>
        <li><strong>Transcription.</strong> Your audio is sent to our transcription provider (Deepgram) to convert speech to text.</li>
        <li><strong>Extraction.</strong> The transcript is sent to our AI provider (Anthropic&rsquo;s Claude) to draft a recap and propose structured &ldquo;events&rdquo; (who did what, which threads moved, loot, and so on).</li>
        <li><strong>Review.</strong> Your GM reviews the proposed events and decides what becomes part of the campaign record. Nothing is treated as canon until the GM accepts it.</li>
        <li><strong>Analytics.</strong> Accepted events feed the dashboards and the disposition model, which runs a statistical computation on a cloud server.</li>
      </ol>

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
        <li>You can <strong>stop recording</strong>, <strong>delete audio</strong>, and <strong>export or delete your data</strong> (see the Privacy Policy).</li>
        <li>Turning on &ldquo;auto&rdquo; capture (where the tool records and processes automatically) doesn&rsquo;t change any of this: the consent and the visible indicator still apply, and you can turn it off.</li>
      </ul>

      <h2>Consent at the table</h2>
      <p><strong>The GM is responsible for getting everyone&rsquo;s consent and for following the recording laws where the players are.</strong> Some places require every person to agree before a conversation is recorded. Be especially careful recording <strong>minors</strong>: a parent or guardian should consent, and if you run games for kids, talk to a lawyer about the extra rules that apply.</p>
      <p>When you consent to recording in Six Axes, this is what you are agreeing to:</p>
      <blockquote>
        I understand this session will be recorded and that the audio will be transcribed and analyzed by AI (Deepgram and Anthropic) to generate a recap and analytics for my table. I consent to being recorded. I can stop and request deletion at any time.
      </blockquote>

      <h2>Questions</h2>
      <p>[PRIVACY CONTACT EMAIL].</p>
    </LegalPage>
  );
}
