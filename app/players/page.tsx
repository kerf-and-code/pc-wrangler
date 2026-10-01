import type { Metadata } from "next";
import Link from "next/link";
import SiteShell from "@/components/site/site-shell";

// app/players/page.tsx
//
// "For players." The rest of the site sells the GM; this page speaks to the people who consent to being
// recorded, and shows what they get for it. Server-rendered. Screenshots live in /public/screens/players/.
//
// LAYOUT (2026-10, critic round 4): three densities instead of one block repeated seven times.
//   1. one lead row: the character page, capture in the 60% column (the home page's split);
//   2. a pair: the recap and journal, and the lore, captures above text;
//   3. a strip of four: maps, chat, the check-in, every character, each with a short caption.
// No eyebrow labels and no dividers; space separates the groups, as on the home page.

export const metadata: Metadata = {
  title: "For players",
  description:
    "What Six Axes gives the players at the table: your own character page, the recap and journal, the "
    + "lore you can see, shared maps, group chat, scheduling, an anonymous check-in, and every character "
    + "and campaign in one place. Your data stays yours.",
  alternates: { canonical: "/players" },
};

type Shot = { img: string; w: number; h: number; alt: string; pos?: string; contain?: boolean };

const LEAD: Shot = {
  img: "/screens/players/character-page.png", w: 743, h: 835,
  alt: "A player's character page with written sections, each marked private or shared",
};

const PAIR: { title: string; shot: Shot; paras: string[] }[] = [
  {
    title: "The recap, and your own journal",
    shot: { img: "/screens/players/recaps.png", w: 712, h: 908, alt: "A session recap as a player reads it" },
    paras: [
      "Miss a session, or forget what happened three weeks ago? Every session gets written up, so you can catch up in a minute instead of asking the table.",
      "Your journal is yours alone: private notes on your character, your suspicions, your plans.",
    ],
  },
  {
    title: "The lore you're allowed to see",
    shot: { img: "/screens/players/lore.png", w: 724, h: 887, alt: "The shared campaign lore as a player sees it" },
    paras: [
      "Every NPC you've met, every place you've been, every faction and thread, filed and searchable, showing exactly what your character would know and nothing the GM is still keeping back.",
    ],
  },
];

const STRIP: { title: string; shot: Shot; text: string }[] = [
  {
    title: "The map",
    shot: { img: "/screens/worldmap.png", w: 1057, h: 818, alt: "The campaign's hex world map in Six Axes, with settlements and regions", pos: "100% 100%" },
    text: "See the world map the GM shares, and help build the place when the GM opens it up.",
  },
  {
    title: "Between sessions",
    shot: { img: "/screens/players/chat.png", w: 776, h: 500, alt: "The campaign's group chat between sessions", contain: true, pos: "50% 50%" },
    text: "Group chat that stays with the campaign, not lost in a Discord server with forty other channels.",
  },
  {
    title: "Show up, and speak up",
    shot: { img: "/screens/players/checkin.png", w: 497, h: 899, alt: "The anonymous check-in a player fills in after a session" },
    text: "RSVP in a tap, then tell the GM anonymously what landed and what dragged.",
  },
  {
    title: "Every character",
    shot: { img: "/screens/players/characters.png", w: 733, h: 875, alt: "A player's characters across campaigns" },
    text: "All your characters, across every table you play at, next to the campaigns they belong to.",
  },
];

