import type { Metadata } from "next";
import Link from "next/link";
import { SAX, STONE, AXES, TAVERN_ORDER } from "@/lib/theme";
import {
  C, FORGE_FONTS, forgeBackground, forgeVignette, stonePanel, stoneButton,
  FORGE_BUTTON_CSS, forgeHeading, forgeLabel, forgeRuleLine, forgeBoss,
} from "@/lib/forge-theme";
import SectionRail, { type RailSection } from "@/components/home/section-rail";
import SampleOutput from "@/components/sample-output";
import HowItWorks from "@/components/how-it-works";
import TrustSection from "@/components/trust-section";

// app/page.tsx
//
// The landing page, given the Six Axes treatment: the dungeon/forge register the app itself wears,
// a bolder hero with the spinning six-axes mark, the radar/hexagon motif, divided carved sections
// with side-by-side screenshots, a left-rail scrollspy, and the app's carved-depth buttons.
//
// Server-rendered, because this is the URL every link points at and a crawler needs the content.
// The only client island is the scrollspy rail (progressive enhancement over server-rendered sections).
//
// ASSETS this page references (drop into /public):
//   /six-axes-logo.png            the spinning astrolabe-axes mark
//   /wall-2.png                   already present (the app background)
//   /screens/mechanics.png        the Mechanics (dice) insight view
//   /screens/codex.png            the Codex editor
//   /screens/dispositions.png     the player disposition radar cards
//   /screens/worldmap.png         the rendered world map
//   /screens/forge.png            the character builder (the Forge)

export const metadata: Metadata = {
  title: "Six Axes: session analytics for tabletop RPGs",
  description:
    "Records your table, writes the recap, builds the campaign wiki, and tracks what was actually "
    + "rolled. Works across D&D 5e, Pathfinder 2e, Draw Steel, Daggerheart and more, on Discord or in person.",
  openGraph: {
    title: "Six Axes: session analytics for tabletop RPGs",
    description:
      "Records your table, writes the recap, builds the campaign wiki, and tracks what was actually rolled.",
    type: "website",
    siteName: "Six Axes",
    // Image omitted on purpose: the app/opengraph-image.png banner (file convention) supplies it.
  },
  twitter: {
    card: "summary_large_image",
  },
  alternates: { canonical: "/" },
};

const RAIL: RailSection[] = [
  { id: "top", label: "Overview" },
  { id: "how", label: "How it works" },
  { id: "sample", label: "See it" },
  { id: "trust", label: "Your data" },
  { id: "capture", label: "What you rolled" },
  { id: "wiki", label: "Living wiki" },
  { id: "insight", label: "Player insight" },
  { id: "maps", label: "Maps & world" },
  { id: "systems", label: "Your system" },
  { id: "tools", label: "Free tools" },
  { id: "pilot", label: "The pilot" },
];

// Six-axes radar motif geometry (TAVERN order, coloured per axis). Static.
const HEX = TAVERN_ORDER.map((k, i) => {
  const ang = ((-90 + i * 60) * Math.PI) / 180;
  return { k, x: Math.cos(ang), y: Math.sin(ang), color: AXES[k].color, label: AXES[k].tavernName };
});
const SAMPLE_R = [0.9, 0.62, 0.78, 0.5, 0.86, 0.66];

const TOOLS = [
  "Encounter balancer", "Dice roller", "Map generator", "Party coverage",
  "Session zero", "Pacing planner", "Magic item prices", "Player-type quiz",
];

