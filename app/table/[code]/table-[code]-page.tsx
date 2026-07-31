"use client";

// Standalone Table Tap deep link. The engine lives in components/table-tap and
// is also embedded on the player record page; this route keeps /table/<code>
// working as a direct link.

import { Suspense } from "react";
import { useParams } from "next/navigation";
import TableTap from "@/components/table-tap";

export default function TableTapPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", background: "#16121f", color: "#9a8fb0", fontFamily: "system-ui, sans-serif", padding: 24 }}>
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
        background: "#16121f",
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
