import type { Metadata } from "next";
import Link from "next/link";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { breadcrumbSchema } from "@/lib/seo";
import { SAX, STONE } from "@/lib/theme";

// app/tools/page.tsx
//
// The free-tools hub. No login. Lists the tools; live ones link out, planned ones are shown as such so the
// page is honest rather than salting it with dead links. Server-rendered for search. Night palette: the
// cards are flat with a hairline border, two to a row on desktop.

export const metadata: Metadata = {
  title: "Free tabletop RPG tools",
  description:
    "Free, no-login tools for tabletop RPGs: a hex world map generator, an encounter balancer, a party "
    + "coverage check, a session zero charter, a pacing planner, and a player-type quiz, across D&D 5e, "
    + "Pathfinder 2e, Draw Steel and Daggerheart. No account, nothing saved.",
  alternates: { canonical: "/tools" },
};

type Tool = {
  href?: string;
  name: string;
  blurb: string;
  systems?: string;
  status: "live" | "soon";
};

const TOOLS: Tool[] = [
  {
    href: "/tools/encounter-balancer",
    name: "Encounter balancer",
    blurb: "Build a fight, add your party, and see whether it lands Easy, Hard or lethal, with the real per-system math.",
    systems: "D&D 5e (2024 and 2014), Pathfinder 2e, Draw Steel, Daggerheart",
    status: "live",
  },
  {
    href: "/tools/player-quiz",
    name: "Player-type quiz",
    blurb: "A quick read on how you play across the six axes, with your tavern disposition chart at the end.",
    systems: "Any system",
    status: "live",
  },
  {
    href: "/tools/map-generator",
    name: "Map generator",
    blurb: "Generate a full fantasy hex world, continents, rivers, biomes, towns and roads, from a seed, and download it.",
    systems: "Any system",
    status: "live",
  },
  {
    href: "/tools/party-coverage",
    name: "Party coverage check",
    blurb: "Enter the party and see the gaps: no healer, no front line, no face.",
    systems: "D&D 5e, Pathfinder 2e, Draw Steel, Daggerheart, Call of Cthulhu",
    status: "live",
  },
  {
    href: "/tools/session-zero",
    name: "Session zero checklist",
    blurb: "Walk the table through every session-zero topic and download a table charter everyone can hold you to.",
    systems: "Any system",
    status: "live",
  },
  {
    href: "/tools/pacing",
    name: "Session and arc pacing",
    blurb: "See whether tonight's plan fits the clock, and estimate how many sessions an arc will take.",
    systems: "Any system",
    status: "live",
  },
  {
    href: "/tools/magic-item-price",
    name: "Magic item prices and finder",
    blurb: "Price a magic item by rarity, or search 400+ named 2024 items and see each one's estimate.",
    systems: "D&D 5e (2024)",
    status: "live",
  },
  {
    href: "/tools/dice-roller",
    name: "Dice roller",
    blurb: "A provably-fair roller with per-system modes: advantage, degrees, d100, power rolls, Hope and Fear, d10 pools.",
    systems: "D&D 5e, Pathfinder 2e, Call of Cthulhu, Draw Steel, Daggerheart, d10 pool",
    status: "live",
  },
];

export default function ToolsHub() {
  return (
    <ToolsShell
      title="Free tabletop tools"
      tagline="Small, sharp tools you can use without an account. More are rolling out."
      hideHubLink
    >
      <JsonLd data={breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Free tools", path: "/tools" }])} />
      <style dangerouslySetInnerHTML={{ __html: HUB_CSS }} />
      <div className="hub-grid">
        {TOOLS.map((t) => {
          const inner = (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span className="tool-name" style={cardName}>{t.name}</span>
                {t.status === "soon" && <span style={soon}>Coming soon</span>}
              </div>
              <p style={cardBlurb}>{t.blurb}</p>
              {t.systems && <p style={cardSystems}>{t.systems}</p>}
            </>
          );
          return t.href ? (
            <Link key={t.name} href={t.href} className="tool-card" style={{ ...cardBase, ...cardLive }} data-reveal>{inner}</Link>
          ) : (
            <div key={t.name} style={{ ...cardBase, ...cardSoon }}>{inner}</div>
          );
        })}
      </div>
    </ToolsShell>
  );
}

const cardBase: React.CSSProperties = {
  display: "block", padding: "24px 26px", borderRadius: 10, height: "100%",
  background: "var(--sn-card, #1b2230)", border: "1px solid var(--sn-line2, rgba(174,180,190,0.16))",
  textDecoration: "none", color: "inherit",
};
const cardLive: React.CSSProperties = {};
const cardSoon: React.CSSProperties = { opacity: 0.6 };

const HUB_CSS = `
.hub-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.tool-card { transition: opacity .7s cubic-bezier(0.22, 1, 0.36, 1), transform .7s cubic-bezier(0.22, 1, 0.36, 1), box-shadow .2s ease; }
.tool-card.is-in:hover { transform: translateY(-2px); transition: transform .15s ease, box-shadow .2s ease; }
.tool-card:hover .tool-name { text-decoration: underline; text-decoration-color: rgba(232,228,218,0.5); text-underline-offset: 4px; }
@media (max-width: 860px) { .hub-grid { grid-template-columns: 1fr; gap: 14px; } }
`;
const cardName: React.CSSProperties = { fontSize: 26, fontWeight: 700, color: STONE.ink, fontFamily: "var(--forge-display, 'Cinzel', serif)", lineHeight: 1.15 };
const soon: React.CSSProperties = {
  fontSize: 15, fontWeight: 600, color: STONE.inkDim, border: `1px solid ${STONE.hi}`, borderRadius: 6, padding: "2px 8px",
};
const cardBlurb: React.CSSProperties = { fontSize: 17, lineHeight: 1.6, color: STONE.inkDim, margin: "10px 0 0", fontFamily: SAX.serif };
const cardSystems: React.CSSProperties = { fontSize: 15, color: STONE.inkFaint, margin: "10px 0 0", fontFamily: SAX.serif };
