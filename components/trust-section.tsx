import Link from "next/link";
import { SAX, STONE } from "@/lib/theme";
import { FORGE_FONTS, forgeHeading } from "@/lib/forge-theme";

// components/trust-section.tsx
//
// The trust story, surfaced. Everything here is stated plainly on /privacy already; the point of this
// section is that a GM weighing "you want to record my table's voices" should not have to dig through a
// policy to find the reassurance. Every claim is deliberately conservative and matches the privacy page
// (note: "in transit", because encryption at rest is not claimed there). Server-rendered.

type Point = { title: string; body: string };

const POINTS: Point[] = [
  {
    title: "Everyone opts in, every time",
    body: "No one is recorded until they have agreed, and anyone at the table can stop it at any point in the session.",
  },
  {
    title: "The audio is on a clock",
    body: "Recordings delete themselves 60 days after the session. Only the transcript and the moments you choose to keep stay.",
  },
  {
    title: "Never used to train AI",
    body: "The services that transcribe and analyze your sessions do not train their models on your table's data.",
  },
  {
    title: "Encrypted on the way",
    body: "Your session data is encrypted in transit between your table and us.",
  },
  {
    title: "Yours to take, or to erase",
    body: "Export everything as a single file whenever you want. Delete your account and your personal data and recordings go with it.",
  },
  {
    title: "No mystery vendors",
    body: "Every outside service that touches your data is named in the privacy policy, with exactly what it does.",
  },
];

export default function TrustSection() {
  return (
    <div>
      <p style={eyebrow}>Your data, handled straight</p>
      <h2 style={h2}>You&apos;re recording your table. We take that seriously.</h2>
      <p style={lead}>The reassurance a GM actually wants, in plain terms. All of it is spelled out in full on the privacy page.</p>
      <div style={grid}>
        {POINTS.map((p) => (
          <div key={p.title} style={item}>
            <span style={mark} aria-hidden />
            <div>
              <div style={itemTitle}>{p.title}</div>
              <p style={body}>{p.body}</p>
            </div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 18 }}>
        <Link href="/privacy" style={link}>Read the full privacy policy →</Link>
      </p>
    </div>
  );
}

const eyebrow: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase",
  color: SAX.brass, margin: "0 0 10px",
};
const h2: React.CSSProperties = { ...forgeHeading, fontFamily: FORGE_FONTS.display, fontSize: 30, margin: "0 0 6px", lineHeight: 1.18 };
const lead: React.CSSProperties = { fontSize: 14.5, color: SAX.brass, fontStyle: "italic", margin: "0 0 20px", fontFamily: FORGE_FONTS.body };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "18px 26px" };
const item: React.CSSProperties = { display: "flex", gap: 12, alignItems: "flex-start" };
const mark: React.CSSProperties = {
  flex: "0 0 auto", width: 10, height: 10, marginTop: 6, transform: "rotate(45deg)",
  background: `linear-gradient(135deg, ${STONE.brassHi}, ${STONE.brassDeep})`,
  boxShadow: `0 0 0 2px ${STONE.mortar}, 0 0 10px rgba(184,135,74,0.5)`,
};
const itemTitle: React.CSSProperties = {
  fontFamily: FORGE_FONTS.display, fontWeight: 700, fontSize: 17, color: STONE.ink,
  margin: "0 0 4px", letterSpacing: "0.02em",
};
const body: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.6, color: STONE.inkDim, margin: 0, fontFamily: FORGE_FONTS.body };
const link: React.CSSProperties = { color: STONE.brassHi, textDecoration: "none", fontFamily: FORGE_FONTS.body, fontSize: 15 };
