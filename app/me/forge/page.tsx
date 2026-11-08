"use client";

// app/me/forge/page.tsx
//
// The Forge, where a character is built. The component itself lives in components/forge/forge-app.tsx
// (phase 5d) so the character sheet page (/me/sheet) can render the same character with the same
// derivation. useSearchParams() inside it needs this Suspense boundary for the route to prerender.

import React, { Suspense } from "react";
import ForgeApp from "@/components/forge/forge-app";

export default function ForgePage() {
  return (
    <Suspense fallback={null}>
      <ForgeApp view="forge" />
    </Suspense>
  );
}
