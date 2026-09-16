"use client";

import React, { useEffect, useRef } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

// An accessible modal shell. It owns the backdrop and the accessibility wiring so no overlay has to
// reimplement it: role="dialog" + aria-modal, Escape to close, a focus trap that keeps Tab inside
// the dialog, focus returned to whatever opened it on close, and a body-scroll lock while open.
// The visible panel is whatever you pass as children.
//
// Name the dialog with either labelledBy (preferred: the id of a visible heading inside the panel)
// or a plain label string. Pass exactly one.

type ModalProps = {
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  align?: "center" | "start";
  backdropStyle?: React.CSSProperties;
  panelStyle?: React.CSSProperties;
  children: React.ReactNode;
};

export function Modal({
  onClose,
  label,
  labelledBy,
  align = "center",
  backdropStyle,
  panelStyle,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Hold onClose in a ref so the setup effect can run exactly once on mount without re-running (and
  // stealing focus) every time the parent re-renders with a new onClose identity.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const node = dialogRef.current;
    const opener = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;

    // Move focus into the dialog so keyboard and screen-reader users start inside it.
    node?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const focusables = node.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      // Return focus to whatever held it before the dialog opened.
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      onClick={(e) => {
        // Close only on a click that lands on the backdrop itself, not one that bubbled up from a
        // drag or a click inside the panel.
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: align === "start" ? "flex-start" : "center",
        justifyContent: "center",
        padding: 20,
        overflow: "auto",
        ...backdropStyle,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        style={{
          background: C.surface,
          border: `1px solid ${C.line}`,
          borderRadius: FORGE_RADIUS,
          outline: "none",
          maxWidth: "100%",
          ...panelStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default Modal;
