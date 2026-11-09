import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { toolBreadcrumb } from "@/lib/seo";
import ToolCopy from "@/components/tools/tool-copy";
import { TOOL_COPY } from "@/lib/tools/tool-copy-content";
import TokenMaker from "@/components/token-maker";

// app/tools/token-maker/page.tsx (2026-11-08)
//
// The free token maker. Server shell (for search) around the client maker. No login, nothing uploaded:
// the picture, the background removal and the exports all stay in the browser. /tools is on the
// middleware allowlist in lib/supabase/proxy.ts.

export const metadata: Metadata = {
  title: "Free token maker for D&D and virtual tabletops",
  description:
    "Make a token from any picture: remove the background, cut it to a circle, hexagon or shield, and add a "
    + "class-inspired border with animated fire, lightning, acid or radiant effects. Download PNG or video. Free, no login.",
  alternates: { canonical: "/tools/token-maker" },
};

export default function TokenMakerPage() {
  return (
    <ToolsShell
      title="Token maker"
      tagline="Lift a picture off its background, cut it to a shape, and frame it: class-inspired borders and animated damage-type effects."
    >
      <JsonLd data={toolBreadcrumb("Token maker", "token-maker")} />
      <TokenMaker mode="free" />
      <ToolCopy {...TOOL_COPY["token-maker"]} />
    </ToolsShell>
  );
}
