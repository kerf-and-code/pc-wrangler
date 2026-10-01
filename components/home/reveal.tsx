"use client";

import { useEffect } from "react";

// components/home/reveal.tsx
//
// Scroll reveal for the landing page (taste brief A4): every element marked data-reveal rises 24px and
// fades in as it enters the viewport, 0.7s on cubic-bezier(0.22, 1, 0.36, 1), with siblings that enter
// together staggered 80ms apart (capped at 320ms, so a long batch never waits). The CSS lives in app/page.tsx and only applies once this component has
// put the `nt-js` class on the page root, so with JavaScript off nothing is ever hidden. Under
// prefers-reduced-motion every element is shown at once.
//
// The marketing shells (SiteShell, ToolsShell) mount it too, as <Reveal root=".sax-night" jsClass="sn-js" />,
// with the matching CSS in NIGHT_CSS, so inner pages settle the same way the home page does.

export default function Reveal({ root: rootSelector = ".nt", jsClass = "nt-js" }: { root?: string; jsClass?: string }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(rootSelector);
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (still || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }

    // Anything already on screen (even partly, at the fold edge) is shown before the hidden state switches
    // on, so it never fades out and back in; only what is still below the fold waits to reveal.
    const fold = window.innerHeight;
    els.forEach((el) => { if (el.getBoundingClientRect().top < fold) el.classList.add("is-in"); });
    root.classList.add(jsClass);
    const io = new IntersectionObserver(
      (entries) => {
        let n = 0;
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target as HTMLElement;
          el.style.transitionDelay = `${Math.min(n, 4) * 80}ms`;
          n += 1;
          el.classList.add("is-in");
          io.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    els.forEach((el) => { if (!el.classList.contains("is-in")) io.observe(el); });

    // A jump (an anchor link, scroll restoration on Back) can carry an element from below the fold to
    // above it without it ever intersecting, so the observer never fires. On scroll, show anything that
    // is now above the bottom of the screen and still hidden.
    let raf = 0;
    const sweep = () => {
      raf = 0;
      const bottom = window.innerHeight;
      els.forEach((el) => {
        if (!el.classList.contains("is-in") && el.getBoundingClientRect().top < bottom) {
          el.classList.add("is-in");
          io.unobserve(el);
        }
      });
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(sweep); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [rootSelector, jsClass]);

  return null;
}
