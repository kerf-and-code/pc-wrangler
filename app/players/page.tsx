import type { Metadata } from "next";
import Link from "next/link";
import SiteShell from "@/components/site/site-shell";
import { SAX, STONE } from "@/lib/theme";
import { FORGE_FONTS, stonePanel, stoneButton, forgeRuleLine, forgeBoss } from "@/lib/forge-theme";

// app/players/page.tsx
//
// "For players." The rest of the site sells the GM; this page speaks to the people who actually consent
// to being recorded, and shows what they get for it. Server-rendered. Screenshots live in
// /public/screens/players/ (see the shot list handed to the GM). If an image is missing it simply does
// not render, so the page is safe to ship before every screenshot is in.

export const metadata: Metadata = {
  title: "For players",
  description:
    "What Six Axes gives the players at the table: your own character page, the recap and journal, the "
    + "lore you can see, shared maps, group chat, scheduling, an anonymous check-in, and every character "
    + "and campaign in one place. Your data stays yours.",
  alternates: { canonical: "/players" },
};

type Block = { key: string; eyebrow: string; title: string; img: string; alt: string; paras: string[] };

const BLOCKS: Block[] = [
  {
    key: "character",
    eyebrow: "Your character",
    title: "A character page that's yours",
    img: "/screens/players/character-page.png",
    alt: "A player's character page with written sections and a shared toggle",
    paras: [
      "Write your character's story in your own words: backstory, goals, the bonds that matter, the secrets that don't leave your head. Mark each part private or shared, and hand your GM edit access only when you want a second hand.",
      "It's your page. The story stops living only in the GM's notes.",
    ],
  },
  {
    key: "recaps",
    eyebrow: "Never lose the thread",
    title: "The recap, and your own journal",
    img: "/screens/players/recaps.png",
    alt: "A session recap a player can read",
    paras: [
      "Miss a session, or just forget what happened three weeks ago? Every session gets written up, so you can catch up in a minute instead of asking the table to recap it for you.",
      "And your own journal is yours alone: private notes on your character, your suspicions, your plans, kept separate from everyone else's.",
    ],
  },
  {
    key: "lore",
    eyebrow: "The world you know",
    title: "The lore you're allowed to see",
    img: "/screens/players/lore.png",
    alt: "The shared campaign lore as a player sees it",
    paras: [
      "Every NPC you've met, every place you've been, every faction and thread, filed and searchable, showing exactly what your character would know, and nothing the GM is still keeping back.",
      "No more \"wait, who was that again?\" It's the campaign bible, from your seat at the table.",
    ],
  },
  {
    key: "maps",
    eyebrow: "Where you are",
    title: "The map, and a hand in the world",
    img: "/screens/players/maps.png",
    alt: "A shared world or region map",
    paras: [
      "See the world, city, and dungeon maps the GM shares, so you always know where you are and where you've been.",
      "And when the GM opens it up, you can help build the place your characters live in, instead of only ever visiting it.",
    ],
  },
  {
    key: "chat",
    eyebrow: "Between sessions",
    title: "Keep the table talking",
    img: "/screens/players/chat.png",
    alt: "Group chat between sessions",
    paras: [
      "Group chat that stays with the campaign: plan the heist, argue about the plan, stay in character or drop out of it, without the thread getting lost in a Discord server with forty other channels.",
    ],
  },
  {
    key: "checkin",
    eyebrow: "Your voice at the table",
    title: "Show up, and speak up",
    img: "/screens/players/checkin.png",
    alt: "The anonymous check-in and scheduling",
    paras: [
      "Find the next session time and RSVP in a tap, so the GM isn't chasing five calendars.",
      "And the check-in lets you tell the GM the truth, anonymously: what landed, what dragged, what you wish you got more of. The thing you'd never say out loud is exactly the thing that makes the next session better.",
    ],
  },
  {
    key: "characters",
    eyebrow: "Everyone you've been",
    title: "Every character, every campaign",
    img: "/screens/players/characters.png",
    alt: "A player's characters across campaigns",
    paras: [
      "All your characters, across every table you play at, in one place, alongside the campaigns they belong to.",
      "Build a new one from scratch in the Forge, whatever the system, and it lands here next to the rest.",
    ],
  },
];

export default function PlayersPage() {
  return (
    <SiteShell
      title="For players"
      tagline="Six Axes isn't only the GM's tool. Here's what it puts in your hands, and why saying yes to being recorded is worth it."
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {BLOCKS.map((b, i) => (
        <div key={b.key}>
          <section className={`pl-block${i % 2 ? " rev" : ""}`}>
            <figure className="pl-figure" style={{ ...stonePanel(), padding: 8, margin: 0, overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.img} alt={b.alt} loading="lazy" />
            </figure>
            <div>
              <p style={eyebrow}>{b.eyebrow}</p>
              <h2 style={title}>{b.title}</h2>
              {b.paras.map((p, j) => <p key={j} style={body}>{p}</p>)}
            </div>
          </section>
          {i < BLOCKS.length - 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "34px 0" }} aria-hidden>
              <span style={forgeRuleLine} />
              <span style={forgeBoss} />
              <span style={{ ...forgeRuleLine, transform: "scaleX(-1)" }} />
            </div>
          )}
        </div>
      ))}

      {/* your data is yours */}
      <div style={{ ...stonePanel(), padding: "22px 24px", marginTop: 40 }}>
        <p style={eyebrow}>What's yours stays yours</p>
        <h2 style={{ ...title, marginBottom: 8 }}>Your read, and your data</h2>
        <p style={{ ...body, margin: 0 }}>
          You see your own read across the six axes, how you actually play, not a label someone put on you.
          And everything you put in is yours to take: export it all as a file whenever you want, and deleting
          your account takes your personal data and recordings with it. The <Link href="/privacy" style={inlineLink}>privacy policy</Link>{" "}
          spells out exactly who touches your data and for how long.
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 30 }}>
        <Link href="/pilot" className="forge-btn is-primary" style={stoneButton("primary")}>Join the pilot</Link>
        <Link href="/faq" className="forge-btn is-ghost" style={stoneButton("ghost")}>Questions about privacy?</Link>
      </div>
    </SiteShell>
  );
}

const eyebrow: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: SAX.brass, margin: "0 0 8px",
};
const title: React.CSSProperties = {
  fontFamily: FORGE_FONTS.display, fontWeight: 700, fontSize: 25, color: STONE.ink, margin: "0 0 10px", lineHeight: 1.2, letterSpacing: "0.02em",
};
const body: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.68, color: STONE.inkDim, margin: "0 0 12px", fontFamily: FORGE_FONTS.body };
const inlineLink: React.CSSProperties = { color: STONE.brassHi, textDecoration: "none" };

const CSS = `
.pl-block { display: grid; grid-template-columns: 0.92fr 1fr; gap: 30px; align-items: center; }
.pl-block.rev .pl-figure { order: 2; }
.pl-figure img { width: 100%; height: auto; display: block; border-radius: 3px; }
@media (max-width: 680px) {
  .pl-block { grid-template-columns: 1fr; gap: 18px; }
  .pl-block.rev .pl-figure { order: 0; }
}
`;
