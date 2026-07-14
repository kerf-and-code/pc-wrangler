"use client";

import React, { Suspense } from "react";
import { SAX, stoneBackground } from "@/lib/theme";
import SixAxesNav from "@/components/six-axes-nav";

/* PageShell — the cellar frame every page sits in.
   Paints the stone wall, drops a warm vignette over the edges, mounts the nav,
   and centers the content. Pass `bg="/wall.png"` on the Power Room for the big
   single image; everything else uses the default further-back wall. */

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
    <div style={{ position: "relative", minHeight: "100dvh", color: SAX.text, fontFamily: SAX.serif, ...stoneBackground(bg) }}>
      <style>{`
        .sax-vignette{position:fixed;inset:0;pointer-events:none;z-index:0;
          background:radial-gradient(ellipse 78% 62% at 50% 38%, transparent 42%, rgba(6,3,10,0.55) 100%);}
        @media (prefers-reduced-motion: no-preference){
          .sax-pulse{animation:saxPulse 0.5s ease-out 3;}
        }
        @keyframes saxPulse{0%{transform:scale(1)}40%{transform:scale(1.1)}100%{transform:scale(1)}}
        @media (min-width:1024px){ .sax-shell{ padding-left:232px; } }
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
