import WorldMapViewer from "@/components/worldmap/WorldMapViewer";

// Default route for the read-only member map viewer. Route-agnostic component, so move or link this
// from wherever logged-in party members land; the RPC self-gates, returning nothing to non-members.
export default async function WorldViewerPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  return <WorldMapViewer campaignId={campaignId} />;
}
