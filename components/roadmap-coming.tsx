import { SAX, STONE } from "@/lib/theme";
import { FORGE_FONTS, stonePanel, forgeHeading, forgeLabel } from "@/lib/forge-theme";

// components/roadmap-coming.tsx
//
// "On the way": the two adoption-driving features we are building next, presented honestly as upcoming.
// A SERVER component on purpose (no client state), so the copy sits in the HTML for crawlers and link
// previews, unlike the click-to-switch features explorer that only renders its active card. Shared by
// the home page and the features page so the wording stays in one place.
//
// The two items answer the two questions that gate adoption: "what about the campaign I am already
// running?" (backfill) and "what is in it for my players?" (player-owned character wikis).

type Coming = { label: string; title: string; audience: string; body: string };

const COMING: Coming[] = [
  {
    label: "Coming in the pilot",
    title: "Backfill a campaign already in flight",
    audience: "For the GM mid-campaign",
    body:
      "Bring what you already have. Point Six Axes at your existing notes, recaps, or session logs and it "
      + "seeds the wiki, the cast, and the open threads from them, so a campaign twenty sessions deep starts "
      + "full instead of empty. You do not have to start over to start.",
  },
  {
    label: "Coming in the pilot",
    title: "Players own their character's page",
    audience: "For the players",
    body:
      "Every player gets a character wiki that is theirs to write: backstory, goals, and the bonds and "
      + "secrets they choose to share. They hold the pen and grant the GM edit access when they want a "
      + "second hand, so the story stops living only in one person's head.",
  },
];

export default function RoadmapComing() {
  return (
    <div>
      <p style={eyebrow}>On the way</p>
      <h2 style={h2}>What we are building next</h2>
      <p style={lead}>
        Aimed squarely at the two questions we hear most: what about the campaign I am already running,
        and what is in it for my players?
      </p>
      <div style={grid}>
        {COMING.map((c) => (
          <div key={c.title} style={{ ...stonePanel(), padding: "20px 22px" }}>
            <div style={forgeLabel}>{c.label}</div>
            <h3 style={cardTitle}>{c.title}</h3>
            <p style={audience}>{c.audience}</p>
            <p style={body}>{c.body}</p>
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
const lead: React.CSSProperties = { fontSize: 14.5, color: SAX.brass, fontStyle: "italic", margin: "0 0 18px", fontFamily: FORGE_FONTS.body };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 };
const cardTitle: React.CSSProperties = {
  fontFamily: FORGE_FONTS.display, fontWeight: 700, fontSize: 19, color: STONE.ink,
  margin: "8px 0 2px", lineHeight: 1.25, letterSpacing: "0.02em",
};
const audience: React.CSSProperties = { fontSize: 13, color: STONE.brassHi, fontStyle: "italic", margin: "0 0 8px", fontFamily: FORGE_FONTS.body };
const body: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.66, color: STONE.inkDim, margin: 0, fontFamily: FORGE_FONTS.body };
