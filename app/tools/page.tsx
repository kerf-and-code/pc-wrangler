import type { Metadata } from "next";
import Link from "next/link";
import ToolsShell from "@/components/tools-shell";
import { SAX, STONE } from "@/lib/theme";

// app/tools/page.tsx
//
// The free-tools hub. No login. Lists the tools; live ones link out, planned ones are shown as such so the
// page is honest rather than salting it with dead links. Server-rendered for search.

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
      <style dangerouslySetInnerHTML={{ __html: HUB_CSS }} />
      <div style={{ display: "grid", gap: 14, marginTop: 4 }}>
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
            <Link key={t.name} href={t.href} className="tool-card" style={{ ...cardBase, ...cardLive }}>{inner}</Link>
          ) : (
            <div key={t.name} style={{ ...cardBase, ...cardSoon }}>{inner}</div>
          );
        })}
      </div>
    </ToolsShell>
  );
}

const cardBase: React.CSSProperties = {
  display: "block", padding: "18px 20px 18px 22px", borderRadius: 4,
  borderLeft: `3px solid ${SAX.brass}`,
  background: "linear-gradient(160deg, rgba(52,47,39,0.82) 0%, rgba(38,34,28,0.86) 45%, rgba(22,19,15,0.9) 100%)",
  textDecoration: "none", color: "inherit",
  boxShadow: [
    "inset 1px 1px 0 rgba(255,235,200,0.12)", "inset -1px -1px 0 rgba(0,0,0,0.6)",
    "0 4px 0 -1px #17130d", "0 6px 14px rgba(0,0,0,0.55)",
  ].join(","),
  transition: "transform .08s ease, box-shadow .08s ease",
};
const cardLive: React.CSSProperties = {};
const cardSoon: React.CSSProperties = { opacity: 0.6, borderLeftColor: STONE.hi };

const HUB_CSS = `
.tool-card:hover { transform: translateY(-2px);
  box-shadow: inset 1px 1px 0 rgba(255,235,200,0.14), inset -1px -1px 0 rgba(0,0,0,0.6),
    0 6px 0 -1px #17130d, 0 12px 22px rgba(0,0,0,0.6); }
.tool-card:hover .tool-name { color: ${STONE.brassHi}; }
`;
const cardName: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: STONE.ink, fontFamily: "var(--forge-display, 'Cinzel', serif)" };
const soon: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 10.5, letterSpacing: "0.12em",
  textTransform: "uppercase", color: SAX.brass, border: `1px solid ${STONE.brassDeep}`, borderRadius: 3, padding: "2px 7px",
};
const cardBlurb: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.6, color: STONE.inkDim, margin: "8px 0 0", fontFamily: SAX.serif };
const cardSystems: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 12, color: STONE.inkFaint, margin: "8px 0 0",
};
