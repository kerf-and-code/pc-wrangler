"use client";

// app/me/sheet/page.tsx
//
// The character sheet a player plays from (phase 5d): ?c=<character_id> for a campaign character,
// ?lib=<library_id> for a library build, neither to pick one. Laid out like a D&D Beyond sheet and
// apart from the Forge, where the character is built. It renders the Forge's own component in its
// play view (components/forge/forge-app.tsx), so the numbers are the Forge's numbers.

import React, { Suspense } from "react";
import ForgeApp from "@/components/forge/forge-app";

export default function SheetPage() {
  return (
    <Suspense fallback={null}>
      <ForgeApp view="play" />
    </Suspense>
  );
}
