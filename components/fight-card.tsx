"use client";

// components/fight-card.tsx (2026-11-07)
//
// The running fight, on a player's character sheet. It shows what the GM's Combat page and the tabletop
// show for this character (HP, temporary HP, conditions and effects, whose turn it is) and lets the
// player act on it: heal, take damage, set temporary HP, add or remove their own conditions, and mark
// their effects on allies and monsters, and attack a monster they pick (components/fight-controls.tsx,
// combat_act and the attack functions in p110). Affecting anyone else waits for this character's turn.
//
// When the fight has no max HP or AC for this character yet, the card fills them in from the sheet
// once (sync_sheet fills only what is empty, so a GM's own numbers are never overwritten).
//
// Saves (phase 4b, p111): an effect that calls for a save waits on the character until the player
// rolls it here (or on the tabletop); the bonus comes from the sheet. The six saving throws sit on the
// card too, ready to roll into table chat.
//
// Players cannot read combats directly or get its live updates (RLS), so the card reads
// tabletop_combat: every 5 seconds while a fight runs, every 20 while none does, and at once after
// each change made here.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { openTabletop } from "@/lib/tabletop/open";
import { AttackForm, combatAct, isMyTurn, MarkerChips, PlayerEntryControls, SaveBanner, SavesRow, type FightEntry, type FightView } from "@/components/fight-controls";

