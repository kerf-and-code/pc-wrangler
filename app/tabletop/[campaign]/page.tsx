import { Suspense } from "react";
import TabletopClient from "../TabletopClient";

// app/tabletop/[campaign]/page.tsx (2026-11-06)
//
// The shared table for one campaign. The GM and the players open the same address; tabletop_state
// (p105) decides who is who and what each may see. Sign-in is required (lib/supabase/proxy.ts sends a
// logged-out visitor to /auth/login); the GM access-code gate covers /gm only, so players get in.
//
// The default export MUST NOT await: cacheComponents rejects an uncached await (here `await params`)
// outside a Suspense boundary, so the awaiting work sits in a child inside one, as in app/world/[campaignId].

type P = { params: Promise<{ campaign: string }> };

export default function TabletopPage({ params }: P) {
  return (
    <Suspense fallback={null}>
      <TabletopBody params={params} />
    </Suspense>
  );
}

async function TabletopBody({ params }: P) {
  const { campaign } = await params;
  return <TabletopClient campaignId={campaign} />;
}
