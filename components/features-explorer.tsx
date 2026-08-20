"use client";

import { useState } from "react";
import { SAX, STONE } from "@/lib/theme";
import { stonePanel } from "@/lib/forge-theme";

// components/features-explorer.tsx
//
// The /features experience: one feature card at a time, switched by a left-rail nav, so a focused page
// reads as cards changing rather than a long scroll. Client component (the switch is state). The five
// groups roll the whole product up into the pillars, each with a live screenshot.
//
// SCREENSHOTS referenced (in /public/screens): mechanics.png, codex.png, dispositions.png, forge.png,
// worldmap.png. The first four line up with the home page's set; forge.png is the only new one.

type Feature = {
  key: string;
  label: string;
  title: string;
  lead: string;
  paras: string[];
  img: string;
  imgAlt: string;
};

const FEATURES: Feature[] = [
  {
    key: "capture",
    label: "Mechanical capture",
    title: "It knows what you rolled",
    lead: "The one thing a microphone cannot tell you.",
    paras: [
      "Every session tool transcribes and summarises. Six Axes also captures the mechanics: attacks, saves, damage, hit points, who rolled what and when. On a supported virtual tabletop the numbers arrive automatically; in person, it reads the rolls your table says out loud.",
      "That turns into arithmetic nobody else can do. It knows the fight it called Moderate left the party at a third of their hit points, and it can tell you your Moderate encounters land like Hard ones, at your table, across a whole campaign, with its own uncertainty shown so a thin read reads as thin.",
    ],
    img: "/screens/mechanics.png",
    imgAlt: "The Mechanics view: a d20 distribution and a per-character roll table",
  },
  {
    key: "wiki",
    label: "The living wiki",
    title: "A campaign wiki that writes itself",
    lead: "The bible you were never going to keep by hand.",
    paras: [
      "Every NPC, place, faction, thread, and piece of loot is captured from what was narrated and filed where you can find it. You approve what goes in. By session five you have a campaign bible without having written one.",
      "Publish it as a page anyone can read, no account needed, and choose exactly what appears, so the setting and the cast can go public while the secrets your players have not found yet stay yours.",
    ],
    img: "/screens/codex.png",
    imgAlt: "The Codex editor with linked NPCs, places and factions",
  },
  {
    key: "insight",
    label: "Player insight",
    title: "How your table is actually doing",
    lead: "In plain language, across six axes.",
    paras: [
      "Which threads have gone stale, who has not had a scene in a while, that one character quietly holding two thirds of the loot, the things you half-notice on the night and forget by the next.",
      "And a read of how each player engages across six axes, tactics, arcana, voice, exploration, rapport, and nerve, comparing what they say they like against how they actually play. It is not a score and no axis is the good one; it is there so you can give someone the scene they would love.",
    ],
    img: "/screens/dispositions.png",
    imgAlt: "Player disposition radar cards across the six axes",
  },
  {
    key: "systems",
    label: "Built for your system",
    title: "One core, a module per game",
    lead: "It reskins and re-rules itself around your table.",
    paras: [
      "D&D 5e, Pathfinder 2e, Draw Steel, and Daggerheart get the full toolset: a character builder, monsters or NPCs, encounter maths, and system-correct dice. Call of Cthulhu, Lancer, and a generic d10 pool run as a themed table with the right roller, with more on the way.",
      "The record, recap, wiki, and player insight work the same on every system. What changes is the dice and the sheet, not the loop.",
    ],
    img: "/screens/forge.png",
    imgAlt: "The Forge character builder",
  },
  {
    key: "world",
    label: "World & maps",
    title: "Build the world, four scales deep",
    lead: "World, city, dungeon, and building.",
    paras: [
      "Generate a hex world from a seed or paint biomes by hand up to 250 by 250, then have it rendered as a finished map. Drop pins linked to places and NPCs, trace where a session went, and build city, dungeon, and building maps with the same brush-and-render loop.",
      "A slice of all of this is free with no login: the encounter balancer, dice roller, map generator, and more. The free tools are the front door to everything above.",
    ],
    img: "/screens/worldmap.png",
    imgAlt: "A rendered hex world map with settlements and regions",
  },
];

