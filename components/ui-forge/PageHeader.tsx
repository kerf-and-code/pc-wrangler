import React from "react";
import { ui } from "@/lib/theme";
import { C } from "@/lib/forge-theme";

// components/ui-forge/PageHeader.tsx
//
// The page title block every screen repeats: an optional mono eyebrow, the Iowan display h1
// (ui.h1, now the real 28 the pages were all overriding to), and an optional subtitle. Using this
// ends the "spread ui.h1 then override fontSize to 28" pattern across ~152 heading tags and gives
// every page one heading size instead of by-eye variants.
//
// Pass `titleStyle` only for a deliberate one-off (a hero that really is larger); the default is
// the app title size.

type Props = {
  eyebrow?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  titleStyle?: React.CSSProperties;
  subStyle?: React.CSSProperties;
};

export default function PageHeader({ eyebrow, title, sub, titleStyle, subStyle }: Props) {
  return (
    <div>
      {eyebrow ? <div style={ui.eyebrow}>{eyebrow}</div> : null}
      <h1 style={{ ...ui.h1, ...titleStyle }}>{title}</h1>
      {sub ? (
        <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, margin: "0 0 18px", maxWidth: 720, ...subStyle }}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}
