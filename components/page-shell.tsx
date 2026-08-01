"use client";

import React, { Suspense } from "react";
import { SAX } from "@/lib/theme";
import { forgeBackground, FORGE_FONTS, STONE, FORGE_BUTTON_CSS } from "@/lib/forge-theme";
import SixAxesNav from "@/components/six-axes-nav";

/* PageShell — the cellar frame every page sits in.
   Paints the stone wall, drops a warm vignette over the edges, mounts the nav,
   and centers the content. Pass `bg="/wall.png"` on the Power Room for the big
   single image; everything else uses the default further-back wall.

   The wall is now painted with forgeBackground() rather than stoneBackground(). Both draw the SAME
   /wall-2.png; they differed only in the wash laid over it — stoneBackground tinted it cool and
   purple to sit with the SAX palette, forgeBackground tints it warm to sit with the dungeon one.
   Since the Forge, the stat-block builder and the PC library already use the warm frame, this is
   what makes the rest of the app share a room with them rather than merely resemble one.

   Body type moves to the Forge stack for the same reason, and text/link colour to STONE so the
   default a page inherits is already on-palette before it sets anything of its own. */

export default function PageShell({
  children,
  bg = "/wall-2.png",
  width = 920,
}: {
  children: React.ReactNode;
  bg?: string;
  width?: number;
}) {
  return (
    <div style={{ position: "relative", minHeight: "100dvh", color: STONE.ink, fontFamily: FORGE_FONTS.body, ...forgeBackground(bg) }}>
      <style>{FORGE_BUTTON_CSS}</style>
      <style>{`
        .sax-vignette{position:fixed;inset:0;pointer-events:none;z-index:0;
          background:radial-gradient(ellipse 78% 62% at 50% 38%, transparent 42%, rgba(6,3,10,0.55) 100%);}
        @media (prefers-reduced-motion: no-preference){
          .sax-pulse{animation:saxPulse 0.5s ease-out 3;}
        }
        @keyframes saxPulse{0%{transform:scale(1)}40%{transform:scale(1.1)}100%{transform:scale(1)}}
        @media (min-width:1024px){ .sax-shell{ padding-left:232px; } }
        /* Links inherit the interactive brass rather than the browser default. Element selectors
           only, so any page setting its own colour inline still wins — this is a floor, not an
           override. */
        .sax-shell a{ color:${STONE.brassHi}; }
        .sax-shell a:hover{ color:${SAX.brass}; }
        /* The PRESS on every button. :active cannot be expressed in an inline style, so the depth
           the Monster Maker has could never reach the pages that style buttons inline. This is the
           one case where the cascade is the right tool rather than a workaround.
           It sets TRANSFORM only, deliberately: transform is not among the properties the pages set
           inline, so this rule actually wins. box-shadow IS set inline on those buttons, so a
           shadow rule here would silently lose and is not attempted. */
        /* CARVED DEPTH ON EVERY BUTTON.
           An earlier pass carved ui.btnPrimary/btnGhost in lib/theme and it changed nothing,
           because NOTHING IN THE APP USES THEM: 38 files render buttons and all of them style
           inline. That also means almost nothing sets box-shadow inline (6 references app-wide),
           so unlike colour or radius, SHADOW is a property the cascade actually wins. This is the
           only lever that reaches every button without editing 38 files.
           Kept deliberately moderate rather than the full Forge lip: 12 of the app's buttons are
           transparent ghosts and 15 are filled, and one rule has to read as carved on both. A page
           wanting the full treatment uses stoneButton() and its inline shadow overrides this. */
        .sax-shell button:not(:disabled){
          box-shadow:
            inset 0 1px 0 rgba(255,235,200,0.16),
            inset 0 -2px 3px rgba(0,0,0,0.42),
            inset 0 0 0 1px rgba(0,0,0,0.35),
            0 3px 0 -1px rgba(23,19,13,0.9),
            0 4px 6px rgba(0,0,0,0.45);
          transition:transform 0.06s ease, box-shadow 0.06s ease, color 0.15s ease;
        }
        .sax-shell button:not(:disabled):hover{ filter:brightness(1.08); }
        .sax-shell button:not(:disabled):active{
          transform:translateY(2px);
          box-shadow:
            inset 0 1px 0 rgba(255,235,200,0.10),
            inset 0 2px 6px rgba(0,0,0,0.55),
            inset 0 0 0 1px rgba(0,0,0,0.45);
        }
        .sax-shell button:focus-visible{ outline:2px solid ${SAX.brass}; outline-offset:3px; }
      `}</style>
      <div className="sax-vignette" />
      <div className="sax-shell" style={{ position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: width, margin: "0 auto", padding: "28px 20px 64px" }}>
          <Suspense fallback={null}><SixAxesNav /></Suspense>
          {children}
        </div>
      </div>
    </div>
  );
}
