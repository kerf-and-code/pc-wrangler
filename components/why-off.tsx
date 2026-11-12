// components/why-off.tsx (2026-11-12, push 49: audit round 2, U12)
//
// The reason a button is greyed out, shown as a short line beside it. The reason used to live only in
// the button's hover title, which a phone never shows and a keyboard user rarely sees. Renders nothing
// when there is no reason. Keep the title too: it costs nothing on a desktop.

import React from "react";
import { C } from "@/lib/forge-theme";

export function WhyOff({ reason, style }: { reason: string | null | undefined | false; style?: React.CSSProperties }) {
  if (!reason) return null;
  return <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.4, ...style }}>{reason}</span>;
}
