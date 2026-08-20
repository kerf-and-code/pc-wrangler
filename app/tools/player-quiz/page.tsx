import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { toolBreadcrumb } from "@/lib/seo";
import ToolCopy from "@/components/tools/tool-copy";
import { TOOL_COPY } from "@/lib/tools/tool-copy-content";
import PlayerQuiz from "@/components/player-quiz";

// app/tools/player-quiz/page.tsx
//
// The free player-type quiz. Server shell (for search) around the client quiz. No login, nothing saved.
// /tools is on the middleware allowlist in lib/supabase/proxy.ts.

export const metadata: Metadata = {
  title: "What kind of tabletop RPG player are you?",
  description:
    "A free, no-login quiz that reads how you play across six axes (Voice, Tactics, Arcana, Rapport, "
    + "Exploration, Nerve) and shows your tavern disposition chart. Twenty-four questions, nothing saved.",
  alternates: { canonical: "/tools/player-quiz" },
};

export default function PlayerQuizPage() {
  return (
    <ToolsShell
      title="What kind of player are you?"
      tagline="Twenty-four quick reads on what pulls you to the table, then your disposition across the six axes."
    >
      <JsonLd data={toolBreadcrumb("Player-type quiz", "player-quiz")} />
      <PlayerQuiz />
      <ToolCopy {...TOOL_COPY["player-quiz"]} />
    </ToolsShell>
  );
}
