"use client";

// components/play-party.tsx (2026-11-07)
//
// Phase 5h: the party inventory, shared by everyone at the table (p116). It sits on the character
// sheet's Inventory tab under the character's own gear.
//
//   * The party's stacks and coins, live: Realtime on party_items and party_funds, with a slow poll
//     as a fallback, so a potion one player takes disappears from everyone's list.
//   * Give: move an item (or some of a stack) from this character's inventory to the party. The
//     party row is written first and the character's copy removed only after it lands, so a failed
//     write never loses the item.
//   * Take: party_take locks the stack, so two players can never both take the last one; what comes
//     back goes into this character's inventory unequipped and unattuned.
//   * Add loot found at the table straight to the party, by name (any player or the GM).
//   * Coins move between this character and the party through party_fund_change, which refuses to
//     take more than the party has.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, STONE, FORGE_FONTS, stonePanel, stoneButton } from "@/lib/forge-theme";
import { needsAttunement, type Build, type GearEntry, type RulesContext } from "@/lib/srd/derive-sheet";
import type { ItemRecord } from "@/lib/descriptions";
import { canEquip, parseWeight, type Coins } from "@/components/play-inventory";

type PartyItem = { id: string; name: string; qty: number; weight: number | null; note: string | null; custom: boolean; mod: number | null; variant: string | null; updated_at: string };
type Funds = { pp: number; gp: number; ep: number; sp: number; cp: number };
const COINS: (keyof Funds)[] = ["pp", "gp", "ep", "sp", "cp"];

