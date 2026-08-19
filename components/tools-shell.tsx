import Link from "next/link";

// components/tools-shell.tsx
//
// The shared frame every free tool sits in. No auth, no database, no account: these pages exist to be
// found in search and used on the spot, then to breadcrumb the visitor toward the pilot. Set in the same
// plain document register as the landing page (cream, serif), NOT the in-app dungeon chrome, because a
// visitor arriving from a search result is reading, not playing.
//
// Every tool passes a title and a one-line tagline; the shell supplies the eyebrow, the back-link to the
// tools hub, the pilot CTA, and the footer breadcrumb, so each tool page only writes its own body.

export default function ToolsShell({
  title,
  tagline,
  hideHubLink,
  children,
}: {
  title: string;
  tagline?: string;
  hideHubLink?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main style={page}>
      <div style={wrap}>
        <header style={{ marginBottom: 28 }}>
          <div style={topRow}>
            <Link href="/" style={brandLink}>Six Axes</Link>
            <span style={topDot}>·</span>
            <span style={eyebrow}>Free tools</span>
            {!hideHubLink && (
              <Link href="/tools" style={hubLink}>All tools</Link>
            )}
          </div>
          <h1 style={h1}>{title}</h1>
          {tagline && <p style={lede}>{tagline}</p>}
        </header>

        {children}

        <section style={cta}>
          <p style={ctaLead}>These tools run on a slice of what Six Axes does at the table.</p>
          <p style={ctaBody}>
            The full product records your session, writes the recap, keeps the campaign wiki, and reads how
            your table actually plays, across whatever system you run. It is in free pilot now.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
            <Link href="/pilot" style={ctaBtn}>Join the pilot</Link>
            <Link href="/" style={ctaGhost}>What is Six Axes?</Link>
          </div>
        </section>

        <footer style={footer}>
          <p style={{ margin: 0 }}>
            <Link href="/tools" style={link}>All free tools</Link>
            {" · "}
            <Link href="/" style={link}>Overview</Link>
            {" · "}
            <Link href="/pilot" style={link}>Join the pilot</Link>
          </p>
          <p style={{ margin: "8px 0 0", color: "#9a9078" }}>
            No account, nothing saved. System names are referenced for compatibility only.
          </p>
        </footer>
      </div>
    </main>
  );
}

const page: React.CSSProperties = {
  minHeight: "100vh", background: "#f6f2e9", color: "#2a2620",
  padding: "44px 20px 64px",
  fontFamily: "'Iowan Old Style', Georgia, 'Times New Roman', serif",
};
const wrap: React.CSSProperties = { maxWidth: 760, margin: "0 auto" };
const topRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" };
const brandLink: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, letterSpacing: "0.2em",
  textTransform: "uppercase", color: "#8a7a55", textDecoration: "none",
};
const topDot: React.CSSProperties = { color: "#c3b48f" };
const eyebrow: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, letterSpacing: "0.2em",
  textTransform: "uppercase", color: "#8a7a55",
};
const hubLink: React.CSSProperties = { marginLeft: "auto", color: "#8a6a2f", fontSize: 14, textDecoration: "none" };
const h1: React.CSSProperties = { fontSize: 36, lineHeight: 1.15, margin: "0 0 10px", fontWeight: 600 };
const lede: React.CSSProperties = { fontSize: 18, lineHeight: 1.6, color: "#4a443a", margin: 0 };
const cta: React.CSSProperties = { marginTop: 40, padding: "24px 0 0", borderTop: "1px solid #ddd4c2" };
const ctaLead: React.CSSProperties = { fontSize: 17, fontWeight: 600, color: "#2a2620", margin: "0 0 6px" };
const ctaBody: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.65, color: "#4a443a", margin: 0 };
const ctaBtn: React.CSSProperties = {
  display: "inline-block", background: "#3a352c", color: "#f6f2e9", padding: "11px 22px", borderRadius: 3,
  textDecoration: "none", fontFamily: "ui-monospace, monospace", fontSize: 13, letterSpacing: "0.08em",
  textTransform: "uppercase",
};
const ctaGhost: React.CSSProperties = {
  ...ctaBtn, background: "transparent", color: "#3a352c", border: "1px solid #c9bfa8",
};
const link: React.CSSProperties = { color: "#8a6a2f" };
const footer: React.CSSProperties = {
  marginTop: 34, paddingTop: 18, borderTop: "1px solid #ddd4c2", fontSize: 13.5, color: "#8a8069",
};
