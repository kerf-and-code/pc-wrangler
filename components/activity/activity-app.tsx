"use client";

// components/activity/activity-app.tsx (2026-11-11, push 34, audit P7: the Discord Activity)
//
// Six Axes inside Discord. Launched from a voice channel's Activities, it shows the campaign linked to
// that Discord server (/setup): the battle map with its tokens and fog, the shared turn order, and a
// dice roller whose rolls land in the table's chat. A player can move their own token and roll as
// their character, including initiative; the GM rolls too, hidden if they like. Someone in the server
// without a linked character watches.
//
// How it talks to Six Axes: the Discord Embedded App SDK (loaded only here) signs the user in with
// Discord, app/api/activity/token turns that into an Activity session, and everything else goes
// through app/api/activity (state, move, roll), which reads and writes as the user's Six Axes profile.
// No Supabase session exists in the iframe, so nothing here talks to Supabase directly; pictures
// stored in Supabase come through the "/sb" URL mapping (lib/discord/activity-view.ts). The page polls
// every few seconds; the table on the website is the full tool.
//
// Push 35: Your cards, the cards in this person's hand (words only; pictures need a website session),
// with Use it for the GM's own cards (it goes back to its deck) and Play face up.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { renderClassic, layoutBare } from "@/lib/dungeon/classic";
import { normalizeLevels, CELL_TYPES } from "@/lib/dungeon/render";
import { normCustom, normDoors, normElements, normBattleMeta, piecesOverImage } from "@/lib/dungeon/battle";
import { decodeFog, isRevealed, doorsAsDrawn, edgeSegment } from "@/lib/tabletop/fog";
import { gridOf, isHex, offsetOf, hexCentres, hexCorners } from "@/lib/tabletop/hex";
import { snapTokenOn } from "@/lib/tabletop/geometry";
import { mergeMessages, sinceOf, proxiedUrl, diceNotation, rollLine, type FeedMessage, type HandCard } from "@/lib/discord/activity-view";

