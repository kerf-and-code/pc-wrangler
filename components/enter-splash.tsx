"use client";

import React, { useState } from "react";
import { SAX, stoneBackground } from "@/lib/theme";
import LeverSwitch from "@/components/lever-switch";

/* EnterSplash — the "pull to enter the dungeon" moment. Full-screen over the big
   wall image; throw the breaker and it fades out, then calls onEnter (navigate
   into the app, dismiss the splash, whatever you pass). */

export default function EnterSplash({
  onEnter,
  title = "Six Axes",
  tagline = "run the table",
}: {
  onEnter: () => void;
  title?: string;
  tagline?: string;
}) {
  const [leaving, setLeaving] = useState(false);

  const enter = () => {
    setLeaving(true);
    window.setTimeout(onEnter, 500);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
        color: SAX.text, ...stoneBackground("/wall.png"),
        opacity: leaving ? 0 : 1, transition: "opacity 0.5s ease",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 6 }}>
        <div style={{ fontFamily: SAX.serif, fontSize: 34, fontWeight: 700, color: SAX.text }}>{title}</div>
        <div style={{ fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.28em", textTransform: "uppercase", color: SAX.muted, marginTop: 6 }}>
          {tagline}
        </div>
      </div>
      <LeverSwitch onEnter={enter} />
    </div>
  );
}