export default function Home() {
  return (
    <main style={{ ...forgeBackground(), minHeight: "100vh", color: C.text, position: "relative", overflowX: "clip" }}>
      <div style={forgeVignette} />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* top bar */}
      <header className="home-top">
        <Link href="/" className="home-brand">
          <img src="/six-axes-logo.png" alt="" className="brand-mark" aria-hidden />
          <span className="brand-word">Six Axes</span>
        </Link>
        <nav className="home-topnav">
          <Link href="/features" className="topnav-link">Features</Link>
          <Link href="/players" className="topnav-link">For players</Link>
          <Link href="/tools" className="topnav-link">Free tools</Link>
          <Link href="/pricing" className="topnav-link">Pricing</Link>
          <Link href="/enter" className="topnav-link">Enter</Link>
          <Link href="/pilot" className="forge-btn is-primary" style={{ ...stoneButton("primary"), padding: "9px 18px", fontSize: 12.5 }}>
            Join the pilot
          </Link>
        </nav>
      </header>

      <div className="home-shell">
        <SectionRail sections={RAIL} />

        <div className="home-content">

          {/* HERO */}
          <section id="top" className="sec hero">
            <div className="hero-copy">
              <p style={eyebrow}>Kerf &amp; Code · Six Axes</p>
              <h1 className="wordmark" style={{ ...forgeHeading, fontFamily: "var(--font-cinzel-dec, 'Cinzel Decorative', serif)" }}>
                SIX AXES
              </h1>
              <p className="hero-tag" style={{ fontFamily: FORGE_FONTS.display, color: STONE.ink }}>
                Your table already tells the story. This writes it down.
              </p>
              <p style={lede}>
                Six Axes sits in your session, transcribes it, and turns it into the work you would do
                afterwards if you ever had the time: the recap, the campaign wiki, and a record of what
                actually happened at the table. Across your system, not just one.
              </p>
              <div className="hero-cta">
                <Link href="/pilot" className="forge-btn is-primary" style={stoneButton("primary")}>Join the pilot</Link>
                <Link href="/tools" className="forge-btn" style={stoneButton("stone")}>Free tools</Link>
                <Link href="/enter" className="forge-btn is-ghost" style={stoneButton("ghost")}>I have an account</Link>
              </div>
              <p style={{ ...small, marginTop: 16 }}>
                Free while in pilot. No card, no commitment, and you can take all your data out again.
              </p>
            </div>
            <div className="hero-mark">
              <img src="/six-axes-logo.png" alt="The Six Axes mark" className="spin-slow hero-logo" />
            </div>
          </section>

          <Divider />

          {/* HOW IT WORKS */}
          <section id="how" className="sec">
            <HowItWorks />
          </section>

          <Divider />

          {/* SAMPLE OUTPUT */}
          <section id="sample" className="sec">
            <SampleOutput />
          </section>

          <Divider />

          {/* TRUST */}
          <section id="trust" className="sec">
            <TrustSection />
          </section>

          <Divider />

          {/* CAPTURE */}
          <Section id="capture" eyebrow="Mechanical capture" title="It knows what you rolled"
            lead="This is the part other tools cannot do." imageSide="right"
            img="/screens/mechanics.png" imgAlt="The Mechanics view: a d20 distribution and per-character roll table">
            <p style={body}>
              Most session tools listen and summarise. Six Axes also captures the mechanics: attacks,
              saves, damage, hit points, who rolled what and when. On a supported virtual tabletop those
              numbers arrive automatically; playing in person with real dice, it reads the numbers your
              table says out loud.
            </p>
            <p style={body}>
              Which lets it do arithmetic nobody else can. It knows the fight it called Moderate left the
              party at a third of their hit points, and it can tell you that your Moderate encounters land
              like Hard ones, at your table specifically, across a whole campaign.
            </p>
          </Section>

          <Divider />

          {/* WIKI */}
          <Section id="wiki" eyebrow="The living wiki" title="A campaign wiki that writes itself"
            lead="Because nobody has ever kept one up to date by hand." imageSide="left"
            img="/screens/codex.png" imgAlt="The Codex editor with linked NPCs, places and factions">
            <p style={body}>
              Every NPC the party meets, every place they go, every faction and thread and piece of loot
              gets captured from what was narrated and filed where you can find it. You approve what goes
              in. By session five you have the campaign bible you were never going to write.
            </p>
            <p style={body}>
              When it is worth sharing, publish it as a page anyone can read, no account needed. You choose
              exactly what appears, so the setting and the cast can go public while the things your players
              have not found yet stay yours.
            </p>
          </Section>

          <Divider />

          {/* INSIGHT */}
          <Section id="insight" eyebrow="Player insight" title="It tells you how your table is doing"
            lead="In plain language, not charts." imageSide="right"
            img="/screens/dispositions.png" imgAlt="Player disposition radar cards across the six axes">
            <p style={body}>
              Which threads you have left hanging for four sessions. Who has not had a scene in a while.
              That one character is quietly holding two thirds of the party&apos;s loot. The things you
              half-notice on the night and have forgotten by the next one.
            </p>
            <p style={body}>
              It also builds a read of how each player engages, across six axes: tactics, arcana, voice,
              exploration, rapport, and nerve. It is not a score and no axis is the good one. It exists so
              you can notice you have not given someone a scene that plays to what they actually enjoy.
            </p>
            <div className="axis-legend">
              <MotifHex />
              <ul style={legendList}>
                {TAVERN_ORDER.map((k) => (
                  <li key={k} style={legendItem}>
                    <span style={{ ...legendSwatch, background: AXES[k].color }} />
                    <span style={{ color: STONE.ink }}>{AXES[k].tavernName}</span>
                    <span style={{ color: STONE.inkDim }}>&nbsp;·&nbsp;{AXES[k].facet}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Divider />

          {/* MAPS */}
          <Section id="maps" eyebrow="Maps & world" title="Build the world, four scales deep"
            lead="World, city, dungeon, and building, all yours." imageSide="left"
            img="/screens/worldmap.png" imgAlt="A rendered hex world map with settlements and regions">
            <p style={body}>
              Generate a hex world from a seed, or paint biomes by hand up to 250 by 250, then have it
              rendered as a finished map. Drop pins, link each to a place or an NPC, and trace where a
              session actually went. City, dungeon, and building maps use the same brush-and-render loop.
            </p>
            <p style={body}>
              A slice of it, the generator, is one of the free tools below. Inside a campaign it ties to
              your codex, your sessions, and what your players are allowed to see.
            </p>
          </Section>

          <Divider />

          {/* SYSTEMS */}
          <section id="systems" className="sec">
            <p style={eyebrow}>Your system</p>
            <h2 style={h2}>Works with your system</h2>
            <p style={sectionLead}>Honestly, because the depth varies by system.</p>
            <div className="tier-grid">
              <div style={{ ...stonePanel(), padding: "18px 20px" }}>
                <div style={forgeLabel}>Full toolset</div>
                <p style={tierText}>Character builder, monsters or NPCs, encounter maths, system-correct dice.</p>
                <p style={tierList}>D&amp;D 5e (2014 &amp; 2024) · Pathfinder 2e · Draw Steel · Daggerheart</p>
              </div>
              <div style={{ ...stonePanel(), padding: "18px 20px" }}>
                <div style={forgeLabel}>Themed table + dice</div>
                <p style={tierText}>The right roller and the system&apos;s look, character and monster builders still to come.</p>
                <p style={tierList}>Call of Cthulhu · Lancer · a generic d10 pool for gothic games</p>
              </div>
              <div style={{ ...stonePanel(), padding: "18px 20px" }}>
                <div style={forgeLabel}>Planned</div>
                <p style={tierText}>On the roadmap, waiting on the publisher&apos;s permission before we can ship them.</p>
                <p style={tierList}>Cyberpunk RED · Vampire: The Masquerade</p>
              </div>
            </div>
            <p style={{ ...small, marginTop: 16 }}>
              The record, recap, wiki and player insight work the same on every system. System names are
              referenced for compatibility only; see the <Link href="/terms" style={inlineLink}>Terms</Link> for
              the Lancer, Daggerheart and Draw Steel attributions.
            </p>
          </section>

          <Divider />

          {/* TOOLS */}
          <section id="tools" className="sec">
            <p style={eyebrow}>Free tools</p>
            <h2 style={h2}>Small, sharp tools, no login</h2>
            <p style={sectionLead}>Some of what Six Axes does is useful on its own.</p>
            <div className="tool-grid">
              {TOOLS.map((t) => (
                <div key={t} className="tool-chip" style={toolChip}>{t}</div>
              ))}
            </div>
            <div className="tool-cta">
              <Link href="/tools" className="forge-btn is-primary" style={stoneButton("primary")}>Open the free tools</Link>
            </div>
          </section>

          <Divider />

          {/* INTEGRATIONS */}
          <section id="integrations" className="sec">
            <p style={eyebrow}>Integrations</p>
            <h2 style={h2}>It meets your table where it plays</h2>
            <div className="tier-grid">
              <div style={{ ...stonePanel(), padding: "18px 20px" }}>
                <div style={forgeLabel}>Discord</div>
                <p style={tierText}>
                  The bot records your voice channel with each player on their own track, then files the
                  recap, for the tables that already live in Discord.
                </p>
              </div>
              <div style={{ ...stonePanel(), padding: "18px 20px" }}>
                <div style={forgeLabel}>D&amp;D Beyond &amp; Roll20</div>
                <p style={tierText}>
                  Rolls from D&amp;D Beyond and Roll20 come in through the browser, so mechanical capture
                  reaches your online table without a separate setup on the night.
                </p>
              </div>
              <div style={{ ...stonePanel(), padding: "18px 20px" }}>
                <div style={forgeLabel}>Foundry VTT</div>
                <p style={tierText}>
                  A Foundry module pipes every roll straight in. <Link href="/foundry" style={inlineLink}>Set it up →</Link>
                </p>
              </div>
            </div>
            <p style={{ ...small, marginTop: 14 }}>
              The Discord bot and the browser capture are set up when you join the pilot.
            </p>
          </section>

          <Divider />

          {/* PILOT */}
          <section id="pilot" className="sec">
            <div style={{ ...stonePanel(), padding: "30px 30px" }}>
              <p style={eyebrow}>The pilot</p>
              <h2 style={{ ...h2, marginTop: 4 }}>Looking for pilot tables</h2>
              <p style={body}>
                This is early. It works, it is in use at real tables, and it is not finished. What it needs
                most is more campaigns and honest feedback, including the unflattering kind. The pilot is
                invitation-based right now, so tell us about your table and we will get you in.
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
                <Link href="/pilot" className="forge-btn is-primary" style={stoneButton("primary")}>Apply to the pilot</Link>
                <Link href="/tools" className="forge-btn is-ghost" style={stoneButton("ghost")}>Try the free tools first</Link>
              </div>
            </div>
          </section>

        </div>
      </div>

      {/* footer */}
      <footer className="home-foot">
        <div className="foot-inner">
          <span>Six Axes is made by Kerf and Code.</span>
          <span className="foot-links">
            <Link href="/features" style={inlineLink}>Features</Link>
            {" · "}
            <Link href="/players" style={inlineLink}>For players</Link>
            {" · "}
            <Link href="/tools" style={inlineLink}>Free tools</Link>
            {" · "}
            <Link href="/pricing" style={inlineLink}>Pricing</Link>
            {" · "}
            <Link href="/about" style={inlineLink}>About</Link>
            {" · "}
            <Link href="/faq" style={inlineLink}>FAQ</Link>
            {" · "}
            <Link href="/contact" style={inlineLink}>Contact</Link>
            {" · "}
            <Link href="/privacy" style={inlineLink}>Privacy</Link>
            {" · "}
            <Link href="/terms" style={inlineLink}>Terms</Link>
          </span>
        </div>
      </footer>
    </main>
  );
}

// ---- section + motif components ----

function Section({
  id, eyebrow: eb, title, lead, children, img, imgAlt, imageSide,
}: {
  id: string; eyebrow: string; title: string; lead?: string;
  children: React.ReactNode; img: string; imgAlt: string; imageSide: "left" | "right";
}) {
  const copy = (
    <div>
      <p style={eyebrow}>{eb}</p>
      <h2 style={h2}>{title}</h2>
      {lead && <p style={sectionLead}>{lead}</p>}
      {children}
    </div>
  );
  const shot = (
    <figure style={shotFrame}>
      <img src={img} alt={imgAlt} style={shotImg} loading="lazy" />
    </figure>
  );
  return (
    <section id={id} className="sec row">
      {imageSide === "left" ? <>{shot}{copy}</> : <>{copy}{shot}</>}
    </section>
  );
}

function Divider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "6px 0" }} aria-hidden>
      <span style={forgeRuleLine} />
      <span style={forgeBoss} />
      <span style={{ ...forgeRuleLine, transform: "scaleX(-1)" }} />
    </div>
  );
}

