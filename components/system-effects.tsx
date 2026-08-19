import React from "react";

// Per-system ambient EFFECTS layer: film grain, CRT scanlines, a HUD scan sweep, drifting motes and a
// slow glow pulse. One fixed, pointer-events:none overlay mounted ONCE at the app root (app/layout.tsx),
// so it covers every page with no per-page edits, the same way the palette/typography/structural layers do.
//
// KEYED ON data-system: SystemThemeProvider sets data-system on <html> from the active campaign (via
// setAttribute, which is reliable in the App Router, unlike the old head-injected stylesheet). Every rule
// below is scoped html[data-system="..."], so:
//   - no active campaign  -> attribute absent    -> nothing matches -> zero effects, zero animations.
//   - a D&D campaign      -> data-system="5e" etc -> nothing matches -> the dungeon look stays byte-identical.
//   - a themed system     -> its rules light up, and its animations run ONLY while it is active.
// The animation-name is applied inside the per-system rules (not on the base layer), so no infinite
// animation runs for a system that has that effect turned off.
//
// The <style> is rendered in the body (like PageShell's), not injected into <head>, so it lands reliably.
// Mote positions/timings are computed from the index (deterministic) so server and client render identically
// (no hydration mismatch) without Math.random.
//
// LICENSING: these are generic atmospheric treatments (grain, scanlines, embers, dust); they evoke each
// game's mood and reproduce no publisher art.

const MOTE_COUNT = 18;

export default function SystemEffects() {
  const motes = Array.from({ length: MOTE_COUNT }, (_, i) => {
    const left = (i * 53) % 100;              // spread across the width
    const delay = ((i * 7) % 90) / 10;        // 0 to 9s, staggered
    const dur = 9 + (i % 5) * 2;              // 9 to 17s
    const size = 2 + (i % 3);                 // 2 to 4px
    const drift = (i % 2 === 0 ? 1 : -1) * (6 + (i % 4) * 4); // sideways sway
    const style: React.CSSProperties = {
      left: `${left}%`,
      width: size,
      height: size,
      animationDelay: `${delay}s`,
      animationDuration: `${dur}s`,
    };
    (style as Record<string, string | number>)["--drift"] = `${drift}px`;
    return <span key={i} style={style} />;
  });

  return (
    <div className="sax-fx" aria-hidden="true">
      <div className="sax-fx-grain" />
      <div className="sax-fx-scan" />
      <div className="sax-fx-sweep" />
      <div className="sax-fx-pulse" />
      <div className="sax-fx-motes">{motes}</div>
      <style>{SYSTEM_EFFECTS_CSS}</style>
    </div>
  );
}

