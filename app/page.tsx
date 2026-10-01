import type { Metadata } from "next";
import Link from "next/link";
import { AXES, TAVERN_ORDER } from "@/lib/theme";
import SectionRail, { type RailSection } from "@/components/home/section-rail";
import Reveal from "@/components/home/reveal";
import LitLine from "@/components/home/lit-line";
import { STEPS } from "@/components/how-it-works";
import { READS } from "@/components/sample-output";
import { POINTS } from "@/components/trust-section";
import JsonLd from "@/components/json-ld";
import { softwareApplicationSchema } from "@/lib/seo";
import { FULL_TOOLSET, THEMED_TABLE, PLANNED, systemsDots } from "@/lib/marketing/systems";
import MobileMenu from "@/components/site/mobile-menu";
import { LANDING_NAV, PILOT_CTA } from "@/lib/marketing/nav";

// app/page.tsx
//
// The landing page, palette C ("night table", chosen by Terry on 2026-10-01 from three mockups).
// Deep blue-black page, warm candle-amber for the one action color, EB Garamond headlines over a
// Source Sans body. The app's own screens stay exactly as they are (warm brown inside); against the
// cool page they read as the product, not as background.
//
// Round 2 of the site-critic loop. What changed from the forge version, and why:
//   - Hero: an outcome headline (A1) with the product beside it, not the brand name and the spinning
//     logo. The logo's dial lettering is garbled (generated art), so it now appears only at 30px in
//     the header, where the lettering cannot be read.
//   - Proof bar under the hero with the real pilot numbers and their date (A10).
//   - No monospace eyebrow over every section (owner's veto); headings carry the sections.
//   - Motion: sections settle in on scroll (A4, components/home/reveal.tsx), and one scroll-lit
//     line in the chapter band (A5, components/home/lit-line.tsx). Both respect reduced motion.
//   - Rhythm: two chapter bands (the why, and the data promise) instead of eleven identical
//     sections split by the same divider (T10, A11).
//   - The free-tool chips are real links (they were plain boxes).
//   - 40/60 text-to-image splits that run wide on monitors (A7); the phone gets its own order.
//
// Server-rendered, because this is the URL every link points at and a crawler needs the content.
// Client islands: the section rail, the reveal observer, and the lit line, all progressive
// enhancement over server-rendered markup.

