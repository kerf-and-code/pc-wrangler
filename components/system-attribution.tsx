import Link from "next/link";
import { STONE, FORGE_FONTS } from "@/lib/forge-theme";
import { attributionFor } from "@/lib/systems/attribution";

// The compact license-attribution line shown in the Forge for the active system. It surfaces the notice
// where the mechanics are actually used and links to the full /licenses page. Systems that ship no
// licensed content (e.g. the generic dice pool) have no attribution, so the line renders nothing.
// Presentational and dependency-light, so it works in the client Forge page.
export default function SystemAttribution({ system }: { system: string | null | undefined }) {
  const a = attributionFor(system);
  if (!a) return null;
  return (
    <p
      style={{
        fontFamily: FORGE_FONTS.mono,
        fontSize: 11.5,
        lineHeight: 1.5,
        color: STONE.inkFaint,
        margin: "16px 0 0",
      }}
    >
      {a.short}{" "}
      <Link href="/licenses" style={{ color: STONE.brassHi, textDecoration: "none" }}>
        Full game system licenses &rarr;
      </Link>
    </p>
  );
}
