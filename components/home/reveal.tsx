"use client";

import { useEffect } from "react";

// components/home/reveal.tsx
//
// Scroll reveal for the landing page (taste brief A4): every element marked data-reveal rises 24px and
// fades in as it enters the viewport, 0.7s on cubic-bezier(0.22, 1, 0.36, 1), with siblings that enter
// together staggered 80ms apart. The CSS lives in app/page.tsx and only applies once this component has
// put the `nt-js` class on the page root, so with JavaScript off nothing is ever hidden. Under
// prefers-reduced-motion every element is shown at once.

export default function Reveal() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".nt");
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (still || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }

    root.classList.add("nt-js");
    const io = new IntersectionObserver(
      (entries) => {
        let n = 0;
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target as HTMLElement;
          el.style.transitionDelay = `${n * 80}ms`;
          n += 1;
          el.classList.add("is-in");
          io.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}
