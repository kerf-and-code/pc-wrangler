import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { toolBreadcrumb } from "@/lib/seo";
import ToolCopy from "@/components/tools/tool-copy";
import { TOOL_COPY } from "@/lib/tools/tool-copy-content";
import SessionZero from "@/components/session-zero";

// app/tools/session-zero/page.tsx
//
// The free Session Zero tool. Server shell (for search) around the client tool. No login, nothing saved.
// /tools is on the middleware allowlist in lib/supabase/proxy.ts.

export const metadata: Metadata = {
  title: "Free session zero checklist and table charter generator",
  description:
    "Run a great session zero: a guided checklist covering tone, content lines and veils, safety tools, "
    + "characters, and table expectations, that builds a downloadable table charter. Any system. Free, no login.",
  alternates: { canonical: "/tools/session-zero" },
};

export default function SessionZeroPage() {
  return (
    <ToolsShell
      title="Session zero checklist and charter"
      tagline="Walk the table through every session-zero topic, then download a charter everyone can hold you to."
    >
      <JsonLd data={toolBreadcrumb("Session zero checklist", "session-zero")} />
      <SessionZero />
      <ToolCopy {...TOOL_COPY["session-zero"]} />
    </ToolsShell>
  );
}