type Role = "gm" | "player" | "watch";
type Camp = { id: string; name: string; role: Role };
type Token = { id: string; kind: string; character_id: string | null; name: string; image_url: string | null; x: number; y: number; size: number; layer: string; hidden: boolean; mine?: boolean };
/** A short fingerprint of what a map picture is drawn from (push 45, B3): FNV-1a over its JSON. */
function sig(v: unknown): string {
  const t = JSON.stringify(v) ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${t.length.toString(36)}.${h.toString(36)}`;
}
type MapJson = { id: string; kind: string; n: number; feet_per_square: number; grid: unknown; custom: unknown; doors: unknown; elements: unknown; meta: Record<string, unknown>; door_state?: Record<string, boolean>; fog?: { on: boolean; revealed: string }; walls?: string[] };
type TableState = { scene: { id: string; name: string; settings?: Record<string, unknown> } | null; map: MapJson | null; tokens: Token[] } | null;
type Entry = { id: string; name: string; kind: string; initiative: number | null; defeated: boolean; is_turn: boolean; tokenId?: string | null; characterId?: string | null; mine?: boolean; hp?: number | null; maxHp?: number | null; tempHp?: number | null; conditions?: string[]; health?: "healthy" | "bloodied" | "down";
  // push 36: on your own character, the saving throws the GM's effects are waiting on
  pendingSaves?: { id: string; by: string; label: string; ability: string; dc: number; damage: number; type?: string; half: boolean; conditions?: string[] }[] };
type Combat = { id: string; name: string; round: number; order: Entry[] } | null;
type Char = { id: string; name: string; init?: number | null; saves?: Record<string, number> | null };

const INK = "#ece4d6", MUTED = "#a99e86", LINE = "#3a332a", PANEL = "#1f1a15", DEEP = "#14110d", GOLD = "#c9a24b", GOOD = "#7cc49a", WARN = "#e8907e";
const DICE = [4, 6, 8, 10, 12, 20, 100];

export default function ActivityApp() {
  const [phase, setPhase] = useState<"outside" | "connecting" | "pick" | "table" | "error">("connecting");
  const [err, setErr] = useState<string | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [camps, setCamps] = useState<Camp[]>([]);
  const [camp, setCamp] = useState<Camp | null>(null);
  const [state, setState] = useState<TableState>(null);
  const [combat, setCombat] = useState<Combat>(null);
  const [feed, setFeed] = useState<FeedMessage[]>([]);
  const [chars, setChars] = useState<Char[]>([]);
  const [hand, setHand] = useState<HandCard[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const inDiscord = useRef(false);
  const feedRef = useRef<FeedMessage[]>([]);
  feedRef.current = feed;

  // ---- sign in through Discord ----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("frame_id")) { setPhase("outside"); return; }
    inDiscord.current = true;
    const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
    if (!clientId) { setErr("The Discord Activity is not set up on this server yet."); setPhase("error"); return; }
    let off = false;
    (async () => {
      try {
        const { DiscordSDK } = await import("@discord/embedded-app-sdk");
        const sdk = new DiscordSDK(clientId);
        await sdk.ready();
        const { code } = await sdk.commands.authorize({ client_id: clientId, response_type: "code", state: "", prompt: "none", scope: ["identify", "guilds"] });
        const res = await fetch("/api/activity/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, guildId: sdk.guildId }) });
        const j = (await res.json().catch(() => ({}))) as { error?: string; access_token?: string; session?: string; user?: { name: string }; campaigns?: Camp[] };
        if (!res.ok || !j.session || !j.access_token) throw new Error(j.error || "Sign-in did not go through. Close the Activity and open it again.");
        await sdk.commands.authenticate({ access_token: j.access_token });
        if (off) return;
        setSession(j.session); setUserName(j.user?.name ?? "");
        const list = j.campaigns ?? [];
        setCamps(list);
        if (list.length === 1) { setCamp(list[0]); setPhase("table"); } else setPhase("pick");
      } catch (e) {
        if (off) return;
        setErr(e instanceof Error ? e.message : "Could not connect to Discord.");
        setPhase("error");
      }
    })();
    return () => { off = true; };
  }, []);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${session}`, "Content-Type": "application/json" } });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Something went wrong.");
    return j;
  }, [session]);

  // ---- the table, polled ----
  const poll = useCallback(async () => {
    if (!camp || !session) return;
    try {
      const since = sinceOf(feedRef.current);
      const j = await api(`/api/activity/state?campaign=${camp.id}${since ? `&since=${encodeURIComponent(since)}` : ""}`);
      setState((j.state as TableState) ?? null);
      setCombat((j.combat as Combat) ?? null);
      setFeed((f) => mergeMessages(f, ((j.feed as { messages?: FeedMessage[] } | null)?.messages) ?? []));
      setChars((((j.me as { characters?: Char[] } | undefined)?.characters) ?? []));
      setHand((((j.me as { hand?: HandCard[] } | undefined)?.hand) ?? []));
      setNote(typeof j.note === "string" ? j.note : null);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Lost the table for a moment."); }
  }, [api, camp, session]);
  useEffect(() => {
    if (phase !== "table") return;
    void poll();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void poll(); }, 2500);
    return () => window.clearInterval(t);
  }, [phase, poll]);

  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast((x) => (x === m ? null : x)), 4000); };

  const move = async (tokenId: string, x: number, y: number) => {
    if (!camp) return;
    try { await api("/api/activity/move", { method: "POST", body: JSON.stringify({ campaign: camp.id, token: tokenId, x, y }) }); void poll(); }
    catch (e) { say(e instanceof Error ? e.message : "That move did not go through."); }
  };
  const roll = async (notation: string, label: string, opts: { characterId?: string | null; initiative?: boolean; gmOnly?: boolean; saveFor?: string; manual?: number } = {}) => {
    if (!camp) return;
    try {
      const j = await api("/api/activity/roll", { method: "POST", body: JSON.stringify({ campaign: camp.id, notation, label, ...opts }) });
      const msg = j.message as FeedMessage | undefined;
      if (msg) setFeed((f) => mergeMessages(f, [msg]));
      const sv = j.saved as { saved: boolean; damage: number; dc: number } | null | undefined;
      if (sv) say(`${(msg?.roll?.total ?? "?")} against DC ${sv.dc}: ${sv.saved ? "saved" : "failed"}. ${sv.damage ? `${sv.damage} damage.` : "No damage."}`);
      if (opts.initiative || opts.saveFor) void poll();
    } catch (e) { say(e instanceof Error ? e.message : "That roll did not go through."); }
  };

  // push 35: use a card from your hand (it goes back to its deck), or play it face up on the table
  const card = async (c: HandCard, action: "use" | "play") => {
    if (!camp) return;
    try { await api("/api/activity/card", { method: "POST", body: JSON.stringify({ campaign: camp.id, card: c.id, action }) }); setHand((h) => h.filter((x) => x.id !== c.id)); void poll(); }
    catch (e) { say(e instanceof Error ? e.message : "That did not go through."); }
  };

  const shell: React.CSSProperties = { minHeight: "100vh", background: DEEP, color: INK, fontFamily: "system-ui, sans-serif", fontSize: 14, boxSizing: "border-box" };
  const center: React.CSSProperties = { ...shell, display: "grid", placeItems: "center", padding: 24, textAlign: "center" };

  if (phase === "outside") {
    return (
      <div style={center}><div style={{ maxWidth: 460 }}>
        <h1 style={{ fontFamily: "Georgia, serif", color: GOLD, fontWeight: 600 }}>Six Axes in Discord</h1>
        <p style={{ color: MUTED, lineHeight: 1.6 }}>This page runs inside Discord. Join a voice channel in your game&apos;s server, open Activities, and pick Six Axes. On the web, the full table is at <Link href="/tabletop" style={{ color: GOLD }}>the tabletop</Link>.</p>
      </div></div>
    );
  }
  if (phase === "connecting") return <div style={center}><p style={{ color: MUTED }}>Connecting to Discord...</p></div>;
  if (phase === "error") {
    return <div style={center}><div style={{ maxWidth: 460 }}><h1 style={{ fontFamily: "Georgia, serif", color: GOLD, fontWeight: 600 }}>Six Axes</h1><p role="alert" style={{ lineHeight: 1.6 }}>{err}</p></div></div>;
  }
  if (phase === "pick") {
    return (
      <div style={center}><div style={{ maxWidth: 520, width: "100%" }}>
        <h1 style={{ fontFamily: "Georgia, serif", color: GOLD, fontWeight: 600 }}>Six Axes</h1>
        {camps.length === 0 ? (
          <p style={{ color: MUTED, lineHeight: 1.6 }}>No campaign is linked to this Discord server yet. The GM links one by typing <b style={{ color: INK }}>/setup</b> in a text channel here.</p>
        ) : (
          <>
            <p style={{ color: MUTED }}>Which table, {userName || "adventurer"}?</p>
            <div style={{ display: "grid", gap: 8 }}>
              {camps.map((c) => (
                <button key={c.id} type="button" onClick={() => { setCamp(c); setPhase("table"); }}
                  style={{ background: PANEL, color: INK, border: `1px solid ${LINE}`, borderRadius: 10, padding: "12px 14px", fontSize: 15, cursor: "pointer", textAlign: "left" }}>
                  {c.name} <span style={{ color: MUTED, fontSize: 12 }}>{c.role === "gm" ? "you run it" : c.role === "player" ? "you play" : "watching"}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div></div>
    );
  }

  return (
    <div style={{ ...shell, display: "flex", flexDirection: "column", height: "100vh" }}>
      <header style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <b style={{ fontFamily: "Georgia, serif", color: GOLD, fontSize: 16 }}>{camp?.name}</b>
        {state?.scene && <span style={{ color: MUTED, fontSize: 12.5 }}>{state.scene.name}</span>}
        <span style={{ flex: 1 }} />
        {camps.length > 1 && <button type="button" onClick={() => { setPhase("pick"); setState(null); setCombat(null); setFeed([]); }} style={btn()}>Switch table</button>}
        <span style={{ color: MUTED, fontSize: 12 }}>{camp?.role === "gm" ? "GM" : camp?.role === "player" ? userName : `${userName}, watching`}</span>
      </header>
      {camp?.role === "watch" && (
        <p style={{ margin: 0, padding: "6px 12px", background: "rgba(201,162,75,0.1)", color: MUTED, fontSize: 12.5, borderBottom: `1px solid ${LINE}` }}>
          You are watching. To play, sign in to Six Axes with Discord on the website, or type /claim in this server to link your character.
        </p>
      )}
      {(err || note) && <p role="status" style={{ margin: 0, padding: "6px 12px", color: err ? WARN : MUTED, fontSize: 12.5 }}>{err || note}</p>}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 420px", minWidth: 0, minHeight: 300, position: "relative" }}>
          <MapView state={state} combat={combat} canMove={camp?.role !== "watch"} onMove={move} inDiscord={inDiscord.current} say={say} />
        </div>
        <aside style={{ flex: "0 1 340px", minWidth: 280, borderLeft: `1px solid ${LINE}`, overflow: "auto", padding: 12, display: "grid", gap: 14, alignContent: "start" }}>
          {camp?.role === "player" && <SavePrompt combat={combat} chars={chars} onRoll={(e, ps, bonus, manual) => void roll(manual != null ? "1d20" : `1d20${bonus >= 0 ? "+" : ""}${bonus}`, `${ps.ability.toUpperCase()} save vs ${ps.label}`, { characterId: e.characterId, saveFor: ps.id, manual })} />}
          <TurnOrder combat={combat} chars={chars} role={camp?.role ?? "watch"} onInitiative={(c) => void roll(`1d20${c.init ? (c.init > 0 ? `+${c.init}` : `${c.init}`) : ""}`, "Initiative", { characterId: c.id, initiative: true })} />
          {camp?.role !== "watch" && <DicePanel chars={chars} gm={camp?.role === "gm"} onRoll={roll} />}
          {camp?.role !== "watch" && hand.length > 0 && <Hand hand={hand} onCard={(c, a) => void card(c, a)} />}
          <Log feed={feed} />
        </aside>
      </div>
      {toast && <div role="alert" style={{ position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)", background: PANEL, border: `1px solid ${GOLD}`, borderRadius: 10, padding: "8px 14px", fontSize: 13.5 }}>{toast}</div>}
    </div>
  );
}

function btn(on = false): React.CSSProperties {
  return { background: on ? "rgba(201,162,75,0.18)" : "transparent", color: on ? GOLD : INK, border: `1px solid ${on ? GOLD : LINE}`, borderRadius: 8, padding: "5px 10px", fontSize: 12.5, cursor: "pointer" };
}

// ---- the map ----
function MapView({ state, combat, canMove, onMove, inDiscord, say }: {
  state: TableState; combat: Combat; canMove: boolean; onMove: (id: string, x: number, y: number) => void; inDiscord: boolean; say: (m: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<{ key: string; cv: HTMLCanvasElement; cell: number } | null>(null);
  const imgs = useRef(new Map<string, HTMLImageElement | "loading" | "failed">());
  const [cam, setCam] = useState({ s: 1, x: 0, y: 0 });
  const [fitted, setFitted] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [imgTick, setImgTick] = useState(0);
  const drag = useRef<{ px: number; py: number; cx: number; cy: number; moved: boolean } | null>(null);
  const map = state?.map ?? null;
  const n = map ? (map.n > 0 ? map.n : 25) : 0;
  const turnToken = combat?.order.find((e) => e.is_turn)?.tokenId ?? null;

  const image = useCallback((url: string | null | undefined): HTMLImageElement | null => {
    const u = proxiedUrl(url, process.env.NEXT_PUBLIC_SUPABASE_URL, inDiscord);
    if (!u) return null;
    const have = imgs.current.get(u);
    if (have && typeof have !== "string") return have;
    if (!have) {
      imgs.current.set(u, "loading");
      const im = new Image(); im.crossOrigin = "anonymous";
      im.onload = () => { imgs.current.set(u, im); setImgTick((v) => v + 1); };
      im.onerror = () => { imgs.current.set(u, "failed"); };
      im.src = u;
    }
    return null;
  }, [inDiscord]);

  // the map picture, drawn once per map and scene (the same renderer as the web tabletop)
  const base = useMemo(() => {
    if (!map) return null;
    void imgTick; // run again when a picture arrives (the map's painting may be one)
    const cell = Math.max(16, Math.min(48, Math.floor(3072 / n)));
    const kind = map.kind === "outdoor" ? "outdoor" : "indoor";
    const meta = normBattleMeta({ ...map.meta, overlays: [(map.meta as { overlay?: unknown })?.overlay ?? null] }, kind);
    const ov = meta.overlays[0];
    const ovImg = ov && ov.show ? image(ov.url) : null;
    const gsets = state?.scene?.settings, gk = gridOf(gsets), off = offsetOf(gsets);
    // push 45 (audit round 2, B3): the key covers everything the picture is drawn from. It used to leave
    // out the grid, custom tiles, doors, elements and map settings, which change when the GM reveals
    // squares (the server sends what is under them only then) or the scene moves to another floor, so
    // the Activity kept drawing the old picture.
    const key = `${map.id}|${sig([map.grid, map.custom, map.doors, map.elements, map.meta, map.feet_per_square, map.kind, map.door_state ?? {}, map.walls ?? []])}|${ovImg ? "img" : "plain"}|${gk}|${off.x}|${off.y}`;
    if (baseRef.current?.key === key) return baseRef.current;
    const allEls = normElements([map.elements], n)[0];
    const piecesInPaint = !!ovImg && !!ov && !piecesOverImage(ov);
    const L = layoutBare(cell, { r0: 0, c0: 0, rows: n, cols: n });
    const cv = document.createElement("canvas"); cv.width = L.width; cv.height = L.height;
    const ctx = cv.getContext("2d");
    if (ctx) {
      renderClassic(ctx, {
        n, grid: normalizeLevels([map.grid], n)[0], custom: normCustom([map.custom], n)[0], tileImages: new Map(), tileColors: new Map(),
        marks: { features: {}, doors: doorsAsDrawn(normDoors([map.doors], n)[0], map.door_state ?? {}), labels: {} },
        meta: { title: "", levelNames: meta.levelNames, autoNumber: meta.autoNumber, grid: meta.showGrid },
        level: 0, feetPerSquare: map.feet_per_square, outdoor: kind === "outdoor", ground: meta.ground > 0 && meta.ground < CELL_TYPES.length ? meta.ground : undefined,
        gridLook: meta.grid, elements: allEls, drawElements: true,
        topGrid: meta.topGrid.show ? meta.topGrid.opacity : null, overlay: ovImg && ov ? { img: ovImg, opacity: ov.opacity, inkOnTop: ov.inkOnTop } : null,
        piecesHidden: piecesInPaint, bare: true,
      }, L);
      // closed secret doors, as players get them: plain wall (as on the web tabletop)
      if (map.walls?.length) {
        ctx.save(); ctx.lineCap = "round";
        for (const [w, col] of [[Math.max(3, cell * 0.32), "rgba(70,50,25,0.13)"], [Math.max(2, cell * 0.11), "#2b2018"]] as [number, string][]) {
          ctx.lineWidth = w; ctx.strokeStyle = col; ctx.beginPath();
          for (const k of map.walls) { const sg = edgeSegment(k, n); if (!sg) continue; ctx.moveTo(sg.a.x * cell, sg.a.y * cell); ctx.lineTo(sg.b.x * cell, sg.b.y * cell); }
          ctx.stroke();
        }
        ctx.restore();
      }
      // a hex scene's grid (push 33)
      if (isHex(gk)) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, n * cell, n * cell); ctx.clip();
        ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.beginPath();
        for (const c of hexCentres(n, gk, off)) {
          const cs = hexCorners(c, gk);
          ctx.moveTo(cs[0].x * cell, cs[0].y * cell);
          for (let k = 1; k < 6; k++) ctx.lineTo(cs[k].x * cell, cs[k].y * cell);
          ctx.closePath();
        }
        ctx.stroke(); ctx.restore();
      }
    }
    baseRef.current = { key, cv, cell };
    return baseRef.current;
  }, [map, n, image, imgTick, state?.scene?.settings]);

  // fit the map to the view when a new scene arrives
  useEffect(() => {
    const cv = canvasRef.current; if (!cv || !base || !state?.scene) return;
    if (fitted === state.scene.id) return;
    const r = cv.getBoundingClientRect(), W = base.cv.width, H = base.cv.height;
    const s = Math.max(0.05, Math.min((r.width - 20) / W, (r.height - 20) / H));
    setCam({ s, x: (r.width - W * s) / 2, y: (r.height - H * s) / 2 });
    setFitted(state.scene.id);
  }, [base, state?.scene, fitted]);

  // draw
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = DEEP; ctx.fillRect(0, 0, r.width, r.height);
    if (!base || !map) {
      ctx.fillStyle = MUTED; ctx.font = "14px system-ui"; ctx.textAlign = "center";
      ctx.fillText(state ? "No map on the table yet." : "Loading the table...", r.width / 2, r.height / 2);
      return;
    }
    const cell = base.cell;
    ctx.save(); ctx.translate(cam.x, cam.y); ctx.scale(cam.s, cam.s);
    ctx.drawImage(base.cv, 0, 0);
    // fog: hidden squares dark (the server already leaves out what is under them)
    if (map.fog?.on) {
      const bits = decodeFog(map.fog.revealed, n);
      ctx.fillStyle = "rgba(10,8,6,0.94)";
      for (let rr = 0; rr < n; rr++) for (let c = 0; c < n; c++) if (!isRevealed(bits, n, c, rr)) ctx.fillRect(c * cell, rr * cell, cell + 0.5, cell + 0.5);
    }
    for (const t of state?.tokens ?? []) {
      if (t.layer === "map") continue;
      const x = t.x * cell, y = t.y * cell, rad = Math.max(0.35, t.size / 2) * cell;
      ctx.globalAlpha = t.hidden ? 0.45 : 1;
      if (turnToken === t.id) { ctx.strokeStyle = GOLD; ctx.lineWidth = Math.max(3, cell * 0.12); ctx.beginPath(); ctx.arc(x, y, rad + cell * 0.12, 0, Math.PI * 2); ctx.stroke(); }
      const im = image(t.image_url);
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, rad * 0.92, 0, Math.PI * 2); ctx.closePath();
      if (im) { ctx.clip(); ctx.drawImage(im, x - rad, y - rad, rad * 2, rad * 2); }
      else { ctx.fillStyle = t.kind === "pc" ? "#3f7a55" : t.kind === "monster" ? "#8a3b31" : t.kind === "npc" ? "#5d4a8a" : "#5a5248"; ctx.fill(); }
      ctx.restore();
      ctx.strokeStyle = sel === t.id ? GOLD : t.mine ? GOOD : "rgba(0,0,0,0.7)"; ctx.lineWidth = Math.max(2, cell * (sel === t.id ? 0.1 : 0.05));
      ctx.beginPath(); ctx.arc(x, y, rad * 0.92, 0, Math.PI * 2); ctx.stroke();
      if (!im) { ctx.fillStyle = INK; ctx.font = `600 ${Math.max(10, rad * 0.8)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText((t.name || "?").slice(0, 1).toUpperCase(), x, y); }
      ctx.font = `${Math.max(10, cell * 0.28)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.strokeText(t.name.slice(0, 18), x, y + rad + 2); ctx.fillStyle = INK; ctx.fillText(t.name.slice(0, 18), x, y + rad + 2);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }, [base, map, n, state, cam, sel, turnToken, image, imgTick]);

  const toSquares = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const cell = base?.cell ?? 1;
    return { x: (clientX - r.left - cam.x) / cam.s / cell, y: (clientY - r.top - cam.y) / cam.s / cell };
  };
  const tokenAt = (p: { x: number; y: number }) => {
    const list = (state?.tokens ?? []).filter((t) => t.layer !== "map");
    for (let i = list.length - 1; i >= 0; i--) { const t = list[i]; if (Math.hypot(p.x - t.x, p.y - t.y) <= Math.max(0.35, t.size / 2)) return t; }
    return null;
  };
  const tap = (clientX: number, clientY: number) => {
    const p = toSquares(clientX, clientY);
    const t = tokenAt(p);
    if (t) {
      if (!canMove) return;
      if (t.mine) { setSel(sel === t.id ? null : t.id); return; }
      if (sel) { /* tapping someone else while one of yours is chosen: fall through to a move there */ } else return;
    }
    if (sel && canMove) {
      const tok = (state?.tokens ?? []).find((x) => x.id === sel);
      if (!tok) { setSel(null); return; }
      if (p.x < 0 || p.y < 0 || p.x > n || p.y > n) return;
      const at = snapTokenOn(state?.scene?.settings, p.x, p.y, tok.size);
      onMove(sel, at.x, at.y); setSel(null);
    } else if (canMove) say("Tap one of your tokens, then the square to move it to.");
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: sel ? "crosshair" : "grab" }}
        onPointerDown={(e) => { drag.current = { px: e.clientX, py: e.clientY, cx: cam.x, cy: cam.y, moved: false }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => {
          const d = drag.current; if (!d) return;
          const dx = e.clientX - d.px, dy = e.clientY - d.py;
          if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
          if (d.moved) setCam((c) => ({ ...c, x: d.cx + dx, y: d.cy + dy }));
        }}
        onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && !d.moved) tap(e.clientX, e.clientY); }}
        onWheel={(e) => {
          const r = canvasRef.current!.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
          const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          setCam((c) => { const s = Math.max(0.05, Math.min(6, c.s * f)); return { s, x: mx - ((mx - c.x) * s) / c.s, y: my - ((my - c.y) * s) / c.s }; });
        }} />
      <div style={{ position: "absolute", right: 8, bottom: 8, display: "flex", gap: 4 }}>
        <button type="button" aria-label="Zoom in" style={btn()} onClick={() => setCam((c) => ({ ...c, s: Math.min(6, c.s * 1.25) }))}>+</button>
        <button type="button" aria-label="Zoom out" style={btn()} onClick={() => setCam((c) => ({ ...c, s: Math.max(0.05, c.s / 1.25) }))}>&minus;</button>
        <button type="button" style={btn()} onClick={() => setFitted(null)}>Fit</button>
      </div>
      {sel && <div style={{ position: "absolute", left: 8, bottom: 8, background: PANEL, border: `1px solid ${GOLD}`, borderRadius: 8, padding: "5px 9px", fontSize: 12.5 }}>Tap where to move. <button type="button" style={btn()} onClick={() => setSel(null)}>Cancel</button></div>}
    </div>
  );
}

// ---- a saving throw the GM's effect is waiting on (push 36) ----
type PS = NonNullable<Entry["pendingSaves"]>[number];
// push 45 (audit round 2, U1): the bonus starts at the character's save off its saved sheet, not +0
function SavePrompt({ combat, chars, onRoll }: { combat: Combat; chars: Char[]; onRoll: (e: Entry, ps: PS, bonus: number, manual?: number) => void }) {
  const [bonus, setBonus] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const mine = (combat?.order ?? []).filter((e) => e.mine && (e.pendingSaves ?? []).length);
  if (!mine.length) return null;
  const sheetBonus = (e: Entry, ps: PS): number | null => {
    const v = chars.find((c) => c.id === e.characterId)?.saves?.[ps.ability];
    return typeof v === "number" ? v : null;
  };
  const bonusText = (e: Entry, ps: PS) => bonus[ps.id] ?? (sheetBonus(e, ps) != null ? `${sheetBonus(e, ps)! >= 0 ? "+" : ""}${sheetBonus(e, ps)}` : "");
  const field: React.CSSProperties = { background: DEEP, color: INK, border: `1px solid ${LINE}`, borderRadius: 7, padding: "5px 7px", fontSize: 13, width: 56 };
  return (
    <section role="alert" style={{ border: `1px solid ${WARN}`, borderRadius: 10, padding: 10, background: "rgba(232,144,126,0.08)" }}>
      {mine.flatMap((e) => (e.pendingSaves ?? []).map((ps) => (
        <div key={ps.id} style={{ display: "grid", gap: 6 }}>
          <div style={{ lineHeight: 1.45 }}>
            <b>{e.name}</b>: {ps.by}&apos;s {ps.label}. Make a <b>{ps.ability.toUpperCase()}</b> save, DC {ps.dc}.
            {ps.damage ? ` ${ps.damage}${ps.type ? ` ${ps.type}` : ""} damage on a failure${ps.half ? ", half on a success" : ", none on a success"}.` : ""}
            {(ps.conditions ?? []).length ? ` ${(ps.conditions ?? []).join(", ")} on a failure.` : ""}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ color: MUTED, fontSize: 12.5 }}>Bonus <input aria-label="Save bonus" inputMode="numeric" placeholder="+0" style={field} value={bonusText(e, ps)}
              onChange={(ev) => setBonus((m) => ({ ...m, [ps.id]: ev.target.value.replace(/[^0-9+-]/g, "").slice(0, 3) }))} /></label>
            <button type="button" style={{ ...btn(true), background: WARN, color: DEEP, border: "none", fontWeight: 700 }} onClick={() => onRoll(e, ps, parseInt(bonusText(e, ps) || "0", 10) || 0)}>Roll {ps.ability.toUpperCase()} save</button>
          </div>
          <form onSubmit={(ev) => { ev.preventDefault(); const n = parseInt(typed[ps.id] ?? "", 10); if (Number.isFinite(n)) onRoll(e, ps, 0, n); }} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <label style={{ color: MUTED, fontSize: 12.5 }}>or I rolled <input aria-label="The total you rolled, with your bonus" inputMode="numeric" placeholder="total" style={field} value={typed[ps.id] ?? ""}
              onChange={(ev) => setTyped((m) => ({ ...m, [ps.id]: ev.target.value.replace(/[^0-9-]/g, "").slice(0, 3) }))} /></label>
            <button type="submit" style={btn()} disabled={!/^-?\d+$/.test(typed[ps.id] ?? "")}>Enter</button>
          </form>
        </div>
      )))}
    </section>
  );
}