export default function FightCard({ campaignId, characterId, sheet }: {
  campaignId: string; characterId: string;
  sheet?: { ac: number; hpMax: number; saves?: Record<string, number>; saveProfs?: string[]; spellDc?: number | null } | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [fight, setFight] = useState<FightView | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const synced = useRef<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("tabletop_combat", { p_campaign: campaignId });
    if (error) { setErr(/not at this table/.test(error.message) ? null : `Could not read the fight: ${error.message}`); setFight(null); return; }
    setErr(null);
    setFight((data as FightView | null) ?? null);
  }, [supabase, campaignId]);

  useEffect(() => { void load(); }, [load]);
  const running = !!fight;
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) void load(); }, running ? 5000 : 20000);
    return () => clearInterval(id);
  }, [load, running]);

  const me: FightEntry | null = fight?.order.find((e) => e.characterId === characterId) ?? null;

  // Bring the sheet's max HP and AC into the fight once, where the fight has none.
  useEffect(() => {
    if (!fight || !me || !me.mine || !sheet || synced.current === fight.id) return;
    if (me.maxHp != null && me.ac != null) { synced.current = fight.id; return; }
    synced.current = fight.id;
    void combatAct(supabase as never, fight.id, me.id, "sync_sheet", { value: sheet.hpMax > 0 ? sheet.hpMax : null, ac: sheet.ac > 0 ? sheet.ac : null })
      .then((e) => { if (e) setErr(e); else void load(); });
  }, [fight, me, sheet, supabase, load]);

  const box: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "14px 16px", margin: "0 0 14px" };
  const btn: React.CSSProperties = { padding: "6px 12px", background: "transparent", color: C.sun, border: `1px solid ${C.sun}`, borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" };

  if (fight === undefined) return null;
  if (!fight) {
    return (
      <div style={{ ...box, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: C.muted, fontSize: 13 }}>No fight running right now. When the GM starts one, your HP and conditions show here.</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => openTabletop(campaignId)} style={btn}>Open the tabletop</button>
        {err && <span role="alert" style={{ color: "#e07a70", fontSize: 12 }}>{err}</span>}
      </div>
    );
  }

  const cur = fight.order.find((e) => e.is_turn);
  const myTurn = isMyTurn(fight, characterId);
  const frac = me && me.hp != null && me.maxHp ? Math.max(0, Math.min(1, me.hp / me.maxHp)) : null;
  return (
    <section style={box} aria-label="The running fight">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ color: C.text, fontSize: 15 }}>In the fight: {fight.name}</strong>
        <span style={{ color: C.sun, fontSize: 13 }}>Round {fight.round}{cur ? ` · ${cur.mine ? "your" : `${cur.name}'s`} turn` : ""}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => openTabletop(campaignId)} style={btn}>Open the tabletop</button>
      </div>

      {!me && <p style={{ color: C.muted, fontSize: 13, margin: "10px 0 0" }}>This character is not in the fight. The GM adds them from the Combat page or the tabletop.</p>}
      {me && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 26, fontWeight: 700, color: C.text }}>{me.hp ?? "?"}<span style={{ fontSize: 15, color: C.muted }}> / {me.maxHp ?? "?"} HP</span></span>
            {!!me.tempHp && <span style={{ color: "#6fa3d8", fontSize: 14 }}>+{me.tempHp} temp</span>}
            {me.ac != null && <span style={{ color: C.muted, fontSize: 13 }}>AC {me.ac}</span>}
            {me.defeated && <span style={{ color: "#e07a70", fontSize: 13 }}>down</span>}
          </div>
          {frac != null && (
            <div style={{ height: 6, background: "#2a241d", borderRadius: 3, margin: "6px 0 8px" }}>
              <div style={{ width: `${frac * 100}%`, height: 6, borderRadius: 3, background: frac > 0.5 ? "#5fae5a" : frac > 0.25 ? "#d9a43a" : "#d0463c" }} />
            </div>
          )}
          <MarkerChips list={me.conditions ?? []} />
          {me.mine && (me.pendingSaves ?? []).length > 0 && (
            <div style={{ marginTop: 10 }}><SaveBanner campaignId={campaignId} characterId={characterId} entry={me} saves={sheet?.saves ?? null} onDone={() => void load()} /></div>
          )}
          {me.mine && me.lastSave && (
            <p style={{ fontSize: 12.5, color: C.muted, margin: "8px 0 0" }}>
              Last save: {me.lastSave.label} from {me.lastSave.by}, {me.lastSave.total} vs DC {me.lastSave.dc}, {me.lastSave.saved ? "saved" : "failed"}{me.lastSave.damage ? `, ${me.lastSave.damage} damage` : ""}.
            </p>
          )}
          {me.mine && sheet?.saves && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>Saving throws</div>
              <SavesRow campaignId={campaignId} characterId={characterId} saves={sheet.saves} profs={sheet.saveProfs} />
            </div>
          )}
          {me.mine ? (
            <>
              <div style={{ marginTop: 10 }}><PlayerEntryControls fightId={fight.id} entry={me} onChanged={() => void load()} /></div>
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: myTurn ? C.sun : C.muted, marginBottom: 6 }}>{myTurn ? "Your turn: attack" : "Attack"}</div>
                <AttackForm campaignId={campaignId} characterId={characterId} fight={fight} onDone={() => void load()} defaultDc={sheet?.spellDc ?? null} />
              </div>
            </>
          ) : (
            <p style={{ color: C.muted, fontSize: 12.5, margin: "8px 0 0" }}>Only this character&apos;s player and the GM can change it.</p>
          )}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>Turn order</div>
        <div style={{ display: "grid", gap: 6 }}>
          {fight.order.filter((e) => e.id !== me?.id).map((e) => {
            const open = openId === e.id;
            return (
              <div key={e.id} style={{ border: `1px solid ${e.is_turn ? C.sun : C.line}`, borderRadius: 8, padding: "6px 9px", opacity: e.defeated ? 0.55 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ width: 26, textAlign: "center", fontWeight: 700, color: C.muted }}>{e.initiative ?? "?"}</span>
                  <span style={{ color: C.text, fontSize: 13.5, fontWeight: e.is_turn ? 700 : 500, textDecoration: e.defeated ? "line-through" : "none" }}>{e.name}</span>
                  {e.kind === "pc" && e.hp != null && <span style={{ fontSize: 12, color: C.muted }}>{e.hp}{e.maxHp ? `/${e.maxHp}` : ""}</span>}
                  {e.awaitingSave && <span style={{ fontSize: 11, color: "#e07a70" }}>saving throw due</span>}
                  <span style={{ flex: 1 }}><MarkerChips list={e.conditions ?? []} /></span>
                  <button type="button" onClick={() => setOpenId(open ? null : e.id)} aria-expanded={open}
                    style={{ padding: "3px 9px", background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
                    {open ? "Done" : "Buff or debuff"}
                  </button>
                </div>
                {open && <div style={{ marginTop: 6 }}><PlayerEntryControls fightId={fight.id} entry={e} myTurn={myTurn} onChanged={() => void load()} /></div>}
              </div>
            );
          })}
        </div>
      </div>
      {err && <p role="alert" style={{ color: "#e07a70", fontSize: 12, margin: "8px 0 0" }}>{err}</p>}
    </section>
  );
}