function MotifHex() {
  const sample = HEX.map((h, i) => `${h.x * SAMPLE_R[i]},${h.y * SAMPLE_R[i]}`).join(" ");
  return (
    <svg viewBox="-1.25 -1.25 2.5 2.5" width="150" height="150" className="motif" aria-hidden>
      {[0.33, 0.66, 1].map((r) => (
        <polygon key={r} points={HEX.map((h) => `${h.x * r},${h.y * r}`).join(" ")}
          fill="none" stroke={STONE.hi} strokeWidth={0.012} />
      ))}
      {HEX.map((h) => (
        <line key={h.k} x1={0} y1={0} x2={h.x} y2={h.y} stroke={h.color} strokeWidth={0.014} opacity={0.85} />
      ))}
      <polygon points={sample} fill={SAX.brass} fillOpacity={0.16} stroke={SAX.brass} strokeWidth={0.018} />
      {HEX.map((h, i) => (
        <circle key={h.k} cx={h.x * SAMPLE_R[i]} cy={h.y * SAMPLE_R[i]} r={0.03} fill={h.color} />
      ))}
    </svg>
  );
}

// ---- styles ----

const eyebrow: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase",
  color: SAX.brass, margin: "0 0 10px",
};
const lede: React.CSSProperties = { fontSize: 18, lineHeight: 1.66, color: STONE.inkDim, margin: 0 };
const h2: React.CSSProperties = { ...forgeHeading, fontFamily: FORGE_FONTS.display, fontSize: 30, margin: "0 0 6px", lineHeight: 1.18 };
const sectionLead: React.CSSProperties = { fontSize: 14.5, color: SAX.brass, fontStyle: "italic", margin: "0 0 16px", fontFamily: FORGE_FONTS.body };
const body: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.72, margin: "0 0 14px", color: STONE.ink, fontFamily: FORGE_FONTS.body };
const small: React.CSSProperties = { fontSize: 13.5, color: STONE.inkFaint, margin: 0, lineHeight: 1.6, fontFamily: FORGE_FONTS.body };
const inlineLink: React.CSSProperties = { color: STONE.brassHi, textDecoration: "none" };

