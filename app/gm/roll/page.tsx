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
import { C, FORGE_RADIUS, STONE } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";

type Campaign = { id: string; name: string };
type Session = { id: string; session_number: number | null; ended_at: string | null };
type Character = { id: string; name: string };
type Rolled = {
  total: number; notation: string; natural: 20 | 1 | null;
  dice: { sides: number; value: number; kept: boolean }[];
  label: string; actor: string; at: number;
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
      const { data } = await supabase.from("campaigns").select("id, name").eq("gm_id", user.id).order("name");
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

      setLog(rows.map((r) => {
        const kept = (r.rolls?.dice ?? []).flatMap((g) =>
          (g.results ?? []).map((v) => ({ sides: g.faces, value: v, kept: true })));
        const dropped = (r.rolls?.dropped ?? []).map((d) => ({ sides: d.faces, value: d.value, kept: false }));
        return {
          total: r.rolls?.total ?? 0,
          notation: r.rolls?.notation ?? "",
          natural: r.rolls?.natural ?? null,
          dice: [...kept, ...dropped],
          label: r.name ?? (KINDS.find((k) => k.key === r.rolls?.kind)?.label ?? ""),
          actor: r.actor_name ?? "the GM",
          at: new Date(r.rolled_at).getTime(),
        };
      }));
    } finally { setLoadingLog(false); }
  }, [supabase]);

  useEffect(() => { void loadHistory(campaignId, sessionId); }, [campaignId, sessionId, loadHistory]);

  // The notation actually rolled, with the modifier folded in and advantage applied. Shown to the
  // GM before they roll, because a roller you cannot check is a roller you cannot trust.
  const finalNotation = useMemo(
    () => applyAdvantage(notation.trim() || "1d20", mode),
    [notation, mode],
  );

  const valid = useMemo(() => {
    try { parseDice(finalNotation); return null; }
    catch (e) { return e instanceof DiceError ? e.message : "Cannot read that roll."; }
  }, [finalNotation]);

  const advMeaningful = canHaveAdvantage(notation);

  const doRoll = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/rolls/gm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId, sessionId: sessionId || null, notation: finalNotation,
          kind, actorName: characterId ? null : actor, characterId: characterId || null,
          label,
        }),
      });
      const out = await res.json();
      if (!res.ok) { setError(out.error ?? "Could not roll."); return; }
      const r = out.result;
      setLog((l) => [{
        total: r.total, notation: r.notation, natural: r.natural, dice: r.dice,
        label: label || KINDS.find((k) => k.key === kind)?.label || "",
        actor: characterId ? (characters.find((c) => c.id === characterId)?.name ?? "") : (actor || "the GM"),
        at: Date.now(),
      }, ...l].slice(0, 60));
    } finally { setBusy(false); }
  }, [campaignId, sessionId, finalNotation, kind, actor, characterId, label, characters]);

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

        <div style={{
          background: "rgba(0,0,0,0.28)", borderRadius: FORGE_RADIUS, padding: "8px 12px",
          fontFamily: SAX.mono, fontSize: 13, color: valid ? C.warn : C.plum, marginBottom: 12,
        }}>
          {valid ?? `rolling  ${finalNotation}`}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <Label>What kind</Label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={field}>
              {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </div>
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
          {busy ? "Rolling…" : "Roll"}
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
                  color: r.natural === 20 ? C.good : r.natural === 1 ? C.warn : C.sun,
                }}>
                  {r.total}
                </span>
              </div>
              <div style={{ fontFamily: SAX.mono, fontSize: 11.5, color: STONE.inkFaint, marginTop: 2 }}>
                {r.notation} · {r.dice.map((d) => (d.kept ? `${d.value}` : `(${d.value})`)).join(" ")}
                {r.natural === 20 ? " · natural 20" : r.natural === 1 ? " · natural 1" : ""}
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
