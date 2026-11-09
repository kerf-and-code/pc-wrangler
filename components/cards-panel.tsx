"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "@/lib/forge-theme";
import type { createClient } from "@/lib/supabase/client";
import { MAX_CARDS, SUIT_SYMBOL, isRed, parseCustomDeck, shuffled, standardDeck, type CardFace, type Suit } from "@/lib/tabletop/cards";

// components/cards-panel.tsx (2026-11-09)
//
// Phase 6a (p130): card decks at the table. The Cards tab shows the cards on the table, your hand, and
// the decks. Tap a card to see it large with what you can do with it: play it face up or down, discard
// it, pass it to someone, take it back. The GM also makes decks (playing cards, or their own cards one
// per line), deals, shuffles, and sees every hand.
//
// Everything goes through the p130 functions; players never read the deck itself, so the order of the
// draw pile and other people's hands never reach their browser.

type Supa = ReturnType<typeof createClient>;
export type Card = { id: string; deckId: string; pile: "draw" | "hand" | "table" | "discard"; faceUp: boolean; holder: string | null; playedBy: string | null; shown: boolean; name?: string; body?: string; suit?: Suit | null; rank?: string | null };
export type Deck = { id: string; name: string; kind: "standard" | "custom"; backColor: string; playersDraw: boolean; total: number; draw: number; discard: number; discardTop: Card | null };
export type TableCards = { decks: Deck[]; table: Card[]; hand: Card[]; hands: { holder: string; name: string; count: number }[]; others: Card[] | null };
export type Seat = { profileId: string; name: string };

export const BACK_COLORS = ["#7a2e2e", "#2e4a7a", "#2f5e3a", "#5b3a7a", "#1f1b17", "#8a6a2a"];

/** The table's cards for this person; reload after any change and when someone else changes them. */
export function useTableCards(supabase: Supa, campaignId: string) {
  const [data, setData] = useState<TableCards | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const { data: d, error: er } = await supabase.rpc("tabletop_cards", { p_campaign: campaignId });
    if (er) { setError(/tabletop_cards/.test(er.message) ? "Card decks are not set up yet (the p130 migration)." : er.message); return; }
    setError(null);
    const t = d as TableCards;
    setData({ decks: t.decks ?? [], table: t.table ?? [], hand: t.hand ?? [], hands: t.hands ?? [], others: t.others ?? null });
  }, [supabase, campaignId]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload };
}

const small: React.CSSProperties = { padding: "5px 9px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" };
const field: React.CSSProperties = { padding: "5px 7px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, boxSizing: "border-box" };
const head: React.CSSProperties = { fontWeight: 600, fontSize: 13, margin: "14px 0 6px" };
const primary: React.CSSProperties = { ...small, background: C.sun, color: "#1b1712", border: "none", fontWeight: 600 };

/** One card: its face when this person may see it, else its back. */
export function CardView({ card, back, big, selected, onClick }: { card: Card | null; back: string; big?: boolean; selected?: boolean; onClick?: () => void }) {
  const w = big ? 150 : 62, h = big ? 210 : 88;
  const shown = card?.shown && card.name;
  const red = isRed(card?.suit, card?.rank);
  const label = !card ? "Empty" : shown ? `${card.name}${card.faceUp || card.pile !== "table" ? "" : " (face down)"}` : "A face-down card";
  const style: React.CSSProperties = {
    width: w, height: h, flex: "0 0 auto", borderRadius: big ? 12 : 7, position: "relative", overflow: "hidden", padding: 0,
    border: selected ? `2px solid ${C.sun}` : `1px solid ${shown ? "#c9bca0" : "rgba(255,255,255,0.25)"}`,
    background: shown ? "#f6efdf" : `repeating-linear-gradient(45deg, ${back}, ${back} 6px, rgba(0,0,0,0.25) 6px, rgba(0,0,0,0.25) 12px)`,
    color: red ? "#b3312a" : "#1b1712", cursor: onClick ? "pointer" : "default", textAlign: "left",
    boxShadow: selected ? `0 0 0 2px rgba(217,164,58,0.35)` : "0 2px 6px rgba(0,0,0,0.35)",
    opacity: card && card.pile === "table" && !card.faceUp ? 0.85 : 1,
  };
  const inner = !card ? null : shown ? (
    card.suit ? (
      <>
        <span style={{ position: "absolute", top: big ? 8 : 4, left: big ? 10 : 5, fontWeight: 800, fontSize: big ? 22 : 12, lineHeight: 1.05, textAlign: "center" }}>
          {card.suit === "joker" ? "J" : card.rank}<br />{SUIT_SYMBOL[card.suit]}
        </span>
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: big ? 76 : 30 }}>{SUIT_SYMBOL[card.suit]}</span>
        {card.suit === "joker" && <span style={{ position: "absolute", bottom: big ? 10 : 4, left: 0, right: 0, textAlign: "center", fontSize: big ? 14 : 8.5, fontWeight: 700 }}>JOKER</span>}
      </>
    ) : (
      <span style={{ display: "flex", flexDirection: "column", gap: big ? 8 : 3, padding: big ? 12 : 5, height: "100%", boxSizing: "border-box" }}>
        <span style={{ fontWeight: 700, fontSize: big ? 15 : 9.5, lineHeight: 1.2, wordBreak: "break-word" }}>{card.name}</span>
        {card.body && <span style={{ fontSize: big ? 12 : 7.5, lineHeight: 1.3, color: "#4a4136", overflow: "hidden", wordBreak: "break-word" }}>{card.body}</span>}
      </span>
    )
  ) : null;
  if (onClick) return <button type="button" aria-label={label} aria-pressed={selected} title={shown ? [card!.name, card!.body].filter(Boolean).join(": ") : undefined} onClick={onClick} style={style}>{inner}</button>;
  return <div role="img" aria-label={label} style={style}>{inner}</div>;
}

