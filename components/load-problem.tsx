"use client";

// components/load-problem.tsx (push 12, audit U9)
//
// The two ways a share-link page can fail, kept apart. A link that does not match any table is the
// player's to fix (ask the GM). A sign-in or network failure is not: sending them to their GM for a new
// link would not help, so it says what happened and offers to try again. "Nothing here yet" is only
// shown after a read that succeeded and came back empty.

import { C, FORGE_RADIUS } from "@/lib/forge-theme";

const text: React.CSSProperties = { textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6, margin: "0 0 10px" };

export function LinkInvalid({ what = "campaign link" }: { what?: string }) {
  return <p style={text}>This link does not match a table. Ask your GM for the {what}.</p>;
}

export function ConnectProblem() {
  return (
    <div role="alert" style={{ textAlign: "center" }}>
      <p style={text}>Could not reach Six Axes. Check your connection, then try again.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          padding: "10px 18px", minHeight: 44, borderRadius: FORGE_RADIUS, border: "none",
          background: C.brass, color: C.ink, fontWeight: 700, fontSize: 14, cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
