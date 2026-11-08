"use client";

// lib/use-narrow.ts (2026-11-07)
//
// Phase 5c: true while the window is at most `px` wide, so a component can lay its rows out for a
// phone. Read through useSyncExternalStore, so the first server render (false) and a resize both
// stay consistent without setting state inside an effect.

import { useCallback, useSyncExternalStore } from "react";

export function useNarrow(px = 640): boolean {
  const q = `(max-width: ${px}px)`;
  const subscribe = useCallback((cb: () => void) => {
    const mq = window.matchMedia(q);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }, [q]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(q).matches, () => false);
}