export default function PlayersPage() {
  return (
    <SiteShell
      layout="wide"
      title="For players"
      tagline="Six Axes isn't only the GM's tool. Here's what it puts in your hands, and why saying yes to being recorded is worth it."
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* 1. lead row */}
      <section className="sn-split is-flip pl-lead">
        <figure className="sn-figure" data-reveal>
          <img src={LEAD.img} width={LEAD.w} height={LEAD.h} alt={LEAD.alt} />
        </figure>
        <div className="pl-lead-text" data-reveal>
          <h2 className="sn-h2">A character page that&apos;s yours</h2>
          <p className="sn-p">
            Write your character&apos;s story in your own words: backstory, goals, the bonds that matter, the secrets
            that don&apos;t leave your head. Mark each part private or shared, and hand your GM edit access only when
            you want a second hand.
          </p>
          <p className="sn-p">It&apos;s your page. The story stops living only in the GM&apos;s notes.</p>
        </div>
      </section>

      {/* 2. the pair */}
      <section className="pl-pair">
        {PAIR.map((b) => (
          <div key={b.title} data-reveal>
            <figure className="sn-figure pl-crop">
              <img src={b.shot.img} width={b.shot.w} height={b.shot.h} alt={b.shot.alt} loading="lazy" />
            </figure>
            <h2 className="sn-h3" style={{ marginTop: 24 }}>{b.title}</h2>
            {b.paras.map((p, i) => <p key={i} className="sn-p">{p}</p>)}
          </div>
        ))}
      </section>

      {/* 3. the strip */}
      <section className="pl-strip" aria-label="More for players">
        {STRIP.map((b) => (
          <div key={b.title} data-reveal>
            <figure className="sn-figure pl-thumb">
              <img src={b.shot.img} width={b.shot.w} height={b.shot.h} alt={b.shot.alt} loading="lazy"
                style={{ objectPosition: b.shot.pos, objectFit: b.shot.contain ? "contain" : undefined }} />
            </figure>
            <h3 className="pl-strip-title">{b.title}</h3>
            <p className="sn-p" style={{ fontSize: 16 }}>{b.text}</p>
          </div>
        ))}
      </section>

      {/* your data is yours */}
      <section className="sn-card pl-data" data-reveal>
        <h2>Your read, and your data</h2>
        <p>
          You see your own read across the six axes, how you actually play, not a label someone put on you.
          Everything you put in is yours to take: export it all as a file whenever you want, and deleting your
          account takes your personal data and recordings with it. The <Link href="/privacy">privacy policy</Link>{" "}
          spells out exactly who touches your data and for how long.
        </p>
        <div className="sn-ctas">
          <Link href="/pilot" className="sn-btn sn-btn-fill">Apply to the pilot</Link>
          <Link href="/faq" className="sn-btn sn-btn-ghost">Questions about privacy?</Link>
        </div>
      </section>
    </SiteShell>
  );
}

const CSS = `
.pl-lead { align-items: center; }
@media (min-width: 981px) { .sn-split.pl-lead { grid-template-columns: minmax(0, 570px) minmax(0, 1fr); } }
.pl-lead .sn-figure img { max-height: 640px; width: auto; max-width: 100%; margin: 0; }
.pl-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; margin-top: 112px; }
.pl-crop { height: 460px; overflow: hidden; border-radius: 10px; border: 1px solid var(--sn-line2); }
.pl-crop img { height: 100%; width: 100%; object-fit: cover; object-position: 50% 0; border: 0; box-shadow: none; border-radius: 0; }
.pl-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 32px; margin-top: 112px; }
.pl-thumb { height: 300px; overflow: hidden; border-radius: 10px; border: 1px solid var(--sn-line2); background: #151b25; }
.pl-thumb img { height: 100%; width: 100%; object-fit: cover; object-position: 50% 0; border: 0; box-shadow: none; border-radius: 0; }
.pl-strip-title { font-family: var(--sn-display); font-weight: 700; font-size: 22px; color: var(--sn-ink); margin: 18px 0 6px; }
.pl-data { margin-top: 112px; max-width: 900px; }
@media (max-width: 980px) {
  .pl-pair { grid-template-columns: 1fr; gap: 48px; margin-top: 64px; }
  .pl-strip { grid-template-columns: 1fr 1fr; gap: 28px 20px; margin-top: 64px; }
  .pl-thumb { height: 220px; }
  .pl-crop { height: 380px; }
  .pl-data { margin-top: 64px; }
}
@media (max-width: 520px) {
  .pl-strip { grid-template-columns: 1fr; }
  .pl-thumb { height: 260px; }
}
`;