// ---- the turn order ----
function TurnOrder({ combat, chars, role, onInitiative }: { combat: Combat; chars: Char[]; role: Role; onInitiative: (c: Char) => void }) {
  if (!combat) return <section><h2 style={h2}>Turn order</h2><p style={{ color: MUTED, margin: 0, fontSize: 13 }}>No fight is running.</p></section>;
  const mineNeeding = role === "player" ? chars.filter((c) => combat.order.some((e) => e.characterId === c.id && e.initiative == null)) : [];
  const cur = combat.order.find((e) => e.is_turn);
  return (
    <section>
      <h2 style={h2}>Turn order <span style={{ color: MUTED, fontWeight: 400, fontSize: 12 }}>round {combat.round}</span></h2>
      {cur?.mine && <p role="status" style={{ margin: "0 0 6px", color: GOLD, fontWeight: 700 }}>Your turn, {cur.name}.</p>}
      {mineNeeding.map((c) => (
        <button key={c.id} type="button" style={{ ...btn(true), marginBottom: 6, width: "100%" }} onClick={() => onInitiative(c)}>
          Roll initiative for {c.name}{c.init ? ` (${c.init > 0 ? "+" : ""}${c.init})` : ""}
        </button>
      ))}
      <div style={{ display: "grid", gap: 4 }}>
        {combat.order.map((e) => {
          const frac = e.hp != null && e.maxHp ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : null;
          return (
            <div key={e.id} style={{ border: `1px solid ${e.is_turn ? GOLD : LINE}`, borderLeft: `4px solid ${e.is_turn ? GOLD : "transparent"}`, borderRadius: 8, padding: "5px 8px", opacity: e.defeated ? 0.5 : 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ width: 24, textAlign: "center", fontWeight: 700, color: e.initiative == null ? MUTED : INK }}>{e.initiative ?? "?"}</span>
                <span style={{ flex: 1, color: e.mine ? GOOD : INK }}>{e.name}</span>
                {e.hp == null && e.health && <span style={{ color: e.health === "healthy" ? GOOD : e.health === "bloodied" ? GOLD : WARN, fontSize: 12 }}>{e.health}</span>}
                {e.hp != null && <span style={{ color: MUTED, fontSize: 12 }}>{e.hp}{e.maxHp ? `/${e.maxHp}` : ""}{e.tempHp ? ` +${e.tempHp}` : ""}</span>}
              </div>
              {frac != null && <div style={{ height: 3, background: "#2a241d", borderRadius: 2, marginTop: 4 }}><div style={{ width: `${frac * 100}%`, height: 3, borderRadius: 2, background: frac > 0.5 ? GOOD : frac > 0.25 ? GOLD : WARN }} /></div>}
              {(e.conditions ?? []).length > 0 && <div style={{ color: MUTED, fontSize: 11.5, marginTop: 3 }}>{(e.conditions ?? []).join(", ")}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- dice ----
function DicePanel({ chars, gm, onRoll }: { chars: Char[]; gm: boolean; onRoll: (n: string, label: string, o?: { characterId?: string | null; gmOnly?: boolean }) => void }) {
  const [adv, setAdv] = useState<"flat" | "adv" | "dis">("flat");
  const [mod, setMod] = useState("");
  const [custom, setCustom] = useState("");
  const [label, setLabel] = useState("");
  const [as, setAs] = useState<string>(chars[0]?.id ?? "");
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (!as && chars[0]) setAs(chars[0].id); }, [chars, as]);
  const m = parseInt(mod, 10) || 0;
  const go = (notation: string) => onRoll(notation, label.trim(), { characterId: as || null, gmOnly: gm && hidden });
  const field: React.CSSProperties = { background: PANEL, color: INK, border: `1px solid ${LINE}`, borderRadius: 7, padding: "5px 7px", fontSize: 13 };
  return (
    <section>
      <h2 style={h2}>Dice</h2>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {DICE.map((d) => <button key={d} type="button" style={{ ...btn(), minWidth: 44, minHeight: 36 }} onClick={() => go(diceNotation(d, 1, m, d === 20 ? adv : "flat"))}>d{d}</button>)}
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
        {(["flat", "adv", "dis"] as const).map((k) => <button key={k} type="button" aria-pressed={adv === k} style={btn(adv === k)} onClick={() => setAdv(k)}>{k === "flat" ? "Normal" : k === "adv" ? "Advantage" : "Disadvantage"}</button>)}
        <input aria-label="Modifier" value={mod} onChange={(e) => setMod(e.target.value.replace(/[^0-9-]/g, "").slice(0, 4))} placeholder="+0" style={{ ...field, width: 48 }} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (custom.trim()) { go(custom.trim()); setCustom(""); } }} style={{ display: "flex", gap: 4, marginTop: 6 }}>
        <input aria-label="Dice to roll" value={custom} onChange={(e) => setCustom(e.target.value.slice(0, 40))} placeholder="e.g. 2d6+3" style={{ ...field, flex: 1 }} />
        <button type="submit" style={btn(true)}>Roll</button>
      </form>
      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="What the roll is for" value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} placeholder="for (optional): Stealth" style={{ ...field, flex: 1, minWidth: 120 }} />
        {chars.length > 0 && (
          <select aria-label="Roll as" value={as} onChange={(e) => setAs(e.target.value)} style={field}>
            {chars.map((c) => <option key={c.id} value={c.id}>as {c.name}</option>)}
            {gm && <option value="">as the GM</option>}
          </select>
        )}
        {gm && <label style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12.5, color: MUTED }}><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> hidden</label>}
      </div>
    </section>
  );
}

