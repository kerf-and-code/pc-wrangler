"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { SAX } from "@/lib/theme";

/* LeverSwitch — the breaker flipbook, salvaged from the old Power Room. Drag it
   down (or hit the button) to close; on commit it flashes alive and calls
   onEnter. Pure UI: no campaign, no cloud fit, just the pull and the payoff. */

const PULL_PX = 200;
const COMMIT = 0.8;
const FRAMES = ["/breaker-open.png", "/breaker-1.png", "/breaker-2.png", "/breaker-3.png", "/breaker-closed.png"];
const ALIVE = ["/breaker-alive-1.png", "/breaker-alive-2.png"];

type Phase = "dormant" | "arming" | "entering";

export default function LeverSwitch({
  onEnter,
  label = "Pull to enter",
}: {
  onEnter: () => void;
  label?: string;
}) {
  const [phase, setPhase] = useState<Phase>("dormant");
  const [pull, setPull] = useState(0);
  const dragStartY = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const entered = useRef(false);

  useEffect(() => {
    [...FRAMES, ...ALIVE].forEach((src) => { const img = new Image(); img.src = src; });
  }, []);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const animatePull = useCallback((target: number, then?: () => void) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const step = () => {
      setPull((p) => {
        const next = p + (target - p) * 0.18;
        if (Math.abs(target - next) < 0.004) { rafRef.current = null; then?.(); return target; }
        rafRef.current = requestAnimationFrame(step);
        return next;
      });
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const commit = useCallback(() => {
    if (entered.current) return;
    entered.current = true;
    setPhase("entering");
    animatePull(1, () => { window.setTimeout(onEnter, 900); });
  }, [animatePull, onEnter]);

  const canThrow = phase === "dormant" || phase === "arming";

  const onDown = (e: React.PointerEvent) => {
    if (!canThrow) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStartY.current = e.clientY;
    setPhase("arming");
  };
  const onMove = (e: React.PointerEvent) => {
    if (phase !== "arming" || dragStartY.current === null) return;
    setPull(Math.max(0, Math.min(1, (e.clientY - dragStartY.current) / PULL_PX)));
  };
  const onUp = () => {
    if (phase !== "arming") return;
    dragStartY.current = null;
    setPull((p) => {
      if (p >= COMMIT) { commit(); return 1; }
      animatePull(0);
      setPhase("dormant");
      return p;
    });
  };

  const seated = pull > 0.985;
  const showAlive = phase === "entering" && seated;
  const frameIdx = Math.round(pull * (FRAMES.length - 1));

  return (
    <div style={S.stage}>
      <style>{CSS}</style>
      <div style={S.breakerStage}>
        <div style={{ ...S.glow, opacity: showAlive ? 1 : phase === "entering" ? 0.7 : 0.26 }} />
        <div
          style={{ ...S.wrap, cursor: canThrow ? "grab" : "default" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          role="button"
          aria-label="Pull the lever to enter"
        >
          {showAlive ? (
            <>
              <img src={ALIVE[0]} alt="" draggable={false} className="lv-a" style={S.img} />
              <img src={ALIVE[1]} alt="" draggable={false} className="lv-b" style={S.img} />
            </>
          ) : (
            <img src={FRAMES[frameIdx]} alt="" draggable={false} style={S.img} />
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={commit}
        disabled={phase === "entering"}
        style={{ ...S.btn, opacity: phase === "entering" ? 0.55 : 1, cursor: phase === "entering" ? "default" : "pointer" }}
      >
        {phase === "entering" ? "Entering\u2026" : label}
      </button>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  stage: { display: "flex", flexDirection: "column", alignItems: "center" },
  breakerStage: { position: "relative", width: "100%", display: "flex", justifyContent: "center", padding: "8px 0" },
  glow: {
    position: "absolute", top: "50%", left: "50%", width: "78%", height: "70%",
    transform: "translate(-50%, -50%)", borderRadius: "50%", pointerEvents: "none",
    background: `radial-gradient(ellipse at center, ${SAX.ember} 0%, rgba(232,146,58,0.35) 35%, transparent 70%)`,
    filter: "blur(28px)", transition: "opacity 0.35s ease",
  },
  wrap: { position: "relative", width: "min(340px, 84vw)", aspectRatio: "1792 / 2338", touchAction: "none", userSelect: "none" },
  img: {
    position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain",
    userSelect: "none", pointerEvents: "none", filter: "drop-shadow(0 18px 30px rgba(0,0,0,0.6))",
  },
  btn: {
    marginTop: 16, background: "transparent", color: SAX.brass, border: `1px solid ${SAX.brass}`,
    borderRadius: 999, padding: "10px 22px", fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.14em",
    textTransform: "uppercase",
  },
};

const CSS = `
  .lv-a, .lv-b { will-change: opacity; }
  @media (prefers-reduced-motion: no-preference) {
    .lv-a { animation: lvflipA 0.22s steps(1, end) infinite; }
    .lv-b { animation: lvflipB 0.22s steps(1, end) infinite; }
  }
  @keyframes lvflipA { 0%, 49.9% { opacity: 1 } 50%, 100% { opacity: 0 } }
  @keyframes lvflipB { 0%, 49.9% { opacity: 0 } 50%, 100% { opacity: 1 } }
`;
