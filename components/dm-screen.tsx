"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import { getActiveCampaign } from "@/lib/active-campaign";
import { CardBody, entryTag } from "@/components/compendium-tool";
import {
  type DmBoard, type PlacedCard,
  listBoards, createBoard, renameBoard, deleteBoard, saveBoardCards,
} from "@/lib/compendium/dm-board";

// components/dm-screen.tsx
//
// The DM Screen canvas. A GM picks (or makes) a named board and arranges the cards they sent over from
// the compendium. Placement is free-form: drag a card by its header, resize from the bottom-right corner.
// Each card is a stored snapshot (PlacedCard.entry), rendered through the compendium's own CardBody so it
// looks identical to the lookup tool. Layout changes persist to dm_boards (p92) on drop.

// "board" mode resizes the canvas viewport height (id is unused for it); move/resize act on a card.
type Drag = { id: string; mode: "move" | "resize" | "board"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number };

const ZOOM_MIN = 0.5, ZOOM_MAX = 2, ZOOM_STEP = 0.1;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

export default function DmScreen() {
  const supabase = useMemo(() => createClient(), []);
  const [gmId, setGmId] = useState<string | null>(null);
  const [boards, setBoards] = useState<DmBoard[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cards, setCards] = useState<PlacedCard[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewportH, setViewportH] = useState(640);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const cardsRef = useRef<PlacedCard[]>([]);
  cardsRef.current = cards;
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const selectBoard = useCallback((b: DmBoard | null) => {
    setActiveId(b?.id ?? null);
    setCards(b?.cards ?? []);
    setRenaming(false);
    // View prefs (canvas height + zoom) are per-board and client-only, remembered in localStorage.
    let h = 640, z = 1;
    try {
      if (b?.id) {
        localStorage.setItem("sax_dm_board", b.id);
        const raw = localStorage.getItem(`sax_dm_view_${b.id}`);
        if (raw) { const v = JSON.parse(raw) as { h?: number; zoom?: number }; if (v.h) h = v.h; if (v.zoom) z = clampZoom(v.zoom); }
      }
    } catch { /* storage disabled */ }
    setViewportH(h);
    setZoom(z);
  }, []);

  // Persist the per-board view prefs whenever the canvas height or zoom changes.
  useEffect(() => {
    if (!activeId) return;
    try { localStorage.setItem(`sax_dm_view_${activeId}`, JSON.stringify({ h: viewportH, zoom })); } catch { /* storage disabled */ }
  }, [activeId, viewportH, zoom]);

  const refresh = useCallback(async (preferId?: string | null) => {
    try {
      const list = await listBoards(supabase);
      setBoards(list);
      let want = preferId ?? activeIdRef.current;
      if (!want) { try { want = localStorage.getItem("sax_dm_board"); } catch { want = null; } }
      const found = list.find((b) => b.id === want) ?? list[0] ?? null;
      selectBoard(found);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load your DM Screen boards.");
    }
  }, [supabase, selectBoard]);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (off) return;
        setGmId(data.user?.id ?? null);
        if (data.user?.id) await refresh();
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [supabase, refresh]);

  const persist = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    try { await saveBoardCards(supabase, id, cardsRef.current); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save the board."); }
  }, [supabase]);

  // Window-level drag: bind while a drag is active so the pointer can leave the card.
  useEffect(() => {
    if (!drag) return;
    const move = (ev: PointerEvent) => {
      const rawDx = ev.clientX - drag.sx, rawDy = ev.clientY - drag.sy;
      if (drag.mode === "board") { setViewportH(Math.max(320, drag.oh + rawDy)); return; }
      // Card coords live in the unscaled world; screen deltas must be divided by the zoom to match.
      const z = zoomRef.current || 1;
      const dx = rawDx / z, dy = rawDy / z;
      setCards((cs) => cs.map((c) => {
        if (c.id !== drag.id) return c;
        if (drag.mode === "move") return { ...c, x: Math.max(0, drag.ox + dx), y: Math.max(0, drag.oy + dy) };
        return { ...c, w: Math.max(220, drag.ow + dx), h: Math.max(120, drag.oh + dy) };
      }));
    };
    const up = () => { const wasBoard = drag.mode === "board"; setDrag(null); if (!wasBoard) void persist(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [drag, persist]);

  const startMove = (e: React.PointerEvent, card: PlacedCard) => {
    e.preventDefault();
    setDrag({ id: card.id, mode: "move", sx: e.clientX, sy: e.clientY, ox: card.x, oy: card.y, ow: card.w, oh: card.h });
  };
  const startResize = (e: React.PointerEvent, card: PlacedCard) => {
    e.preventDefault(); e.stopPropagation();
    setDrag({ id: card.id, mode: "resize", sx: e.clientX, sy: e.clientY, ox: card.x, oy: card.y, ow: card.w, oh: card.h });
  };
  const removeCard = (id: string) => { setCards((cs) => cs.filter((c) => c.id !== id)); setTimeout(() => void persist(), 0); };
  const startBoardResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setDrag({ id: "__board__", mode: "board", sx: e.clientX, sy: e.clientY, ox: 0, oy: 0, ow: 0, oh: viewportH });
  };
  const adjustZoom = (delta: number) => setZoom((z) => clampZoom(z + delta));

  const onNewBoard = async () => {
    if (!gmId) return;
    try {
      const b = await createBoard(supabase, gmId, "New board", getActiveCampaign()?.id ?? null);
      await refresh(b.id);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not create a board."); }
  };
  const onRename = async () => {
    if (!activeId) return;
    try { await renameBoard(supabase, activeId, nameDraft.trim() || "New board"); setRenaming(false); await refresh(activeId); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not rename the board."); }
  };
  const onDelete = async () => {
    if (!activeId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this board and its cards? This can't be undone.")) return;
    try { await deleteBoard(supabase, activeId); await refresh(null); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not delete the board."); }
  };

  const seg = (on: boolean): React.CSSProperties => ({ padding: "7px 12px", background: on ? C.surface2 : "transparent", color: on ? C.sun : C.muted, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer" });
  const field: React.CSSProperties = { padding: "7px 10px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 14 };
  const activeBoard = boards.find((b) => b.id === activeId) ?? null;
  // The scrollable "world" hugs the cards with room to spare, so there is always somewhere to drag to.
  const maxRight = cards.reduce((m, c) => Math.max(m, c.x + c.w), 0);
  const maxBottom = cards.reduce((m, c) => Math.max(m, c.y + c.h), 0);
  const worldW = Math.max(1400, maxRight + 240);
  const worldH = Math.max(900, maxBottom + 240);

  if (loading) return <p style={{ color: C.muted }}>Loading your DM Screen…</p>;
  if (!gmId) return <p style={{ color: C.muted }}>Sign in as a GM to use the DM Screen.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* board controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {boards.length > 0 && !renaming && (
          <select value={activeId ?? ""} onChange={(e) => selectBoard(boards.find((b) => b.id === e.target.value) ?? null)} style={{ ...field, maxWidth: 280 }}>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}{b.cards.length ? ` (${b.cards.length})` : ""}</option>)}
          </select>
        )}
        {renaming && (
          <>
            <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Board name" style={{ ...field, maxWidth: 240 }} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void onRename(); if (e.key === "Escape") setRenaming(false); }} />
            <button type="button" onClick={() => void onRename()} style={seg(true)}>Save</button>
            <button type="button" onClick={() => setRenaming(false)} style={seg(false)}>Cancel</button>
          </>
        )}
        {!renaming && (
          <>
            <button type="button" onClick={onNewBoard} style={seg(false)}>+ New board</button>
            {activeBoard && <button type="button" onClick={() => { setNameDraft(activeBoard.name); setRenaming(true); }} style={seg(false)}>Rename</button>}
            {activeBoard && <button type="button" onClick={onDelete} style={{ ...seg(false), color: "#c98a7a" }}>Delete</button>}
          </>
        )}
        {activeBoard && (
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: 4 }}>
            <button type="button" onClick={() => adjustZoom(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} title="Zoom out" style={seg(false)}>&minus;</button>
            <button type="button" onClick={() => setZoom(1)} title="Reset zoom to 100%" style={{ ...seg(false), minWidth: 52, textAlign: "center" }}>{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => adjustZoom(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} title="Zoom in" style={seg(false)}>+</button>
          </div>
        )}
        <span style={{ flex: 1 }} />
        {activeBoard && <span style={{ color: C.muted, fontSize: 12.5 }}>{cards.length} card{cards.length === 1 ? "" : "s"}</span>}
      </div>

      {err && <p style={{ color: "#c98a7a", fontSize: 12.5, margin: 0 }}>{err}</p>}

      {boards.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 14 }}>No boards yet. Create one, then send cards over from the Rules compendium with the “To DM Screen” button.</p>
      ) : cards.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 14 }}>This board is empty. Open the Rules compendium, look something up, and press “To DM Screen” to place it here.</p>
      ) : null}

      {/* canvas: a fixed-height scrollable viewport over a zoomable "world" that holds the cards */}
      {boards.length > 0 && (
        <div>
          <div style={{
            height: viewportH, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
            background: C.surface, overflow: "auto", touchAction: "none",
          }}>
            {/* sizer takes the SCALED dimensions so the scrollbars track the zoomed content */}
            <div style={{ position: "relative", width: worldW * zoom, height: worldH * zoom }}>
              {/* world is at natural size and scaled; the dotted grid scales with it */}
              <div style={{
                position: "absolute", top: 0, left: 0, width: worldW, height: worldH,
                transform: `scale(${zoom})`, transformOrigin: "0 0",
                backgroundImage: `radial-gradient(${C.line} 1px, transparent 1px)`, backgroundSize: "24px 24px",
              }}>
                {cards.map((card) => (
                  <div key={card.id} style={{
                    position: "absolute", left: card.x, top: card.y, width: card.w, height: card.h,
                    background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
                    display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
                  }}>
                    <div onPointerDown={(e) => startMove(e, card)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "move", borderBottom: `1px solid ${C.line}`, background: C.surface2, userSelect: "none" }}>
                      <span style={{ color: C.text, fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.entry.name}</span>
                      <span style={{ fontSize: 10.5, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 999, padding: "0 6px", whiteSpace: "nowrap" }}>{entryTag(card.entry)}</span>
                      <span style={{ flex: 1 }} />
                      <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeCard(card.id)} title="Remove from board"
                        style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>&times;</button>
                    </div>
                    <div style={{ padding: "8px 12px 14px", overflow: "auto", flex: 1 }}>
                      <CardBody entry={card.entry} meta={{ color: C.muted, fontSize: 12.5, margin: "2px 0 0" }} />
                    </div>
                    <div onPointerDown={(e) => startResize(e, card)} title="Resize"
                      style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize",
                        background: `linear-gradient(135deg, transparent 50%, ${C.line} 50%)` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* drag this grip to resize the board's height */}
          <div onPointerDown={startBoardResize} title="Drag to resize the board"
            style={{ height: 16, marginTop: 2, cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 44, height: 5, borderRadius: 3, background: C.line }} />
          </div>
        </div>
      )}
    </div>
  );
}
