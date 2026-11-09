import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { toolBreadcrumb } from "@/lib/seo";
import ToolCopy from "@/components/tools/tool-copy";
import { TOOL_COPY } from "@/lib/tools/tool-copy-content";
import BackgroundRemover from "@/components/background-remover";

// app/tools/background-remover/page.tsx (2026-11-08)
//
// The free background remover. Server shell (for search) around the client tool. No login, nothing
// uploaded: the picture is processed in the browser. /tools is on the middleware allowlist in
// lib/supabase/proxy.ts.

export const metadata: Metadata = {
  title: "Free background remover for character art and tokens",
  description:
    "Remove the background from character art, monsters and props in your browser. Click to clear leftover "
    + "patches, touch up with brushes, and download a full-size transparent PNG. Free, no login, nothing uploaded.",
  alternates: { canonical: "/tools/background-remover" },
};

export default function BackgroundRemoverPage() {
  return (
    <ToolsShell
      title="Background remover"
      tagline="Lift a character, monster or prop off its background, right in your browser, and download it full size."
    >
      <JsonLd data={toolBreadcrumb("Background remover", "background-remover")} />
      <BackgroundRemover />
      <ToolCopy {...TOOL_COPY["background-remover"]} />
    </ToolsShell>
  );
}
