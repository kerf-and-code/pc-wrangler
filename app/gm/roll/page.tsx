"use client";

// app/gm/roll/page.tsx
//
// A dice roller for the GM's side of the screen.
//
// WHY THIS EXISTS WHEN PLAYERS ALREADY HAVE DICE
//   It is not here to replace anybody's dice bag. Players are attached to their own dice and should
//   keep rolling them; asking a table to change how it plays is the one thing this product has been
//   careful never to do.
//
//   It is here because MONSTER rolls are invisible. Beyond20 sees what players roll on D&D Beyond
//   and nothing else, so the app knows a fight happened and how the party fared but never what the
//   monsters actually rolled. That gap is exactly where encounter calibration lives: without it the
//   app can say a Moderate fight left the party at a third of their hit points, but not whether the
//   maths was wrong or the dice were cruel. GMs also roll behind a screen, often on a device
//   already, and nobody is sentimental about goblin dice.
//
// AND IT COVERS THE FORGOTTEN-DICE CASE
//   Same roller, shared with the table when someone turns up without theirs. Their rolls attribute
//   to their character rather than to a monster, so nothing about their analytics is distorted by
//   borrowing it for a night.

import { useCallback, useEffect, useMemo, useState } from "react";
import PageShell from "@/components/page-shell";
import DicePicker from "@/components/dice-picker";
import { createClient } from "@/lib/supabase/client";
import { applyAdvantage, canHaveAdvantage, parseDice, DiceError } from "@/lib/dice";
import { getModule } from "@/lib/systems/registry";
import { C, FORGE_RADIUS, STONE } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";
import { setActiveCampaign } from "@/lib/active-campaign";

type Campaign = { id: string; name: string; system: string | null };
type Session = { id: string; session_number: number | null; ended_at: string | null };
type Character = { id: string; name: string };
type Rolled = {
  total: number; notation: string; natural: 20 | 1 | null;
  dice: { sides: number; value: number; kept: boolean }[];
  label: string; actor: string; at: number;
  band?: string; target?: number; degrees?: boolean; duality?: boolean; hope?: number; fear?: number; pool?: boolean; power?: boolean; lancer?: boolean;
};

const KINDS: { key: string; label: string }[] = [
  { key: "attack", label: "Attack" },
  { key: "spell", label: "Spell attack" },
  { key: "damage", label: "Damage" },
  { key: "save", label: "Saving throw" },
  { key: "check", label: "Check" },
  { key: "initiative", label: "Initiative" },
  { key: "other", label: "Other" },
];

