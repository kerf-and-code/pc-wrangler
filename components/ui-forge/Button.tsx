"use client";

import React from "react";
import { stoneButton, type StoneButtonVariant } from "@/lib/forge-theme";

// components/ui-forge/Button.tsx
//
// The carved-stone button as one component, mapping the ~273 styled buttons in the app. It pairs
// stoneButton(variant) (the resting inline style) with the "forge-btn" class family that carries
// the hover/active/focus depth. Those class rules are injected once by PageShell via
// FORGE_BUTTON_CSS, so any button rendered inside a PageShell page gets the press for free; a
// button rendered outside a PageShell (a bare login/claim screen) still looks right at rest.
//
// variant: "stone" | "primary" | "danger" | "ghost"  (default "stone")
// size:    "md" (default) | "sm"

type Size = "md" | "sm";

const SIZE: Record<Size, React.CSSProperties> = {
  md: {},
  sm: { padding: "8px 14px", fontSize: 13 },
};

const VARIANT_CLASS: Record<StoneButtonVariant, string> = {
  stone: "",
  primary: "is-primary",
  danger: "is-danger",
  ghost: "is-ghost",
};

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: StoneButtonVariant;
  size?: Size;
};

const Button = React.forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "stone", size = "md", className, style, children, type, ...rest },
  ref,
) {
  const cls = ["forge-btn", VARIANT_CLASS[variant], className].filter(Boolean).join(" ");
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cls}
      style={{ ...stoneButton(variant), ...SIZE[size], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
});

export default Button;