export default function CardsPanel({ campaignId, supabase, isGm, me, seats, data, error, reload, onChanged }: {
  campaignId: string; supabase: Supa; isGm: boolean; me: string; seats: Seat[];
  data: TableCards | null; error: string | null; reload: () => Promise<void>;
  /** after this person changed something, so everyone else reloads */
  onChanged: () => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [passTo, setPassTo] = useState("");
  const [making, setMaking] = useState(false);
  const decks = useMemo(() => new Map((data?.decks ?? []).map((d) => [d.id, d])), [data]);
  const backOf = (c: Card | null) => (c && decks.get(c.deckId)?.backColor) || BACK_COLORS[0];
  const others = useMemo(() => seats.filter((s) => s.profileId !== me), [seats, me]);
  const nameOf = (id: string | null) => seats.find((s) => s.profileId === id)?.name ?? "someone";

  const run = async (job: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    setBusy(true); setMsg(null);
    const { error: er } = await job();
    setBusy(false);
    if (er) { setMsg(er.message); return false; }
    if (ok) setMsg(ok);
    await reload(); onChanged();
    return true;
  };
  const move = (c: Card, to: Card["pile"], faceUp = true, holder: string | null = null) =>
    run(() => supabase.rpc("tabletop_card_move", { p_card: c.id, p_to: to, p_face_up: faceUp, p_holder: holder })).then((ok) => { if (ok) setSel(null); });

  if (error) return <div style={{ padding: 12, color: C.muted, fontSize: 13 }}>{error}</div>;
  if (!data) return <div style={{ padding: 12, color: C.muted, fontSize: 13 }}>Loading the cards...</div>;

  const all = [...data.table, ...data.hand, ...(data.others ?? []), ...data.decks.flatMap((d) => (d.discardTop ? [d.discardTop] : []))];
  const picked = all.find((c) => c.id === sel) ?? null;
  const pickedDeck = picked ? decks.get(picked.deckId) : undefined;
  const mineOnTable = picked?.pile === "table" && (isGm || picked.playedBy === me);
  const inMyHand = picked?.pile === "hand" && picked.holder === me;
  const inOtherHand = picked?.pile === "hand" && picked.holder !== me && isGm;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 12, fontSize: 12.5, color: C.text }}>
      {picked && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, marginBottom: 6 }}>
          <CardView card={picked} back={backOf(picked)} big />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
            <div style={{ color: C.muted, fontSize: 11.5 }}>
              {pickedDeck?.name ?? "A deck"}{picked.pile === "table" ? `, played by ${picked.playedBy === me ? "you" : nameOf(picked.playedBy)}` : picked.pile === "hand" && picked.holder !== me ? `, in ${nameOf(picked.holder)}'s hand` : picked.pile === "discard" ? ", top of the discards" : ""}
            </div>
            {inMyHand && <>
              <button type="button" disabled={busy} onClick={() => void move(picked, "table", true)} style={primary}>Play face up</button>
              <button type="button" disabled={busy} onClick={() => void move(picked, "table", false)} style={small}>Play face down</button>
              <button type="button" disabled={busy} onClick={() => void move(picked, "discard")} style={small}>Discard</button>
              {others.length > 0 && (
                <span style={{ display: "flex", gap: 4 }}>
                  <select aria-label="Pass to" value={passTo} onChange={(e) => setPassTo(e.target.value)} style={{ ...field, flex: 1, minWidth: 0 }}>
                    <option value="">Pass to...</option>
                    {others.map((s) => <option key={s.profileId} value={s.profileId}>{s.name}</option>)}
                  </select>
                  <button type="button" disabled={busy || !passTo} onClick={() => void move(picked, "hand", false, passTo)} style={small}>Pass</button>
                </span>
              )}
            </>}
            {mineOnTable && <>
              <button type="button" disabled={busy} onClick={() => void move(picked, "table", !picked.faceUp)} style={small}>{picked.faceUp ? "Turn face down" : "Reveal"}</button>
              <button type="button" disabled={busy} onClick={() => void move(picked, "discard")} style={small}>Discard</button>
              <button type="button" disabled={busy} onClick={() => void move(picked, "hand", false, me)} style={small}>Take into my hand</button>
            </>}
            {inOtherHand && <>
              <button type="button" disabled={busy} onClick={() => void move(picked, "discard")} style={small}>Discard it</button>
              <button type="button" disabled={busy} onClick={() => void move(picked, "hand", false, me)} style={small}>Take it</button>
            </>}
            {isGm && picked.pile === "discard" && <button type="button" disabled={busy} onClick={() => void move(picked, "hand", false, me)} style={small}>Take into my hand</button>}
            {isGm && picked.pile !== "draw" && <button type="button" disabled={busy} onClick={() => void move(picked, "draw")} style={small}>Back on top of the deck</button>}
            <button type="button" onClick={() => setSel(null)} style={{ ...small, color: C.muted }}>Close</button>
          </div>
        </div>
      )}
      {msg && <p role="status" style={{ color: "#e07a70", margin: "4px 0" }}>{msg}</p>}

      <div style={head}>On the table</div>
      {data.table.length === 0 ? <p style={{ color: C.muted, margin: 0 }}>No cards played.</p> : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {data.table.map((c) => <CardView key={c.id} card={c} back={backOf(c)} selected={sel === c.id} onClick={() => setSel(sel === c.id ? null : c.id)} />)}
        </div>
      )}

      <div style={head}>Your hand{data.hand.length ? ` (${data.hand.length})` : ""}</div>
      {data.hand.length === 0 ? <p style={{ color: C.muted, margin: 0 }}>No cards. Draw from a deck below{isGm ? "" : " when the GM allows it"}.</p> : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {data.hand.map((c) => <CardView key={c.id} card={c} back={backOf(c)} selected={sel === c.id} onClick={() => setSel(sel === c.id ? null : c.id)} />)}
        </div>
      )}

      {data.hands.filter((h) => h.holder !== me).length > 0 && (
        <>
          <div style={head}>Other hands</div>
          {data.hands.filter((h) => h.holder !== me).map((h) => (
            <div key={h.holder} style={{ marginBottom: 8 }}>
              <div style={{ color: C.muted, marginBottom: 4 }}>{h.name}: {h.count} {h.count === 1 ? "card" : "cards"}</div>
              {isGm && data.others && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {data.others.filter((c) => c.holder === h.holder).map((c) => <CardView key={c.id} card={c} back={backOf(c)} selected={sel === c.id} onClick={() => setSel(sel === c.id ? null : c.id)} />)}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <div style={head}>Decks</div>
      {data.decks.length === 0 && <p style={{ color: C.muted, margin: 0 }}>{isGm ? "No decks yet. Make one below: playing cards, or your own (a deck of omens, a tarot, the parts of a puzzle)." : "No decks at this table yet."}</p>}
      {data.decks.map((d) => <DeckRow key={d.id} deck={d} isGm={isGm} seats={seats} busy={busy} run={run} supabase={supabase} selected={sel} onPick={(id) => setSel(sel === id ? null : id)} />)}

      {isGm && (making
        ? <NewDeck campaignId={campaignId} supabase={supabase} onDone={async (m) => { setMaking(false); if (m) setMsg(m); await reload(); onChanged(); }} onCancel={() => setMaking(false)} />
        : <button type="button" onClick={() => setMaking(true)} style={{ ...small, marginTop: 10 }}>New deck</button>)}
    </div>
  );
}

function DeckRow({ deck, isGm, seats, busy, run, supabase, selected, onPick }: {
  deck: Deck; isGm: boolean; seats: Seat[]; busy: boolean; supabase: Supa; selected: string | null;
  run: (job: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => Promise<boolean>;
  onPick: (id: string) => void;
}) {
  const [dealTo, setDealTo] = useState("");
  const [count, setCount] = useState(1);
  const [confirm, setConfirm] = useState<"" | "gather" | "delete">("");
  const canDraw = isGm || deck.playersDraw;
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 9, padding: 8, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div aria-hidden style={{ width: 34, height: 48, borderRadius: 5, flex: "0 0 auto", border: "1px solid rgba(255,255,255,0.25)", background: `repeating-linear-gradient(45deg, ${deck.backColor}, ${deck.backColor} 5px, rgba(0,0,0,0.25) 5px, rgba(0,0,0,0.25) 10px)` }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{deck.name}</div>
          <div style={{ color: C.muted, fontSize: 11.5 }}>{deck.draw} to draw, {deck.discard} discarded, {deck.total} in all{!deck.playersDraw ? ". Only the GM draws." : ""}</div>
        </div>
        {deck.discardTop && <CardView card={deck.discardTop} back={deck.backColor} selected={selected === deck.discardTop.id} onClick={() => onPick(deck.discardTop!.id)} />}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
        {canDraw && <button type="button" disabled={busy || deck.draw === 0} onClick={() => void run(() => supabase.rpc("tabletop_deck_draw", { p_deck: deck.id, p_count: 1 }))} style={primary}>{deck.draw === 0 ? "Deck empty" : "Draw a card"}</button>}
        {isGm && (
          <>
            <select aria-label={`Deal from ${deck.name} to`} value={dealTo} onChange={(e) => setDealTo(e.target.value)} style={{ ...field, maxWidth: 130 }}>
              <option value="">Deal to...</option>
              {seats.map((s) => <option key={s.profileId} value={s.profileId}>{s.name}</option>)}
            </select>
            <input type="number" min={1} max={10} value={count} aria-label="How many to deal" onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} style={{ ...field, width: 48 }} />
            <button type="button" disabled={busy || !dealTo || deck.draw === 0} onClick={() => void run(() => supabase.rpc("tabletop_deck_deal", { p_deck: deck.id, p_to: dealTo, p_count: count }))} style={small}>Deal</button>
          </>
        )}
      </div>
      {isGm && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
          <button type="button" disabled={busy} onClick={() => void run(() => supabase.rpc("tabletop_deck_shuffle", { p_deck: deck.id, p_all: false }))} style={small}>{deck.discard ? "Shuffle the discards in" : "Shuffle"}</button>
          {confirm === "gather"
            ? <button type="button" disabled={busy} onClick={() => { setConfirm(""); void run(() => supabase.rpc("tabletop_deck_shuffle", { p_deck: deck.id, p_all: true })); }} style={{ ...small, background: "#d98a3a", color: "#1b1712", border: "none" }}>Take every card back, from hands too</button>
            : <button type="button" onClick={() => setConfirm("gather")} style={small}>Gather all</button>}
          <label style={{ display: "flex", gap: 4, alignItems: "center", color: C.muted }}>
            <input type="checkbox" checked={deck.playersDraw} onChange={(e) => void run(() => supabase.from("vtt_decks").update({ players_draw: e.target.checked, updated_at: new Date().toISOString() }).eq("id", deck.id))} style={{ accentColor: C.sun }} />Players draw
          </label>
          {confirm === "delete"
            ? <button type="button" disabled={busy} onClick={() => { setConfirm(""); void run(() => supabase.from("vtt_decks").delete().eq("id", deck.id)); }} style={{ ...small, background: "#e07a70", color: "#1b1712", border: "none", marginLeft: "auto" }}>Delete {deck.name} and its cards</button>
            : <button type="button" onClick={() => setConfirm("delete")} style={{ ...small, color: "#e07a70", marginLeft: "auto" }}>Delete</button>}
        </div>
      )}
    </div>
  );
}

function NewDeck({ campaignId, supabase, onDone, onCancel }: { campaignId: string; supabase: Supa; onDone: (msg: string | null) => void; onCancel: () => void }) {
  const [name, setName] = useState("Playing cards");
  const [kind, setKind] = useState<"standard" | "custom">("standard");
  const [jokers, setJokers] = useState(true);
  const [text, setText] = useState("");
  const [back, setBack] = useState(BACK_COLORS[0]);
  const [playersDraw, setPlayersDraw] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const parsed = useMemo(() => (kind === "custom" ? parseCustomDeck(text) : null), [kind, text]);
  const faces: CardFace[] = kind === "standard" ? standardDeck(jokers) : parsed?.cards ?? [];

  const create = async () => {
    const n = name.trim().slice(0, 60);
    if (!n) { setErr("Give the deck a name."); return; }
    if (!faces.length) { setErr("Add at least one card, one per line."); return; }
    setBusy(true); setErr(null);
    const { data: d, error: er } = await supabase.from("vtt_decks").insert({ campaign_id: campaignId, name: n, kind, back_color: back, players_draw: playersDraw }).select("id").single();
    if (er || !d) { setBusy(false); setErr(er?.message ?? "Could not make the deck."); return; }
    const id = (d as { id: string }).id;
    // a new deck starts shuffled
    const rows = shuffled(faces).map((f, i) => ({ deck_id: id, campaign_id: campaignId, name: f.name, body: f.body, suit: f.suit, rank: f.rank, ord: i + 1 }));
    const { error: er2 } = await supabase.from("vtt_cards").insert(rows);
    if (er2) { await supabase.from("vtt_decks").delete().eq("id", id); setBusy(false); setErr(`Could not add the cards: ${er2.message}`); return; }
    setBusy(false);
    onDone(null);
  };

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 9, padding: 10, marginTop: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>New deck</div>
      <label htmlFor="deck-name" style={{ display: "block", color: C.muted, fontSize: 11.5, marginBottom: 4 }}>Name</label>
      <input id="deck-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={{ ...field, width: "100%" }} />
      <div role="radiogroup" aria-label="What cards" style={{ display: "flex", gap: 6, margin: "8px 0" }}>
        <button type="button" role="radio" aria-checked={kind === "standard"} onClick={() => { setKind("standard"); if (!name.trim() || name === "My cards") setName("Playing cards"); }} style={{ ...small, ...(kind === "standard" ? { borderColor: C.sun, color: C.sun } : {}) }}>Playing cards</button>
        <button type="button" role="radio" aria-checked={kind === "custom"} onClick={() => { setKind("custom"); if (!name.trim() || name === "Playing cards") setName("My cards"); }} style={{ ...small, ...(kind === "custom" ? { borderColor: C.sun, color: C.sun } : {}) }}>My own cards</button>
      </div>
      {kind === "standard"
        ? <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={jokers} onChange={(e) => setJokers(e.target.checked)} style={{ accentColor: C.sun }} />Include two jokers ({jokers ? 54 : 52} cards)</label>
        : <>
            <label htmlFor="deck-cards" style={{ display: "block", color: C.muted, fontSize: 11.5, marginBottom: 4 }}>One card per line: Name | what it says. &quot;3x Name&quot; makes three. Up to {MAX_CARDS}.</label>
            <textarea id="deck-cards" value={text} rows={7} onChange={(e) => setText(e.target.value)} placeholder={"The Tower | Something you built falls.\nThe Star | Hope, from an unexpected place.\n2x Blank"} style={{ ...field, width: "100%", resize: "vertical", fontFamily: "inherit" }} />
            <div style={{ color: C.muted, fontSize: 11.5, marginTop: 2 }}>{faces.length} {faces.length === 1 ? "card" : "cards"}{parsed?.problems.length ? `. ${parsed.problems.join(" ")}` : ""}</div>
          </>}
      <div role="group" aria-label="Back colour" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <span style={{ color: C.muted, fontSize: 11.5 }}>Back</span>
        {BACK_COLORS.map((c) => <button key={c} type="button" aria-label={`Back colour ${c}`} aria-pressed={back === c} onClick={() => setBack(c)} style={{ width: 20, height: 26, borderRadius: 4, background: c, border: back === c ? "2px solid #fff" : `1px solid ${C.line}`, cursor: "pointer" }} />)}
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}><input type="checkbox" checked={playersDraw} onChange={(e) => setPlayersDraw(e.target.checked)} style={{ accentColor: C.sun }} />Players can draw from it</label>
      {err && <p role="status" style={{ color: "#e07a70", margin: "6px 0 0" }}>{err}</p>}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button type="button" disabled={busy} onClick={() => void create()} style={primary}>{busy ? "Making..." : "Make the deck"}</button>
        <button type="button" onClick={onCancel} style={small}>Cancel</button>
      </div>
    </div>
  );
}
