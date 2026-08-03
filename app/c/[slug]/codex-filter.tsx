"use client";

// app/c/[slug]/codex-filter.tsx
//
// The search box on a published codex.
//
// WHY IT FILTERS THE DOM INSTEAD OF HOLDING THE DATA
//   The page is a server component so that a crawler receives the whole codex as HTML. If this
//   component owned the list, the content would have to be passed down and re-rendered on the
//   client, which means the text exists twice - once for machines, once for people - and the two
//   drift the first time either side changes. So the server renders one list, tags each item with
//   data-search, and this hides the ones that do not match.
//
//   The trade is that it is DOM manipulation rather than React state, which is normally the wrong
//   instinct. Here it is the point: nothing about what a reader sees can diverge from what was
//   indexed, because they are the same nodes.
//
// It degrades honestly: with JavaScript off the box never appears and the full codex is still there
// to read and to search with the browser's own find.

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
    <div style={{ marginBottom: 22 }}>
      <input
        type="search"
        value={q}
        onChange={(e) => { setQ(e.target.value); apply(e.target.value); }}
        placeholder="Search this codex"
        aria-label="Search this codex"
        style={{
          width: "100%", padding: "11px 14px", fontSize: 16,
          fontFamily: "'Iowan Old Style', Georgia, serif",
          color: "#2a2620", background: "#fffdf8",
          border: "1px solid #ddd4c2", borderRadius: 3,
        }}
      />
      {q.trim() !== "" && (
        <p style={{
          fontFamily: "ui-monospace, monospace", fontSize: 12,
          color: shown === 0 ? "#9a5b3f" : "#8a8069", margin: "8px 0 0",
        }}>
          {shown === 0
            ? `Nothing here matches "${q.trim()}".`
            : `${shown} of ${total} shown.`}
        </p>
      )}
    </div>
  );
}
