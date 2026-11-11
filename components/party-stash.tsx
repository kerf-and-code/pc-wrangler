"use client";

// components/party-stash.tsx (2026-11-10, push 20, audit G10)
//
// The party inventory (p116) without a character sheet: for the GM on Tonight, and for players in a
// system whose sheet has no inventory yet (anything but D&D 5e). The character sheet keeps its own
// version (components/play-party.tsx) with Give and Take, which move things in and out of that
// character's gear; here there is no character, so:
//   * the list shows every stack, with - and + to change a count and Remove for spent, sold or lost;
//   * Found loot adds a stack by name. For a D&D campaign the item list loads the first time the field
//     is used, so a known item keeps its catalogue weight and plays as itself when a player takes it;
//     anything else is marked as a found item;
//   * the purse takes coins in and pays them out through party_fund_change, which refuses to go below
//     zero.
// Same live updates as the sheet: Realtime on both tables, with a slow poll behind it.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, STONE, FORGE_FONTS, stonePanel, stoneButton } from "@/lib/forge-theme";
import { parseWeight } from "@/components/play-inventory";
import { notReady } from "@/lib/friendly-error";

type PartyItem = { id: string; name: string; qty: number; weight: number | null; note: string | null; custom: boolean; mod: number | null; variant: string | null };
type Funds = { pp: number; gp: number; ep: number; sp: number; cp: number };
const COINS: (keyof Funds)[] = ["pp", "gp", "ep", "sp", "cp"];
type Catalog = Map<string, number | null>;

async function loadCatalog(ruleset: "2014" | "2024"): Promise<Catalog> {
  const [eq, mi] = ruleset === "2014"
    ? await Promise.all([import("@/lib/srd/equipment-2014.json"), import("@/lib/srd/magic-items-2014.json")])
    : await Promise.all([import("@/lib/srd/equipment-2024.json"), import("@/lib/srd/magic-items-2024.json")]);
  const out: Catalog = new Map();
  for (const list of [eq.default, mi.default] as unknown as { name: string; weight?: unknown }[][]) {
    for (const r of list) if (r?.name && !out.has(r.name)) out.set(r.name, parseWeight(r.weight));
  }
  return out;
}

