import { Suspense } from "react";
import WorldMapViewer from "@/components/worldmap/WorldMapViewer";

// Default route for the read-only member map viewer. Route-agnostic component, so move or link this
// from wherever logged-in party members land; the RPC self-gates, returning nothing to non-members.
//
// The default export MUST NOT await: cacheComponents rejects an uncached await (here `await params`)
// outside a Suspense boundary, the same constraint the wiki routes work around. So the awaiting work
// moves into a child that sits inside a Suspense boundary.

type P = { params: Promise<{ campaignId: string }> };

export default function WorldViewerPage({ params }: P) {
  return (
    <Suspense fallback={null}>
      <ViewerBody params={params} />
    </Suspense>
  );
}

async function ViewerBody({ params }: P) {
  const { campaignId } = await params;
  return <WorldMapViewer campaignId={campaignId} />;
}
