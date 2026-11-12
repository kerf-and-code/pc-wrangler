"use client";

// app/initiative/page.tsx
//
// The players' view of a fight the GM is running on /gm/combat: whose turn it is, the order, the
// round, and conditions on player characters. It reads combat_for_player(share) (p101), a SECURITY
// DEFINER function keyed by the campaign share code like every other player page, which never returns
// monster HP, AC or stat blocks and leaves out monsters the GM has hidden.
//
// Polls every few seconds rather than subscribing to realtime: combats rows are GM-only under RLS, so
// a player cannot subscribe to them, and a short poll of one small function is cheap and robust.
//
// Push 45 (audit round 2, U14, LV11): this is the page the Combat page sends players to, and it could
// not show or answer a saving throw waiting on them. A signed-in player now gets their own characters
// here (initiative_my_characters, p168): a save waiting on one shows above the order with Roll (the
// bonus off the saved sheet) and "I rolled", and the result stays for ten minutes after.

import React, { useEffect, useMemo, useState } from "react";
import PageShell from "@/components/page-shell";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";
import { ConnectProblem, LinkInvalid } from "@/components/load-problem";
import { SaveBanner, type FightEntry, type FightView } from "@/components/fight-controls";
import { lastSaveLine } from "@/components/fight-card";

type Mine = { campaign: string; characters: { id: string; name: string; saves: Record<string, number> | null }[] } | null;

type Entry = { id: string; name: string; kind: string; initiative: number | null; defeated: boolean; is_turn: boolean; conditions: string[] };
type Fight = { name: string; round: number; order: Entry[] } | null;

const POLL_MS = 4000;

export default function PlayerInitiativePage() {
  const supabase = useMemo(() => createClient(), []);
  const [share, setShare] = useState<string | null | undefined>(undefined);
  const [fight, setFight] = useState<Fight>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [mine, setMine] = useState<Mine>(null);
  const [view, setView] = useState<FightView | null>(null);

  useEffect(() => {
    (async () => {
      const code = new URLSearchParams(window.location.search).get("share");
      if (!code) { setShare(null); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) { setOffline(true); return; } // audit U9: a sign-in failure is not a bad link
      }
      setShare(code);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!share) return;
    let off = false;
    let me: Mine = null;
    const read = async () => {
      const { data, error } = await supabase.rpc("combat_for_player", { p_share: share });
      if (off) return;
      if (error) setErr(error.message.includes("does not exist") ? "Your GM's combat tracker is not set up yet." : "Could not read the fight. Retrying…");
      else { setErr(null); setFight((data as Fight) ?? null); }
      setLoaded(true);
      // your own characters' side of the fight: saves waiting on them (signed in, with a character here)
      if (me?.characters.length) {
        const { data: v } = await supabase.rpc("tabletop_combat", { p_campaign: me.campaign });
        if (!off) setView((v as FightView | null) ?? null);
      }
    };
    void (async () => {
      const { data: m } = await supabase.rpc("initiative_my_characters", { p_share: share });
      if (off) return;
      me = (m as Mine) ?? null;
      setMine(me);
      if (me?.characters.length) void read();
    })();
    void read();
    const t = setInterval(() => { if (document.visibilityState === "visible") void read(); }, POLL_MS);
    return () => { off = true; clearInterval(t); };
  }, [share, supabase]);

  const turn = fight?.order.find((e) => e.is_turn) ?? null;

  return (
    <PageShell width={640}>
      <h1 style={{ fontFamily: SAX.serif, fontSize: 30, margin: "4px 0 2px", color: C.text }}>Initiative</h1>
      {share === undefined && !offline && <p role="status" style={{ color: C.muted }}>Loading…</p>}
      {offline && <ConnectProblem />}
      {share === null && <LinkInvalid />}
      {share && loaded && !fight && !err && (
        <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>No fight right now. When your GM starts one, the turn order shows up here on its own.</p>
      )}
      {err && <p role="alert" style={{ color: C.warn, fontSize: 13 }}>{err}</p>}
      {fight && (
        <>
          <p style={{ color: C.muted, fontSize: 14, margin: "0 0 14px" }}>
            {fight.name} · Round {fight.round}
            {turn && <> · <strong style={{ color: C.sun }}>{turn.name}</strong>&apos;s turn</>}
          </p>
          {mine && view && mine.characters.map((ch) => {
            const e = view.order.find((x) => x.characterId === ch.id && x.mine) as FightEntry | undefined;
            if (!e) return null;
            const recent = e.lastSave && Date.now() / 1000 - Number(e.lastSave.at) < 600;
            if (!(e.pendingSaves ?? []).length && !recent) return null;
            return (
              <div key={ch.id} style={{ marginBottom: 14 }}>
                {(e.pendingSaves ?? []).length > 0 && (
                  <SaveBanner campaignId={mine.campaign} characterId={ch.id} entry={e} saves={ch.saves} onDone={() => {
                    void supabase.rpc("tabletop_combat", { p_campaign: mine.campaign }).then(({ data: v }) => setView((v as FightView | null) ?? null));
                  }} />
                )}
                {recent && !(e.pendingSaves ?? []).length && e.lastSave && (
                  <p role="status" style={{ fontSize: 13.5, color: C.text, margin: 0 }}>{ch.name}: {lastSaveLine(e.lastSave)}</p>
                )}
              </div>
            );
          })}
          <ol aria-live="polite" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {fight.order.map((e) => (
              <li key={e.id} style={{
                background: C.panel, border: `1px solid ${e.is_turn ? C.sun : C.line}`, borderLeft: `4px solid ${e.is_turn ? C.sun : "transparent"}`,
                borderRadius: FORGE_RADIUS, padding: "12px 14px", opacity: e.defeated ? 0.5 : 1,
                display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
              }}>
                <span style={{ fontFamily: SAX.mono, fontSize: 15, color: C.muted, minWidth: 28, textAlign: "right" }}>{e.initiative ?? "-"}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: C.text, textDecoration: e.defeated ? "line-through" : undefined }}>{e.name}</span>
                {e.is_turn && <span style={{ fontSize: 11, color: C.sun, fontWeight: 700 }}>TURN</span>}
                {e.conditions.map((k) => (
                  <span key={k} style={{ fontSize: 11.5, color: C.text, background: "rgba(200,162,75,0.12)", border: `1px solid ${C.line}`, borderRadius: 999, padding: "1px 8px" }}>{k}</span>
                ))}
              </li>
            ))}
          </ol>
        </>
      )}
    </PageShell>
  );
}
