import { SAX, STONE } from "@/lib/theme";
import { FORGE_FONTS, stonePanel, forgeHeading } from "@/lib/forge-theme";

// components/how-it-works.tsx
//
// The concrete game-night flow, the one thing the rest of the page never spells out: how a session gets
// recorded, what happens to it, and what you get back. Three steps, server-rendered so it is in the HTML
// for crawlers and previews. Answers the evaluating GM's first question ("how does this even work?")
// before any feature detail.

type Step = { n: string; title: string; body: string };

const STEPS: Step[] = [
  {
    n: "01",
    title: "Record the session",
    body:
      "Play the way you already do. The Discord bot records your voice channel with each player on their "
      + "own track; in person, it reads the dice and the numbers your table says out loud; and on D&D "
      + "Beyond, the Chrome extension catches every roll. Everyone opts in first, and anyone can stop it "
      + "at any time.",
  },
  {
    n: "02",
    title: "It does the after-work you never get to",
    body:
      "Once you wrap, Six Axes transcribes the night, sorts out who did what, and pulls out both halves of "
      + "the game: the mechanics (attacks, saves, damage, hit points) and the story (the NPCs, places, "
      + "factions, and threads that came up). It drafts the recap and files the rest, in the background, "
      + "while you pack up.",
  },
  {
    n: "03",
    title: "Review, and get your night back",
    body:
      "You skim what it found and approve what goes in, nothing lands without your say. Out comes a "
      + "player-ready recap, your campaign wiki brought up to date, and a fresh read on how each player is "
      + "engaging across the six axes, so you know who to aim next session at.",
  },
];

export default function HowItWorks() {
  return (
    <div>
      <p style={eyebrow}>How it works</p>
      <h2 style={h2}>What game night actually looks like</h2>
      <p style={lead}>Three steps, and you keep running the table exactly the way you do now.</p>
      <div style={grid}>
        {STEPS.map((s) => (
          <div key={s.n} style={{ ...stonePanel(), padding: "22px 22px 24px" }}>
            <div style={numeral}>{s.n}</div>
            <h3 style={stepTitle}>{s.title}</h3>
            <p style={body}>{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const eyebrow: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase",
  color: SAX.brass, margin: "0 0 10px",
};
const h2: React.CSSProperties = { ...forgeHeading, fontFamily: FORGE_FONTS.display, fontSize: 30, margin: "0 0 6px", lineHeight: 1.18 };
const lead: React.CSSProperties = { fontSize: 14.5, color: SAX.brass, fontStyle: "italic", margin: "0 0 20px", fontFamily: FORGE_FONTS.body };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 };
const numeral: React.CSSProperties = {
  fontFamily: FORGE_FONTS.display, fontWeight: 700, fontSize: 34, lineHeight: 1,
  color: STONE.brassHi, marginBottom: 12, letterSpacing: "0.04em",
};
const stepTitle: React.CSSProperties = {
  fontFamily: FORGE_FONTS.display, fontWeight: 700, fontSize: 19, color: STONE.ink,
  margin: "0 0 8px", lineHeight: 1.25, letterSpacing: "0.02em",
};
const body: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: STONE.inkDim, margin: 0, fontFamily: FORGE_FONTS.body };
