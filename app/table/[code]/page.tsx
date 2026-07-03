"use client";

// Six Axes Table Tap
// Players open this page during a session (in the browser running Beyond20) and
// keep it in a background tab. It listens for Beyond20's DOM events, normalizes
// them with the noise rules from the integration spike, and batches them to
// /api/vtt/ingest. Fidelity: events rendered locally from a formula (rendered:
// "fallback") are marked unverified; baked digital-dice results are canonical.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

const BRASS = "#c8a24b";
const EVENT_TYPES = new Set([
  "to-hit",
  "damage",
  "saving-throw",
  "skill",
  "ability",
  "initiative",
  "death-save",
  "hp-update",
  "conditions",
  "combat",
  "custom",
  "other",
]);

type DiceGroup = { faces: number | null; results: number[] };

type TapEvent = {
  source: "beyond20";
  ddb_character_id: string | null;
  actor_name: string | null;
  event_type: string;
  name: string | null;
  fidelity: "canonical" | "unverified";
  rolled_at: string;
  rolls: Record<string, unknown> | null;
  state: Record<string, unknown> | null;
};

function mapRollType(t: unknown): string {
  const s = typeof t === "string" ? t : "";
  if (EVENT_TYPES.has(s)) return s;
  if (s === "attack" || s === "spell-attack") return "to-hit";
  if (s === "hit-dice") return "other";
  if (s === "digital-dice") return "other";
  return "other";
}

function extractDice(roll: any): { dice: DiceGroup[]; modifier: number } {
  const dice: DiceGroup[] = [];
  let modifier = 0;
  let sign = 1;
  const parts = Array.isArray(roll?.parts) ? roll.parts : [];
  for (const part of parts) {
    if (typeof part === "string") {
      sign = part.trim() === "-" ? -1 : 1;
    } else if (typeof part === "number") {
      modifier += sign * part;
      sign = 1;
    } else if (part && typeof part === "object" && Array.isArray(part.rolls)) {
      const results: number[] = [];
      for (const r of part.rolls) {
        if (r && typeof r.roll === "number") results.push(r.roll);
      }
      dice.push({ faces: typeof part.faces === "number" ? part.faces : null, results });
    }
  }
  return { dice, modifier };
}

function characterState(ch: any): Record<string, unknown> | null {
  if (!ch || typeof ch !== "object") return null;
  return {
    hp: ch.hp ?? null,
    max_hp: ch["max-hp"] ?? null,
    temp_hp: ch["temp-hp"] ?? null,
    conditions: Array.isArray(ch.conditions) ? ch.conditions : [],
    exhaustion: ch.exhaustion ?? null,
  };
}

// Turn one Beyond20 RenderedRoll payload into zero or more normalized events.
function normalizeRenderedRoll(payload: any): TapEvent[] {
  const req = payload?.request;
  const ch = req?.character;
  const isMonster = ch?.type && ch.type !== "Character";
  const ddbId = !isMonster && ch?.id ? String(ch.id).slice(0, 64) : null;
  const actor = ch?.name ? String(ch.name).slice(0, 200) : null;
  const fidelity: "canonical" | "unverified" =
    payload?.rendered === "fallback" ? "unverified" : "canonical";
  const rolledAt = new Date().toISOString();
  const name = (req?.name || payload?.title || null) as string | null;
  const state = characterState(ch);
  const events: TapEvent[] = [];

  const attackRolls = Array.isArray(payload?.attack_rolls) ? payload.attack_rolls : [];
  for (const roll of attackRolls) {
    if (!roll || typeof roll !== "object") continue;
    const { dice, modifier } = extractDice(roll);
    const type = mapRollType(roll.type);
    const isD20 = type === "to-hit" || type === "saving-throw" || type === "skill" ||
      type === "ability" || type === "initiative" || type === "death-save";
    events.push({
      source: "beyond20",
      ddb_character_id: ddbId,
      actor_name: actor,
      event_type: type,
      name: name ? String(name).slice(0, 200) : null,
      fidelity,
      rolled_at: rolledAt,
      rolls: {
        formula: roll.formula ?? null,
        total: roll.total ?? null,
        modifier,
        dice,
        advantage: req?.advantage ?? 0,
        discarded: roll.discarded === true,
        critical_success: isD20 ? roll["critical-success"] === true : null,
        critical_failure: isD20 ? roll["critical-failure"] === true : null,
      },
      state,
    });
  }

  const damageRolls = Array.isArray(payload?.damage_rolls) ? payload.damage_rolls : [];
  for (const entry of damageRolls) {
    const label = Array.isArray(entry) ? entry[0] : null;
    const roll = Array.isArray(entry) ? entry[1] : entry;
    if (!roll || typeof roll !== "object") continue;
    const { dice, modifier } = extractDice(roll);
    events.push({
      source: "beyond20",
      ddb_character_id: ddbId,
      actor_name: actor,
      event_type: "damage",
      name: name ? String(name).slice(0, 200) : null,
      fidelity,
      rolled_at: rolledAt,
      rolls: {
        formula: roll.formula ?? null,
        total: roll.total ?? null,
        modifier,
        dice,
        damage_type: typeof label === "string" ? label.replace(/ Damage$/i, "") : null,
      },
      state,
    });
  }

  // Item and description cards carry no rolls; skip them.
  return events;
}