// ---- your cards (push 35) ----
function Hand({ hand, onCard }: { hand: HandCard[]; onCard: (c: HandCard, action: "use" | "play") => void }) {
  return (
    <section>
      <h2 style={h2}>Your cards <span style={{ color: MUTED, fontWeight: 400, fontSize: 12 }}>{hand.length}</span></h2>
      <div style={{ display: "grid", gap: 6 }}>
        {hand.map((c) => (
          <div key={c.id} style={{ border: `1px solid ${c.gift ? GOLD : LINE}`, borderRadius: 8, padding: "7px 9px", background: PANEL }}>
            <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
              <b style={{ flex: 1 }}>{c.name}</b>
              {c.gift && <span style={{ color: GOLD, fontSize: 11.5 }}>given to you</span>}
            </div>
            {c.body && <div style={{ fontSize: 12.5, lineHeight: 1.4, marginTop: 2 }}>{c.body}</div>}
            {c.deck && <div style={{ color: MUTED, fontSize: 11.5, marginTop: 2 }}>{c.deck}</div>}
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {c.usable && <button type="button" style={btn(true)} title="Shows it to the table, then it goes back to its deck" onClick={() => onCard(c, "use")}>Use it</button>}
              <button type="button" style={btn()} onClick={() => onCard(c, "play")}>Play face up</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- the log ----
function Log({ feed }: { feed: FeedMessage[] }) {
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [feed.length]);
  return (
    <section>
      <h2 style={h2}>Rolls and chat</h2>
      <div style={{ maxHeight: 260, overflow: "auto", display: "grid", gap: 4, fontSize: 13 }} aria-live="polite">
        {feed.length === 0 && <p style={{ color: MUTED, margin: 0 }}>Nothing yet.</p>}
        {feed.map((m) => (
          <div key={m.id} style={{ borderBottom: `1px solid ${LINE}`, paddingBottom: 3 }}>
            {m.kind === "roll" && m.roll
              ? <span>{rollLine(m)}{m.roll.natural === 20 ? <b style={{ color: GOOD }}> natural 20</b> : m.roll.natural === 1 ? <b style={{ color: WARN }}> natural 1</b> : null}{m.gm_only ? <span style={{ color: MUTED }}> (hidden)</span> : null}</span>
              : <span><b>{m.as_name || "Someone"}</b> {m.body}</span>}
          </div>
        ))}
        <div ref={end} />
      </div>
    </section>
  );
}

const h2: React.CSSProperties = { fontFamily: "Georgia, serif", fontSize: 15, color: GOLD, margin: "0 0 6px", fontWeight: 600 };
