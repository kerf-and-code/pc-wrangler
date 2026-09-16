"use client";

import React from "react";
import { stoneField, forgeLabel } from "@/lib/forge-theme";

// components/ui-forge/Field.tsx
//
// The carved form controls as components, standardizing stoneField() (used directly on ~3 pages)
// and the ~250 raw inputs/selects/textareas that lean on the PageShell cascade. Each spreads
// stoneField() and merges a caller `style` last.
//
// THE NATIVE-ARROW DECISION. stoneField() sets appearance:none because the three Forge pages that
// call it draw their own dropdown arrow. App-wide, PageShell deliberately does NOT strip the native
// arrow, because 63 selects rely on it for affordance. So the shared Select here restores
// appearance:auto: it keeps the carved look and the native arrow, matching the app default rather
// than the Forge-only variant. A page that draws its own arrow can still override via `style`.

export function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <label style={{ ...forgeLabel, ...style }}>{children}</label>;
}

export const Field = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Field({ style, ...rest }, ref) {
    return <input ref={ref} style={{ ...stoneField(), ...style }} {...rest} />;
  },
);

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ style, ...rest }, ref) {
    return <textarea ref={ref} style={{ ...stoneField(), resize: "vertical", ...style }} {...rest} />;
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ style, children, ...rest }, ref) {
    return (
      <select ref={ref} style={{ ...stoneField(), appearance: "auto", ...style }} {...rest}>
        {children}
      </select>
    );
  },
);