const shotFrame: React.CSSProperties = {
  ...stonePanel(), padding: 10, margin: 0, overflow: "hidden", alignSelf: "start",
};
const shotImg: React.CSSProperties = { display: "block", width: "100%", height: "auto", borderRadius: 3 };

const tierText: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.6, color: STONE.inkDim, margin: "6px 0 10px", fontFamily: FORGE_FONTS.body };
const tierList: React.CSSProperties = { fontSize: 13.5, color: STONE.ink, margin: 0, fontFamily: SAX.mono, lineHeight: 1.6 };
const toolChip: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 13, color: STONE.brassHi, textAlign: "center",
  padding: "12px 10px", background: "linear-gradient(180deg, rgba(52,47,39,0.8), rgba(22,19,15,0.85))",
  boxShadow: `inset 0 1px 0 rgba(255,230,190,0.10), inset 0 -1px 2px rgba(0,0,0,0.5), 0 0 0 1px ${STONE.mortar}`,
  borderRadius: 3,
};
const legendList: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 };
const legendItem: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontFamily: FORGE_FONTS.body };
const legendSwatch: React.CSSProperties = { width: 11, height: 11, borderRadius: 2, flex: "0 0 auto", boxShadow: `0 0 0 1px ${STONE.mortar}` };

const CSS = `
${FORGE_BUTTON_CSS}
html { scroll-behavior: smooth; }
.home-top {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 24px;
  background: linear-gradient(180deg, rgba(14,11,8,0.92), rgba(14,11,8,0.66));
  border-bottom: 1px solid ${STONE.mortar};
  backdrop-filter: blur(4px);
}
.home-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.brand-mark { width: 30px; height: 30px; mix-blend-mode: screen; }
.brand-word { font-family: var(--font-cinzel, 'Cinzel', serif); font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase; color: ${STONE.ink}; font-size: 16px; }
.home-topnav { display: flex; align-items: center; gap: 16px; }
.topnav-link { font-family: ${SAX.mono}; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: ${STONE.inkDim}; text-decoration: none; }
.topnav-link:hover { color: ${STONE.brassHi}; }

.home-shell { display: flex; gap: 34px; max-width: 1180px; margin: 0 auto; padding: 40px 24px 20px;
  position: relative; z-index: 1; }
.home-rail { position: sticky; top: 76px; align-self: flex-start; flex: 0 0 176px; padding-top: 8px; }
.home-rail ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px;
  border-left: 1px solid ${STONE.hi}; }
.home-rail a { display: flex; align-items: center; gap: 10px; padding: 7px 12px; text-decoration: none;
  font-family: ${SAX.mono}; font-size: 11.5px; letter-spacing: 0.06em; color: ${STONE.inkFaint};
  margin-left: -1px; border-left: 2px solid transparent; }
.home-rail .rail-dot { width: 6px; height: 6px; border-radius: 50%; background: ${STONE.hi}; flex: 0 0 auto; }
.home-rail li.is-active a { color: ${STONE.brassHi}; border-left-color: ${SAX.brass}; }
.home-rail li.is-active .rail-dot { background: ${SAX.brass}; box-shadow: 0 0 8px rgba(200,162,75,0.7); }
.home-rail a:hover { color: ${STONE.ink}; }

.home-content { flex: 1 1 auto; min-width: 0; }
.sec { scroll-margin-top: 88px; padding: 30px 0; }
.sec.row { display: grid; grid-template-columns: 1fr 1fr; gap: 34px; align-items: center; }
.hero { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 30px; align-items: center; padding-top: 14px; }
.wordmark { font-size: 60px; letter-spacing: 0.08em; margin: 6px 0 8px; line-height: 1; }
.hero-tag { font-size: 22px; line-height: 1.3; margin: 0 0 16px; }
.hero-cta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 22px; }
.hero-mark { display: flex; justify-content: center; }
.hero-logo { width: 100%; max-width: 340px; mix-blend-mode: screen;
  filter: drop-shadow(0 0 22px rgba(200,162,75,0.15)); }
.spin-slow { animation: sax-spin 90s linear infinite; }
@keyframes sax-spin { to { transform: rotate(360deg); } }

.tier-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; margin-top: 4px; }
.tool-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 4px; }
.tool-cta { display: flex; justify-content: center; margin-top: 18px; }
.axis-legend { display: flex; gap: 22px; align-items: center; flex-wrap: wrap; margin-top: 16px;
  padding: 20px 22px; border-radius: 4px;
  background: linear-gradient(180deg, rgba(38,34,28,0.94), rgba(24,21,17,0.96));
  box-shadow: inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.6),
    0 5px 14px rgba(0,0,0,0.6), 0 0 0 1px ${STONE.mortar}; }
.motif { flex: 0 0 auto; }

.home-foot { border-top: 1px solid ${STONE.mortar}; margin-top: 30px; position: relative; z-index: 1;
  background: linear-gradient(180deg, transparent, rgba(10,7,4,0.5)); }
.foot-inner { max-width: 1180px; margin: 0 auto; padding: 22px 24px; display: flex; gap: 14px;
  justify-content: space-between; flex-wrap: wrap; font-family: ${SAX.mono}; font-size: 12.5px; color: ${STONE.inkFaint}; }

@media (max-width: 980px) {
  .home-rail { display: none; }
  .hero { grid-template-columns: 1fr; }
  .hero-mark { order: -1; }
  .hero-logo { max-width: 240px; }
  .sec.row { grid-template-columns: 1fr; gap: 22px; }
  .wordmark { font-size: 44px; }
  .tool-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 520px) {
  .tool-grid { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .spin-slow { animation: none; }
}
`;
