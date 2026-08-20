import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { toolBreadcrumb } from "@/lib/seo";
import ToolCopy from "@/components/tools/tool-copy";
import { TOOL_COPY } from "@/lib/tools/tool-copy-content";
import MagicItemPricer from "@/components/magic-item-pricer";
import MagicItemFinder from "@/components/magic-item-finder";

// app/tools/magic-item-price/page.tsx
//
// The free magic item price calculator and finder. Server shell (for search) around the client tools. No
// login, nothing saved. /tools is on the middleware allowlist in lib/supabase/proxy.ts.

export const metadata: Metadata = {
  title: "Free D&D magic item price calculator and finder (2024)",
  description:
    "Price any D&D magic item by rarity, or search 400+ named 2024 items and see each one's estimated value. "
    + "Permanent or consumable, with the reasoning shown. Based on the 2024 DMG bands. Free, no login.",
  alternates: { canonical: "/tools/magic-item-price" },
};

export default function MagicItemPricePage() {
  return (
    <ToolsShell
      title="Magic item price calculator"
      tagline="What is that magic item worth? Price it by rarity, or search the 2024 items and see each one's estimate."
    >
      <JsonLd data={toolBreadcrumb("Magic item price calculator", "magic-item-price")} />
      <MagicItemPricer />
      <MagicItemFinder />
      <ToolCopy {...TOOL_COPY["magic-item-price"]} />
    </ToolsShell>
  );
}
