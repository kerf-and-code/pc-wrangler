"use client";

// app/c/[slug]/codex-filter.tsx
//
// The search box on a published codex.
//
// WHY IT FILTERS THE DOM INSTEAD OF HOLDING THE DATA
//   The page is a server component so a crawler receives the whole codex as HTML. If this component
//   owned the list, the content would exist twice - once for machines, once for people - and drift
//   the first time either side changed. So the server renders one list, tags each item with
//   data-search, and this hides the ones that do not match. Nothing a reader sees can diverge from
//   what was indexed, because they are the same nodes.
//
// It degrades honestly: with JavaScript off the box never appears and the full codex is still there
// to read and to search with the browser's own find.
//
// STYLING: colours come from the shared --w-* theme variables (the .w-search class), so the box is
// dark in dark mode instead of the old hardcoded parchment.

import { useCallback, useEffect, useRef, useState } from "react";

export default function CodexFilter({ total }: { total: number }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(total);
  const ready = useRef(false);

  useEffect(() => { ready.current = true; }, []);

  const apply = useCallback((value: string) => {
    const needle = value.trim().toLowerCase();
    let visible = 0;

    document.querySelectorAll<HTMLElement>("[data-item]").forEach((el) => {
      const hay = el.dataset.search ?? "";
      const hit = !needle || hay.includes(needle);
      el.style.display = hit ? "" : "none";
      if (hit) visible += 1;
    });

    // A section whose items are all hidden should go too, heading and all, otherwise the page fills
    // with empty categories and reads as broken rather than filtered.
    document.querySelectorAll<HTMLElement>("[data-section]").forEach((sec) => {
      const any = Array.from(sec.querySelectorAll<HTMLElement>("[data-item]"))
        .some((el) => el.style.display !== "none");
      sec.style.display = any ? "" : "none";
    });

    setShown(visible);
  }, []);

  return (
    <div style={{ marginBottom: 24 }}>
      <input
        type="search"
        className="w-search"
        value={q}
        onChange={(e) => { setQ(e.target.value); apply(e.target.value); }}
        placeholder="Search this codex"
        aria-label="Search this codex"
      />
      {q.trim() !== "" && (
        <p className="w-mono" style={{
          fontSize: 12, margin: "8px 0 0", letterSpacing: "0.04em",
          color: shown === 0 ? "var(--w-accent)" : "var(--w-muted)",
        }}>
          {shown === 0
            ? `Nothing here matches "${q.trim()}".`
            : `${shown} of ${total} shown.`}
        </p>
      )}
    </div>
  );
}
