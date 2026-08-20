import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { toolBreadcrumb } from "@/lib/seo";
import PacingCalculator from "@/components/pacing-calculator";

// app/tools/pacing/page.tsx
//
// The free session pacing tool. Server shell (for search) around the client calculator. No login, nothing
// saved. /tools is on the middleware allowlist in lib/supabase/proxy.ts.

export const metadata: Metadata = {
  title: "Free tabletop RPG session pacing calculator",
  description:
    "Plan your session and your arc: see whether tonight's encounters and scenes fit the clock, and "
    + "estimate how many sessions an arc will take. System-aware combat timing. Free, no login.",
  alternates: { canonical: "/tools/pacing" },
};

export default function PacingPage() {
  return (
    <ToolsShell
      title="Session and arc pacing"
      tagline="Will tonight's plan fit the clock, and how many sessions is this arc? Two quick calculators, system-aware."
    >
      <JsonLd data={toolBreadcrumb("Session and arc pacing", "pacing")} />
      <PacingCalculator />
    </ToolsShell>
  );
}
