import Link from "next/link";

// lib/guides/guides.tsx
//
// The guides content layer: a registry of long-form, system-agnostic articles that target
// informational search ("how to write a session recap", "record a D&D session on Discord") and funnel
// to the tools and the product. Each entry carries its own metadata plus a Body component authored as
// plain semantic HTML; <GuideLayout> supplies the H1, byline, schema, and prose styling.
//
// To add a guide: append an entry here. The index page and the dynamic route both read this array, and
// the sitemap enumerates it, so no other wiring is needed.

export type Guide = {
  slug: string;
  title: string;
  description: string;   // meta description, ~150 chars
  excerpt: string;       // one-line dek for the index + shell tagline
  updated: string;       // ISO date (YYYY-MM-DD)
  Body: React.ComponentType;
};

export const GUIDES: Guide[] = [
  {
    slug: "how-to-write-a-session-recap",
    title: "How to write a D&D session recap players actually read",
    description:
      "A practical guide to session recaps: lead with what changed, keep it short, name who did what, "
      + "and write it while it's fresh - or let it write itself.",
    excerpt: "Lead with what changed, keep it to a screen, name who did what — and write it while it's fresh.",
    updated: "2026-08-20",
    Body: function RecapGuide() {
      return (
        <>
          <p className="lede">
            A session recap has one job: get everyone back into the story before the next game, in the
            ninety seconds they'll actually spend reading it. Most recaps fail because they try to be a
            transcript. The good ones are a memory jog, not a record.
          </p>

          <h2>Lead with what changed, not what happened</h2>
          <p>
            The temptation is to narrate the session in order: they went here, then they fought this, then
            they talked to that person. But your players don't need the sequence — they need the
            <strong> consequences</strong>. What is true now that wasn't true last week? A debt is owed, an
            ally is dead, a door that was locked is open. Open on the change and the rest hangs off it.
          </p>
          <p>
            A useful test: if a beat didn't move a relationship, a goal, or a threat, it probably doesn't
            belong in the recap. It happened; it just isn't load-bearing.
          </p>

          <h2>Keep it to one screen</h2>
          <p>
            The recap competes with everything else in a group chat, and length is the enemy of getting
            read. Aim for something a player can take in without scrolling — a few short paragraphs, or a
            handful of tight beats. If a session was enormous, that's a sign to be more ruthless about what
            changed, not to write more.
          </p>

          <h2>Name people, and let them act</h2>
          <p>
            Attribute the choices. "The party decided" is forgettable; "Bram paid the ferryman with the
            ring his sister gave him" is a hook the whole table remembers. Naming the character who made a
            call — and what it cost — is what turns a summary into a story your players feel ownership over.
            It also quietly rewards the people who took the interesting risks.
          </p>

          <h2>End on the open question</h2>
          <p>
            The last line should point forward. What is unresolved, who is owed an answer, what is the party
            walking toward next session? A recap that ends on a cliff does the work of getting people
            excited to show up — which is the entire point.
          </p>

          <h2>Write it the night of — or let it write itself</h2>
          <p>
            Recaps rot fast. Written the night of the session, it takes fifteen minutes and reads true;
            written three days later, you've forgotten the small human moments that made it worth reading,
            and it becomes a chore you eventually skip. The best recap is the one that actually gets sent.
          </p>
          <p>
            This is the part <strong>Six Axes</strong> takes off your plate: it sits in the session,
            transcribes it, and writes the recap for you — grounded in what was actually said and rolled,
            not invented — so you can edit a draft instead of facing a blank page at midnight. If you'd
            rather do it by hand, the same principles above still hold; the tool just removes the excuse of
            being too tired. <Link href="/features">See how it works</Link>, or{" "}
            <Link href="/pilot">join the pilot</Link>.
          </p>

          <p>
            Related: our free <Link href="/tools/session-zero">session zero checklist</Link> and the{" "}
            <Link href="/tools/pacing">pacing planner</Link> help with the other half of running a campaign
            — the part before the recap.
          </p>
        </>
      );
    },
  },

  {
    slug: "how-to-record-a-dnd-session-on-discord",
    title: "How to record a D&D session on Discord",
    description:
      "How to record a tabletop session over Discord: why per-speaker tracks beat one room track, "
      + "getting consent right, and turning the audio into a transcript and recap you'll use.",
    excerpt: "Per-speaker tracks, consent done right, and turning the audio into notes you'll actually use.",
    updated: "2026-08-20",
    Body: function DiscordRecordingGuide() {
      return (
        <>
          <p className="lede">
            Recording a game you run online is easy to start and easy to get wrong in ways you only notice
            afterward — a single muddy track, no one's sure who agreed to it, and three hours of audio you
            never turn into anything. Here's how to do it so the recording is actually useful.
          </p>

          <h2>One track per player beats one track for the room</h2>
          <p>
            The single most important choice is whether you capture <strong>one mixed track</strong> for
            the whole call or <strong>a separate track per speaker</strong>. Per-speaker is far better, and
            not just for audio quality. When each person has their own track, you know who said what
            without guessing — which means a transcript can attribute lines correctly, and you can drop a
            single player's audio if they'd rather not be recorded, without losing everyone else's.
          </p>
          <p>
            A mixed room track throws that away. Everyone is on top of each other, cross-talk is
            unrecoverable, and any transcription has to guess at speakers and usually guesses wrong.
            Discord's architecture gives every participant their own audio stream, so per-speaker capture is
            available if the tool you use takes advantage of it.
          </p>

          <h2>Get consent once, out loud, and make it easy to withdraw</h2>
          <p>
            Recording people's voices is not a thing to do quietly. Before the first recorded session, say
            it plainly to the whole table: this is being recorded, here's what it's used for, here's how
            long the audio is kept, and anyone can opt out. Then make opting out real — a player who changes
            their mind should be able to have their track excluded without a negotiation.
          </p>
          <p>
            Treat it as a room-level agreement that any individual can step out of, not a box buried in a
            settings page. It's the difference between "we record the table" and "we record you," and only
            the first one is something a group actually consents to.
          </p>

          <h2>Turn the audio into something you'll use</h2>
          <p>
            Raw audio is a liability, not an asset. Nobody re-listens to three hours of a session, so the
            recording only earns its keep once it becomes something you'll actually open: a transcript you
            can search, a recap you can send, notes that feed your campaign wiki. Plan for that step before
            you hit record, or you'll accumulate a folder of files you never touch.
          </p>
          <p>
            The usual pipeline is: capture per-speaker audio, transcribe it (speaker-labelled, because you
            kept the tracks separate), then summarize the transcript into a recap. Doing each step by hand
            works but rarely survives contact with a busy week.
          </p>

          <h2>The in-person case</h2>
          <p>
            If your table is around a physical table, the same principles hold but the mechanics differ:
            you're usually working with one microphone in the room, so per-speaker separation isn't
            available and consent is genuinely room-level. The trade-off is that an in-person recording can
            hear the thing an online one often can't — the numbers people say out loud as they roll.
          </p>

          <h2>Where Six Axes fits</h2>
          <p>
            <strong>Six Axes</strong> is built around exactly this: it records per-speaker over Discord,
            enforces consent at the track level (an un-consented player is never even uploaded), transcribes
            with speakers attributed, and writes the recap and campaign wiki from the result. On a supported
            virtual tabletop it also captures what was <em>rolled</em>, not just what was said.{" "}
            <Link href="/features">See what it does</Link>, read how we handle{" "}
            <Link href="/faq">consent and your data</Link>, or <Link href="/pilot">join the pilot</Link>.
          </p>
        </>
      );
    },
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