export default function RollerPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);

  const [notation, setNotation] = useState("1d20");
  const [target, setTarget] = useState(50);
  const [cocMode, setCocMode] = useState(false);
  const [dc, setDc] = useState("");
  const [dualityMod, setDualityMod] = useState("");
  const [dualityDiff, setDualityDiff] = useState("");
  const [poolSize, setPoolSize] = useState(5);
  const [poolDiff, setPoolDiff] = useState("");
  const [dsMod, setDsMod] = useState("");
  const [dsEB, setDsEB] = useState(0);   // Draw Steel edges/banes: -2 double bane .. +2 double edge
  const [lancerMod, setLancerMod] = useState("");
  const [lancerAcc, setLancerAcc] = useState(0);  // Lancer net accuracy: positive = Accuracy, negative = Difficulty
  const [lancerTarget, setLancerTarget] = useState("");
  const [mode, setMode] = useState<"flat" | "adv" | "dis">("flat");
  const [kind, setKind] = useState("attack");
  const [actor, setActor] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [label, setLabel] = useState("");

  const [log, setLog] = useState<Rolled[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("campaigns").select("id, name, system").eq("gm_id", user.id).order("name");
      const rows = (data as Campaign[]) ?? [];
      setCampaigns(rows);
      if (rows.length === 1) setCampaignId(rows[0].id);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) { setSessions([]); setCharacters([]); return; }
    (async () => {
      const [{ data: ss }, { data: cs }] = await Promise.all([
        supabase.from("sessions").select("id, session_number, ended_at")
          .eq("campaign_id", campaignId).order("session_number", { ascending: false }).limit(10),
        supabase.from("characters").select("id, name")
          .eq("campaign_id", campaignId).eq("kind", "pc").order("name"),
      ]);
      const srows = (ss as Session[]) ?? [];
      setSessions(srows);
      setSessionId(srows.find((r) => !r.ended_at)?.id ?? srows[0]?.id ?? "");
      setCharacters((cs as Character[]) ?? []);
    })();
  }, [campaignId, supabase]);

  // Rolls already saved for this session, read back from vtt_events.
  //
  // The page used to show only what you had rolled since opening it, which was honest but not
  // useful: the rolls were always saved, the roller simply never asked. Coming back the next day to
  // check what the boss actually rolled meant going to Mechanics, and Mechanics summarises rather
  // than lists.
  //
  // The stored payload is the Beyond20 shape - [{faces, results}] plus a `dropped` list - because
  // that is what Mechanics reads. Rebuilding the per-die display from it here keeps ONE stored
  // format rather than saving a second copy shaped for this page.
  const loadHistory = useCallback(async (cid: string, sid: string) => {
    if (!cid || !sid) { setLog([]); return; }
    setLoadingLog(true);
    try {
      const { data } = await supabase
        .from("vtt_events")
        .select("id, actor_name, character_id, name, rolls, rolled_at")
        .eq("campaign_id", cid)
        .eq("session_id", sid)
        .eq("source", "six_axes_roller")
        .order("rolled_at", { ascending: false })
        .limit(60);

      const rows = (data as {
        id: string; actor_name: string | null; character_id: string | null;
        name: string | null; rolled_at: string;
        rolls: {
          total?: number; notation?: string; natural?: 20 | 1 | null; kind?: string;
          dice?: { faces: number; results: number[] }[];
          dropped?: { faces: number; value: number }[];
        } | null;
      }[]) ?? [];

      // Reconstruct the derived band on reload. The stored payload is the Beyond20 shape and carries no
      // band, so recompute it from the campaign's dice style plus the target the roll label already holds
      // ("skill N" / "DC N" / "Diff N"). Keying off the campaign's module means a CoC / PF2e / Daggerheart
      // / pool roll reads back with its outcome tomorrow instead of a bare number. (A manual d100 toggle
      // used on a non-CoC campaign won't reconstruct, since the campaign's own style isn't percentile.)
      const histSys = campaigns.find((c) => c.id === cid)?.system;
      const styleKind = getModule(histSys).dice.style.kind;
      setLog(rows.map((r) => {
        const kept = (r.rolls?.dice ?? []).flatMap((g) =>
          (g.results ?? []).map((v) => ({ sides: g.faces, value: v, kept: true })));
        const dropped = (r.rolls?.dropped ?? []).map((d) => ({ sides: d.faces, value: d.value, kept: false }));
        const dice = [...kept, ...dropped];
        const total = r.rolls?.total ?? 0;
        const natural = r.rolls?.natural ?? null;
        const label = r.name ?? (KINDS.find((k) => k.key === r.rolls?.kind)?.label ?? "");
        return {
          total, notation: r.rolls?.notation ?? "", natural, dice, label,
          actor: r.actor_name ?? "the GM",
          at: new Date(r.rolled_at).getTime(),
          ...reloadBand(styleKind, histSys, dice, total, natural, label),
        };
      }));
    } finally { setLoadingLog(false); }
  }, [supabase, campaigns]);

  useEffect(() => { void loadHistory(campaignId, sessionId); }, [campaignId, sessionId, loadHistory]);

  // Resolve this campaign's rules module. Its dice style - not a hardcoded d20 assumption - decides
  // how the roller behaves: D&D (d20-vs-dc) rolls dice with optional advantage; a percentile-under
  // system (Call of Cthulhu) rolls d100 under a skill target instead.
  const activeSystem = campaigns.find((c) => c.id === campaignId)?.system;
  const dice = getModule(activeSystem).dice;
  const moduleIsPercentile = dice.style.kind === "percentile-under";
  const isPercentile = cocMode || moduleIsPercentile;
  // PF2e keeps the d20 roll but adds an optional DC -> four degrees of success (beat by 10 / meet /
  // miss / miss by 10, with a natural 20 stepping the result up one and a natural 1 stepping it down).
  const isPf2e = activeSystem === "pf2e" && !isPercentile;
  // Daggerheart: roll 2d12 (a Hope die + a Fear die) + a modifier; the higher die colours the result,
  // matching dice are a critical, and the sum meets a Difficulty for success/failure.
  const isDuality = dice.style.kind === "duality";
  const dualityDice = dice.style.kind === "duality" ? dice.style.dice : "2d12";
  // A system-neutral d10 success pool: roll N ten-sided dice, 6+ is a success, a pair of 10s is a crit.
  const isPool = dice.style.kind === "dice-pool";
  const poolDie = dice.style.kind === "dice-pool" ? dice.style.die : 10;
  // Draw Steel: roll 2d10 + a characteristic against tiers; edges/banes adjust it, a natural 19-20 crits.
  const isPowerRoll = dice.style.kind === "power-roll";
  // Lancer: roll 1d20 + a flat bonus, adjusted by net Accuracy/Difficulty (roll |net| d6, add or subtract
  // the single highest), against a target number. A natural 20 on the d20 is a critical hit.
  const isLancer = dice.style.kind === "d20-accuracy";
  const advMeaningful =
    !isPercentile && canHaveAdvantage(notation) && dice.style.kind === "d20-vs-dc" && dice.style.advantage;

  // The notation actually rolled. Percentile systems always roll 1d100; otherwise the modifier is
  // folded in and advantage applied. Shown to the GM before they roll, because a roller you cannot
  // check is a roller you cannot trust.
  const finalNotation = useMemo(
    () => isPercentile ? "1d100"
      : isDuality ? `${dualityDice}${dualityMod.trim() ? ` + ${dualityMod.trim()}` : ""}`
      : isPool ? `${Math.max(1, Math.min(30, poolSize))}d${poolDie}`
      : isPowerRoll ? powerRollNotation(dsMod, dsEB)
      : isLancer ? lancerNotation(lancerMod, lancerAcc)
      : applyAdvantage(notation.trim() || "1d20", mode),
    [notation, mode, isPercentile, isDuality, dualityDice, dualityMod, isPool, poolSize, poolDie, isPowerRoll, dsMod, dsEB, isLancer, lancerMod, lancerAcc],
  );

  const valid = useMemo(() => {
    try { parseDice(finalNotation); return null; }
    catch (e) { return e instanceof DiceError ? e.message : "Cannot read that roll."; }
  }, [finalNotation]);

  useEffect(() => {
    const c = campaigns.find((x) => x.id === campaignId);
    if (c) setActiveCampaign({ id: c.id, name: c.name, system: c.system });
  }, [campaignId, campaigns]);

  const doRoll = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const dcNum = Number(dc);
      const usePf2eDc = isPf2e && dc.trim() !== "" && Number.isFinite(dcNum);
      const diffNum = Number(dualityDiff);
      const useDiff = isDuality && dualityDiff.trim() !== "" && Number.isFinite(diffNum);
      const poolDiffNum = Number(poolDiff);
      const usePoolDiff = isPool && poolDiff.trim() !== "" && Number.isFinite(poolDiffNum);
      const ebLabel = dsEB === 2 ? "Double Edge" : dsEB === 1 ? "Edge" : dsEB === -1 ? "Bane" : dsEB === -2 ? "Double Bane" : "";
      const lancerTgtNum = Number(lancerTarget);
      const useLancerTgt = isLancer && lancerTarget.trim() !== "" && Number.isFinite(lancerTgtNum);
      // Encode net accuracy and target in the label so a reloaded roll can rebuild its outcome from the
      // stored dice (positive = "Acc N", negative = "Diff N", and "Tgt N" for the target number).
      const lancerAccLabel = lancerAcc > 0 ? `Acc ${lancerAcc}` : lancerAcc < 0 ? `Diff ${-lancerAcc}` : "";
      const rollLabel = isPercentile
        ? [label, `skill ${target}`].filter(Boolean).join(" · ")
        : usePf2eDc ? [label, `DC ${dcNum}`].filter(Boolean).join(" · ")
        : isDuality ? [label, useDiff ? `Diff ${diffNum}` : ""].filter(Boolean).join(" · ")
        : isPool ? [label, usePoolDiff ? `Diff ${poolDiffNum}` : ""].filter(Boolean).join(" · ")
        : isPowerRoll ? [label, ebLabel].filter(Boolean).join(" · ")
        : isLancer ? [label, lancerAccLabel, useLancerTgt ? `Tgt ${lancerTgtNum}` : ""].filter(Boolean).join(" · ")
        : label;
      const res = await fetch("/api/rolls/gm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId, sessionId: sessionId || null, notation: finalNotation,
          kind: isPercentile || isDuality || isPool || isPowerRoll ? "check" : kind, actorName: characterId ? null : actor, characterId: characterId || null,
          label: rollLabel,
        }),
      });
      const out = await res.json();
      if (!res.ok) { setError(out.error ?? "Could not roll."); return; }
      const r = out.result;
      const hf = isDuality && r.dice.length >= 2 ? { hope: r.dice[0].value, fear: r.dice[1].value } : null;
      const pool = isPool ? poolOutcome(r.dice, usePoolDiff ? poolDiffNum : null) : null;
      const ds = isPowerRoll && r.dice.length >= 2 ? drawSteelOutcome(r.dice[0].value, r.dice[1].value, r.total, dsEB === 2, dsEB === -2) : null;
      const lan = isLancer ? lancerResolve(r.dice, r.total, lancerAcc, useLancerTgt ? lancerTgtNum : null) : null;
      setLog((l) => [{
        total: pool ? pool.successes : lan ? lan.total : r.total, notation: r.notation, natural: r.natural, dice: r.dice,
        band: isPercentile ? cocBand(r.total, target)
          : usePf2eDc ? pf2eDegree(r.total, dcNum, r.natural)
          : hf ? dualityOutcome(hf.hope, hf.fear, r.total, useDiff ? diffNum : null)
          : pool ? pool.band
          : ds ? ds
          : lan ? (lan.band || undefined)
          : undefined,
        target: isPercentile ? target : usePf2eDc ? dcNum : useDiff ? diffNum : usePoolDiff ? poolDiffNum : useLancerTgt ? lancerTgtNum : undefined,
        degrees: usePf2eDc,
        duality: !!hf,
        pool: !!pool,
        power: !!ds,
        lancer: !!lan,
        hope: hf?.hope, fear: hf?.fear,
        label: rollLabel || KINDS.find((k) => k.key === kind)?.label || "",
        actor: characterId ? (characters.find((c) => c.id === characterId)?.name ?? "") : (actor || "the GM"),
        at: Date.now(),
      }, ...l].slice(0, 60));
    } finally { setBusy(false); }
  }, [campaignId, sessionId, finalNotation, kind, actor, characterId, label, characters, isPercentile, target, isPf2e, dc, isDuality, dualityDiff, isPool, poolDiff, isPowerRoll, dsEB, isLancer, lancerAcc, lancerTarget]);

  const session = sessions.find((s) => s.id === sessionId) ?? null;

  return (
    <PageShell width={760}>
      <h1 style={{ fontFamily: SAX.serif, fontSize: 30, margin: "4px 0 2px", color: C.text }}>Roll</h1>
      <p style={{ color: C.muted, fontSize: 14, marginTop: 0, marginBottom: 18, lineHeight: 1.6 }}>
        For the monsters, and for anyone at the table who forgot their dice. Every roll is logged
        against the session, which is how the app learns what your encounters actually cost.
      </p>

      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <Label>Campaign</Label>
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={field}>
              <option value="">Pick a campaign</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Session</Label>
            <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={field}>
              {sessions.length === 0 && <option value="">No sessions</option>}
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  Session {s.session_number ?? "?"}{s.ended_at ? " (closed)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        {session?.ended_at && (
          <p style={{ ...body, marginTop: 8, marginBottom: 0, fontSize: 12.5 }}>
            That session is closed. Rolls still attach to it.
          </p>
        )}
      </Card>

      <Card>
        <Label>The roll</Label>
        {!isDuality && !isPool && !isPowerRoll && !isLancer && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <button type="button" onClick={() => setCocMode(false)} disabled={moduleIsPercentile}
            style={{ ...chip(!isPercentile), opacity: moduleIsPercentile ? 0.4 : 1, cursor: moduleIsPercentile ? "default" : "pointer" }}>
            d20 &middot; D&amp;D
          </button>
          <button type="button" onClick={() => setCocMode(true)} style={chip(isPercentile)}>
            d100 &middot; Call of Cthulhu
          </button>
        </div>
        )}
        {isPercentile && (
          <div style={{ marginBottom: 10 }}>
            <Label>Skill target</Label>
            <input type="number" min={1} max={99} value={target}
              onChange={(e) => setTarget(Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 0))))}
              style={{ ...field, fontFamily: SAX.mono }} />
            <p style={{ ...body, marginTop: 6, marginBottom: 0, fontSize: 12.5 }}>
              Roll d100 under the skill. 01 is a critical; extreme at a fifth, hard at half; a fumble is
              100, or 96 to 99 when the skill is under 50.
            </p>
          </div>
        )}
        {isPf2e && (
          <div style={{ marginBottom: 10 }}>
            <Label>DC (optional)</Label>
            <input type="number" min={1} value={dc} onChange={(e) => setDc(e.target.value)}
              placeholder="e.g. 18" style={{ ...field, fontFamily: SAX.mono }} />
            <p style={{ ...body, marginTop: 6, marginBottom: 0, fontSize: 12.5 }}>
              Set a DC to read the degree of success: critical success at DC+10, critical failure at
              DC-10; a natural 20 steps the result up one, a natural 1 steps it down.
            </p>
          </div>
        )}
        {isDuality && (<>
          <div style={{ marginBottom: 10 }}>
            <Label>Modifier</Label>
            <input value={dualityMod} onChange={(e) => setDualityMod(e.target.value)}
              placeholder="e.g. 2 (trait + bonuses)" style={{ ...field, fontFamily: SAX.mono }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <Label>Difficulty (optional)</Label>
            <input type="number" min={1} value={dualityDiff} onChange={(e) => setDualityDiff(e.target.value)}
              placeholder="e.g. 14" style={{ ...field, fontFamily: SAX.mono }} />
            <p style={{ ...body, marginTop: 6, marginBottom: 0, fontSize: 12.5 }}>
              Roll 2d12 (Hope + Fear) plus your modifier against the Difficulty. Higher Hope die is with
              Hope, higher Fear die is with Fear, and matching dice are a critical success.
            </p>
          </div>
        </>)}
        {isPool && (<>
          <div style={{ marginBottom: 10 }}>
            <Label>Pool size</Label>
            <input type="number" min={1} max={30} value={poolSize}
              onChange={(e) => setPoolSize(Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 0))))}
              style={{ ...field, fontFamily: SAX.mono }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <Label>Difficulty (successes, optional)</Label>
            <input type="number" min={1} value={poolDiff} onChange={(e) => setPoolDiff(e.target.value)}
              placeholder="e.g. 3" style={{ ...field, fontFamily: SAX.mono }} />
            <p style={{ ...body, marginTop: 6, marginBottom: 0, fontSize: 12.5 }}>
              Roll a pool of d{poolDie}s. Each 6 or higher is a success; a pair of 10s adds a critical
              bonus. Set a difficulty (a number of successes) to read it as success or failure.
            </p>
          </div>
        </>)}
        {isPowerRoll && (<>
          <div style={{ marginBottom: 10 }}>
            <Label>Modifier (characteristic + bonuses)</Label>
            <input value={dsMod} onChange={(e) => setDsMod(e.target.value)}
              placeholder="e.g. 2" style={{ ...field, fontFamily: SAX.mono }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <Label>Edges / banes</Label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[{ v: -2, l: "Bane \u00D72" }, { v: -1, l: "Bane" }, { v: 0, l: "\u2014" }, { v: 1, l: "Edge" }, { v: 2, l: "Edge \u00D72" }].map((o) => (
                <button key={o.v} type="button" onClick={() => setDsEB(o.v)} style={chip(dsEB === o.v)}>{o.l}</button>
              ))}
            </div>
            <p style={{ ...body, marginTop: 6, marginBottom: 0, fontSize: 12.5 }}>
              Roll 2d10 + modifier against the tiers (11 or lower, 12 to 16, 17+). An edge is +2 and a
              double edge bumps the tier up; a bane is -2 and a double bane drops it. A natural 19 to 20 is a critical.
            </p>
          </div>
        </>)}
        {isLancer && (<>
          <div style={{ marginBottom: 10 }}>
            <Label>Bonus (grit, tier, tags)</Label>
            <input value={lancerMod} onChange={(e) => setLancerMod(e.target.value)}
              placeholder="e.g. 4" style={{ ...field, fontFamily: SAX.mono }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <Label>Accuracy / Difficulty</Label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[-3, -2, -1, 0, 1, 2, 3].map((v) => (
                <button key={v} type="button" onClick={() => setLancerAcc(v)} style={chip(lancerAcc === v)}>
                  {v > 0 ? `+${v}` : v === 0 ? "0" : `${v}`}
                </button>
              ))}
            </div>
            <p style={{ ...body, marginTop: 6, marginBottom: 0, fontSize: 12.5 }}>
              Positive is Accuracy, negative is Difficulty. The net rolls that many d6 and adds (or
              subtracts) the single highest. They cancel one for one, so only the net is rolled.
            </p>
          </div>
          <div style={{ marginBottom: 10 }}>
            <Label>Target (Evasion / E-Defense / DC, optional)</Label>
            <input type="number" min={1} value={lancerTarget} onChange={(e) => setLancerTarget(e.target.value)}
              placeholder="e.g. 10" style={{ ...field, fontFamily: SAX.mono }} />
            <p style={{ ...body, marginTop: 6, marginBottom: 0, fontSize: 12.5 }}>
              Roll 1d20 + bonus against the target to read hit or miss. A natural 20 on the d20 is a critical hit.
            </p>
          </div>
        </>)}
        {!isPercentile && !isDuality && !isPool && !isPowerRoll && !isLancer && (<>
        <DicePicker notation={notation} onChange={setNotation} />

        <div style={{ marginTop: 12, marginBottom: 10 }}>
          <Label>Or type it</Label>
          <input value={notation} onChange={(e) => setNotation(e.target.value)}
            placeholder="2d4 + 2d8 + 1d20 + 16"
            style={{ ...field, fontFamily: SAX.mono }} />
          <p style={{ ...body, marginTop: 6, marginBottom: 0, fontSize: 12.5 }}>
            The tiles and this box edit the same roll, either way round. Type here for anything the
            tiles cannot express, like 4d6kh3 to drop the lowest.
          </p>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {(["dis", "flat", "adv"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} disabled={m !== "flat" && !advMeaningful}
              style={{ ...chip(mode === m), opacity: m !== "flat" && !advMeaningful ? 0.4 : 1 }}>
              {m === "adv" ? "Advantage" : m === "dis" ? "Disadvantage" : "Straight"}
            </button>
          ))}
          {!advMeaningful && (
            <span style={{ ...body, margin: 0, fontSize: 12.5, alignSelf: "center" }}>
              Advantage needs a single d20 in the roll.
            </span>
          )}
        </div>
        </>)}

        <div style={{
          background: "rgba(0,0,0,0.28)", borderRadius: FORGE_RADIUS, padding: "8px 12px",
          fontFamily: SAX.mono, fontSize: 13, color: valid ? C.warn : C.plum, marginBottom: 12,
        }}>
          {valid ?? (isPercentile ? `rolling 1d100 under ${target}` : `rolling  ${finalNotation}`)}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isPercentile || isDuality || isPool || isPowerRoll ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
          {!isPercentile && !isDuality && !isPool && !isPowerRoll && (
          <div>
            <Label>What kind</Label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={field}>
              {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </div>
          )}
          <div>
            <Label>Who is rolling</Label>
            <select value={characterId} onChange={(e) => setCharacterId(e.target.value)} style={field}>
              <option value="">A monster or the GM</option>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {!characterId && (
          <input value={actor} onChange={(e) => setActor(e.target.value)}
            placeholder="Name the monster, if you like (Grultok, goblin archer)"
            style={{ ...field, marginBottom: 10 }} />
        )}
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="What for? (longsword, fireball, perception)"
          style={{ ...field, marginBottom: 12 }} />

        <button onClick={() => void doRoll()} disabled={busy || !campaignId || Boolean(valid)} style={btn}>
          {busy ? "Rolling…" : isPercentile ? "Roll d100" : isDuality ? "Roll with Hope & Fear" : isPool ? "Roll pool" : isPowerRoll ? "Roll power" : "Roll"}
        </button>
      </Card>

      {error && <Card tone="warn"><p style={{ ...body, marginBottom: 0 }}>{error}</p></Card>}

      {loadingLog && log.length === 0 && (
        <Card><p style={{ ...body, marginBottom: 0 }}>Loading this session&apos;s rolls…</p></Card>
      )}

      {log.length > 0 && (
        <Card>
          <Label>Rolled this session</Label>
          {log.map((r) => (
            <div key={r.at} style={{ padding: "9px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <span style={{ color: C.text, fontSize: 14 }}>
                  {r.actor}{r.label ? ` · ${r.label}` : ""}
                </span>
                <span style={{
                  fontFamily: SAX.mono, fontSize: 20,
                  color: r.band ? bandColor(r.band) : r.natural === 20 ? C.good : r.natural === 1 ? C.warn : C.sun,
                }}>
                  {r.total}
                </span>
              </div>
              <div style={{ fontFamily: SAX.mono, fontSize: 11.5, color: STONE.inkFaint, marginTop: 2 }}>
                {r.band
                  ? (r.duality
                      ? `Hope ${r.hope} · Fear ${r.fear} · ${r.band}${r.target != null ? ` vs ${r.target}` : ""}`
                      : r.pool
                        ? `${r.notation} · ${r.dice.map((d) => `${d.value}`).join(" ")} · ${r.band}${r.target != null ? ` vs ${r.target}` : ""}`
                        : r.power
                        ? `${r.notation} · ${r.dice.map((d) => `${d.value}`).join(" ")} · ${r.band}`
                        : r.lancer
                        ? `${r.notation} · ${r.dice.map((d) => `${d.value}`).join(" ")} · ${r.band}${r.target != null ? ` vs ${r.target}` : ""}`
                        : r.degrees
                          ? `${r.notation} · ${r.band}${r.target != null ? ` vs DC ${r.target}` : ""}${r.natural === 20 ? " · nat 20" : r.natural === 1 ? " · nat 1" : ""}`
                          : `d100 · ${r.band}${r.target != null ? ` vs ${r.target}` : ""}`)
                  : `${r.notation} · ${r.dice.map((d) => (d.kept ? `${d.value}` : `(${d.value})`)).join(" ")}${r.natural === 20 ? " · natural 20" : r.natural === 1 ? " · natural 1" : ""}`}
              </div>
            </div>
          ))}
          <p style={{ ...body, marginTop: 10, marginBottom: 0, fontSize: 12.5 }}>
            Dice in brackets were rolled and dropped by a keep rule. This is every roll saved
            against this session, newest first, so it is still here tomorrow.
          </p>
        </Card>
      )}
    </PageShell>
  );
}

function cocBand(roll: number, target: number): string {
  if (roll === 1) return "Critical";
  const fumble = target < 50 ? roll >= 96 : roll === 100;
  if (fumble) return "Fumble";
  if (roll <= Math.floor(target / 5)) return "Extreme";
  if (roll <= Math.floor(target / 2)) return "Hard";
  if (roll <= target) return "Success";
  return "Failure";
}
function pf2eDegree(total: number, dc: number, natural: 20 | 1 | null): string {
  let step = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (natural === 20) step = Math.min(3, step + 1);
  else if (natural === 1) step = Math.max(0, step - 1);
  return ["Critical Failure", "Failure", "Success", "Critical Success"][step];
}
function dualityOutcome(hope: number, fear: number, total: number, difficulty: number | null): string {
  if (hope === fear) return "Critical Success";           // matching dice: a crit regardless of difficulty
  const via = hope > fear ? "Hope" : "Fear";
  if (difficulty == null) return `with ${via}`;           // no difficulty set: just the tone
  return `${total >= difficulty ? "Success" : "Failure"} with ${via}`;
}
// Build the "2d10 + N" notation for a power roll; a single edge/bane folds its +2/-2 into the modifier,
// while a double edge/bane carries no numeric (it shifts the tier) and leaves the modifier alone.
function powerRollNotation(mod: string, eb: number): string {
  const m = (parseInt(mod, 10) || 0) + (eb === 1 ? 2 : eb === -1 ? -2 : 0);
  return `2d10${m > 0 ? ` + ${m}` : m < 0 ? ` - ${-m}` : ""}`;
}

// Lancer: 1d20 + a flat bonus, plus |net accuracy| d6 rolled additively so every d6 comes back and the
// single highest can be selected client-side (the sum is corrected out in lancerResolve). Difficulty is
// negative accuracy; the d6 count is the same, only the sign of the applied highest changes.
function lancerNotation(mod: string, acc: number): string {
  const n = Math.min(6, Math.abs(Math.round(acc) || 0));
  const m = parseInt(mod, 10) || 0;
  const accTerm = n > 0 ? ` + ${n}d6` : "";
  const modTerm = m > 0 ? ` + ${m}` : m < 0 ? ` - ${-m}` : "";
  return `1d20${accTerm}${modTerm}`;
}
// Lancer outcome: a critical hit is a natural 20 on the d20 (and a crit is always a hit). Otherwise, with
// a target set, the adjusted total hits when it meets or beats it; with no target, there is no band.
function lancerBand(total: number, target: number | null, crit: boolean): string {
  if (crit) return "Critical Hit";
  if (target == null) return "";
  return total >= target ? "Hit" : "Miss";
}
// Rebuild a Lancer roll's true total and band from the returned/stored dice. The server total is
// 1d20 + bonus + the sum of ALL the accuracy d6, so subtracting that sum leaves 1d20 + bonus, to which
// the single highest d6 is added (Accuracy) or subtracted (Difficulty). Works the same live or on reload.
function lancerResolve(
  dice: { sides: number; value: number; kept: boolean }[],
  serverTotal: number, acc: number, target: number | null,
): { total: number; band: string } {
  const d20 = dice.find((d) => d.sides === 20)?.value ?? 0;
  const d6s = dice.filter((d) => d.sides === 6 && d.kept).map((d) => d.value);
  const sumd6 = d6s.reduce((a, b) => a + b, 0);
  const maxd6 = d6s.length ? Math.max(...d6s) : 0;
  const adj = acc > 0 ? maxd6 : acc < 0 ? -maxd6 : 0;
  const total = (serverTotal - sumd6) + adj;
  return { total, band: lancerBand(total, target, d20 === 20) };
}

function poolOutcome(
  dice: { sides: number; value: number; kept: boolean }[],
  difficulty: number | null,
): { successes: number; band: string } {
  const vals = dice.filter((d) => d.kept).map((d) => d.value);
  const base = vals.filter((v) => v >= 6).length;
  const tens = vals.filter((v) => v === 10).length;
  const successes = base + Math.floor(tens / 2) * 2;   // a pair of 10s adds a critical bonus
  const critical = tens >= 2;
  const noun = `${successes} success${successes === 1 ? "" : "es"}`;
  if (difficulty == null) return { successes, band: critical ? `Critical · ${noun}` : noun };
  const win = successes >= difficulty;
  return { successes, band: win ? (critical ? "Critical Success" : "Success") : "Failure" };
}
function bandColor(band: string): string {
  if (band === "Critical Success") return C.good;
  if (band === "Critical Failure") return C.warn;
  if (band === "with Hope" || band === "Success with Hope") return C.good;
  if (band === "with Fear" || band === "Failure with Fear") return C.warn;
  if (band === "Success with Fear" || band === "Failure with Hope") return C.sun;
  if (band === "Critical" || band === "Extreme") return C.good;
  if (band === "Fumble") return C.warn;
  if (band === "Critical Hit" || band === "Hit") return band === "Critical Hit" ? C.good : C.sun;
  if (band === "Miss") return C.warn;
  if (band === "Success" || band === "Hard") return C.sun;
  return C.text;
}

// Draw Steel power roll: total (2d10 + modifier, single edge/bane already folded into it) against the
// tiers; a double edge/bane shifts the tier by one; a natural 19-20 on the 2d10 is always tier 3 + a crit.
function drawSteelOutcome(d1: number, d2: number, total: number, doubleEdge: boolean, doubleBane: boolean): string {
  const crit = d1 + d2 >= 19;
  let tier = total <= 11 ? 1 : total <= 16 ? 2 : 3;
  if (doubleEdge) tier = Math.min(3, tier + 1);
  if (doubleBane) tier = Math.max(1, tier - 1);
  if (crit) tier = 3;
  return `Tier ${tier}${crit ? " · critical" : ""}`;
}

// Recompute a roll's band on reload from the campaign's dice style and the target its label carries.
// Returns only the band-related fields to spread over the reconstructed row; {} when there is none.
function reloadBand(
  styleKind: string, sys: string | null | undefined,
  dice: { sides: number; value: number; kept: boolean }[],
  total: number, natural: 20 | 1 | null, label: string,
): Partial<Rolled> {
  const num = (re: RegExp) => { const m = re.exec(label); return m ? Number(m[1]) : undefined; };
  if (styleKind === "percentile-under") {
    const target = num(/skill\s+(\d+)/i);
    if (target != null) return { band: cocBand(total, target), target };
  } else if (sys === "pf2e") {
    const target = num(/DC\s+(\d+)/i);
    if (target != null) return { band: pf2eDegree(total, target, natural), target, degrees: true };
  } else if (styleKind === "duality") {
    if (dice.length >= 2) {
      const hope = dice[0].value, fear = dice[1].value;
      const target = num(/Diff\s+(\d+)/i);
      return { band: dualityOutcome(hope, fear, total, target ?? null), target, duality: true, hope, fear };
    }
  } else if (styleKind === "dice-pool") {
    const target = num(/Diff\s+(\d+)/i);
    const po = poolOutcome(dice, target ?? null);
    return { band: po.band, target, pool: true, total: po.successes };
  } else if (styleKind === "power-roll") {
    if (dice.length >= 2) {
      const doubleEdge = /Double Edge/.test(label);
      const doubleBane = /Double Bane/.test(label);
      return { band: drawSteelOutcome(dice[0].value, dice[1].value, total, doubleEdge, doubleBane), power: true };
    }
  } else if (styleKind === "d20-accuracy") {
    // Net accuracy sign from the label ("Acc N" adds, "Diff N" subtracts); target from "Tgt N".
    const acc = /Acc\s+(\d+)/i.test(label) ? Number(/Acc\s+(\d+)/i.exec(label)![1])
      : /Diff\s+(\d+)/i.test(label) ? -Number(/Diff\s+(\d+)/i.exec(label)![1]) : 0;
    const target = num(/Tgt\s+(\d+)/i);
    const lan = lancerResolve(dice, total, acc, target ?? null);
    return { band: lan.band || undefined, target, lancer: true, total: lan.total };
  }
  return {};
}

function Card({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <section style={{
      background: "linear-gradient(160deg, rgba(52,47,39,0.80) 0%, rgba(38,34,28,0.85) 45%, rgba(22,19,15,0.90) 100%)",
      borderRadius: FORGE_RADIUS, padding: "14px 16px", marginBottom: 14,
      borderLeft: tone === "warn" ? `3px solid ${C.warn}` : undefined,
      boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.5)",
    }}>{children}</section>
  );
}
const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily: SAX.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase",
    color: C.muted, marginBottom: 6 }}>{children}</div>
);
const body: React.CSSProperties = { color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 10px" };
const field: React.CSSProperties = { width: "100%", padding: "9px 11px", fontSize: 15, fontFamily: SAX.serif };
const chip = (on: boolean): React.CSSProperties => ({
  background: on ? C.sun : "transparent", color: on ? C.ink : C.text,
  border: on ? "none" : `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
  padding: "7px 13px", fontFamily: SAX.mono, fontSize: 12.5, cursor: "pointer",
});
const btn: React.CSSProperties = {
  background: C.sun, color: C.ink, border: "none", borderRadius: FORGE_RADIUS,
  padding: "12px 26px", fontFamily: SAX.mono, fontSize: 13,
  letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
};
