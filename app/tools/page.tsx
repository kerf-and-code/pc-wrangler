import type { Metadata } from "next";
import Link from "next/link";
import ToolsShell from "@/components/tools-shell";

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
                <span style={cardName}>{t.name}</span>
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
  display: "block", padding: "18px 20px 18px 22px", borderRadius: 6,
  border: "1px solid #d8cdb4", borderLeft: "3px solid #b98f2f",
  background: "linear-gradient(180deg, #fffefb, #faf5e8)", textDecoration: "none", color: "inherit",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8), 0 2px 0 -1px #d8cdb4, 0 9px 18px rgba(70,55,25,0.16)",
  transition: "transform .08s ease, box-shadow .08s ease",
};
const cardLive: React.CSSProperties = {};
const cardSoon: React.CSSProperties = { opacity: 0.72, borderLeftColor: "#cbbf9f" };

const HUB_CSS = `
.tool-card:hover { transform: translateY(-2px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.85), 0 3px 0 -1px #d8cdb4, 0 13px 24px rgba(70,55,25,0.22); }
.tool-card:hover span { color: #7a5a1a; }
`;
const cardName: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: "#2a2620" };
const soon: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 10.5, letterSpacing: "0.12em",
  textTransform: "uppercase", color: "#9a7b2e", border: "1px solid #d8c9a2", borderRadius: 3, padding: "2px 7px",
};
const cardBlurb: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.6, color: "#4a443a", margin: "8px 0 0" };
const cardSystems: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, color: "#8a7a55", margin: "8px 0 0",
};
