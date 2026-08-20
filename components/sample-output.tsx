import { SAX, STONE, surfaces } from "@/lib/theme";
import { FORGE_FONTS, stonePanel, forgeHeading } from "@/lib/forge-theme";

// components/sample-output.tsx
//
// "Show, don't tell." Every other section describes what Six Axes produces; this one puts an actual
// example on the page: the recap it drafts, and the read on the table it gives. Clearly labelled as a
// demo campaign so it never reads as a real customer's data. Server-rendered.

const RECAP = [
  "The party finally reached the flooded undervault beneath Emberhold, guided by the map Gnarl the innkeeper sold them two sessions back. Mirella picked the rusted lock while Tharn braced the collapsing archway, buying just enough time for everyone to slip through before it came down.",
  "Below, they disturbed a shrine to the Ashen Hand and woke its guardian, a drowned knight that nearly dropped Bram before Kessa's thunderous rebuke turned the fight. They left with the Tidewrought Signet and a warning carved in old Draconic that no one could yet read.",
];

const OPEN = "Open threads: the Ashen Hand knows the party was here, Bram is down to his last two healing draughts, and Gnarl still hasn't said how he knew the vault existed.";

const READS = [
  "Tharn hasn't had a scene to himself in three sessions.",
  "The party is sitting on 2,400 gp of unspent loot, most of it Kessa's.",
  "That “Moderate” fight left them at a third of their hit points. Your Moderate encounters are landing like Hard ones.",
];

export default function SampleOutput() {
  return (
    <div>
      <p style={eyebrow}>See what comes out</p>
      <h2 style={h2}>What lands the morning after</h2>
      <p style={lead}>The recap your players actually read, and the read on your table only Six Axes can give. An example from a demo campaign.</p>

      <div style={grid}>
        {/* the recap */}
        <div style={{ ...stonePanel(), padding: "22px 24px" }}>
          <div style={cardLabel}>Recap · auto-drafted</div>
          <h3 style={recapTitle}>Session 7 — The Sunken Vault</h3>
          <div style={recapDate}>Emberhold · Nov 3</div>
          {RECAP.map((p, i) => <p key={i} style={recapBody}>{p}</p>)}
          <p style={{ ...recapBody, color: STONE.inkFaint, fontStyle: "italic", margin: 0 }}>{OPEN}</p>
        </div>

        {/* the read */}
        <div style={{ ...surfaces.slate, padding: "22px 24px", borderRadius: 4 }}>
          <div style={cardLabel}>Your table&apos;s read</div>
          <p style={{ ...recapBody, marginTop: 0 }}>Things you half-notice on the night and forget by the next one:</p>
          <div style={{ display: "grid", gap: 14, marginTop: 4 }}>
            {READS.map((r, i) => (
              <div key={i} style={readRow}>
                <span style={mark} aria-hidden />
                <span style={readText}>{r}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const eyebrow: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase", color: SAX.brass, margin: "0 0 10px",
};
const h2: React.CSSProperties = { ...forgeHeading, fontFamily: FORGE_FONTS.display, fontSize: 30, margin: "0 0 6px", lineHeight: 1.18 };
const lead: React.CSSProperties = { fontSize: 14.5, color: SAX.brass, fontStyle: "italic", margin: "0 0 20px", fontFamily: FORGE_FONTS.body };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, alignItems: "start" };
const cardLabel: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: SAX.brass, marginBottom: 10,
};
const recapTitle: React.CSSProperties = {
  fontFamily: FORGE_FONTS.display, fontWeight: 700, fontSize: 21, color: STONE.ink, margin: "0 0 2px", letterSpacing: "0.02em",
};
const recapDate: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 12, color: STONE.inkFaint, marginBottom: 14 };
const recapBody: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.66, color: STONE.inkDim, margin: "0 0 12px", fontFamily: FORGE_FONTS.body };
const readRow: React.CSSProperties = { display: "flex", gap: 11, alignItems: "flex-start" };
const mark: React.CSSProperties = {
  flex: "0 0 auto", width: 9, height: 9, marginTop: 6, transform: "rotate(45deg)",
  background: `linear-gradient(135deg, ${STONE.brassHi}, ${STONE.brassDeep})`,
  boxShadow: `0 0 0 2px ${STONE.mortar}`,
};
const readText: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.55, color: STONE.ink, fontFamily: FORGE_FONTS.body };