export const metadata: Metadata = {
  title: "Six Axes: session analytics for tabletop RPGs",
  description:
    "Records each player on their own track, writes the recap, files the campaign wiki, and counts every "
    + "roll. D&D 5e, Pathfinder 2e, Draw Steel and more.",
  openGraph: {
    title: "Six Axes: session analytics for tabletop RPGs",
    description:
      "Every session recapped. Every roll counted. The recap, the wiki update, and every roll, waiting for the GM's approval by morning.",
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
  { id: "split", label: "GM or player" },
  { id: "how", label: "How it works" },
  { id: "sample", label: "See it" },
  { id: "why", label: "Why" },
  { id: "wiki", label: "Living wiki" },
  { id: "insight", label: "Player insight" },
  { id: "maps", label: "Maps & world" },
  { id: "trust", label: "Your data" },
  { id: "systems", label: "Your system" },
  { id: "tools", label: "Free tools" },
  { id: "pilot", label: "The pilot" },
];

const TOOLS: { label: string; href: string }[] = [
  { label: "Encounter balancer", href: "/tools/encounter-balancer" },
  { label: "Dice roller", href: "/tools/dice-roller" },
  { label: "Map generator", href: "/tools/map-generator" },
  { label: "Party coverage", href: "/tools/party-coverage" },
  { label: "Session zero", href: "/tools/session-zero" },
  { label: "Pacing planner", href: "/tools/pacing" },
  { label: "Magic item prices", href: "/tools/magic-item-price" },
  { label: "Player-type quiz", href: "/tools/player-quiz" },
];

export default function Home() {
  return (
    <main className="nt">
      {/* Product entity for the home page (Organization + WebSite come from the root layout). */}
      <JsonLd data={softwareApplicationSchema()} />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Reveal />

      {/* top bar */}
      <header className="nt-top">
        <div className="nt-wrap nt-top-in">
          <div className="nt-brandwrap">
            <Link href="/" className="nt-brand">
              <img src="/six-axes-mark-60.png" alt="" width={30} height={30} className="nt-mark" aria-hidden />
              <span>Six Axes</span>
            </Link>
            <a href="https://kerfandcode.com" target="_blank" rel="noopener noreferrer" className="nt-by">by Kerf and Code &#8599;</a>
          </div>
          <nav className="nt-nav" aria-label="Main">
            {LANDING_NAV.map((it) => (
              <Link key={it.href} href={it.href} className="nt-navlink">{it.label}</Link>
            ))}
            <Link href={PILOT_CTA.href} className="nt-btn nt-btn-fill nt-btn-sm">{PILOT_CTA.label}</Link>
          </nav>
          <MobileMenu items={LANDING_NAV} cta={PILOT_CTA} />
        </div>
      </header>

      <SectionRail sections={RAIL} />

      {/* HERO */}
      <section id="top" className="nt-sec nt-hero-sec">
        <div className="nt-wrap nt-hero">
          <div className="nt-hero-copy" data-reveal>
            <h1>Every session recapped. Every roll counted.</h1>
            <p className="nt-sub">
              For GMs and their players: the recap, the wiki and every roll, waiting for your approval by morning.
            </p>
            <div className="nt-ctas">
              <Link href="/pilot" className="nt-btn nt-btn-fill">Apply to the pilot</Link>
              <a href="#sample" className="nt-btn nt-btn-ghost">See a sample recap</a>
            </div>
            <p className="nt-small">Free while in pilot. No card, no commitment, and you can take all your data out again.</p>
          </div>
          <figure className="nt-hero-shot" data-reveal>
            <img className="nt-shot-main" src="/screens/mechanics.png" width={867} height={909}
              alt="The Mechanics view for session 6 of a demo campaign: 135 events captured, 52 d20 rolls, a d20 distribution, and a per-character roll and hit point table" />
            <figcaption>From a demo campaign, Emberwatch.</figcaption>
          </figure>
        </div>
      </section>

      {/* PROOF */}
      <section className="nt-proof-sec" aria-label="Pilot numbers">
        <div className="nt-wrap">
          <dl className="nt-proof" data-reveal>
            <div><dt>hours of real sessions recorded</dt><dd>127</dd></div>
            <div><dt>sessions transcribed</dt><dd>50</dd></div>
            <div><dt>campaigns with our pilot GM</dt><dd>6</dd></div>
          </dl>
          <p className="nt-small">Pilot figures as of 30 September 2026.</p>
        </div>
      </section>

      {/* GM OR PLAYER (A9) */}
      <section id="split" className="nt-sec">
        <div className="nt-wrap">
          <div className="nt-head" data-reveal>
            <h2>One table, two ways in</h2>
            <p>The GM runs the session. Every player gets their own side of it.</p>
          </div>
          <div className="nt-split">
            <article data-reveal>
              <figure className="nt-split-shot">
                <img src="/screens/compendium.png" width={696} height={490} loading="lazy"
                  alt="The rules lookup with Fireball searched: the spell card, related items, and a Voice button for asking out loud" />
              </figure>
              <h3>For the GM</h3>
              <p>
                The recap, the wiki you approve, encounter maths, and a rules lookup you can ask out loud: say a
                spell and its card comes up, from 933 SRD entries, without leaving your browser.
              </p>
              <Link href="/features" className="nt-link nt-strong">What the GM gets</Link>
            </article>
            <article data-reveal>
              <figure className="nt-split-shot">
                <img src="/screens/players/character-page.png" width={743} height={835} loading="lazy"
                  alt="A player's character page, written in their own words, with each section set to private or shared" />
              </figure>
              <h3>For your players</h3>
              <p>
                Their own character page in their own words, each section private or shared with you. A party chat
                you cannot read unless they grant you a window, and a quick check-in after each session.
              </p>
              <Link href="/players" className="nt-link nt-strong">What players get</Link>
            </article>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="nt-sec">
        <div className="nt-wrap">
          <div className="nt-head" data-reveal>
            <h2>What game night actually looks like</h2>
            <p>Three steps, and you keep running the table exactly the way you do now.</p>
          </div>
          <ol className="nt-steps">
            {STEPS.map((s) => (
              <li key={s.n} data-reveal>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* SAMPLE OUTPUT */}
      <section id="sample" className="nt-sec">
        <div className="nt-wrap">
          <div className="nt-head" data-reveal>
            <h2>What lands the morning after</h2>
            <p>The recap your players actually read, and the read on your table. An example from a demo campaign.</p>
          </div>
          <div className="nt-sample">
            <figure className="nt-sample-shot" data-reveal>
              <img src="/screens/players/recaps.png" width={712} height={908} loading="lazy"
                alt="The recap page a player reads for session 2 of the demo campaign, written as prose" />
              <figcaption>The recap, as your players read it.</figcaption>
            </figure>
            <article className="nt-card nt-read" data-reveal>
              <p className="nt-card-label">Your table&apos;s read</p>
              <p>What the GM gets alongside it:</p>
              <ul>
                {READS.filter((_, i) => i !== 2).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* WHY: chapter band 1, with the one scroll-lit line */}
      <section id="why" className="nt-band">
        <div className="nt-wrap">
          <div className="nt-rule" aria-hidden />
          <h2 data-reveal>Your table already tells the story. This writes it down.</h2>
          <p className="nt-band-p" data-reveal>
            Nobody has to take notes. The Discord bot hears everyone, the Chrome extension catches every D&amp;D
            Beyond roll, and nothing reaches the wiki until you approve it.
          </p>
          <LitLine className="nt-lit" text="That Moderate fight left them on a third of their hit points. Your Moderates are landing like Hards." />
        </div>
      </section>

      {/* WIKI */}
      <Row id="wiki" title="A campaign wiki that writes itself" side="right"
        img="/screens/codex.png" w={1168} h={808}
        alt="The Codex editor: a faction page with linked NPCs and places, an image, and a reveal setting">
        <p>
          Every NPC the party meets, every place they go, every faction and thread and piece of loot gets
          captured from what was narrated and filed where you can find it. You approve what goes in. By
          session five you have the campaign bible you were never going to write.
        </p>
        <p>
          When it is worth sharing, publish it as a page anyone can read, no account needed. You choose
          exactly what appears, so the setting and the cast can go public while the things your players have
          not found yet stay yours.
        </p>
      </Row>

      {/* INSIGHT */}
      <Row id="insight" title="See who each player is at the table" side="left"
        img="/screens/dispositions.png" w={948} h={897}
        alt="Player disposition radar cards across the six axes for six characters in a demo campaign">
        <p>
          Which threads you have left hanging for four sessions. Who has not had a scene in a while. The
          things you half-notice on the night and have forgotten by the next one.
        </p>
        <p>
          It also builds a read of how each player engages, across six axes. It is not a score and no axis
          is the good one. It exists so you can give someone a scene that plays to what they actually enjoy.
        </p>
        <ul className="nt-axes">
          {TAVERN_ORDER.map((k) => (
            <li key={k}>
              <span className="nt-swatch" style={{ background: AXES[k].color }} aria-hidden />
              {AXES[k].tavernName}
              <span className="nt-facet">{AXES[k].facet}</span>
            </li>
          ))}
        </ul>
      </Row>

      {/* MAPS */}
      <Row id="maps" title="Build the world, four scales deep" side="right"
        img="/screens/worldmap.png" w={1057} h={818}
        alt="The world map editor with a painted continent, mountains, forests and coastlines, and a sidebar of map icons">
        <p>
          Generate a hex world from a seed, or paint biomes by hand up to 250 by 250, then have it rendered as
          a finished map. Drop pins, link each to a place or an NPC, and trace where a session actually went.
        </p>
        <p>
          City, dungeon, and building maps use the same brush-and-render loop. Inside a campaign it ties to
          your codex, your sessions, and what your players are allowed to see.
        </p>
      </Row>

      {/* TRUST: chapter band 2 */}
      <section id="trust" className="nt-band nt-band-trust">
        <div className="nt-wrap">
          <div className="nt-head" data-reveal>
            <h2>You&apos;re recording your table. We take that seriously.</h2>
            <p>All of it is spelled out in full on the <Link href="/privacy" className="nt-link">privacy page</Link>.</p>
          </div>
          <div className="nt-trust-grid">
            <figure className="nt-trust-shot" data-reveal>
              <img src="/screens/players/chat.png" width={776} height={500} loading="lazy"
                alt="The players' party chat, with a panel showing the GM sees nothing unless the players grant a time window" />
              <figcaption>Party chat: the GM sees nothing unless the players grant a window.</figcaption>
            </figure>
            <ul className="nt-trust">
              {POINTS.map((p) => (
                <li key={p.title} data-reveal>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* SYSTEMS */}
      <section id="systems" className="nt-sec">
        <div className="nt-wrap">
          <div className="nt-head" data-reveal>
            <h2>Works with your system</h2>
            <p>Honestly, because the depth varies by system.</p>
          </div>
          <div className="nt-sys">
          <div className="nt-tiers">
            <div data-reveal>
              <h3>Full toolset</h3>
              <p>Character builder, monsters or NPCs, encounter maths, system-correct dice.</p>
              <p className="nt-tier-list">{systemsDots(FULL_TOOLSET)}</p>
            </div>
            <div data-reveal>
              <h3>Themed table and dice</h3>
              <p>The right roller and the system&apos;s look, character and monster builders still to come.</p>
              <p className="nt-tier-list">{systemsDots(THEMED_TABLE)}</p>
            </div>
            <div data-reveal>
              <h3>Planned</h3>
              <p>On the roadmap, waiting on the publisher&apos;s permission before we can ship them.</p>
              <p className="nt-tier-list">{systemsDots(PLANNED)}</p>
            </div>
          </div>
          <figure className="nt-sys-shot" data-reveal>
            <img src="/screens/forge.png" width={821} height={848} loading="lazy"
              alt="The Forge character builder for D&D: identity, class, species, background and spells tabs, with rules and partnered content toggles" />
            <figcaption>The Forge, building a D&amp;D character.</figcaption>
          </figure>
          </div>
          <p className="nt-small nt-gap">
            The record, recap, wiki and player insight work the same on every system. System names are referenced
            for compatibility only; see the <Link href="/terms" className="nt-link">Terms</Link> for the Lancer,
            Daggerheart and Draw Steel attributions.
          </p>
          <div className="nt-integrations" data-reveal>
            <p><strong>Discord.</strong> The bot records your voice channel with each player on their own track.</p>
            <p><strong>D&amp;D Beyond and Roll20.</strong> Rolls come in through the browser extension, with no separate setup on the night.</p>
            <p><strong>Foundry VTT.</strong> A module pipes every roll straight in. <Link href="/foundry" className="nt-link">Set it up</Link></p>
          </div>
        </div>
      </section>

      {/* TOOLS */}
      <section id="tools" className="nt-sec">
        <div className="nt-wrap">
          <div className="nt-head" data-reveal>
            <h2>Small, sharp tools, no login</h2>
            <p>Some of what Six Axes does is useful on its own.</p>
          </div>
          <div className="nt-tools">
            {TOOLS.map((t) => (
              <Link key={t.href} href={t.href} className="nt-tool" data-reveal>{t.label}</Link>
            ))}
          </div>
          <p className="nt-gap"><Link href="/tools" className="nt-link nt-strong nt-solo">All the free tools</Link></p>
        </div>
      </section>

      {/* PILOT */}
      <section id="pilot" className="nt-sec">
        <div className="nt-wrap">
          <div className="nt-pilot-grid">
          <div className="nt-pilot" data-reveal>
            <h2>Looking for pilot tables</h2>
            <p>
              This is early. It works, it is in use at real tables, and it is not finished. What it needs most
              is more campaigns and honest feedback, including the unflattering kind. The pilot is
              invitation-based right now, so tell us about your table and we will get you in.
            </p>
            <div className="nt-ctas">
              <Link href="/pilot" className="nt-btn nt-btn-fill">Apply to the pilot</Link>
              <Link href="/tools" className="nt-btn nt-btn-ghost">Try the free tools first</Link>
            </div>
            <p className="nt-small">
              Six Axes is built by Terry Mickail at Kerf and Code. Questions first? Use the{" "}
              <Link href="/contact" className="nt-link">contact page</Link>.
            </p>
          </div>
          <figure className="nt-pilot-shot" data-reveal>
            <img src="/screens/players/checkin.png" width={497} height={899} loading="lazy"
              alt="The session check-in a player fills in after the game: a 1 to 5 rating and how much of the spotlight they got" />
          </figure>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="nt-foot">
        <div className="nt-wrap nt-foot-in">
          <span>Six Axes is made by <a href="https://kerfandcode.com" target="_blank" rel="noopener noreferrer" className="nt-link">Kerf and Code &#8599;</a>, a studio building other tools too.</span>
          <span className="nt-foot-links">
            <Link href="/features">Features</Link>
            <Link href="/players">For players</Link>
            <Link href="/tools">Free tools</Link>
            <Link href="/guides">Guides</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/about">About</Link>
            <Link href="/faq">FAQ</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </span>
        </div>
        {/* Groupfinder listing badge: a backlink to the Six Axes entry, tucked in the footer corner. */}
        <div className="nt-wrap nt-foot-badge">
          <a href="https://groupfinder.gg/library/six-axes" target="_blank" rel="noopener noreferrer" aria-label="Six Axes on Groupfinder">
            <img src="https://groupfinder.gg/images/badges/gf-badge-red.svg" alt="Listed on Groupfinder" height={40} loading="lazy" />
          </a>
        </div>
      </footer>
    </main>
  );
}

// ---- feature row: 60% capture, 40% text, alternating sides ----

function Row({
  id, title, side, img, w, h, alt, children,
}: {
  id: string; title: string; side: "left" | "right"; img: string; w: number; h: number; alt: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="nt-sec">
      <div className={`nt-wrap nt-row ${side === "left" ? "nt-row-left" : ""}`}>
        <div className="nt-row-copy" data-reveal>
          <h2>{title}</h2>
          {children}
        </div>
        <figure className="nt-row-shot" data-reveal>
          <img src={img} width={w} height={h} alt={alt} loading="lazy" />
        </figure>
      </div>
    </section>
  );
}

// ---- styles (palette C) ----

const CSS = `
.nt {
  --nt-bg: #0f141c; --nt-bg2: #151b25; --nt-band: #0a0e14;
  --nt-ink: #e8e4da; --nt-dim: #aeb4be; --nt-faint: #959daa;
  --nt-line: rgba(224,168,74,0.25); --nt-line2: rgba(174,180,190,0.16);
  --nt-amber: #e0a84a; --nt-amber-hi: #ecbf6e; --nt-amber-ink: #1a1206;
  --nt-display: var(--font-garamond, 'EB Garamond'), Georgia, serif;
  --nt-body: var(--font-source-sans, 'Source Sans 3'), system-ui, sans-serif;
  background: var(--nt-bg); color: var(--nt-ink); font-family: var(--nt-body);
  font-size: 18px; line-height: 1.6; min-height: 100vh; overflow-x: clip;
}
html { scroll-behavior: smooth; }
.nt *, .nt *::before, .nt *::after { box-sizing: border-box; }
.nt h1, .nt h2, .nt h3 { font-family: var(--nt-display); color: var(--nt-ink); margin: 0; letter-spacing: -0.01em; }
.nt p { margin: 0 0 14px; }
.nt-wrap { max-width: 1320px; margin: 0 auto; padding: 0 40px; }
@media (min-width: 1280px) { .nt-wrap { max-width: 1520px; padding-left: 236px; } }

/* top bar */
.nt-top { position: sticky; top: 0; z-index: 30; background: rgba(15,20,28,0.92); border-bottom: 1px solid var(--nt-line2); backdrop-filter: blur(6px); }
.nt-top-in { display: flex; align-items: center; justify-content: space-between; min-height: 68px; }
@media (min-width: 1280px) { .nt-top-in { padding-left: 40px; max-width: 1520px; } }
.nt-brandwrap { display: flex; flex-direction: column; gap: 0; }
.nt-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--nt-ink); font-family: var(--nt-display); font-weight: 700; font-size: 22px; }
.nt-mark { width: 30px; height: 30px; mix-blend-mode: screen; }
.nt-by { font-size: 13px; color: var(--nt-faint); text-decoration: none; padding-left: 40px; line-height: 1.2; }
.nt-by:hover { color: var(--nt-amber-hi); }
.nt-nav { display: flex; align-items: center; gap: 24px; }
.nt-navlink { font-size: 16px; color: var(--nt-dim); text-decoration: none; }
.nt-navlink:hover { color: var(--nt-ink); }

/* buttons */
.nt-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 50px; padding: 0 24px; border-radius: 8px;
  font-family: var(--nt-body); font-weight: 700; font-size: 17px; text-decoration: none; transition: background .2s, border-color .2s, color .2s; }
.nt-btn-fill { background: var(--nt-amber); color: var(--nt-amber-ink); box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 0 rgba(0,0,0,0.35); }
.nt-btn-fill:hover { background: var(--nt-amber-hi); }
.nt-btn-ghost { border: 1.5px solid rgba(232,228,218,0.45); color: var(--nt-ink); }
.nt-btn-ghost:hover { border-color: var(--nt-ink); }
.nt-btn-sm { min-height: 44px; padding: 0 16px; font-size: 15px; }
.nt a:focus-visible, .nt summary:focus-visible { outline: 2px solid var(--nt-amber-hi); outline-offset: 3px; }
.nt-link { color: var(--nt-amber-hi); text-decoration: underline; text-decoration-color: rgba(236,191,110,0.4); text-underline-offset: 3px; }
.nt-link:hover { text-decoration-color: currentColor; }
.nt-strong { font-weight: 700; }
.nt-small { font-size: 16px; color: var(--nt-faint); }
.nt-gap { margin-top: 22px !important; }

/* left rail (owner's scrollspy), fixed on wide screens only */
.home-rail { display: none; }
@media (min-width: 1280px) {
  .home-rail { display: block; position: fixed; top: 110px; left: max(28px, calc((100vw - 1520px) / 2 + 28px)); width: 176px; z-index: 20;
    padding: 10px 0; border-radius: 8px; background: rgba(10,14,20,0.6); }
}
.home-rail ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; border-left: 1px solid var(--nt-line2); }
.home-rail a { display: flex; align-items: center; gap: 10px; padding: 7px 12px; text-decoration: none; font-size: 14px;
  color: #c3c9d2; margin-left: -1px; border-left: 2px solid transparent; }
.home-rail .rail-dot { width: 6px; height: 6px; border-radius: 50%; background: #4b5463; flex: 0 0 auto; }
.home-rail li.is-active a { color: var(--nt-amber-hi); border-left-color: var(--nt-amber); }
.home-rail li.is-active .rail-dot { background: var(--nt-amber); }
.home-rail a:hover { color: var(--nt-ink); }

/* sections */
.nt-sec { scroll-margin-top: 84px; padding: 96px 0; }
.nt-sec-tint { background: var(--nt-bg2); }
.nt-head { max-width: 720px; margin-bottom: 36px; }
.nt-head h2, .nt-row-copy h2, .nt-pilot h2 { font-size: 46px; line-height: 1.06; font-weight: 800; margin-bottom: 14px; }
.nt-head p { color: var(--nt-dim); font-size: 19px; margin: 0; }

/* hero: 40 / 60 */
.nt-hero-sec { padding: 72px 0 48px; }
.nt-hero { display: grid; grid-template-columns: 2fr 3fr; gap: 56px; align-items: center; }
.nt-hero h1 { font-size: clamp(48px, 4.6vw, 72px); line-height: 1.02; font-weight: 800; }
.nt-sub { font-size: 21px; color: var(--nt-dim); margin: 22px 0 30px !important; max-width: 30em; }
.nt-ctas { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 16px; }
.nt-hero-shot { position: relative; margin: 0; padding-bottom: 36px; }
.nt-hero-shot img { display: block; height: auto; border-radius: 10px; box-shadow: 0 24px 60px rgba(0,0,0,0.6); }
.nt-shot-main { width: 100%; }
.nt-hero-shot figcaption { position: absolute; right: 0; bottom: 0; font-size: 15px; color: var(--nt-faint); }

/* proof bar */
.nt-proof-sec { padding: 0 0 24px; }
.nt-proof { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; border-top: 1px solid var(--nt-line2); border-bottom: 1px solid var(--nt-line2); }
.nt-proof div { display: flex; flex-direction: column-reverse; justify-content: flex-end; padding: 22px 24px; border-left: 1px solid var(--nt-line2); }
.nt-proof div:first-child { border-left: 0; padding-left: 0; }
.nt-proof dd { margin: 0; font-family: var(--nt-display); font-weight: 800; font-size: 46px; line-height: 1; color: var(--nt-ink); }
.nt-proof dt { color: var(--nt-dim); font-size: 16px; margin-top: 6px; }
.nt-proof-sec .nt-small { margin-top: 10px; }

/* how it works */
.nt-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 40px; }
.nt-steps li { border-top: 3px solid rgba(232,228,218,0.28); padding-top: 22px; }
.nt-steps h3 { font-size: 26px; line-height: 1.15; font-weight: 700; margin-bottom: 12px; }
.nt-steps p { color: var(--nt-dim); font-size: 17px; }

/* sample output */
.nt-sample { display: grid; grid-template-columns: 3fr 2fr; gap: 40px; align-items: start; }
.nt-card { background: #1b2230; border: 1px solid var(--nt-line2); border-radius: 10px; padding: 28px 30px; }
.nt-card-label { font-size: 16px; font-weight: 700; color: var(--nt-dim); margin-bottom: 10px !important; }
.nt-recap h3 { font-size: 30px; font-weight: 700; }
.nt-date { font-size: 16px; color: var(--nt-faint); margin-bottom: 16px !important; }
.nt-recap p { color: var(--nt-dim); font-size: 17px; }
.nt-open { font-style: italic; color: var(--nt-faint) !important; margin: 0 !important; }
.nt-read p { color: var(--nt-dim); }
.nt-read ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
.nt-read li { position: relative; padding-left: 22px; font-size: 18px; color: var(--nt-ink); }
.nt-read li::before { content: ""; position: absolute; left: 0; top: 10px; width: 9px; height: 9px; background: var(--nt-faint); transform: rotate(45deg); }

/* chapter bands */
.nt-band { background: var(--nt-band); padding: 152px 0; border-top: 1px solid var(--nt-line2); border-bottom: 1px solid var(--nt-line2); scroll-margin-top: 68px; }
.nt-rule { width: 72px; height: 3px; background: rgba(232,228,218,0.35); margin-bottom: 28px; }
.nt-band h2 { font-size: clamp(40px, 4vw, 60px); line-height: 1.04; font-weight: 800; max-width: 16em; }
.nt-band-p { color: var(--nt-dim); font-size: 20px; max-width: 34em; margin: 22px 0 0 !important; }
.nt-lit { font-family: var(--nt-display); font-size: clamp(32px, 3.4vw, 52px); line-height: 1.25; font-weight: 600; max-width: 24em; margin: 48px 0 0 !important; color: var(--nt-ink); }
.nt-lit .w { opacity: 0.25; transition: opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1); }
.nt-lit .w.on { opacity: 1; }
.nt-band-trust { padding: 96px 0; }
.nt-trust { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px 40px; }
.nt-trust h3 { font-size: 23px; font-weight: 700; margin-bottom: 8px; }
.nt-trust p { color: var(--nt-dim); font-size: 17px; margin: 0; }

/* feature rows: 60% capture, 40% text */
.nt-row { display: grid; grid-template-columns: 2fr 3fr; gap: 64px; align-items: center; }
.nt-row-left { grid-template-columns: 3fr 2fr; }
.nt-row-left .nt-row-shot { order: -1; }
.nt-row-copy p { color: var(--nt-dim); font-size: 18px; }
.nt-row-shot { margin: 0; }
.nt-row-shot img { display: block; width: 100%; height: auto; border-radius: 10px; box-shadow: 0 24px 60px rgba(0,0,0,0.6); }
.nt-axes { list-style: none; margin: 18px 0 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; }
.nt-axes li { display: flex; align-items: center; gap: 8px; font-size: 16px; color: var(--nt-ink); flex-wrap: wrap; }
.nt-swatch { width: 11px; height: 11px; border-radius: 2px; flex: 0 0 auto; }
.nt-facet { color: var(--nt-faint); font-size: 15px; }

/* systems */
.nt-sys { display: grid; grid-template-columns: 2fr 3fr; gap: 64px; align-items: start; }
.nt-tiers { display: grid; grid-template-columns: 1fr; gap: 28px; }
.nt-sys-shot { margin: 0; }
.nt-sys-shot img, .nt-split-shot img, .nt-trust-shot img, .nt-sample-shot img, .nt-pilot-shot img { display: block; width: 100%; height: auto; border-radius: 10px; box-shadow: 0 24px 60px rgba(0,0,0,0.6); }
.nt-sys-shot figcaption, .nt-trust-shot figcaption, .nt-sample-shot figcaption { font-size: 15px; color: var(--nt-faint); margin-top: 10px; }
.nt-split { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; }
.nt-split-shot { margin: 0 0 24px; aspect-ratio: 16 / 11; overflow: hidden; border-radius: 10px; }
.nt-split-shot img { height: 100%; object-fit: cover; object-position: top left; }
.nt-split h3 { font-size: 30px; font-weight: 700; margin-bottom: 10px; }
.nt-split p { color: var(--nt-dim); font-size: 18px; }
.nt-sample-shot { margin: 0; max-height: 640px; overflow: hidden; border-radius: 10px; }
.nt-trust-grid { display: grid; grid-template-columns: 2fr 3fr; gap: 56px; align-items: start; }
.nt-trust-shot { margin: 0; }
.nt-pilot-grid { display: grid; grid-template-columns: 3fr 2fr; gap: 64px; align-items: center; }
.nt-pilot-shot { margin: 0; display: flex; justify-content: center; }
.nt-pilot-shot img { width: auto; max-width: 100%; max-height: 560px; }
.nt-tiers > div { border-top: 1px solid var(--nt-line2); padding-top: 20px; }
.nt-tiers h3 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
.nt-tiers p { color: var(--nt-dim); font-size: 17px; }
.nt-tier-list { color: var(--nt-ink) !important; }
.nt-integrations { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 40px; margin-top: 48px; padding-top: 28px; border-top: 1px solid var(--nt-line2); }
.nt-integrations p { color: var(--nt-dim); font-size: 17px; margin: 0; }
.nt-integrations strong { color: var(--nt-ink); }

/* tools */
.nt-tools { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.nt-tool { display: flex; align-items: center; min-height: 64px; padding: 0 20px; border-radius: 8px; background: #1b2230; border: 1px solid var(--nt-line2);
  color: var(--nt-ink); text-decoration: none; font-weight: 600; font-size: 17px; transition: border-color .2s, color .2s; }
.nt-tool:hover { border-color: var(--nt-amber); color: var(--nt-amber-hi); }

/* pilot */
.nt-pilot { max-width: 760px; }
.nt-pilot p { color: var(--nt-dim); font-size: 19px; margin-bottom: 26px !important; }

/* footer */
.nt-foot { border-top: 1px solid var(--nt-line2); background: var(--nt-band); }
.nt-foot-in { display: flex; justify-content: space-between; gap: 18px; flex-wrap: wrap; padding-top: 28px; padding-bottom: 20px; font-size: 15px; color: var(--nt-faint); }
.nt-foot-links { display: flex; flex-wrap: wrap; gap: 4px 18px; }
.nt-foot-links a { color: var(--nt-dim); text-decoration: none; }
.nt-foot-links a:hover { color: var(--nt-amber-hi); }
.nt-foot-badge { display: flex; justify-content: flex-end; padding-bottom: 28px; }
.nt-foot-badge img { height: 40px; width: auto; display: block; opacity: 0.85; }

/* the shared mobile menu, re-toned for this page */
.nt .sax-mm-btn { border-color: var(--nt-line2); background: var(--nt-bg2); }
.nt .sax-mm-bars span { background: var(--nt-ink); }
.nt .sax-mm-panel { background: #151b25; border-color: var(--nt-line2); }
.nt .sax-mm-link { font-family: var(--nt-body); font-size: 17px; letter-spacing: 0; text-transform: none; color: var(--nt-ink); }
.nt .sax-mm-cta { background: var(--nt-amber) !important; color: var(--nt-amber-ink) !important; font-family: var(--nt-body) !important; min-height: 46px; display: flex; align-items: center; justify-content: center; }

/* reveal (A4): only once JS has marked the page, so nothing is hidden without it */
.nt-js [data-reveal] { opacity: 0; transform: translateY(24px); transition: opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1), transform 0.7s cubic-bezier(0.22, 1, 0.36, 1); }
.nt-js [data-reveal].is-in { opacity: 1; transform: none; }

@media (max-width: 980px) {
  .nt { font-size: 17px; }
  .nt-wrap { padding: 0 20px; }
  .nt-nav { gap: 0; margin-left: auto; }
  .nt-navlink { display: none; }
  .nt .sax-mm { display: block; }
  .nt .sax-mm-btn { width: 44px; height: 44px; margin-left: 10px; }
  .nt-top-in { gap: 8px; }
  .nt-sec { padding: 64px 0; }
  .nt-hero-sec { padding: 28px 0 32px; }
  .nt-hero { grid-template-columns: 1fr; gap: 28px; }
  .nt-hero h1 { font-size: 42px; }
  .nt-sub { font-size: 18px; margin: 14px 0 22px !important; }
  .nt-hero-shot { padding-bottom: 32px; }
  .nt-proof { grid-template-columns: 1fr; }
  .nt-proof div { border-left: 0; border-top: 1px solid var(--nt-line); padding: 14px 0; }
  .nt-proof div:first-child { border-top: 0; }
  .nt-proof dd { font-size: 36px; }
  .nt-head h2, .nt-row-copy h2, .nt-pilot h2 { font-size: 34px; }
  .nt-steps, .nt-tiers, .nt-trust, .nt-integrations, .nt-split, .nt-sys, .nt-trust-grid, .nt-pilot-grid { grid-template-columns: 1fr; gap: 28px; }
  .nt-sample-shot { max-height: 520px; }
  .nt-pilot-shot img { max-height: 460px; }
  .nt-sample { grid-template-columns: 1fr; }
  .nt-card { padding: 22px 20px; }
  .nt-row, .nt-row-left { grid-template-columns: 1fr; gap: 24px; }
  .nt-row-shot, .nt-row-left .nt-row-shot { order: -1; }
  .nt-band { padding: 72px 0; }
  .nt-band h2 { font-size: 36px; }
  .nt-tools { grid-template-columns: 1fr 1fr; }
  .nt-axes { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .nt-tools { grid-template-columns: 1fr; }
  .nt-by { display: none !important; }
  .nt-btn-sm { padding: 0 12px; font-size: 14px; }
}
/* phone tap targets: 44px for the brand, the byline, footer links and stand-alone text links */
@media (max-width: 980px) {
  .nt-brand, .nt-by, .nt-foot-links a, .nt-solo, .nt-foot-badge a, .nt-split .nt-link { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; }
  .nt-foot-links { gap: 0 20px; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .nt-js [data-reveal] { opacity: 1; transform: none; transition: none; }
  .nt-lit .w { opacity: 1; transition: none; }
  .nt-btn, .nt-tool { transition: none; }
}
/* Measure (round 3, F5/P8): no body line runs past about 85 characters at any width. */
.nt-head p, .nt-split article, .nt-steps li, .nt-row-copy, .nt-read, .nt-trust li, .nt-tiers > div, .nt-integrations p, .nt-pilot p, .nt-small { max-width: 34em; }
@media (min-width: 700px) and (max-width: 980px) { .nt-split, .nt-trust { grid-template-columns: 1fr 1fr; gap: 28px 32px; } }
`;
