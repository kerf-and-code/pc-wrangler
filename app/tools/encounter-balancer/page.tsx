import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import EncounterBalancer from "@/components/encounter-balancer";

// app/tools/encounter-balancer/page.tsx
//
// The free encounter balancer. Server-rendered shell (for search) wrapping the client tool. No login.
// Must be reachable logged-out: /tools is on the middleware allowlist in lib/supabase/proxy.ts.

export const metadata: Metadata = {
  title: "Encounter balancer for D&D 5e and Pathfinder 2e",
  description:
    "Free encounter balancer. Add your party and the monsters, and see whether the fight is Easy, Hard or "
    + "deadly, using the real 2024 and 2014 D&D methods and Pathfinder 2e's budget. No login, nothing saved.",
  alternates: { canonical: "/tools/encounter-balancer" },
};

export default function EncounterBalancerPage() {
  return (
    <ToolsShell
      title="Encounter balancer"
      tagline="Add your table and the fight, and see how hard it really lands. The same math Six Axes uses in-app."
    >
      <EncounterBalancer />
    </ToolsShell>
  );
}
