import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { toolBreadcrumb } from "@/lib/seo";
import CompendiumTool from "@/components/compendium-tool";

// app/tools/compendium/page.tsx
//
// The offline rules compendium: type a spell, item, or condition and get an instant card. Server shell
// (for search) around the client tool. No login, nothing saved, data is SRD 5.1 (CC-BY) served from
// public/compendium/. /tools is on the middleware allowlist in lib/supabase/proxy.ts. The voice (Vosk)
// mic drops onto the same lookup path in the next increment.

export const metadata: Metadata = {
  title: "Offline D&D rules compendium: instant spell, item, and condition lookup",
  description:
    "Look up any SRD 5.1 spell, magic item, or condition and get an instant reference card. Fast, offline, "
    + "no login, nothing saved. Built for DMs who need a rule at the table without breaking pace.",
  alternates: { canonical: "/tools/compendium" },
};

export default function CompendiumPage() {
  return (
    <ToolsShell
      title="Rules compendium"
      tagline="Type a spell, item, or condition and get an instant card. Offline, no login, nothing saved."
    >
      <JsonLd data={toolBreadcrumb("Rules compendium", "compendium")} />
      <CompendiumTool />
    </ToolsShell>
  );
}