export default function PlayParty({ campaignId, gear, onGear, coins, onCoins, itemByName, ctx, catalogNames }: {
  campaignId: string;
  gear: Build["gear"]; onGear: (items: GearEntry[], attuned: string[]) => void;
  coins: Coins; onCoins: (c: Coins) => void;
  itemByName: Record<string, ItemRecord>; ctx: Pick<RulesContext, "items" | "itemEffects" | "itemVariants">;
  catalogNames: string[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<PartyItem[] | null>(null);
  const [funds, setFunds] = useState<Funds>({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [give, setGive] = useState<{ idx: string; qty: string }>({ idx: "", qty: "1" });
  const [loot, setLoot] = useState<{ name: string; qty: string }>({ name: "", qty: "1" });
  const [coinMove, setCoinMove] = useState<{ coin: keyof Funds; amt: string }>({ coin: "gp", amt: "" });
  const [takeQty, setTakeQty] = useState<Record<string, string>>({});

  const box: React.CSSProperties = { ...stonePanel(), marginBottom: 0, padding: "12px 14px" };
  const btn = (on = false): React.CSSProperties => ({ ...stoneButton(on ? "primary" : "stone"), fontSize: 12.5, padding: "5px 10px" });
  const mono: React.CSSProperties = { fontFamily: FORGE_FONTS.mono };
  const tiny: React.CSSProperties = { ...mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: STONE.inkFaint };
  const field: React.CSSProperties = { padding: "6px 8px", borderRadius: 4, border: `1px solid ${STONE.hi}`, background: "rgba(0,0,0,0.25)", color: STONE.ink, fontSize: 13 };

  const load = useCallback(async () => {
    const [it, fu] = await Promise.all([
      supabase.from("party_items").select("id, name, qty, weight, note, custom, mod, variant, updated_at").eq("campaign_id", campaignId).order("name"),
      supabase.from("party_funds").select("pp, gp, ep, sp, cp").eq("campaign_id", campaignId).maybeSingle(),
    ]);
    if (it.error) { setErr(/does not exist|schema cache/.test(it.error.message) ? "The party inventory is not set up on this server yet (migration p116)." : `Could not read the party inventory: ${it.error.message}`); return; }
    setErr(null);
    setItems((it.data as PartyItem[]) ?? []);
    if (fu.data) setFunds(fu.data as Funds);
  }, [supabase, campaignId]);

  useEffect(() => {
    void load();
    const ch = supabase.channel(`party-${campaignId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "party_items", filter: `campaign_id=eq.${campaignId}` }, () => { void load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "party_funds", filter: `campaign_id=eq.${campaignId}` }, () => { void load(); })
      .subscribe();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 20000);
    return () => { clearInterval(id); void supabase.removeChannel(ch); };
  }, [supabase, campaignId, load]);

  const mine = gear?.items ?? [];
  // what this character can hand over: not worn or wielded, not a container with things in it
  const givable = mine.map((e, i) => ({ e, i })).filter(({ e }) =>
    !(canEquip(e, ctx, itemByName[e.n]) && e.eq !== false) && !(e.id && mine.some((x) => x.in === e.id)));
  const attunedNames = (list: GearEntry[]) => Array.from(new Set(list.filter((e) => e.att && needsAttunement(e.n, ctx)).map((e) => e.n)));

  const doGive = async () => {
    const g = givable.find((x) => String(x.i) === give.idx);
    if (!g) return;
    const have = Math.max(1, g.e.qty ?? 1);
    const n = Math.max(1, Math.min(have, parseInt(give.qty, 10) || 1));
    setBusy(true); setMsg(null);
    try {
      const each = g.e.wt ?? parseWeight((itemByName[g.e.n] as { weight?: unknown } | undefined)?.weight);
      const { error } = await supabase.from("party_items").insert({
        campaign_id: campaignId, name: g.e.n, qty: n, weight: each, note: g.e.note ?? null, custom: !!g.e.custom, mod: g.e.mod || null, variant: g.e.variant ?? null,
      });
      if (error) { setMsg({ text: `Could not give it: ${error.message}`, bad: true }); return; }
      // only now that the party has it does the character lose it
      const next = n >= have
        ? mine.filter((_, idx) => idx !== g.i)
        : mine.map((e, idx) => (idx === g.i ? { ...e, qty: have - n } : e));
      onGear(next, attunedNames(next));
      setMsg({ text: `${n > 1 ? `${n} x ` : ""}${g.e.n} given to the party.`, bad: false });
      setGive({ idx: "", qty: "1" });
      void load();
    } finally { setBusy(false); }
  };

  const doTake = async (p: PartyItem) => {
    const n = Math.max(1, Math.min(p.qty, parseInt(takeQty[p.id] ?? String(p.qty), 10) || p.qty));
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase.rpc("party_take", { p_item: p.id, p_qty: n });
      if (error) { setMsg({ text: error.message, bad: true }); void load(); return; }
      const t = data as { name: string; qty: number; weight: number | null; note: string | null; custom: boolean; mod: number | null; variant: string | null };
      const entry: GearEntry = { n: t.name, qty: t.qty };
      if (t.custom) entry.custom = true;
      if (t.weight != null && (t.custom || parseWeight((itemByName[t.name] as { weight?: unknown } | undefined)?.weight) === null)) entry.wt = t.weight;
      if (t.note) entry.note = t.note;
      if (t.mod) entry.mod = t.mod;
      if (t.variant) entry.variant = t.variant;
      // taken things arrive in the pack: unequipped, and unattuned where that matters
      if (canEquip(entry, ctx, itemByName[entry.n])) entry.eq = false;
      if (!entry.custom && needsAttunement(entry.n, ctx)) entry.att = false;
      // a stackable item joins the matching stack already carried (not one in a container) instead of a second row
      const stackable = entry.eq === undefined && entry.att === undefined;
      const at = stackable ? mine.findIndex((e) => e.n === entry.n && !e.in && !!e.custom === !!entry.custom && (e.mod || 0) === (entry.mod || 0) && (e.variant ?? "") === (entry.variant ?? "")) : -1;
      const next = at >= 0 ? mine.map((e, idx) => (idx === at ? { ...e, qty: Math.max(1, e.qty ?? 1) + t.qty } : e)) : [...mine, entry];
      onGear(next, attunedNames(next));
      setMsg({ text: `You took ${t.qty > 1 ? `${t.qty} x ` : ""}${t.name}.`, bad: false });
      void load();
    } finally { setBusy(false); }
  };

  const doLoot = async () => {
    const name = loot.name.trim().slice(0, 80);
    if (!name) return;
    setBusy(true); setMsg(null);
    try {
      const known = !!itemByName[name];
      const each = known ? parseWeight((itemByName[name] as { weight?: unknown }).weight) : null;
      const { error } = await supabase.from("party_items").insert({ campaign_id: campaignId, name, qty: Math.max(1, Math.min(9999, parseInt(loot.qty, 10) || 1)), weight: each, custom: !known });
      if (error) { setMsg({ text: `Could not add it: ${error.message}`, bad: true }); return; }
      setMsg({ text: `${name} added to the party inventory.`, bad: false });
      setLoot({ name: "", qty: "1" });
      void load();
    } finally { setBusy(false); }
  };

  const moveCoins = async (dir: "in" | "out") => {
    const n = parseInt(coinMove.amt, 10);
    if (!(n > 0)) return;
    const k = coinMove.coin;
    if (dir === "in" && (Number(coins[k]) || 0) < n) { setMsg({ text: `You have only ${Number(coins[k]) || 0} ${k}.`, bad: true }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase.rpc("party_fund_change", { p_campaign: campaignId, p_delta: { [k]: dir === "in" ? n : -n } });
      if (error) { setMsg({ text: error.message, bad: true }); return; }
      setFunds(data as Funds);
      onCoins({ ...coins, [k]: Math.max(0, (Number(coins[k]) || 0) + (dir === "in" ? -n : n)) });
      setMsg({ text: dir === "in" ? `${n} ${k} put in the party's purse.` : `${n} ${k} taken from the party's purse.`, bad: false });
      setCoinMove({ ...coinMove, amt: "" });
    } finally { setBusy(false); }
  };

  const weight = (items ?? []).reduce((n, p) => n + (p.weight ?? 0) * p.qty, 0);
  return (
    <section aria-label="Party inventory" style={{ ...box, marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={tiny}>Party inventory</div>
        {items && <span style={{ fontSize: 12.5, color: STONE.inkFaint }}>{items.length} stack{items.length === 1 ? "" : "s"}{weight ? `, ${Math.round(weight * 10) / 10} lb` : ""}, shared by the table</span>}
      </div>
      {err && <p role="alert" style={{ fontSize: 12.5, color: C.warn, margin: "8px 0 0" }}>{err}</p>}
      {!err && items === null && <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: "8px 0 0" }}>Loading&hellip;</p>}
      {!err && items && items.length === 0 && <p style={{ fontSize: 13, color: STONE.inkFaint, margin: "8px 0 0" }}>The party holds nothing yet. Give something from your inventory or add loot below.</p>}
      {!err && items && items.map((p) => (
        <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 0", borderBottom: `1px solid ${STONE.hi}` }}>
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            <div style={{ fontSize: 13.5, color: STONE.ink }}>{p.name}{p.mod ? ` +${p.mod}` : ""}{p.variant ? ` (${p.variant})` : ""}{p.qty > 1 ? ` x${p.qty}` : ""}</div>
            <div style={{ fontSize: 11, color: STONE.inkFaint }}>{[p.custom ? "found item" : null, p.weight != null ? `${p.weight} lb each` : null, p.note].filter(Boolean).join(" · ")}</div>
          </div>
          {p.qty > 1 && (
            <input type="number" min={1} max={p.qty} aria-label={`How many ${p.name} to take`} value={takeQty[p.id] ?? String(p.qty)}
              onChange={(e) => setTakeQty({ ...takeQty, [p.id]: e.target.value.replace(/\D/g, "").slice(0, 4) })} style={{ ...field, width: 60 }} />
          )}
          <button type="button" className="forge-btn" disabled={busy} onClick={() => void doTake(p)} aria-label={`Take ${p.name}`} style={btn()}>Take</button>
          <button type="button" className="forge-btn" disabled={busy} title="Remove it from the party inventory without taking it (spent, sold, lost)"
            onClick={async () => { setBusy(true); const { error } = await supabase.from("party_items").delete().eq("id", p.id); setBusy(false); if (error) setMsg({ text: error.message, bad: true }); else { setMsg({ text: `${p.name} removed from the party inventory.`, bad: false }); void load(); } }}
            aria-label={`Remove ${p.name} from the party`} style={btn()}>Remove</button>
        </div>
      ))}

      {!err && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: STONE.ink, minWidth: 90 }}>Give</span>
            <select aria-label="Item to give to the party" value={give.idx} onChange={(e) => setGive({ idx: e.target.value, qty: "1" })} style={{ ...field, flex: "1 1 180px" }}>
              <option value="">Something from your inventory</option>
              {givable.map(({ e, i }) => <option key={i} value={i}>{e.n}{e.qty && e.qty > 1 ? ` (x${e.qty})` : ""}</option>)}
            </select>
            {(() => { const g = givable.find((x) => String(x.i) === give.idx); return g && (g.e.qty ?? 1) > 1 ? (
              <input type="number" min={1} max={g.e.qty} aria-label="How many to give" value={give.qty} onChange={(e) => setGive({ ...give, qty: e.target.value.replace(/\D/g, "").slice(0, 4) })} style={{ ...field, width: 60 }} />
            ) : null; })()}
            <button type="button" className="forge-btn" disabled={busy || !give.idx} onClick={() => void doGive()} style={btn()}>Give to the party</button>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: STONE.ink, minWidth: 90 }}>Found loot</span>
            <input aria-label="Loot name" list="party-loot-names" value={loot.name} onChange={(e) => setLoot({ ...loot, name: e.target.value.slice(0, 80) })} placeholder="Item name" style={{ ...field, flex: "1 1 180px" }} />
            <datalist id="party-loot-names">{catalogNames.slice(0, 3000).map((n) => <option key={n} value={n} />)}</datalist>
            <input type="number" min={1} aria-label="How many found" value={loot.qty} onChange={(e) => setLoot({ ...loot, qty: e.target.value.replace(/\D/g, "").slice(0, 4) })} style={{ ...field, width: 60 }} />
            <button type="button" className="forge-btn" disabled={busy || !loot.name.trim()} onClick={() => void doLoot()} style={btn()}>Add to the party</button>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: STONE.ink, minWidth: 90 }}>Purse</span>
            <span style={{ ...mono, fontSize: 12.5, color: STONE.ink }} aria-label="The party's coins">{COINS.map((k) => `${funds[k]} ${k}`).join(" · ")}</span>
            <span style={{ flex: 1 }} />
            <input inputMode="numeric" aria-label="Coins to move" value={coinMove.amt} onChange={(e) => setCoinMove({ ...coinMove, amt: e.target.value.replace(/\D/g, "").slice(0, 7) })} placeholder="amount" style={{ ...field, width: 74 }} />
            <select aria-label="Which coin" value={coinMove.coin} onChange={(e) => setCoinMove({ ...coinMove, coin: e.target.value as keyof Funds })} style={{ ...field, width: "auto" }}>
              {COINS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" className="forge-btn" disabled={busy || !(parseInt(coinMove.amt, 10) > 0)} onClick={() => void moveCoins("in")} style={btn()}>Put in</button>
            <button type="button" className="forge-btn" disabled={busy || !(parseInt(coinMove.amt, 10) > 0)} onClick={() => void moveCoins("out")} style={btn()}>Take out</button>
          </div>
        </div>
      )}
      {msg && <p role={msg.bad ? "alert" : "status"} style={{ fontSize: 12.5, color: msg.bad ? C.warn : C.plum, margin: "8px 0 0" }}>{msg.text}</p>}
    </section>
  );
}
