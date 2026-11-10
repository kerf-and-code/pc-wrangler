"use client";

// components/confirm-host.tsx (push 13, audit L-U1)
//
// The dialog behind askConfirm (lib/confirm.ts), mounted once in the root layout. It shows the
// question in the app's own style, names the action on the go-ahead button, keeps Tab inside, puts
// focus on Cancel (so a stray Enter backs out of a delete), closes on Escape as a no, and hands
// focus back to whatever opened it. Requests that arrive while one is open wait their turn.

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui-forge/Modal";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { registerConfirmHost, type ConfirmRequest } from "@/lib/confirm";

export default function ConfirmHost() {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const current = queue[0] ?? null;

  useEffect(() => registerConfirmHost((req) => setQueue((q) => [...q, req])), []);
  useEffect(() => { if (current) cancelRef.current?.focus(); }, [current]);

  if (!current) return null;

  const answer = (ok: boolean) => {
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  };

  const base: React.CSSProperties = {
    padding: "10px 16px", minHeight: 44, borderRadius: FORGE_RADIUS, fontSize: 14, cursor: "pointer", fontWeight: 600,
  };

  return (
    <Modal onClose={() => answer(false)} labelledBy="sax-confirm-text" panelStyle={{ width: 460, padding: "20px 20px 16px", color: C.text }}>
      <p id="sax-confirm-text" style={{ margin: "0 0 18px", fontSize: 15, lineHeight: 1.55, whiteSpace: "pre-line" }}>{current.message}</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button ref={cancelRef} type="button" onClick={() => answer(false)}
          style={{ ...base, background: "transparent", border: `1px solid ${C.line}`, color: C.text }}>
          {current.cancelLabel}
        </button>
        <button type="button" onClick={() => answer(true)}
          style={{ ...base, border: "none", background: current.danger ? C.warn : C.brass, color: current.danger ? "#fff" : C.ink }}>
          {current.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
