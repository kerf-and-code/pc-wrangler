"use client";

import { useEffect, useRef } from "react";

// components/home/lit-line.tsx
//
// The one scroll-linked moment on the landing page (taste brief A5): a line from a real kind of read
// that fills in word by word as the visitor scrolls it into view. A lit word stays lit. The text is
// server-rendered whole (so crawlers and screen readers get it plain); the word spans are added on the
// client. Under prefers-reduced-motion the line is shown fully lit and never animates.

export default function LitLine({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    p.innerHTML = text
      .split(" ")
      .map((w) => `<span class="w">${w.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`)
      .join(" ");
    const words = Array.from(p.querySelectorAll<HTMLElement>(".w"));
    let lit = 0;
    let queued = false;

    const tick = () => {
      queued = false;
      const r = p.getBoundingClientRect();
      const vh = window.innerHeight;
      const progress = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (vh * 0.45)));
      const target = Math.round(progress * words.length);
      for (; lit < target; lit += 1) words[lit].classList.add("on");
    };
    const onScroll = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(tick);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    tick();
    return () => window.removeEventListener("scroll", onScroll);
  }, [text]);

  return <p ref={ref} className={className}>{text}</p>;
}
