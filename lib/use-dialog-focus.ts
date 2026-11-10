"use client";

// lib/use-dialog-focus.ts (push 13, audit U14)
//
// The keyboard half of a modal dialog, for overlays that draw their own frame instead of using
// components/ui-forge/Modal: while `open`, focus moves inside, Tab and Shift+Tab stay inside, Escape
// calls onClose, and on close focus goes back to whatever opened it. Same behaviour as Modal.

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: (() => void) | null,
  initial?: RefObject<HTMLElement | null>,
): void {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    const first = initial?.current ?? node?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
    if (first) first.focus();
    else if (node) { if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1"); node.focus(); }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (closeRef.current) { e.stopPropagation(); e.preventDefault(); closeRef.current(); }
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const a = items[0], z = items[items.length - 1], cur = document.activeElement;
      if (!node.contains(cur)) { e.preventDefault(); a.focus(); return; }
      if (e.shiftKey && (cur === a || cur === node)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && cur === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && document.contains(opener)) opener.focus?.();
    };
    // The opener and the first focus are taken once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
