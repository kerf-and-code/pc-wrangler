import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { toolBreadcrumb } from "@/lib/seo";
import PartyCoverage from "@/components/party-coverage";

// app/tools/party-coverage/page.tsx
//
// The free party coverage check. Server shell (for search) around the client tool. No login, nothing
// saved. /tools is on the middleware allowlist in lib/supabase/proxy.ts.

export const metadata: Metadata = {
  title: "Free party coverage check for tabletop RPGs",
  description:
    "Enter your party and see the gaps: no healer, no front line, no face. Works across D&D 5e, "
    + "Pathfinder 2e, Draw Steel, Daggerheart and Call of Cthulhu. Free, no login, nothing saved.",
  alternates: { canonical: "/tools/party-coverage" },
};

export default function PartyCoveragePage() {
  return (
    <ToolsShell
      title="Party coverage check"
      tagline="Enter the party and see the holes: no healer, no front line, no face. Pick your system, then the classes."
    >
      <JsonLd data={toolBreadcrumb("Party coverage check", "party-coverage")} />
      <PartyCoverage />
    </ToolsShell>
  );
}
