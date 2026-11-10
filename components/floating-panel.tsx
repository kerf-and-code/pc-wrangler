"use client";

// components/floating-panel.tsx (2026-11-07)
//
// Phase 5d: a small window that floats over the page and can be dragged out of the way by its title
// bar (mouse, pen or finger). The character sheet's turn tracker lives in one, opened by its
// Initiative button.
//
//   * Closing it HIDES it rather than unmounting it, so what is inside keeps running: the fight card
//     goes on polling, and the sheet's targets and HP mirror keep working with the window shut.
//   * Where it was left is remembered in this browser (and only here: a convenience, so a failed
//     read just puts it back at the default spot). It is kept inside the window on a resize.
//   * Escape closes it while it has focus; the close button carries a word, not just a cross.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { STONE, FORGE_FONTS } from "@/lib/forge-theme";

type Pos = { x: number; y: number };

export default function FloatingPanel({ open, onClose, title, storageKey, width = 320, children }: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Where the position is remembered (localStorage key). */
  storageKey: string;
  width?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [folded, setFolded] = useState(false);
  const drag = useRef<{ dx: number; dy: number; id: number } | null>(null);

  // keep the panel on screen: at least its title bar stays reachable
  const clamp = useCallback((p: Pos): Pos => {
    const w = width;
    const maxX = Math.max(0, window.innerWidth - Math.min(w, window.innerWidth));
    const maxY = Math.max(0, window.innerHeight - 40);
    return { x: Math.min(Math.max(0, p.x), maxX), y: Math.min(Math.max(0, p.y), maxY) };
  }, [width]);

  // Until it is moved: the remembered spot, else the top right corner. Read while rendering, which
  // only happens with the panel open, and it only opens in the browser (never on the server).
  const initial = (): Pos => {
    let start: Pos = { x: window.innerWidth - Math.min(width, window.innerWidth) - 16, y: 72 };
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) { const p = JSON.parse(raw) as Pos; if (Number.isFinite(p.x) && Number.isFinite(p.y)) start = p; }
    } catch { /* no storage: the default spot */ }
    return clamp(start);
  };
  const at: Pos | null = pos ?? (open ? initial() : null);

  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  const remember = (p: Pos) => { try { window.localStorage.setItem(storageKey, JSON.stringify(p)); } catch { /* fine */ } };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setPos(clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    drag.current = null;
    if (at) remember(at);
  };
  // the arrow keys move it too, for anyone not dragging
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { onClose(); return; }
    const step = e.shiftKey ? 40 : 10;
    const d: Record<string, Pos> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    if (!d[e.key] || !at || e.target !== e.currentTarget) return;
    e.preventDefault();
    const next = clamp({ x: at.x + d[e.key].x, y: at.y + d[e.key].y });
    setPos(next); remember(next);
  };

  const small: React.CSSProperties = { background: "transparent", border: `1px solid ${STONE.hi}`, borderRadius: 4, color: STONE.ink, fontSize: 11.5, padding: "2px 8px", minHeight: "var(--sax-tap, 0px)", cursor: "pointer", fontFamily: FORGE_FONTS.body };

  return (
    <div ref={ref} role="dialog" aria-modal="false" aria-label={typeof title === "string" ? title : "Floating panel"} hidden={!open}
      onKeyDown={onKey}
      style={{ position: "fixed", left: at?.x ?? 0, top: at?.y ?? 0, width: `min(${width}px, calc(100vw - 16px))`, zIndex: 60,
        display: open ? "flex" : "none", flexDirection: "column", maxHeight: "min(70vh, 560px)",
        background: "rgba(20,17,13,0.97)", border: `1px solid ${STONE.hi}`, borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.55)" }}>
      <div tabIndex={0} aria-label="Drag to move. Arrow keys move it too."
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onKeyDown={onKey}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", cursor: "grab", touchAction: "none", userSelect: "none",
          borderBottom: folded ? "none" : `1px solid ${STONE.hi}`, fontFamily: FORGE_FONTS.mono, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: STONE.inkFaint }}>
        <span aria-hidden style={{ letterSpacing: 0 }}>⠿</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <button type="button" onClick={() => setFolded((f) => !f)} aria-expanded={!folded} style={small}>{folded ? "Show" : "Fold"}</button>
        <button type="button" onClick={onClose} style={small}>Close</button>
      </div>
      <div style={{ display: folded ? "none" : "block", overflowY: "auto", padding: 8 }}>{children}</div>
    </div>
  );
}
