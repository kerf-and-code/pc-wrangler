import type { Metadata } from "next";
import ToolsShell from "@/components/tools-shell";
import JsonLd from "@/components/json-ld";
import { toolBreadcrumb } from "@/lib/seo";
import MapGenerator from "@/components/map-generator";

// app/tools/map-generator/page.tsx
//
// The free hex world map generator. Server shell (for search) around the client generator. No login,
// nothing saved. /tools is on the middleware allowlist in lib/supabase/proxy.ts.

export const metadata: Metadata = {
  title: "Free fantasy hex world map generator",
  description:
    "Generate a full fantasy world map in your browser: continents, climate, rivers, biomes, settlements "
    + "and roads from a seed. Free, no login, download the PNG. The same generator that powers Six Axes.",
  alternates: { canonical: "/tools/map-generator" },
};

export default function MapGeneratorPage() {
  return (
    <ToolsShell
      title="Fantasy world map generator"
      tagline="A whole hex world from a seed: continents, climate, rivers, biomes, towns and roads. Free, in your browser."
    >
      <JsonLd data={toolBreadcrumb("Fantasy world map generator", "map-generator")} />
      <MapGenerator />
    </ToolsShell>
  );
}
