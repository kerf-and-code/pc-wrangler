import type { CSSProperties } from "react";
import { SAX, surfaces, stoneBackground } from "@/lib/theme";
import { C, FORGE_RADIUS, stoneField, forgeLabel, FORGE_BUTTON_CSS, STONE } from "@/lib/forge-theme";

// components/auth/auth-shell.tsx
//
// The shared dungeon frame for every auth page, so login, the error and success screens, and the
// password/sign-up forms all read as one product instead of the stock shadcn cards they shipped as.
// Mirrors the login page's frame: the stone wall, a brass-edged panel, the brand mark. Server
// component (no state); the interactive forms are client children rendered inside it.
//
// Exports the shared control styles (authField / authLabel / authButton via className, etc.) so the
// forms drop shadcn Card/Input/Label/Button and use the carved dungeon controls.

export const authHeading: CSSProperties = {
  textAlign: "center", fontFamily: SAX.serif, fontSize: 22, fontWeight: 600, color: C.text, margin: "0 0 6px",
};
export const authText: CSSProperties = { color: C.muted, fontSize: 14, lineHeight: 1.6 };
export const authLabel: CSSProperties = { ...forgeLabel, marginBottom: 6 };
export const authField: CSSProperties = { ...stoneField(), cursor: "text", colorScheme: "dark" };
export const authError: CSSProperties = { color: STONE.bloodLit, fontSize: 13, margin: 0 };
export const authLink: CSSProperties = { color: STONE.brassHi, textDecoration: "underline" };

export default function AuthShell({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh", color: C.text, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, fontFamily: SAX.serif, ...stoneBackground(),
      }}
    >
      <style>{FORGE_BUTTON_CSS}</style>
      <style>{`input::placeholder{color:${C.muted};opacity:0.85;}`}</style>
      <div style={{ ...surfaces.panel, width: "100%", maxWidth: 420, borderRadius: FORGE_RADIUS, padding: "36px 32px" }}>
        <img
          src="/six-axes-logo.png"
          alt=""
          width={44}
          height={44}
          style={{ display: "block", margin: "0 auto 10px", opacity: 0.92, filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}
        />
        <div style={{ textAlign: "center", fontFamily: SAX.serif, fontSize: 28, fontWeight: 600, color: C.text }}>Six Axes</div>
        <div style={{ textAlign: "center", fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.28em", textTransform: "uppercase", color: C.muted, marginBottom: 18 }}>
          Run the table
        </div>
        <div style={{ height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${C.brass}, ${C.plum})`, marginBottom: 24 }} />
        {title && <h1 style={authHeading}>{title}</h1>}
        {subtitle && <p style={{ ...authText, textAlign: "center", margin: "0 0 18px" }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