const SYSTEM_EFFECTS_CSS = `
.sax-fx{ position:fixed; inset:0; pointer-events:none; z-index:50; overflow:hidden; }
.sax-fx > div{ position:absolute; inset:0; }

/* FILM GRAIN: a tiling fractal-noise tile, laid over the whole app at a per-system opacity. overlay
   blend adds tooth without darkening; if a browser skips the blend it degrades to a faint noise. */
.sax-fx-grain{
  opacity:0;
  mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size:140px 140px;
}

/* CRT / PROJECTOR SCANLINES: thin dark lines every 3px, very low opacity. */
.sax-fx-scan{
  opacity:0;
  background:repeating-linear-gradient(0deg, rgba(0,0,0,0.55) 0 1px, transparent 1px 3px);
}

/* HUD SCAN SWEEP (Lancer): a soft teal band that travels down the screen. A band, not full height. */
.sax-fx-sweep{
  opacity:0;
  inset:0 0 auto 0;
  height:150px;
  background:linear-gradient(180deg, transparent, rgba(55,182,198,0.22), transparent);
}

/* SLOW GLOW PULSE (Vampire pool): a blood-red edge vignette that breathes. */
.sax-fx-pulse{
  opacity:0;
  background:radial-gradient(ellipse 92% 74% at 50% 50%, transparent 55%, rgba(165,31,44,0.5) 100%);
}

/* MOTES: dust / embers rising from the bottom. Base is inert; per-system rules colour them and switch
   the animation on, so the 18 elements only animate while their system is active. */
.sax-fx-motes{ opacity:0; }
.sax-fx-motes span{
  position:absolute;
  bottom:-14px;
  border-radius:50%;
  background:transparent;
  animation:none;
}

@keyframes saxSweep{
  from{ transform:translateY(-170px); }
  to{ transform:translateY(100vh); }
}
@keyframes saxPulse{
  0%,100%{ opacity:0.16; }
  50%{ opacity:0.42; }
}
@keyframes saxMote{
  0%{ transform:translateY(0) translateX(0); opacity:0; }
  12%{ opacity:1; }
  88%{ opacity:1; }
  100%{ transform:translateY(-100vh) translateX(var(--drift, 0)); opacity:0; }
}

/* ---------- per-system activation ---------- */

/* Lancer: scanlines + the teal HUD sweep, a whisper of grain. */
html[data-system="lancer"] .sax-fx-grain{ opacity:0.025; }
html[data-system="lancer"] .sax-fx-scan{ opacity:0.05; }
html[data-system="lancer"] .sax-fx-sweep{ opacity:1; animation:saxSweep 7s linear infinite; }

/* Call of Cthulhu: heavy old-film grain + a faint projector flicker line. */
html[data-system="coc7e"] .sax-fx-grain{ opacity:0.09; }
html[data-system="coc7e"] .sax-fx-scan{ opacity:0.035; }

/* Pathfinder 2e: warm grain + slow faint gold motes, like dust in a library shaft. */
html[data-system="pf2e"] .sax-fx-grain{ opacity:0.04; }
html[data-system="pf2e"] .sax-fx-motes{ opacity:0.55; }
html[data-system="pf2e"] .sax-fx-motes span{
  background:#e6c063;
  box-shadow:0 0 5px rgba(207,155,52,0.55);
  animation:saxMote infinite ease-in;
}

/* Draw Steel: forge embers rising, a touch of grain. */
html[data-system="drawsteel"] .sax-fx-grain{ opacity:0.03; }
html[data-system="drawsteel"] .sax-fx-motes{ opacity:0.78; }
html[data-system="drawsteel"] .sax-fx-motes span{
  background:#ff8a4a;
  box-shadow:0 0 6px rgba(240,110,50,0.85);
  animation:saxMote infinite ease-in;
}

/* Daggerheart: soft drifting gold dust, minimal grain. */
html[data-system="daggerheart"] .sax-fx-grain{ opacity:0.02; }
html[data-system="daggerheart"] .sax-fx-motes{ opacity:0.7; }
html[data-system="daggerheart"] .sax-fx-motes span{
  background:#f0cf78;
  box-shadow:0 0 6px rgba(240,207,120,0.75);
  animation:saxMote infinite ease-in;
}

/* Vampire pool (generic d10): grain + the slow blood pulse. */
html[data-system="poold10"] .sax-fx-grain{ opacity:0.055; }
html[data-system="poold10"] .sax-fx-pulse{ opacity:1; animation:saxPulse 6s ease-in-out infinite; }

/* Dark Matter: heavy derelict-ship grain + faint failing-console scanlines. */
html[data-system="darkmatter"] .sax-fx-grain{ opacity:0.06; }
html[data-system="darkmatter"] .sax-fx-scan{ opacity:0.04; }

/* Motion off: keep the static layers (grain, scanlines, a steady pulse tint), drop everything that moves. */
@media (prefers-reduced-motion: reduce){
  .sax-fx-sweep, .sax-fx-motes{ display:none; }
  html[data-system="poold10"] .sax-fx-pulse{ animation:none; opacity:0.3; }
}
`;
