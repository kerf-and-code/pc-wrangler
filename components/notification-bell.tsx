"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS, STONE } from "@/lib/forge-theme";
import { fmtRelative } from "@/lib/format";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { notificationWhen, type NotificationRow } from "@/lib/notifications";

// components/notification-bell.tsx (2026-11-10, push 19)
//
// The bell in the menu (components/six-axes-nav.tsx): an unread count, and a panel with the latest 30
// notifications (p150; database triggers write them). Opening an item marks it read; "Mark all read"
// clears the count. The count refreshes every minute while the tab is visible, and when the tab comes
// back. Nothing shows when signed out, or before p150 has run (the table read fails quietly).

const POLL_MS = 60_000;

export function NotificationBell({ placement }: { placement: "side" | "top" }) {
  const supabase = useMemo(() => createClient(), []);
  const [signedIn, setSignedIn] = useState(false);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDialogFocus(panel, open, close);

  const count = useCallback(async () => {
    const { count: n, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
    if (!error) setUnread(n ?? 0);
  }, [supabase]);

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!live || !user) return;
      setSignedIn(true);
      void count();
      timer = window.setInterval(() => { if (document.visibilityState === "visible") void count(); }, POLL_MS);
    })();
    const onVis = () => { if (document.visibilityState === "visible") void count(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { live = false; if (timer) window.clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [supabase, count]);

  async function load() {
    setErr(null);
    const { data, error } = await supabase.from("notifications").select("id, kind, title, link, data, created_at, read_at")
      .order("created_at", { ascending: false }).limit(30);
    if (error) { setItems([]); setErr("Could not load your notifications. Try again in a moment."); return; }
    setItems((data as NotificationRow[]) ?? []);
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void load();
  }

  async function markRead(ids: number[]) {
    if (!ids.length) return;
    const stamp = new Date().toISOString();
    setItems((xs) => (xs ?? []).map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? stamp } : n)));
    const { error } = await supabase.from("notifications").update({ read_at: stamp }).in("id", ids).is("read_at", null);
    if (error) setErr("Could not mark that read. Try again.");
    void count();
  }

  async function markAll() {
    const stamp = new Date().toISOString();
    setItems((xs) => (xs ?? []).map((n) => ({ ...n, read_at: n.read_at ?? stamp })));
    const { error } = await supabase.from("notifications").update({ read_at: stamp }).is("read_at", null);
    if (error) setErr("Could not mark them read. Try again.");
    void count();
  }

  if (!signedIn) return null;

  const label = unread ? `Notifications, ${unread} unread` : "Notifications";
  const panelPos: React.CSSProperties = placement === "top"
    ? { position: "fixed", top: 60, right: 12, left: 12, marginLeft: "auto", maxWidth: 400 }
    : { position: "fixed", bottom: 16, left: 240, width: 380 };

  return (
    <>
      <button type="button" className={placement === "top" ? "sax-find sax-plain" : "sax-item sax-plain"} onClick={toggle}
        aria-label={label} aria-expanded={open} aria-haspopup="dialog" title={label}
        style={placement === "side"
          ? { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", background: "transparent", border: "none", width: "100%", textAlign: "left", fontSize: 13.5, color: STONE.inkDim, padding: "4px 10px 4px 12px", borderRadius: 7, fontFamily: "inherit" }
          : { display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {placement === "side" && <span>Notifications</span>}
        {unread > 0 && (
          <span aria-hidden="true" style={{ minWidth: 18, height: 18, borderRadius: 9, padding: "0 5px", background: STONE.brassHi, color: STONE.mortar, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div onClick={close} aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div ref={panel} role="dialog" aria-modal="true" aria-label="Notifications"
            style={{ ...panelPos, zIndex: 61, maxHeight: "min(70vh, 560px)", overflowY: "auto", background: C.panel, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, boxShadow: "0 12px 32px rgba(0,0,0,0.55)", padding: "12px 14px", display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.vellum }}>Notifications</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={markAll} disabled={!items?.some((n) => !n.read_at)}
                  title={items?.some((n) => !n.read_at) ? undefined : "Everything is read"}
                  style={{ background: "none", color: C.brass, border: `1px solid ${C.brassDim}`, borderRadius: FORGE_RADIUS, padding: "6px 10px", fontSize: 12.5, cursor: "pointer", minHeight: "var(--sax-tap, 0px)" }}>
                  Mark all read
                </button>
                <button type="button" onClick={close} aria-label="Close notifications"
                  style={{ background: "none", color: C.muted, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "6px 10px", fontSize: 12.5, cursor: "pointer", minHeight: "var(--sax-tap, 0px)" }}>
                  Close
                </button>
              </span>
            </div>
            {items === null && <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Loading...</p>}
            {items && items.length === 0 && !err && (
              <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
                Nothing yet. You will see sessions, recaps, RSVPs and recordings here as they happen.
              </p>
            )}
            {err && <p role="alert" style={{ margin: 0, fontSize: 13, color: C.warn }}>{err}</p>}
            {items && items.length > 0 && (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
                {items.map((n) => {
                  const when = notificationWhen(n);
                  return (
                    <li key={n.id}>
                      <a href={n.link || "/me"} onClick={() => { if (!n.read_at) void markRead([n.id]); }}
                        style={{ display: "grid", gap: 2, padding: "8px 10px", borderRadius: FORGE_RADIUS, textDecoration: "none", color: C.vellum, background: n.read_at ? "transparent" : "rgba(201,164,76,0.10)", borderLeft: `3px solid ${n.read_at ? "transparent" : STONE.brassHi}` }}>
                        <span style={{ fontSize: 13.5, lineHeight: 1.45, fontWeight: n.read_at ? 400 : 600 }}>
                          {!n.read_at && <span className="sr-only">Unread: </span>}{n.title}
                        </span>
                        <span style={{ fontSize: 12, color: C.muted }}>{when ? `${when} · ` : ""}{fmtRelative(n.created_at)}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
            <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
              Want these by email once a day? Turn on the digest in <a href="/me/settings" style={{ color: C.brass }}>Settings</a>.
            </p>
          </div>
        </>
      )}
    </>
  );
}
