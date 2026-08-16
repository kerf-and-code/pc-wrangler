"use client";

import { useEffect } from "react";

// Scroll-spy for the Contents rail: highlights the heading currently in view by toggling `.active`
// on the matching TOC link. Pure enhancement over the server-rendered anchor links (which work with
// JavaScript off), so nothing about SEO or the static HTML changes. Renders nothing itself.
export default function TocSpy({ ids }: { ids: string[] }) {
  useEffect(() => {
    if (!ids.length) return;
    const linkFor = (id: string) =>
      document.querySelector<HTMLElement>(`.w-toc a[href="#h-${id}"]`);
    const headings = ids.map((id) => ({ id, el: document.getElementById(`h-${id}`) }));
    let active: string | null = null;

    const onScroll = () => {
      let cur: string | null = ids[0] ?? null;
      for (const h of headings) {
        if (h.el && h.el.getBoundingClientRect().top <= 120) cur = h.id;
      }
      if (cur === active) return;
      if (active) linkFor(active)?.classList.remove("active");
      active = cur;
      if (cur) linkFor(cur)?.classList.add("active");
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ids]);

  return null;
}