export default function FeaturesExplorer() {
  const [active, setActive] = useState(0);
  return (
    <div className="feat-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <nav className="feat-nav" aria-label="Features" role="tablist">
        {FEATURES.map((x, i) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            id={`feat-tab-${x.key}`}
            aria-controls={`feat-panel-${x.key}`}
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={i === active ? "feat-tab is-on" : "feat-tab"}
          >
            <span className="feat-num">{String(i + 1).padStart(2, "0")}</span>
            <span className="feat-lbl">{x.label}</span>
          </button>
        ))}
      </nav>

      {/* Every panel is rendered into the HTML; the inactive ones are hidden. That keeps the
          click-to-switch feel while putting all five features' copy in the server response, so crawlers
          and link previews read the whole page instead of just the first card. */}
      <div className="feat-stage" style={{ minWidth: 0 }}>
        {FEATURES.map((f, i) => (
          <article
            key={f.key}
            id={`feat-panel-${f.key}`}
            role="tabpanel"
            aria-labelledby={`feat-tab-${f.key}`}
            hidden={i !== active}
            className="feat-card"
            style={{ ...stonePanel(), padding: "26px 28px" }}
          >
            <p style={eyebrow}>{f.label}</p>
            <h2 style={title}>{f.title}</h2>
            <p style={lead}>{f.lead}</p>
            {f.paras.map((p, j) => <p key={j} style={body}>{p}</p>)}
            <figure style={shotFrame}>
              <img src={f.img} alt={f.imgAlt} style={shotImg} loading="lazy" />
            </figure>
          </article>
        ))}
      </div>
    </div>
  );
}

const eyebrow: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: SAX.brass, margin: "0 0 8px",
};
const title: React.CSSProperties = {
  fontFamily: "var(--forge-display, 'Cinzel', serif)", fontWeight: 700, fontSize: 27, color: STONE.ink,
  margin: "0 0 6px", lineHeight: 1.2, letterSpacing: "0.03em",
};
const lead: React.CSSProperties = { fontSize: 15, color: SAX.brass, fontStyle: "italic", margin: "0 0 16px", fontFamily: SAX.serif };
const body: React.CSSProperties = { fontSize: 16, lineHeight: 1.7, color: STONE.inkDim, margin: "0 0 14px", fontFamily: SAX.serif };
const shotFrame: React.CSSProperties = {
  margin: "8px 0 0", padding: 8, borderRadius: 4, overflow: "hidden",
  background: "linear-gradient(180deg, rgba(14,11,8,0.6), rgba(6,4,3,0.7))",
  boxShadow: `inset 1px 1px 4px rgba(0,0,0,0.7), 0 0 0 1px ${STONE.mortar}`,
};
const shotImg: React.CSSProperties = { display: "block", width: "100%", height: "auto", borderRadius: 3 };

const CSS = `
.feat-wrap { display: grid; grid-template-columns: 210px 1fr; gap: 26px; align-items: start; }
.feat-nav { position: sticky; top: 84px; display: grid; gap: 6px; }
.feat-tab {
  display: flex; align-items: center; gap: 10px; text-align: left; width: 100%;
  padding: 12px 14px; cursor: pointer; border: none; border-radius: 4px;
  font-family: var(--forge-display, 'Cinzel', serif); font-size: 14px; letter-spacing: 0.02em;
  color: ${STONE.inkDim};
  background: linear-gradient(180deg, ${STONE.hi} 0%, ${STONE.face} 55%, ${STONE.shadow} 100%);
  box-shadow: inset 0 1px 0 rgba(255,235,200,0.16), inset 0 -2px 3px rgba(0,0,0,0.5),
    inset 0 0 0 1px rgba(0,0,0,0.4), 0 3px 0 -1px #17130d, 0 4px 6px rgba(0,0,0,0.55);
  transition: transform 0.06s ease, color 0.15s ease;
}
.feat-tab:hover { color: ${STONE.brassHi}; }
.feat-tab.is-on {
  color: #241a0d;
  background: linear-gradient(180deg, ${STONE.brassHi} 0%, ${SAX.brass} 52%, ${STONE.brassDeep} 100%);
  box-shadow: inset 0 1px 0 rgba(255,240,210,0.6), inset 0 -2px 3px rgba(60,35,10,0.55),
    inset 0 0 0 1px rgba(70,45,15,0.5), 0 3px 0 -1px #3a260f, 0 4px 6px rgba(0,0,0,0.55);
}
.feat-num { font-family: ${SAX.mono}; font-size: 11px; opacity: 0.7; }
.feat-card { animation: feat-fade 0.28s ease; }
@keyframes feat-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (max-width: 760px) {
  .feat-wrap { grid-template-columns: 1fr; }
  .feat-nav { position: static; grid-auto-flow: column; grid-auto-columns: max-content;
    overflow-x: auto; padding-bottom: 4px; }
  .feat-lbl { white-space: nowrap; }
}
@media (prefers-reduced-motion: reduce) { .feat-card { animation: none; } }
`;
