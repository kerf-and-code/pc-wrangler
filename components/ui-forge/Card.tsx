import React from "react";
import { surfaces } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

// components/ui-forge/Card.tsx
//
// The carved-stone card, as one component. Three surfaces cover every card in the app:
//   "surface" (default) reproduces the hand-pasted inline pattern found ~88 times:
//              background C.surface, a 1px C.line border, FORGE_RADIUS, and the carved boxShadow.
//   "panel"   spreads surfaces.panel  (the translucent wall-reading plate).
//   "slate"   spreads surfaces.slate  (flatter and more opaque, for panels holding charts).
//
// Padding is deliberately NOT baked in: call sites set their own, so Card is a drop-in wrapper
// that changes nothing visually when it replaces an inline card. Pass `style` to add padding,
// margin, layout, or to override anything (it merges last and wins).

// The exact carved boxShadow string pasted inline across the app. Exported so a page that needs
// the raw value (a non-div element that should read as carved) can reuse it without repasting.
export const CARD_SHADOW =
  "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)";

export type CardVariant = "surface" | "panel" | "slate";

type Props = React.HTMLAttributes<HTMLDivElement> & { variant?: CardVariant };

function baseFor(variant: CardVariant): React.CSSProperties {
  if (variant === "panel") return { ...surfaces.panel };
  if (variant === "slate") return { ...surfaces.slate };
  return {
    background: C.surface,
    border: `1px solid ${C.line}`,
    borderRadius: FORGE_RADIUS,
    boxShadow: CARD_SHADOW,
  };
}

export default function Card({ variant = "surface", style, children, ...rest }: Props) {
  return (
    <div style={{ ...baseFor(variant), ...style }} {...rest}>
      {children}
    </div>
  );
}