export default function PartyStash({ campaignId, ruleset, title = "Party inventory", lead }: {
  campaignId: string;
  /** The D&D ruleset for the item list, or null for a system without one (every item is a found item). */
  ruleset: "2014" | "2024" | null;
  title?: string;
  lead?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<PartyItem[] | null>(null);
  const [funds, setFunds] = useState<Funds>({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loot, setLoot] = useState<{ name: string; qty: string }>({ name: "", qty: "1" });
  const [coinMove, setCoinMove] = useState<{ coin: keyof Funds; amt: string }>({ coin: "gp", amt: "" });
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogAsked, setCatalogAsked] = useState(false);

  const box: React.CSSProperties = { ...stonePanel(), marginBottom: 0, padding: "12px 14px" };
  const btn: React.CSSProperties = { ...stoneButton("stone"), fontSize: 12.5, padding: "5px 10px", minHeight: "var(--sax-tap, 0px)" };
  const mono: React.CSSProperties = { fontFamily: FORGE_FONTS.mono };
  const tiny: React.CSSProperties = { ...mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: STONE.inkFaint };
  const field: React.CSSProperties = { padding: "6px 8px", borderRadius: 4, border: `1px solid ${STONE.hi}`, background: "rgba(0,0,0,0.25)", color: STONE.ink, fontSize: 13 };

  const load = useCallback(async () => {
    const [it, fu] = await Promise.all([
      supabase.from("party_items").select("id, name, qty, weight, note, custom, mod, variant").eq("campaign_id", campaignId).order("name"),
      supabase.from("party_funds").select("pp, gp, ep, sp, cp").eq("campaign_id", campaignId).maybeSingle(),
    ]);
    if (it.error) { setErr(/does not exist|schema cache/.test(it.error.message) ? notReady("The party inventory", "p116") : `Could not read the party inventory: ${it.error.message}`); return; }
    setErr(null);
    setItems((it.data as PartyItem[]) ?? []);
    setFunds((fu.data as Funds | null) ?? { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
  }, [supabase, campaignId]);

  useEffect(() => {
    setItems(null); setMsg(null);
    void load();
    const ch = supabase.channel(`party-stash-${campaignId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "party_items", filter: `campaign_id=eq.${campaignId}` }, () => { void load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "party_funds", filter: `campaign_id=eq.${campaignId}` }, () => { void load(); })
      .subscribe();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 20000);
    return () => { clearInterval(id); void supabase.removeChannel(ch); };
  }, [supabase, campaignId, load]);

  const askCatalog = () => {
    if (catalogAsked || !ruleset) return;
    setCatalogAsked(true);
    loadCatalog(ruleset).then(setCatalog).catch(() => setCatalog(new Map()));
  };
  const names = useMemo(() => (catalog ? Array.from(catalog.keys()).sort() : []), [catalog]);

  async function setQty(p: PartyItem, qty: number) {
    if (qty < 1 || qty > 9999 || qty === p.qty) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("party_items").update({ qty, updated_at: new Date().toISOString() }).eq("id", p.id);
    setBusy(false);
    if (error) { setMsg({ text: `Could not change it: ${error.message}`, bad: true }); return; }
    setItems((xs) => (xs ?? []).map((x) => (x.id === p.id ? { ...x, qty } : x)));
  }

  async function remove(p: PartyItem) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("party_items").delete().eq("id", p.id);
    setBusy(false);
    if (error) { setMsg({ text: error.message, bad: true }); return; }
    setMsg({ text: `${p.name} removed from the party inventory.`, bad: false });
    void load();
  }

  async function addLoot() {
    const name = loot.name.trim().slice(0, 80);
    if (!name) return;
    setBusy(true); setMsg(null);
    try {
      const known = !!catalog?.has(name);
      const qty = Math.max(1, Math.min(9999, parseInt(loot.qty, 10) || 1));
      const { error } = await supabase.from("party_items").insert({ campaign_id: campaignId, name, qty, weight: known ? catalog!.get(name) ?? null : null, custom: !known });
      if (error) { setMsg({ text: `Could not add it: ${error.message}`, bad: true }); return; }
      setMsg({ text: `${qty > 1 ? `${qty} x ` : ""}${name} added to the party inventory.`, bad: false });
      setLoot({ name: "", qty: "1" });
      void load();
    } finally { setBusy(false); }
  }

  async function moveCoins(dir: "in" | "out") {
    const n = parseInt(coinMove.amt, 10);
    if (!(n > 0)) return;
    const k = coinMove.coin;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("party_fund_change", { p_campaign: campaignId, p_delta: { [k]: dir === "in" ? n : -n } });
    setBusy(false);
    if (error) { setMsg({ text: error.message, bad: true }); return; }
    setFunds(data as Funds);
    setMsg({ text: dir === "in" ? `${n} ${k} added to the party's purse.` : `${n} ${k} paid out of the party's purse.`, bad: false });
    setCoinMove({ ...coinMove, amt: "" });
  }

  const weight = (items ?? []).reduce((n, p) => n + (p.weight ?? 0) * p.qty, 0);
  const amt = parseInt(coinMove.amt, 10) > 0;
  return (
    <section aria-label={title} style={box}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 style={{ ...tiny, margin: 0, fontWeight: 400 }}>{title}</h2>
        {items && <span style={{ fontSize: 12.5, color: STONE.inkFaint }}>{items.length} stack{items.length === 1 ? "" : "s"}{weight ? `, ${Math.round(weight * 10) / 10} lb` : ""}, shared by the table</span>}
      </div>
      {lead && <p style={{ fontSize: 13, color: STONE.inkFaint, margin: "6px 0 0", lineHeight: 1.5 }}>{lead}</p>}
      {err && <p role="alert" style={{ fontSize: 12.5, color: C.warn, margin: "8px 0 0" }}>{err}</p>}
      {!err && items === null && <p role="status" style={{ fontSize: 12.5, color: STONE.inkFaint, margin: "8px 0 0" }}>Loading...</p>}
      {!err && items && items.length === 0 && <p style={{ fontSize: 13, color: STONE.inkFaint, margin: "8px 0 0" }}>The party holds nothing yet. Add loot below.</p>}
      {!err && items && items.map((p) => (
        <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 0", borderBottom: `1px solid ${STONE.hi}` }}>
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            <div style={{ fontSize: 13.5, color: STONE.ink }}>{p.name}{p.mod ? ` +${p.mod}` : ""}{p.variant ? ` (${p.variant})` : ""}</div>
            <div style={{ fontSize: 11, color: STONE.inkFaint }}>{[p.custom ? "found item" : null, p.weight != null ? `${p.weight} lb each` : null, p.note].filter(Boolean).join(" · ")}</div>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <button type="button" className="forge-btn" disabled={busy || p.qty <= 1} onClick={() => void setQty(p, p.qty - 1)}
              title={p.qty <= 1 ? "Use Remove to take the last one out" : undefined} aria-label={`One fewer ${p.name}`} style={btn}>-</button>
            <span style={{ ...mono, fontSize: 13, color: STONE.ink, minWidth: 34, textAlign: "center" }} aria-label={`${p.qty} ${p.name}`}>x{p.qty}</span>
            <button type="button" className="forge-btn" disabled={busy || p.qty >= 9999} onClick={() => void setQty(p, p.qty + 1)} aria-label={`One more ${p.name}`} style={btn}>+</button>
          </span>
          <button type="button" className="forge-btn" disabled={busy} title="Take it out of the party inventory (spent, sold, lost or handed to someone)"
            onClick={() => void remove(p)} aria-label={`Remove ${p.name} from the party`} style={btn}>Remove</button>
        </div>
      ))}

      {!err && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <label htmlFor={`stash-loot-${campaignId}`} style={{ fontSize: 12.5, color: STONE.ink, minWidth: 90 }}>Found loot</label>
            <input id={`stash-loot-${campaignId}`} list={`stash-names-${campaignId}`} value={loot.name} onFocus={askCatalog}
              onChange={(e) => setLoot({ ...loot, name: e.target.value.slice(0, 80) })} placeholder="Item name" style={{ ...field, flex: "1 1 180px" }} />
            {names.length > 0 && <datalist id={`stash-names-${campaignId}`}>{names.slice(0, 3000).map((n) => <option key={n} value={n} />)}</datalist>}
            <input type="number" min={1} aria-label="How many found" value={loot.qty} onChange={(e) => setLoot({ ...loot, qty: e.target.value.replace(/\D/g, "").slice(0, 4) })} style={{ ...field, width: 60 }} />
            <button title={!loot.name.trim() ? "Name the item first" : undefined} type="button" className="forge-btn" disabled={busy || !loot.name.trim()} onClick={() => void addLoot()} style={btn}>Add to the party</button>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: STONE.ink, minWidth: 90 }}>Purse</span>
            <span style={{ ...mono, fontSize: 12.5, color: STONE.ink }} aria-label="The party's coins">{COINS.map((k) => `${funds[k]} ${k}`).join(" · ")}</span>
            <span style={{ flex: 1 }} />
            <input inputMode="numeric" aria-label="Coins to add or pay out" value={coinMove.amt} onChange={(e) => setCoinMove({ ...coinMove, amt: e.target.value.replace(/\D/g, "").slice(0, 7) })} placeholder="amount" style={{ ...field, width: 74 }} />
            <select aria-label="Which coin" value={coinMove.coin} onChange={(e) => setCoinMove({ ...coinMove, coin: e.target.value as keyof Funds })} style={{ ...field, width: "auto" }}>
              {COINS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button title={!amt ? "Type an amount first" : undefined} type="button" className="forge-btn" disabled={busy || !amt} onClick={() => void moveCoins("in")} style={btn}>Add</button>
            <button title={!amt ? "Type an amount first" : undefined} type="button" className="forge-btn" disabled={busy || !amt} onClick={() => void moveCoins("out")} style={btn}>Pay out</button>
          </div>
        </div>
      )}
      {msg && <p role={msg.bad ? "alert" : "status"} style={{ fontSize: 12.5, color: msg.bad ? C.warn : C.plum, margin: "8px 0 0" }}>{msg.text}</p>}
    </section>
  );
}
