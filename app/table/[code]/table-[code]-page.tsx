"use client";

// Standalone Table Tap deep link. The engine lives in components/table-tap and
// is also embedded on the player record page; this route keeps /table/<code>
// working as a direct link.

import { Suspense } from "react";
import { useParams } from "next/navigation";
import TableTap from "@/components/table-tap";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

export default function TableTapPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", background: C.bg, color: C.muted, fontFamily: "system-ui, sans-serif", padding: 24 }}>
          Loading Table Tap...
        </main>
      }
    >
      <TableTapInner />
    </Suspense>
  );
}

function TableTapInner() {
  const params = useParams();
  const code = String((params as any)?.code ?? "");
  return (
    <main
      style={{
        minHeight: "100vh",
        background: C.bg,
        fontFamily: "system-ui, sans-serif",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <TableTap shareCode={code} />
      </div>
    </main>
  );
}
