"use client";

import { useEffect, useState } from "react";

// components/home/section-rail.tsx
//
// The left-rail scrollspy for the landing page. Watches the sections via IntersectionObserver and
// highlights the one you are currently reading. Pure progressive enhancement: the section content is
// server-rendered, this only lights up which one is active. Anchors + CSS scroll-behavior do the
// scrolling; scroll-margin on the sections keeps headings clear of the top bar.

export type RailSection = { id: string; label: string };

export default function SectionRail({ sections }: { sections: RailSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (els.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-38% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [sections]);

  return (
    <nav className="home-rail" aria-label="Page sections">
      <ul>
        {sections.map((s) => (
          <li key={s.id} className={active === s.id ? "is-active" : ""}>
            <a href={`#${s.id}`}>
              <span className="rail-dot" aria-hidden />
              <span className="rail-lbl">{s.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
