import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { toolBreadcrumb } from "@/lib/seo";
import ToolCopy from "@/components/tools/tool-copy";
import { TOOL_COPY } from "@/lib/tools/tool-copy-content";
import DiceRoller from "@/components/dice-roller";

// app/tools/dice-roller/page.tsx
//
// The free dice roller. Server shell (for search) around the client roller. No login, nothing saved.
// /tools is on the middleware allowlist in lib/supabase/proxy.ts.

export const metadata: Metadata = {
  title: "Free online dice roller for tabletop RPGs",
  description:
    "A provably-fair dice roller for D&D 5e, Pathfinder 2e, Call of Cthulhu, Draw Steel, Daggerheart and "
    + "d10 pools. Advantage, degrees of success, Hope and Fear, power-roll tiers. Free, no login, nothing saved.",
  alternates: { canonical: "/tools/dice-roller" },
};

export default function DiceRollerPage() {
  return (
    <ToolsShell
      title="Dice roller"
      tagline="A fair roller for six systems: advantage, d100 skill checks, power rolls, Hope and Fear, and d10 pools."
    >
      <JsonLd data={toolBreadcrumb("Dice roller", "dice-roller")} />
      <DiceRoller />
      <ToolCopy {...TOOL_COPY["dice-roller"]} />
    </ToolsShell>
  );
}
