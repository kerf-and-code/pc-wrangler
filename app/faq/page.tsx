import type { Metadata } from "next";
import Link from "next/link";
import SiteShell from "@/components/site/site-shell";
import { SAX, STONE } from "@/lib/theme";
import { stonePanel } from "@/lib/forge-theme";

// app/faq/page.tsx
//
// Quick answers, weighted toward the questions a table actually asks first: consent, recording,
// and data ownership. Native <details>/<summary> accordions, so it is server-rendered with no client
// JS and stays crawlable. Allowlisted in proxy.ts.

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers on how Six Axes handles recording, consent, and your data: audio is deleted after 60 days, "
    + "you can export everything, and you own your characters. Plus systems, cost, and pilot access.",
  alternates: { canonical: "/faq" },
};

const linkS: React.CSSProperties = { color: STONE.brassHi, textDecoration: "none" };

type QA = { q: string; a: React.ReactNode };

const FAQ: QA[] = [
  {
    q: "Is my table's audio kept?",
    a: (
      <>
        No, not for long. Session audio is deleted 60 days after it is recorded. The transcript and the
        moments drawn from it stay, because that is what the recap and the wiki are built from, but the
        recording itself does not.
      </>
    ),
  },
  {
    q: "Who agrees to being recorded?",
    a: (
      <>
        The whole room. Recording only starts once everyone present agrees, and any player can withdraw
        consent at any time by telling the GM; their track is excluded from that session onward. One
        microphone cannot exclude one voice, so the rule is stated as a room, not per person.
      </>
    ),
  },
  {
    q: "Can I get my data out?",
    a: (
      <>
        Yes, all of it, in one JSON file with nothing withheld: your characters, your self-reports and how
        they changed over time, your dispositions, your threads, your check-ins, and your transcribed
        words. Export is a button on your account, not a support request.
      </>
    ),
  },
  {
    q: "What happens if I delete my account?",
    a: (
      <>
        It deletes everything that is <em>about you</em>: your recordings, your transcribed words, your
        self-reports, your dispositions, your threads, your check-ins, and your chat. Your characters stay
        in their campaigns, unlinked from you. The story your table told together is theirs as well as
        yours, and your leaving should not detonate it.
      </>
    ),
  },
  {
    q: "What does it actually record?",
    a: (
      <>
        Two things: the words spoken at the table, transcribed, and the mechanics, who rolled what, the
        damage, the saves, the hit points. On a supported virtual tabletop the numbers arrive
        automatically; in person it reads the numbers your table says out loud. You approve what gets
        filed into the wiki.
      </>
    ),
  },
  {
    q: "Can players keep things private from the GM?",
    a: (
      <>
        Yes. Party chat is private to the players unless a player grants the GM a specific time window.
        Personal notes and the threads you are still owed are yours alone, and nobody else, GM included,
        sees them.
      </>
    ),
  },
  {
    q: "Which systems does it support?",
    a: (
      <>
        D&amp;D 5e (2014 and 2024), Pathfinder 2e, Draw Steel, and Daggerheart have the full toolset;
        Call of Cthulhu, Lancer, and a generic d10 pool run as a themed table with the right dice; more
        are on the way. The recording, recap, wiki, and player insight work the same on every system. See
        the <Link href="/#systems" style={linkS}>systems overview</Link> for the detail.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        It is free while in pilot, with no card and no commitment. The no-login <Link href="/tools" style={linkS}>free
        tools</Link> will always be free. Longer-term <Link href="/pricing" style={linkS}>pricing</Link> is
        still being worked out, and pilot tables will hear first.
      </>
    ),
  },
  {
    q: "How do I get in?",
    a: (
      <>
        The pilot is invitation-based right now. Tell us about your table on the{" "}
        <Link href="/pilot" style={linkS}>pilot page</Link> and we will get you in. It is early and honest
        feedback, including the unflattering kind, is exactly what it needs.
      </>
    ),
  },
  {
    q: "In person or online?",
    a: (
      <>
        Both. Online tables on a supported virtual tabletop get mechanical capture automatically; in-person
        tables record over one microphone in the room, and it reads the rolls spoken aloud, which is the
        thing no audio-only tool does.
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <SiteShell title="Questions and answers" tagline="The things a table asks first: consent, recording, and your data.">
      <div style={{ display: "grid", gap: 10 }}>
        {FAQ.map((item, i) => (
          <details key={i} style={{ ...stonePanel(), padding: "4px 18px" }}>
            <summary style={summary}>{item.q}</summary>
            <p style={answer}>{item.a}</p>
          </details>
        ))}
      </div>
      <p style={foot}>
        Still unsure about something? <Link href="/contact" style={linkS}>Ask us directly</Link>, or read the{" "}
        <Link href="/privacy" style={linkS}>Privacy</Link> and <Link href="/terms" style={linkS}>Terms</Link>.
      </p>
    </SiteShell>
  );
}

const summary: React.CSSProperties = {
  cursor: "pointer", listStyle: "revert", padding: "14px 4px", fontSize: 17,
  fontFamily: "var(--forge-display, 'Cinzel', serif)", color: STONE.ink, fontWeight: 600,
};
const answer: React.CSSProperties = {
  fontSize: 16, lineHeight: 1.68, color: STONE.inkDim, margin: "0 0 14px", fontFamily: SAX.serif,
};
const foot: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.6, color: STONE.inkFaint, margin: "22px 0 0", fontFamily: SAX.serif };
