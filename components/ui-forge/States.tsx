import React from "react";
import { surfaces } from "@/lib/theme";
import { C } from "@/lib/forge-theme";

// components/ui-forge/States.tsx
//
// The three async states every data page hand-rolls: loading, empty, and error. Each is the same
// slate box the pages already use, with the right text tone. Replaces ~115 bespoke "Loading..."
// sites, ~38 empty-state strings, and scattered catch-to-UI, and folds in the accessibility these
// almost always missed: LoadingState announces politely, ErrorState is a live alert.

const boxBase: React.CSSProperties = { ...surfaces.slate, padding: 20, color: C.muted, fontSize: 14 };

export function LoadingState({ label = "Loading…", style }: { label?: string; style?: React.CSSProperties }) {
  return (
    <div role="status" aria-live="polite" style={{ ...boxBase, ...style }}>
      {label}
    </div>
  );
}

export function EmptyState({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ ...boxBase, lineHeight: 1.6, ...style }}>{children}</div>;
}

export function ErrorState({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div role="alert" style={{ ...boxBase, color: C.warn, border: `1px solid ${C.warn}`, lineHeight: 1.6, ...style }}>
      {children}
    </div>
  );
}
