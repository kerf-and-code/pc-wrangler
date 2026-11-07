import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { toolBreadcrumb } from "@/lib/seo";
import ToolCopy from "@/components/tools/tool-copy";
import { TOOL_COPY } from "@/lib/tools/tool-copy-content";
import ClassQuiz from "@/components/class-quiz";

// app/tools/dnd-class-quiz/page.tsx (2026-11-07)
//
// The free "What D&D class should I be?" quiz. Server shell (for search) around the client quiz. No
// login, nothing saved. /tools is on the middleware allowlist in lib/supabase/proxy.ts.

export const metadata: Metadata = {
  title: "What D&D class should I be? Free class and subclass quiz",
  description:
    "A free, no-login quiz that narrows over 450 D&D 5e subclasses down to one, from the 2024 and 2014 "
    + "books and the D&D Beyond partnered publishers, with runners-up and the full flowchart. Nothing saved.",
  alternates: { canonical: "/tools/dnd-class-quiz" },
};

export default function ClassQuizPage() {
  return (
    <ToolsShell
      title="What D&D class should I be?"
      tagline="Answer honestly. There are no wrong answers, only wrong characters."
    >
      <JsonLd data={toolBreadcrumb("What D&D class should I be?", "dnd-class-quiz")} />
      <ClassQuiz />
      <ToolCopy {...TOOL_COPY["dnd-class-quiz"]} />
    </ToolsShell>
  );
}