export default function TableTapPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", background: "#16121f", color: "#9a8fb0", fontFamily: "system-ui, sans-serif", padding: 24 }}>
          Loading Table Tap...
        </main>
      }
    >
      <TableTapInner />
    </Suspense>
  );
}

function TableTapInner() {
  const params = useParams();
  const code = String((params as any)?.code ?? "").toLowerCase();

  const [b20, setB20] = useState<"waiting" | "connected">("waiting");
  const [session, setSession] = useState<"unknown" | "open" | "closed">("unknown");
  const [sent, setSent] = useState(0);
  const [pending, setPending] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [feed, setFeed] = useState<{ line: string; fidelity: string; at: string }[]>([]);

  const queueRef = useRef<TapEvent[]>([]);
  const flushingRef = useRef(false);

  const enqueue = useCallback((evts: TapEvent[]) => {
    if (evts.length === 0) return;
    const q = queueRef.current;
    for (const e of evts) {
      q.push(e);
      const total = e.rolls && "total" in e.rolls ? ` = ${e.rolls.total}` : "";
      const line = `${e.actor_name ?? "Unknown"} ${e.event_type}${e.name ? `: ${e.name}` : ""}${total}`;
      setFeed((f) => [{ line, fidelity: e.fidelity, at: new Date().toLocaleTimeString() }, ...f].slice(0, 25));
    }
    while (q.length > 200) q.shift();
    setPending(q.length);
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    const q = queueRef.current;
    if (q.length === 0) return;
    flushingRef.current = true;
    const batch = q.slice(0, 50);
    try {
      const res = await fetch("/api/vtt/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share_code: code, events: batch }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        q.splice(0, batch.length);
        setSent((n) => n + (data.inserted ?? batch.length));
        setSkipped((n) => n + (data.skipped ?? 0));
        setSession("open");
        setLastError(null);
        if (Array.isArray(data.unmatched_ddb_ids) && data.unmatched_ddb_ids.length > 0) {
          setUnmatched((prev) => Array.from(new Set([...prev, ...data.unmatched_ddb_ids])));
        }
      } else if (res.status === 409) {
        setSession("closed");
        setLastError("No open session. Ask your GM to start the session in Six Axes.");
      } else {
        setLastError(typeof data.error === "string" ? data.error : `Send failed (${res.status}).`);
      }
    } catch {
      setLastError("Network error. Events are queued and will retry.");
    } finally {
      flushingRef.current = false;
      setPending(queueRef.current.length);
    }
  }, [code]);

  useEffect(() => {
    const listeners: [string, EventListener][] = [];
    const listen = (name: string, cb: (...args: any[]) => void) => {
      const handler = ((evt: CustomEvent) => {
        const detail = (evt.detail || []) as any[];
        cb(...detail);
      }) as EventListener;
      document.addEventListener("Beyond20_" + name, handler, false);
      listeners.push(["Beyond20_" + name, handler]);
    };

    listen("Loaded", () => setB20("connected"));
    listen("NewSettings", () => setB20("connected"));
    listen("RenderedRoll", (payload: any) => enqueue(normalizeRenderedRoll(payload)));
    listen("UpdateHP", (request: any, name: any, hp: any, maxHp: any, tempHp: any) => {
      const ch = request?.character;
      enqueue([
        {
          source: "beyond20",
          ddb_character_id: ch?.id ? String(ch.id).slice(0, 64) : null,
          actor_name: typeof name === "string" ? name.slice(0, 200) : null,
          event_type: "hp-update",
          name: null,
          fidelity: "canonical",
          rolled_at: new Date().toISOString(),
          rolls: null,
          state: { hp: hp ?? null, max_hp: maxHp ?? null, temp_hp: tempHp ?? null },
        },
      ]);
    });
    listen("UpdateConditions", (request: any, name: any, conditions: any, exhaustion: any) => {
      const ch = request?.character;
      enqueue([
        {
          source: "beyond20",
          ddb_character_id: ch?.id ? String(ch.id).slice(0, 64) : null,
          actor_name: typeof name === "string" ? name.slice(0, 200) : null,
          event_type: "conditions",
          name: null,
          fidelity: "canonical",
          rolled_at: new Date().toISOString(),
          rolls: null,
          state: {
            conditions: Array.isArray(conditions) ? conditions : [],
            exhaustion: exhaustion ?? null,
          },
        },
      ]);
    });

    const interval = setInterval(() => {
      if (queueRef.current.length > 0) void flush();
    }, 4000);

    return () => {
      clearInterval(interval);
      for (const [name, handler] of listeners) {
        document.removeEventListener(name, handler, false);
      }
    };
  }, [enqueue, flush]);

  useEffect(() => {
    if (pending >= 10) void flush();
  }, [pending, flush]);

  const pill = (label: string, ok: boolean | null) => (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        background: ok === true ? "#1d3324" : ok === false ? "#3a2230" : "#2a2438",
        color: ok === true ? "#9fe0ae" : ok === false ? "#e0a2b8" : "#b7aed1",
      }}
    >
      {label}
    </span>
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#16121f",
        color: "#e8e2f0",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <h1 style={{ color: BRASS, fontSize: 22, marginBottom: 4 }}>Six Axes Table Tap</h1>
      <p style={{ color: "#9a8fb0", fontSize: 14, marginTop: 0 }}>
        Keep this tab open while you play. Rolls you make on D&D Beyond are captured for
        your GM&apos;s session recap and table analytics.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
        {pill(b20 === "connected" ? "Beyond20 connected" : "Waiting for Beyond20", b20 === "connected" ? true : null)}
        {pill(
          session === "open" ? "Session open" : session === "closed" ? "No open session" : "Session unknown",
          session === "open" ? true : session === "closed" ? false : null
        )}
        {pill(`Sent ${sent}`, sent > 0 ? true : null)}
        {pill(`Pending ${pending}`, null)}
      </div>

      {b20 === "waiting" && (
        <div style={{ background: "#221c31", border: "1px solid #37304a", borderRadius: 10, padding: 14, fontSize: 14, marginBottom: 12 }}>
          <b style={{ color: BRASS }}>One-time setup:</b> in Beyond20&apos;s options, add{" "}
          <code style={{ color: "#9fe0ae" }}>https://pc-wrangler.vercel.app/*</code> to Custom Domains and press
          Apply, then reload this page. For table-accurate numbers, also enable D&D Beyond digital dice.
        </div>
      )}

      {lastError && (
        <div style={{ background: "#3a2230", border: "1px solid #5a3348", borderRadius: 10, padding: 12, fontSize: 14, marginBottom: 12, color: "#e0a2b8" }}>
          {lastError}
        </div>
      )}

      {unmatched.length > 0 && (
        <div style={{ background: "#221c31", border: "1px solid #37304a", borderRadius: 10, padding: 12, fontSize: 13, marginBottom: 12, color: "#b7aed1" }}>
          Rolls received from unlinked D&D Beyond character id{unmatched.length > 1 ? "s" : ""}:{" "}
          {unmatched.join(", ")}. Your GM can link them to campaign characters in Six Axes.
        </div>
      )}

      <div>
        {feed.map((f, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              padding: "8px 12px",
              background: "#221c31",
              border: "1px solid #37304a",
              borderRadius: 8,
              marginBottom: 6,
              fontSize: 14,
            }}
          >
            <span
              title={f.fidelity}
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: f.fidelity === "canonical" ? "#9fe0ae" : "#e0c76a",
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1 }}>{f.line}</span>
            <span style={{ color: "#776d90", fontSize: 12 }}>{f.at}</span>
          </div>
        ))}
        {feed.length === 0 && (
          <p style={{ color: "#776d90", fontSize: 14 }}>No rolls captured yet. Roll something on your character sheet.</p>
        )}
      </div>
    </main>
  );
}
