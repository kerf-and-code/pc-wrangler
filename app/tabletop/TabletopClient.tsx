"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import { renderClassic, layoutBare } from "@/lib/dungeon/classic";
import { normalizeLevels, CELL_TYPES } from "@/lib/dungeon/render";
import { normCustom, normDoors, normElements, normBattleMeta } from "@/lib/dungeon/battle";
import {
  snapToken, snapCenter, measure, fitCamera, zoomAt, centerOn, toWorld, parseChat, DIAGONAL_RULES,
  type Camera, type Pt, type DiagonalRule,
} from "@/lib/tabletop/geometry";

// The tabletop, phase 1 (2026-11-06). One page for the GM and the players; tabletop_state (p105)
// decides the role and strips what players must not see before it leaves the database.
//
// Map:     the active scene's battle map level, rendered once by lib/dungeon/classic into an offscreen
//          canvas (no frame or title, so its top-left is the grid's top-left), the Gemini painting
//          included. Every frame draws that image through the camera, then tokens, rulers and pings.
// Mouse:   wheel zooms at the cursor; right-drag, middle-drag or Space-drag pans; a right-click that
//          does not move pings (Shift + right-click, GM: everyone's view jumps there). In the ruler,
//          right-click drops a waypoint. Left-drag on a token you control moves it, snapped (Alt: free).
// Keys:    V select, M ruler, Delete removes (GM), H hides or shows (GM), R turns 45 degrees,
//          Escape lets go, C re-centres.
// Live:    one Realtime channel per campaign. Table changes (tokens, scenes, chat) arrive through RLS;
//          drags, rulers and pings are broadcast and never stored. Positions are saved once on drop.
// Chat:    /r, /gr, /w name, /em. Rolls go to /api/tabletop/roll, which rolls on the server and logs
//          the roll for Mechanics; D&D Beyond and Foundry rolls from the open session show here too.

type Token = {
  id: string; kind: "pc" | "npc" | "monster" | "object"; character_id: string | null; stat_block_id: string | null;
  name: string; image_url: string | null; x: number; y: number; size: number; rot: number;
  layer: "map" | "token" | "gm"; hidden: boolean; controlled_by: string[]; style: Record<string, unknown>; mine?: boolean;
};
type PartyMember = { profile_id: string; name: string; character_id: string | null; portrait_url: string | null };
type MapJson = { id: string; kind: string; n: number; feet_per_square: number; grid: unknown; custom: unknown; doors: unknown; elements: unknown; meta: Record<string, unknown> };
type Scene = { id: string; name: string; battle_map_id: string; level: number; settings: { show_labels?: boolean; diagonal?: DiagonalRule } };
type State = {
  role: "gm" | "player"; me: string; campaign: { id: string; name: string; gm_id: string }; session_id: string | null;
  scene: Scene | null; map: MapJson | null; tokens: Token[]; party: PartyMember[];
  scenes: { id: string; name: string; battle_map_id: string; level: number; is_active: boolean }[];
  battle_maps: { id: string; name: string; kind: string; levelNames: string[] | null }[];
};
type RollDie = { sides: number; value: number; kept: boolean };
type Message = {
  id: string; session_id: string | null; author_profile: string; as_name: string | null; character_id: string | null;
  kind: "say" | "emote" | "whisper" | "roll" | "system"; body: string; whisper_to: string[] | null; gm_only: boolean; created_at: string;
  roll: { label?: string; notation?: string; total?: number; dice?: RollDie[]; natural?: number | null; logged?: boolean } | null;
};
type OutsideRoll = { id: string; actor_name: string | null; source: string; name: string | null; at: string; rolls: { total?: number; dice?: { faces: number; results: number[] }[]; critical_success?: boolean; critical_failure?: boolean } | null };
type FeedItem = { t: number; key: string; msg?: Message; ext?: OutsideRoll };

type Tool = "select" | "ruler" | "hand";
type Ping = { x: number; y: number; color: string; born: number };
type Ruler = { points: Pt[]; color: string; done: number | null; by: string };

const SIZES: { v: number; label: string }[] = [
  { v: 0.5, label: "Tiny" }, { v: 1, label: "Small or Medium" }, { v: 2, label: "Large" }, { v: 3, label: "Huge" }, { v: 4, label: "Gargantuan" },
];
const KIND_RING: Record<Token["kind"], string> = { pc: "#d9a43a", npc: "#6fa3d8", monster: "#c9534a", object: "#9a9387" };
const SELECT = "#ffd36b";
const PING_MS = 3000, RULER_FADE_MS = 1500, DRAG_SEND_MS = 60, GLIDE_MS = 220;

function hueOf(id: string): string {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 75% 60%)`;
}
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const enumerated = (base: string, taken: string[]) => {
  if (!taken.includes(base)) return base;
  let i = 2; while (taken.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
};

export default function TabletopClient({ campaignId }: { campaignId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [panel, setPanel] = useState<"chat" | "tokens" | "scenes">("chat");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [draft, setDraft] = useState("");
  const [asWho, setAsWho] = useState<string>("");          // character id, or "" for yourself / GM name
  const [gmName, setGmName] = useState("GM");
  const [adv, setAdv] = useState<"flat" | "adv" | "dis">("flat");
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [present, setPresent] = useState<{ key: string; name: string; color: string }[]>([]);
  const [tick, setTick] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const cellRef = useRef(48);
  const camRef = useRef<Camera>({ s: 1, ox: 0, oy: 0 });
  const stateRef = useRef<State | null>(null);
  const tokensRef = useRef<Map<string, Token>>(new Map());
  const shown = useRef<Map<string, { x: number; y: number; fx: number; fy: number; t0: number }>>(new Map());
  const remoteDrag = useRef<Map<string, { x: number; y: number; until: number }>>(new Map());
  const imgs = useRef<Map<string, HTMLImageElement | "loading" | "failed">>(new Map());
  const pings = useRef<Ping[]>([]);
  const rulers = useRef<Map<string, Ruler>>(new Map());
  const myRuler = useRef<Ruler | null>(null);
  const keepRuler = useRef(false);
  const rulerSent = useRef(0);
  const drag = useRef<{ ids: string[]; start: Pt; orig: Map<string, Pt>; now: Map<string, Pt>; free: boolean; lastSend: number; moved: boolean } | null>(null);
  const pan = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean; button: number; shift: boolean } | null>(null);
  const box = useRef<{ a: Pt; b: Pt } | null>(null);
  const hover = useRef<string | null>(null);
  const space = useRef(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const frame = useRef<number | null>(null);
  const feedEnd = useRef<HTMLDivElement | null>(null);
  const selRef = useRef<string[]>([]);
  selRef.current = selected;
  stateRef.current = state;

  const isGm = state?.role === "gm";
  const me = state?.me ?? "";
  const myColor = useMemo(() => hueOf(me || "x"), [me]);
  const fps = state?.map?.feet_per_square ?? 5;
  const rule: DiagonalRule = state?.scene?.settings?.diagonal ?? "five";
  const party = useMemo(() => state?.party ?? [], [state]);
  const myChars = useMemo(() => party.filter((p) => p.profile_id === me && p.character_id), [party, me]);
  const nameOf = useCallback((m: Message) => {
    if (m.as_name) return m.as_name;
    const byChar = party.find((p) => p.character_id && p.character_id === m.character_id);
    if (byChar) return byChar.name;
    const byProfile = party.find((p) => p.profile_id === m.author_profile);
    return byProfile?.name ?? "Someone";
  }, [party]);

  // ---------------------------------------------------------------------------------------------------
  // drawing
  const requestDraw = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; drawRef.current(); });
  }, []);

  const loadImage = useCallback((url: string) => {
    if (imgs.current.has(url)) return;
    imgs.current.set(url, "loading");
    const img = new Image();
    img.onload = () => { imgs.current.set(url, img); requestDraw(); setTick((v) => v + 1); };
    img.onerror = () => { imgs.current.set(url, "failed"); };
    img.src = url;
  }, [requestDraw]);

  // The map underneath, rendered once per scene (and again when its painting arrives).
  const renderBase = useCallback(() => {
    const st = stateRef.current, m = st?.map;
    if (!m) { baseRef.current = null; return; }
    const n = m.n > 0 ? m.n : 25;
    const cell = Math.max(16, Math.min(64, Math.floor(4096 / n)));
    cellRef.current = cell;
    const kind = m.kind === "outdoor" ? "outdoor" : "indoor";
    const meta = normBattleMeta({ ...m.meta, overlays: [m.meta?.overlay ?? null] }, kind);
    const ov = meta.overlays[0];
    let overlay: { img: HTMLImageElement; opacity: number; inkOnTop: boolean } | null = null;
    if (ov && ov.show) {
      const im = imgs.current.get(ov.url);
      if (!im) loadImage(ov.url);
      else if (typeof im !== "string") overlay = { img: im, opacity: ov.opacity, inkOnTop: ov.inkOnTop };
    }
    const L = layoutBare(cell, { r0: 0, c0: 0, rows: n, cols: n });
    const cv = baseRef.current ?? document.createElement("canvas");
    cv.width = L.width; cv.height = L.height;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    renderClassic(ctx, {
      n, grid: normalizeLevels([m.grid], n)[0], custom: normCustom([m.custom], n)[0], tileImages: new Map(), tileColors: new Map(),
      marks: { features: {}, doors: normDoors([m.doors], n)[0], labels: {} },
      meta: { title: "", levelNames: meta.levelNames, autoNumber: meta.autoNumber, grid: meta.showGrid },
      level: 0, feetPerSquare: m.feet_per_square, outdoor: kind === "outdoor", ground: meta.ground > 0 && meta.ground < CELL_TYPES.length ? meta.ground : undefined,
      gridLook: meta.grid, elements: normElements([m.elements], n)[0], drawElements: true,
      topGrid: meta.topGrid.show ? meta.topGrid.opacity : null, overlay, piecesHidden: !!overlay && !ov?.piecesOnTop, bare: true,
    }, L);
    baseRef.current = cv;
  }, [loadImage]);

  const fit = useCallback(() => {
    const cv = canvasRef.current, base = baseRef.current; if (!cv || !base) return;
    const r = cv.getBoundingClientRect();
    camRef.current = fitCamera(r.width, r.height, base.width, base.height);
    requestDraw();
  }, [requestDraw]);

  const tokenAt = useCallback((w: Pt): Token | null => {
    const cell = cellRef.current, list = [...tokensRef.current.values()];
    const order = (t: Token) => (t.layer === "map" ? 0 : t.layer === "token" ? 1 : 2);
    list.sort((a, b) => order(a) - order(b));
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i], p = shownPos(t);
      const r = Math.max(0.35, t.size / 2) * cell;
      if (Math.hypot(w.x - p.x * cell, w.y - p.y * cell) <= r) return t;
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // where a token is drawn right now: my drag, someone else's drag, or a glide to its saved square
  function shownPos(t: Token): Pt {
    const d = drag.current?.now.get(t.id); if (d) return d;
    const rd = remoteDrag.current.get(t.id); if (rd && rd.until > performance.now()) return rd;
    const g = shown.current.get(t.id);
    if (!g) return { x: t.x, y: t.y };
    const k = Math.min(1, (performance.now() - g.t0) / GLIDE_MS), e = 1 - (1 - k) * (1 - k);
    return { x: g.fx + (g.x - g.fx) * e, y: g.fy + (g.y - g.fy) * e };
  }

  const drawRef = useRef<() => void>(() => {});
  drawRef.current = () => {
    const cv = canvasRef.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const cam = camRef.current, cell = cellRef.current, now = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#15120f"; ctx.fillRect(0, 0, r.width, r.height);
    ctx.save(); ctx.translate(cam.ox, cam.oy); ctx.scale(cam.s, cam.s);
    const base = baseRef.current;
    if (base) { ctx.imageSmoothingQuality = "high"; ctx.drawImage(base, 0, 0); }
    let animating = false;

    // tokens: map layer, then tokens, then the GM layer
    const list = [...tokensRef.current.values()];
    const order = (t: Token) => (t.layer === "map" ? 0 : t.layer === "token" ? 1 : 2);
    list.sort((a, b) => order(a) - order(b));
    const sel = new Set(selRef.current);
    for (const t of list) {
      const p = shownPos(t);
      const g = shown.current.get(t.id); if (g && now - g.t0 < GLIDE_MS) animating = true;
      const cx = p.x * cell, cy = p.y * cell, rad = (t.size / 2) * cell * 0.9;
      ctx.save();
      if (t.hidden || t.layer === "gm") ctx.globalAlpha = 0.5;
      ctx.translate(cx, cy); ctx.rotate((t.rot * Math.PI) / 180);
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2);
      const im = t.image_url ? imgs.current.get(t.image_url) : undefined;
      if (t.image_url && !im) loadImage(t.image_url);
      if (im && typeof im !== "string") {
        ctx.save(); ctx.clip();
        const k = Math.max((rad * 2) / im.width, (rad * 2) / im.height);
        ctx.drawImage(im, -im.width * k / 2, -im.height * k / 2, im.width * k, im.height * k);
        ctx.restore();
      } else {
        ctx.fillStyle = "#2a241d"; ctx.fill();
        ctx.rotate((-t.rot * Math.PI) / 180);
        ctx.fillStyle = "#f2e6c9"; ctx.font = `600 ${Math.max(8, rad * 0.8)}px Georgia, serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(initials(t.name), 0, rad * 0.04);
        ctx.rotate((t.rot * Math.PI) / 180);
      }
      const ring = typeof t.style?.ring === "string" ? (t.style.ring as string) : KIND_RING[t.kind];
      ctx.lineWidth = Math.max(2, cell * 0.08); ctx.strokeStyle = ring;
      if (t.hidden || t.layer === "gm") ctx.setLineDash([cell * 0.15, cell * 0.1]);
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      if (sel.has(t.id)) {
        ctx.save(); ctx.lineWidth = Math.max(2, 3 / cam.s); ctx.strokeStyle = SELECT; ctx.setLineDash([6 / cam.s, 4 / cam.s]);
        ctx.beginPath(); ctx.arc(cx, cy, rad + Math.max(4, cell * 0.12), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      if (sel.has(t.id) || hover.current === t.id) {
        const fs = Math.max(11, 13 / cam.s);
        ctx.save(); ctx.font = `600 ${fs}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "top";
        const label = t.hidden ? `${t.name} (hidden)` : t.name, w = ctx.measureText(label).width + fs;
        ctx.fillStyle = "rgba(20,16,12,0.85)"; ctx.fillRect(cx - w / 2, cy + rad + 4 / cam.s, w, fs * 1.5);
        ctx.fillStyle = "#f2e6c9"; ctx.fillText(label, cx, cy + rad + 4 / cam.s + fs * 0.25); ctx.restore();
      }
    }

    // rulers: mine, then everyone else's
    const drawRuler = (ru: Ruler) => {
      let alpha = 1;
      if (ru.done !== null) { alpha = 1 - (now - ru.done) / RULER_FADE_MS; if (alpha <= 0) return false; animating = true; }
      const pts = ru.points; if (pts.length < 2) return true;
      ctx.save(); ctx.globalAlpha = Math.max(0, alpha);
      ctx.strokeStyle = ru.color; ctx.lineWidth = Math.max(2, 3 / cam.s); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x * cell, p.y * cell) : ctx.moveTo(p.x * cell, p.y * cell))); ctx.stroke();
      ctx.fillStyle = ru.color; for (const p of pts) { ctx.beginPath(); ctx.arc(p.x * cell, p.y * cell, Math.max(3, 4 / cam.s), 0, Math.PI * 2); ctx.fill(); }
      const d = measure(pts, rule, fps), end = pts[pts.length - 1];
      const fs = Math.max(12, 15 / cam.s), text = `${d.feet} ft`;
      ctx.font = `700 ${fs}px system-ui, sans-serif`; const w = ctx.measureText(text).width + fs;
      ctx.fillStyle = "rgba(20,16,12,0.88)"; ctx.fillRect(end.x * cell + 10 / cam.s, end.y * cell - fs * 1.6, w, fs * 1.4);
      ctx.fillStyle = "#fff"; ctx.textBaseline = "top"; ctx.fillText(text, end.x * cell + 10 / cam.s + fs / 2, end.y * cell - fs * 1.45);
      ctx.restore();
      return true;
    };
    if (myRuler.current && !drawRuler(myRuler.current)) myRuler.current = null;
    for (const [k, ru] of rulers.current) if (!drawRuler(ru)) rulers.current.delete(k);

    // pings: three rings that grow and fade
    pings.current = pings.current.filter((p) => now - p.born < PING_MS);
    for (const p of pings.current) {
      animating = true;
      const age = (now - p.born) / PING_MS;
      for (let k = 0; k < 3; k++) {
        const a = (age * 3 + k * 0.33) % 1;
        ctx.save(); ctx.globalAlpha = (1 - age) * (1 - a); ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(2, 4 / cam.s);
        ctx.beginPath(); ctx.arc(p.x * cell, p.y * cell, cell * (0.3 + a * 1.6), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      ctx.save(); ctx.globalAlpha = 1 - age; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x * cell, p.y * cell, Math.max(4, cell * 0.12), 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (box.current) {
      const { a, b } = box.current;
      ctx.save(); ctx.strokeStyle = SELECT; ctx.lineWidth = 1.5 / cam.s; ctx.setLineDash([5 / cam.s, 4 / cam.s]);
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)); ctx.restore();
    }
    for (const [, rd] of remoteDrag.current) if (rd.until > now) animating = true;
    ctx.restore();
    if (animating) requestDraw();
  };

  // ---------------------------------------------------------------------------------------------------
  // loading and live updates
  const applyTokens = useCallback((list: Token[]) => {
    const map = new Map<string, Token>();
    for (const t of list) map.set(t.id, t);
    tokensRef.current = map;
    shown.current.clear();
    requestDraw();
  }, [requestDraw]);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("tabletop_state", { p_campaign: campaignId });
    if (e) { setError(/not at this table/.test(e.message) ? "You are not at this table. Ask your GM to add your character to the campaign." : /not signed in/.test(e.message) ? "Sign in to join the table." : `Could not load the table: ${e.message}`); return; }
    const st = data as State;
    const prevMap = stateRef.current?.map?.id, prevScene = stateRef.current?.scene?.id;
    stateRef.current = st; setState(st); setError(null);
    applyTokens(st.tokens);
    if (st.map?.id !== prevMap || st.scene?.id !== prevScene || !baseRef.current) { renderBase(); fitPending.current = true; }
  }, [supabase, campaignId, applyTokens, renderBase]);

  // The canvas only exists once a scene is loaded, so the first fit waits for it to mount.
  const fitPending = useRef(true);
  useEffect(() => {
    if (!state?.scene || !canvasRef.current) return;
    if (!baseRef.current) renderBase();
    if (fitPending.current) { fitPending.current = false; fit(); }
    requestDraw();
  }, [state, renderBase, fit, requestDraw]);

  const lastFeed = useRef<{ msg: string | null; ext: string | null }>({ msg: null, ext: null });
  const addFeed = useCallback((msgs: Message[], ext: OutsideRoll[]) => {
    setFeed((prev) => {
      const keys = new Set(prev.map((f) => f.key));
      const add: FeedItem[] = [];
      for (const m of msgs) if (!keys.has(`m${m.id}`)) add.push({ t: Date.parse(m.created_at), key: `m${m.id}`, msg: m });
      for (const r of ext) if (!keys.has(`e${r.id}`)) add.push({ t: Date.parse(r.at), key: `e${r.id}`, ext: r });
      if (!add.length) return prev;
      return [...prev, ...add].sort((a, b) => a.t - b.t).slice(-400);
    });
    for (const m of msgs) if (!lastFeed.current.msg || m.created_at > lastFeed.current.msg) lastFeed.current.msg = m.created_at;
    for (const r of ext) if (!lastFeed.current.ext || r.at > lastFeed.current.ext) lastFeed.current.ext = r.at;
  }, []);

  const pollFeed = useCallback(async (initial: boolean) => {
    const since = initial ? null : [lastFeed.current.msg, lastFeed.current.ext].filter(Boolean).sort()[0] ?? null;
    const { data } = await supabase.rpc("tabletop_feed", { p_campaign: campaignId, p_since: since, p_limit: 200 });
    const f = data as { messages?: Message[]; outside_rolls?: OutsideRoll[] } | null;
    if (f) addFeed(f.messages ?? [], f.outside_rolls ?? []);
  }, [supabase, campaignId, addFeed]);

  useEffect(() => { void load(); void pollFeed(true); }, [load, pollFeed]);
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) void pollFeed(false); }, 6000); return () => clearInterval(id); }, [pollFeed]);
  useEffect(() => { feedEnd.current?.scrollIntoView({ block: "end" }); }, [feed.length]);

  useEffect(() => {
    if (!state?.me) return;
    const ch = supabase.channel(`tabletop:${campaignId}`, { config: { broadcast: { self: false }, presence: { key: state.me } } });
    const upsert = (row: Token) => {
      const st = stateRef.current; if (!st?.scene || (row as unknown as { scene_id?: string }).scene_id !== st.scene.id) return;
      const prev = tokensRef.current.get(row.id);
      const owner = row.character_id ? st.party.find((p) => p.character_id === row.character_id)?.profile_id : null;
      const t: Token = { ...row, mine: st.role === "gm" || owner === st.me || (row.controlled_by ?? []).includes(st.me) };
      if (prev && (prev.x !== t.x || prev.y !== t.y) && !drag.current?.now.has(t.id)) {
        const from = remoteDrag.current.get(t.id) ?? shownPos(prev);
        shown.current.set(t.id, { x: t.x, y: t.y, fx: from.x, fy: from.y, t0: performance.now() });
      }
      remoteDrag.current.delete(t.id);
      tokensRef.current.set(t.id, t);
      if (st.role !== "gm" && (t.hidden || t.layer === "gm")) tokensRef.current.delete(t.id);
      requestDraw();
    };
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "vtt_tokens", filter: `campaign_id=eq.${campaignId}` }, (p) => upsert(p.new as Token))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "vtt_tokens", filter: `campaign_id=eq.${campaignId}` }, (p) => upsert(p.new as Token))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "vtt_tokens" }, (p) => {
        const id = (p.old as { id?: string }).id; if (id && tokensRef.current.delete(id)) requestDraw();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "vtt_scenes", filter: `campaign_id=eq.${campaignId}` }, () => { void load(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "vtt_messages", filter: `campaign_id=eq.${campaignId}` }, (p) => addFeed([p.new as Message], []))
      .on("broadcast", { event: "drag" }, ({ payload }) => {
        const d = payload as { id: string; x: number; y: number };
        if (tokensRef.current.has(d.id)) { remoteDrag.current.set(d.id, { x: d.x, y: d.y, until: performance.now() + 4000 }); requestDraw(); }
      })
      .on("broadcast", { event: "ruler" }, ({ payload }) => {
        const r = payload as { by: string; color: string; points: Pt[]; done: boolean };
        rulers.current.set(r.by, { points: r.points, color: r.color, by: r.by, done: r.done ? performance.now() : null });
        requestDraw();
      })
      .on("broadcast", { event: "ping" }, ({ payload }) => {
        const p = payload as { x: number; y: number; color: string; pull?: boolean };
        pings.current.push({ x: p.x, y: p.y, color: p.color, born: performance.now() });
        if (p.pull) { const cv = canvasRef.current; if (cv) { const r = cv.getBoundingClientRect(); camRef.current = centerOn(camRef.current, p.x * cellRef.current, p.y * cellRef.current, r.width, r.height); } }
        requestDraw();
      })
      .on("broadcast", { event: "refresh" }, () => { void load(); })
      .on("presence", { event: "sync" }, () => {
        const ps = ch.presenceState() as Record<string, { name?: string; color?: string }[]>;
        setPresent(Object.entries(ps).map(([key, arr]) => ({ key, name: arr[0]?.name ?? "Someone", color: arr[0]?.color ?? "#999" })));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          const mineName = state.role === "gm" ? "GM" : state.party.find((p) => p.profile_id === state.me)?.name ?? "Player";
          await ch.track({ name: mineName, color: hueOf(state.me) });
        }
      });
    channelRef.current = ch;
    return () => { void supabase.removeChannel(ch); channelRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, campaignId, state?.me, state?.role]);

  const send = (event: string, payload: Record<string, unknown>) => { void channelRef.current?.send({ type: "broadcast", event, payload }); };

  const loaded = !!state;
  useEffect(() => {
    if (!loaded || !wrapRef.current) return;
    const ro = new ResizeObserver(() => requestDraw());
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [requestDraw, loaded]);
  useEffect(() => { requestDraw(); }, [selected, tick, requestDraw]);

  // ---------------------------------------------------------------------------------------------------
  // pointer
  const screenPt = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toSquares = (sp: Pt): Pt => { const w = toWorld(camRef.current, sp.x, sp.y); return { x: w.x / cellRef.current, y: w.y / cellRef.current }; };

  // Drop a waypoint in the ruler being drawn. A second button pressed while the first is held does not
  // fire a new pointerdown (only a pointermove), so the right-click waypoint comes through onMouseDown.
  const addWaypoint = () => {
    const ru = myRuler.current; if (!ru || ru.done !== null) return false;
    ru.points.push({ ...ru.points[ru.points.length - 1] });
    requestDraw(); return true;
  };

  const onDown = (e: React.PointerEvent) => {
    const st = stateRef.current; if (!st) return;
    const sp = screenPt(e), sq = toSquares(sp);
    canvasRef.current?.setPointerCapture(e.pointerId);
    // right button inside the ruler: a waypoint
    if (e.button === 2 && addWaypoint()) return;
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (tool === "hand" || space.current))) {
      pan.current = { sx: sp.x, sy: sp.y, ox: camRef.current.ox, oy: camRef.current.oy, moved: false, button: e.button, shift: e.shiftKey };
      return;
    }
    if (e.button !== 0) return;
    if (tool === "ruler") {
      const p = e.altKey ? sq : snapCenter(sq);
      myRuler.current = { points: [p, { ...p }], color: myColor, done: null, by: st.me };
      keepRuler.current = false;
      requestDraw(); return;
    }
    const hit = tokenAt({ x: sq.x * cellRef.current, y: sq.y * cellRef.current });
    if (hit) {
      let next = selRef.current;
      if (e.shiftKey) next = next.includes(hit.id) ? next.filter((i) => i !== hit.id) : [...next, hit.id];
      else if (!next.includes(hit.id)) next = [hit.id];
      setSelected(next); selRef.current = next;
      const movable = next.map((i) => tokensRef.current.get(i)).filter((t): t is Token => !!t && !!t.mine);
      if (movable.length) {
        const orig = new Map(movable.map((t) => [t.id, { x: t.x, y: t.y }]));
        drag.current = { ids: movable.map((t) => t.id), start: sq, orig, now: new Map(orig), free: e.altKey, lastSend: 0, moved: false };
      }
    } else {
      if (!e.shiftKey) { setSelected([]); selRef.current = []; }
      box.current = { a: { x: sq.x * cellRef.current, y: sq.y * cellRef.current }, b: { x: sq.x * cellRef.current, y: sq.y * cellRef.current } };
    }
    requestDraw();
  };

  const onMove = (e: React.PointerEvent) => {
    const sp = screenPt(e), sq = toSquares(sp);
    if (pan.current) {
      const dx = sp.x - pan.current.sx, dy = sp.y - pan.current.sy;
      if (Math.hypot(dx, dy) > 4) pan.current.moved = true;
      if (pan.current.moved) { camRef.current = { ...camRef.current, ox: pan.current.ox + dx, oy: pan.current.oy + dy }; requestDraw(); }
      return;
    }
    if (myRuler.current && myRuler.current.done === null) {
      const pts = myRuler.current.points;
      pts[pts.length - 1] = e.altKey ? sq : snapCenter(sq);
      const t = performance.now();
      if (t - rulerSent.current > DRAG_SEND_MS) { rulerSent.current = t; send("ruler", { by: me, color: myColor, points: pts, done: false }); }
      requestDraw(); return;
    }
    const d = drag.current;
    if (d) {
      const dx = sq.x - d.start.x, dy = sq.y - d.start.y;
      if (Math.hypot(dx, dy) > 0.05) d.moved = true;
      for (const id of d.ids) {
        const o = d.orig.get(id)!, t = tokensRef.current.get(id)!;
        d.now.set(id, d.free || e.altKey ? { x: o.x + dx, y: o.y + dy } : snapToken(o.x + dx, o.y + dy, t.size));
      }
      const now = performance.now();
      if (now - d.lastSend > DRAG_SEND_MS) {
        d.lastSend = now;
        for (const id of d.ids) { const t = tokensRef.current.get(id)!; if (!t.hidden && t.layer !== "gm") { const p = d.now.get(id)!; send("drag", { id, x: p.x, y: p.y }); } }
      }
      requestDraw(); return;
    }
    if (box.current) { box.current.b = { x: sq.x * cellRef.current, y: sq.y * cellRef.current }; requestDraw(); return; }
    const h = tokenAt({ x: sq.x * cellRef.current, y: sq.y * cellRef.current })?.id ?? null;
    if (h !== hover.current) { hover.current = h; requestDraw(); }
  };

  const onUp = (e: React.PointerEvent) => {
    const st = stateRef.current; if (!st) return;
    const sp = screenPt(e), sq = toSquares(sp);
    if (pan.current) {
      const p = pan.current; pan.current = null;
      if (!p.moved && p.button === 2) {
        // a right-click that did not move: ping. Shift + right-click from the GM pulls every view there.
        const pull = st.role === "gm" && p.shift;
        pings.current.push({ x: sq.x, y: sq.y, color: myColor, born: performance.now() });
        send("ping", { x: sq.x, y: sq.y, color: myColor, pull });
        requestDraw();
      }
      return;
    }
    if (myRuler.current && myRuler.current.done === null && e.button === 0) {
      keepRuler.current = e.shiftKey;
      if (!keepRuler.current) myRuler.current.done = performance.now();
      send("ruler", { by: me, color: myColor, points: myRuler.current.points, done: !keepRuler.current });
      requestDraw(); return;
    }
    const d = drag.current;
    if (d) {
      drag.current = null;
      if (d.moved) {
        for (const id of d.ids) {
          const p = d.now.get(id)!, t = tokensRef.current.get(id);
          if (!t) continue;
          tokensRef.current.set(id, { ...t, x: p.x, y: p.y });
          void supabase.rpc("tabletop_move_token", { p_token: id, p_x: p.x, p_y: p.y, p_rot: null }).then(({ error: er }) => {
            if (er) { setChatErr(`Could not move ${t.name}: ${er.message}`); tokensRef.current.set(id, t); requestDraw(); }
          });
        }
      }
      requestDraw(); return;
    }
    if (box.current) {
      const { a, b } = box.current; box.current = null;
      const cell = cellRef.current, x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      if (x1 - x0 > 4 || y1 - y0 > 4) {
        const inside = [...tokensRef.current.values()].filter((t) => t.mine && t.x * cell >= x0 && t.x * cell <= x1 && t.y * cell >= y0 && t.y * cell <= y1).map((t) => t.id);
        const next = e.shiftKey ? [...new Set([...selRef.current, ...inside])] : inside;
        setSelected(next); selRef.current = next;
      }
      requestDraw();
    }
  };

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const r = canvasRef.current!.getBoundingClientRect();
    const factor = Math.pow(1.0015, -e.deltaY * (e.shiftKey ? 0.25 : 1));
    camRef.current = zoomAt(camRef.current, factor, e.clientX - r.left, e.clientY - r.top);
    requestDraw();
  }, [requestDraw]);
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [onWheel, state?.scene?.id]);

  // ---------------------------------------------------------------------------------------------------
  // token actions
  const selectedTokens = useMemo(() => selected.map((i) => tokensRef.current.get(i)).filter((t): t is Token => !!t),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, tick, state]);

  const updateTokens = useCallback(async (ids: string[], patch: Partial<Token>, notify = false) => {
    const { error: er } = await supabase.from("vtt_tokens").update({ ...patch, updated_at: new Date().toISOString() }).in("id", ids);
    if (er) { setChatErr(`Could not change the token: ${er.message}`); return; }
    for (const id of ids) { const t = tokensRef.current.get(id); if (t) tokensRef.current.set(id, { ...t, ...patch }); }
    setTick((v) => v + 1); requestDraw();
    if (notify) send("refresh", {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, requestDraw]);

  const deleteTokens = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const { error: er } = await supabase.from("vtt_tokens").delete().in("id", ids);
    if (er) { setChatErr(`Could not remove: ${er.message}`); return; }
    for (const id of ids) tokensRef.current.delete(id);
    setSelected([]); requestDraw();
  }, [supabase, requestDraw]);

  const turn = useCallback((ids: string[], by: number) => {
    for (const id of ids) {
      const t = tokensRef.current.get(id); if (!t || !t.mine) continue;
      const rot = (((t.rot + by) % 360) + 360) % 360;
      tokensRef.current.set(id, { ...t, rot });
      void supabase.rpc("tabletop_move_token", { p_token: id, p_x: t.x, p_y: t.y, p_rot: rot });
    }
    requestDraw();
  }, [supabase, requestDraw]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === " ") { space.current = true; e.preventDefault(); return; }
      const k = e.key.toLowerCase();
      if (k === "escape") { setSelected([]); if (myRuler.current) { myRuler.current.done = performance.now(); send("ruler", { by: me, color: myColor, points: myRuler.current.points, done: true }); } requestDraw(); return; }
      if (k === "v") { setTool("select"); return; }
      if (k === "m") { setTool("ruler"); return; }
      if (k === "q") { addWaypoint(); return; }
      if (k === "c") { fit(); return; }
      if (k === "r") { turn(selRef.current, e.shiftKey ? -45 : 45); return; }
      if (!isGm) return;
      if (k === "delete" || k === "backspace") { e.preventDefault(); void deleteTokens(selRef.current); return; }
      if (k === "h") {
        const ts = selRef.current.map((i) => tokensRef.current.get(i)).filter((t): t is Token => !!t);
        if (ts.length) void updateTokens(ts.map((t) => t.id), { hidden: !ts.every((t) => t.hidden) }, true);
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === " ") space.current = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGm, me, myColor, fit, turn, deleteTokens, updateTokens, requestDraw]);

  // place new tokens in the middle of what the GM is looking at
  const viewCentre = (): Pt => {
    const cv = canvasRef.current; if (!cv) return { x: 1.5, y: 1.5 };
    const r = cv.getBoundingClientRect();
    return toSquares({ x: r.width / 2, y: r.height / 2 });
  };
  const addToken = useCallback(async (t: Partial<Token> & { name: string; size: number; kind: Token["kind"] }, count = 1) => {
    const st = stateRef.current; if (!st?.scene) return;
    const c = viewCentre(), taken = [...tokensRef.current.values()].map((x) => x.name);
    const rows: (Record<string, unknown> & { name: string })[] = [];
    for (let i = 0; i < count; i++) {
      const name = count > 1 || taken.includes(t.name) ? enumerated(t.name, [...taken, ...rows.map((r) => r.name)]) : t.name;
      const p = snapToken(c.x + (i % 4) * Math.max(1, t.size), c.y + Math.floor(i / 4) * Math.max(1, t.size), t.size);
      rows.push({ campaign_id: campaignId, scene_id: st.scene.id, kind: t.kind, character_id: t.character_id ?? null, stat_block_id: t.stat_block_id ?? null,
        name, image_url: t.image_url ?? null, x: p.x, y: p.y, size: t.size, rot: 0, layer: "token", hidden: !!t.hidden, controlled_by: [], style: {} });
    }
    const { data, error: er } = await supabase.from("vtt_tokens").insert(rows).select("*");
    if (er) { setChatErr(`Could not add the token: ${er.message}`); return; }
    for (const row of (data ?? []) as Token[]) tokensRef.current.set(row.id, { ...row, mine: true });
    setSelected(((data ?? []) as Token[]).map((r) => r.id)); requestDraw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, campaignId, requestDraw]);

  // ---------------------------------------------------------------------------------------------------
  // chat
  const [sending, setSending] = useState(false);
  const rollDice = useCallback(async (notation: string, label: string, gmOnly: boolean) => {
    const charId = asWho || null;
    const res = await fetch("/api/tabletop/roll", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, notation, label, gmOnly, characterId: charId, asName: !charId && isGm ? gmName : undefined }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: Message };
    if (!res.ok || !j.message) { setChatErr(j.error || `Roll failed (${res.status}).`); return; }
    addFeed([j.message], []);
  }, [campaignId, asWho, isGm, gmName, addFeed]);

  const submit = async () => {
    const st = stateRef.current; if (!st || !draft.trim() || sending) return;
    setChatErr(null);
    const names = st.party.map((p) => p.name);
    const parsed = parseChat(draft, names);
    if (parsed.kind === "error") { setChatErr(parsed.message); return; }
    setSending(true);
    try {
      if (parsed.kind === "roll") { await rollDice(parsed.notation, parsed.label, parsed.gmOnly); setDraft(""); return; }
      const asName = !asWho && isGm ? gmName : null;
      const to = parsed.kind === "whisper" ? st.party.filter((p) => p.name.toLowerCase() === parsed.to[0].toLowerCase()).map((p) => p.profile_id) : null;
      const { error: er } = await supabase.rpc("tabletop_say", {
        p_campaign: campaignId, p_body: parsed.body, p_kind: parsed.kind, p_as_name: asName, p_character: asWho || null, p_whisper_to: to,
      });
      if (er) { setChatErr(er.message); return; }
      setDraft("");
      void pollFeed(false);
    } finally { setSending(false); }
  };

  const quickRoll = (sides: number) => {
    const notation = sides === 20 && adv !== "flat" ? `2d20${adv === "adv" ? "kh1" : "kl1"}` : `1d${sides}`;
    void rollDice(notation, sides === 20 && adv !== "flat" ? (adv === "adv" ? "with advantage" : "with disadvantage") : "", false);
  };

  // ---------------------------------------------------------------------------------------------------
  // GM: scenes
  const [newMap, setNewMap] = useState("");
  const [newLevel, setNewLevel] = useState(0);
  const [newSceneName, setNewSceneName] = useState("");
  const makeScene = async () => {
    const st = stateRef.current; if (!st || !newMap) return;
    const bm = st.battle_maps.find((b) => b.id === newMap);
    const name = newSceneName.trim() || `${bm?.name ?? "Map"}${bm?.levelNames?.[newLevel] ? `: ${bm.levelNames[newLevel]}` : ""}`;
    const { data, error: er } = await supabase.from("vtt_scenes").insert({ campaign_id: campaignId, battle_map_id: newMap, level: newLevel, name, settings: {} }).select("id").single();
    if (er || !data) { setChatErr(`Could not make the scene: ${er?.message ?? "no row"}`); return; }
    const { error: e2 } = await supabase.rpc("tabletop_activate_scene", { p_scene: (data as { id: string }).id });
    if (e2) { setChatErr(e2.message); return; }
    setNewSceneName(""); await load();
  };
  const activate = async (id: string) => {
    const { error: er } = await supabase.rpc("tabletop_activate_scene", { p_scene: id });
    if (er) setChatErr(er.message); else await load();
  };
  const sceneSetting = async (patch: Scene["settings"]) => {
    const st = stateRef.current; if (!st?.scene) return;
    const settings = { ...st.scene.settings, ...patch };
    const { error: er } = await supabase.from("vtt_scenes").update({ settings, updated_at: new Date().toISOString() }).eq("id", st.scene.id);
    if (er) setChatErr(er.message); else await load();
  };

  // GM: the add-token form
  const [tName, setTName] = useState("Goblin");
  const [tSize, setTSize] = useState(1);
  const [tKind, setTKind] = useState<Token["kind"]>("monster");
  const [tCount, setTCount] = useState(1);
  const [tImage, setTImage] = useState("");
  const [tHidden, setTHidden] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [blocks, setBlocks] = useState<{ id: string; name: string; size: string | null }[]>([]);
  useEffect(() => {
    if (!isGm || panel !== "tokens") return;
    void (async () => {
      const { data } = await supabase.from("stat_blocks").select("id, name, size").or(`campaign_id.eq.${campaignId},gm_id.eq.${me}`).order("name").limit(500);
      setBlocks((data ?? []) as { id: string; name: string; size: string | null }[]);
    })();
  }, [isGm, panel, supabase, campaignId, me]);
  const sizeFromText = (s: string | null) => {
    const l = (s ?? "").toLowerCase();
    return l.startsWith("tiny") ? 0.5 : l.startsWith("large") ? 2 : l.startsWith("huge") ? 3 : l.startsWith("garg") ? 4 : 1;
  };
  const uploadImage = async (file: File, then: (url: string) => void) => {
    setUploading(true); setChatErr(null);
    try {
      const fd = new FormData(); fd.append("campaignId", campaignId); fd.append("file", file);
      const res = await fetch("/api/tabletop/token-image", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !j.url) { setChatErr(j.error || `Upload failed (${res.status}).`); return; }
      then(j.url);
    } finally { setUploading(false); }
  };

  // ---------------------------------------------------------------------------------------------------
  // render
  const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "7px 9px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 13 };
  const small: React.CSSProperties = { padding: "6px 10px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" };
  const seg = (on: boolean): React.CSSProperties => ({ flex: 1, padding: "7px 0", background: on ? C.surface2 : "transparent", color: on ? C.sun : C.muted, border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 7, fontWeight: 600, fontSize: 12.5, cursor: "pointer" });
  const label: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, margin: "14px 0 6px" };
  const railBtn = (on: boolean): React.CSSProperties => ({ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 1, background: on ? C.surface2 : "transparent", color: on ? C.sun : C.text, border: `1px solid ${on ? C.sun : "transparent"}`, borderRadius: 8, cursor: "pointer", fontSize: 10.5 });

  if (error) return (
    <div style={{ minHeight: "100vh", background: "#15120f", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 20, maxWidth: 460, color: C.text }}>
        <p role="alert" style={{ margin: 0 }}>{error}</p>
      </div>
    </div>
  );
  if (!state) return <div style={{ minHeight: "100vh", background: "#15120f", color: C.muted, padding: 24 }}>Setting up the table…</div>;

  const renderRoll = (who: string, title: string, total: number | undefined, dice: { v: number; sides: number; kept: boolean }[], nat: number | null, badge: string | null) => (
    <div style={{ background: "#1c1814", border: `1px solid ${nat === 20 ? "#5f9c5a" : nat === 1 ? "#a8483f" : C.line}`, borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: C.muted, fontSize: 12 }}>
        <span><b style={{ color: C.text }}>{who}</b>{title ? ` · ${title}` : ""}</span>
        {badge && <span style={{ fontSize: 11, color: C.sun }}>{badge}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: nat === 20 ? "#8fd18a" : nat === 1 ? "#e07a70" : C.text }}>{total ?? "?"}</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {dice.map((d, i) => (
            <span key={i} title={`d${d.sides}`} style={{ fontSize: 11.5, padding: "1px 6px", borderRadius: 5, border: `1px solid ${C.line}`, color: d.kept ? C.text : C.muted, textDecoration: d.kept ? "none" : "line-through" }}>
              {d.v}<span style={{ color: C.muted }}>/d{d.sides}</span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );

  const scene = state.scene;
  const onSceneTokens = new Set([...tokensRef.current.values()].map((t) => t.character_id).filter(Boolean));
  const sel = selectedTokens;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#15120f", display: "flex", flexDirection: "column", color: C.text }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${C.line}`, background: C.surface }}>
        <div style={{ fontWeight: 700 }}>{state.campaign.name}</div>
        <div style={{ color: C.muted, fontSize: 13 }}>{scene ? scene.name : "No map on the table"}</div>
        {!state.session_id && <div style={{ color: "#d9a43a", fontSize: 12 }}>No open session: rolls show here but are not logged for Mechanics.</div>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {present.map((p) => (
            <span key={p.key} title={p.name} style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, border: `1px solid ${p.color}`, color: p.color }}>{p.name}</span>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* tool rail */}
        <div style={{ width: 56, padding: 6, display: "flex", flexDirection: "column", gap: 6, alignItems: "center", borderRight: `1px solid ${C.line}`, background: C.surface }}>
          <button type="button" title="Select and move (V)" onClick={() => setTool("select")} style={railBtn(tool === "select")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3l14 8-6 2-2 6z"/></svg>Select
          </button>
          <button type="button" title="Measure (M). Right-click or Q adds a waypoint, Shift on release keeps it, Alt measures freely." onClick={() => setTool("ruler")} style={railBtn(tool === "ruler")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2"/></svg>Ruler
          </button>
          <button type="button" title="Pan (or hold Space, or drag with the right mouse button)" onClick={() => setTool("hand")} style={railBtn(tool === "hand")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20 M2 12h20 M12 2l-3 3 M12 2l3 3 M12 22l-3-3 M12 22l3-3 M2 12l3-3 M2 12l3 3 M22 12l-3-3 M22 12l-3 3"/></svg>Pan
          </button>
          <div style={{ height: 1, width: 36, background: C.line, margin: "4px 0" }} />
          <button type="button" title="Zoom in" onClick={() => { const r = canvasRef.current!.getBoundingClientRect(); camRef.current = zoomAt(camRef.current, 1.25, r.width / 2, r.height / 2); requestDraw(); }} style={railBtn(false)}>+<span>Zoom</span></button>
          <button type="button" title="Zoom out" onClick={() => { const r = canvasRef.current!.getBoundingClientRect(); camRef.current = zoomAt(camRef.current, 0.8, r.width / 2, r.height / 2); requestDraw(); }} style={railBtn(false)}>&minus;<span>Zoom</span></button>
          <button type="button" title="Show the whole map (C)" onClick={fit} style={railBtn(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5"/></svg>Fit
          </button>
        </div>

        {/* the table */}
        <div ref={wrapRef} style={{ flex: 1, position: "relative", minWidth: 0 }}>
          {scene ? (
            <canvas ref={canvasRef} onMouseDown={(e) => { if (e.button === 2 && myRuler.current && myRuler.current.done === null && (e.buttons & 1)) addWaypoint(); }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              onPointerLeave={() => { hover.current = null; requestDraw(); }} onContextMenu={(e) => e.preventDefault()}
              aria-label={`Table: ${scene.name}`}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: tool === "ruler" ? "crosshair" : tool === "hand" ? "grab" : "default" }} />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, padding: 24, textAlign: "center" }}>
              {isGm ? "Put a battle map on the table from the Scenes tab on the right." : "The GM has not put a map on the table yet. Chat and dice work in the meantime."}
            </div>
          )}
          {scene && (
            <div style={{ position: "absolute", left: 10, bottom: 10, fontSize: 11.5, color: C.muted, background: "rgba(20,16,12,0.75)", padding: "4px 8px", borderRadius: 6, pointerEvents: "none" }}>
              Wheel zooms · right-drag pans · right-click pings{isGm ? " (Shift: bring everyone)" : ""} · R turns · M ruler
            </div>
          )}
        </div>

        {/* side panel */}
        <div style={{ width: 360, display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.line}`, background: C.surface, minHeight: 0 }}>
          <div style={{ display: "flex", gap: 6, padding: 8, borderBottom: `1px solid ${C.line}` }}>
            <button type="button" onClick={() => setPanel("chat")} style={seg(panel === "chat")}>Chat</button>
            {isGm && <button type="button" onClick={() => setPanel("tokens")} style={seg(panel === "tokens")}>Tokens</button>}
            {isGm && <button type="button" onClick={() => setPanel("scenes")} style={seg(panel === "scenes")}>Scenes</button>}
          </div>

          {panel === "chat" && (
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {feed.length === 0 && <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Nothing said yet. Type below, or roll with the dice buttons. /r 1d20+5 Attack rolls, /w name whispers.</p>}
                {feed.map((f) => {
                  if (f.ext) {
                    const r = f.ext.rolls, dice = (r?.dice ?? []).flatMap((g) => g.results.map((v) => ({ v, sides: g.faces, kept: true })));
                    const nat = r?.critical_success ? 20 : r?.critical_failure ? 1 : null;
                    return <div key={f.key}>{renderRoll(f.ext.actor_name ?? "Someone", f.ext.name ?? "", r?.total, dice, nat, f.ext.source === "beyond20" ? "D&D Beyond" : f.ext.source === "foundry" ? "Foundry" : f.ext.source)}</div>;
                  }
                  const m = f.msg!;
                  const who = nameOf(m);
                  if (m.kind === "roll" && m.roll) {
                    const dice = (m.roll.dice ?? []).map((d) => ({ v: d.value, sides: d.sides, kept: d.kept }));
                    return <div key={f.key}>{renderRoll(who, m.roll.label ?? "", m.roll.total, dice, m.roll.natural ?? null, m.gm_only ? "GM only" : m.roll.logged === false ? "not logged" : null)}</div>;
                  }
                  if (m.kind === "emote") return <div key={f.key} style={{ fontStyle: "italic", color: C.muted, fontSize: 13.5 }}>{who} {m.body}</div>;
                  if (m.kind === "whisper") {
                    const to = (m.whisper_to ?? []).map((id) => party.find((p) => p.profile_id === id)?.name ?? "someone").join(", ");
                    return <div key={f.key} style={{ fontSize: 13.5, background: "rgba(140,110,200,0.12)", border: "1px solid rgba(140,110,200,0.35)", borderRadius: 8, padding: "6px 8px" }}>
                      <span style={{ color: "#c2a8f0", fontSize: 12 }}>{m.author_profile === me ? `You whisper to ${to}` : `${who} whispers to you`}</span><div>{m.body}</div></div>;
                  }
                  return <div key={f.key} style={{ fontSize: 13.5 }}><b style={{ color: m.author_profile === state.campaign.gm_id ? C.sun : C.text }}>{who}:</b> {m.body}</div>;
                })}
                <div ref={feedEnd} />
              </div>
              <div style={{ padding: 10, borderTop: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                  {[4, 6, 8, 10, 12, 20, 100].map((s) => (
                    <button key={s} type="button" title={`Roll 1d${s}`} onClick={() => quickRoll(s)} style={{ ...small, padding: "5px 7px", fontWeight: 600 }}>d{s}</button>
                  ))}
                  <select aria-label="Advantage for d20" value={adv} onChange={(e) => setAdv(e.target.value as typeof adv)} style={{ ...field, width: 92, padding: "5px 6px" }}>
                    <option value="flat">Normal</option><option value="adv">Advantage</option><option value="dis">Disadvantage</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                  <span style={{ color: C.muted, fontSize: 12 }}>As</span>
                  <select aria-label="Speak and roll as" value={asWho} onChange={(e) => setAsWho(e.target.value)} style={{ ...field, flex: 1 }}>
                    <option value="">{isGm ? "GM or a named NPC" : "Yourself"}</option>
                    {(isGm ? party.filter((p) => p.character_id) : myChars).map((p) => <option key={p.character_id!} value={p.character_id!}>{p.name}</option>)}
                  </select>
                  {isGm && !asWho && <input aria-label="Name to speak as" value={gmName} onChange={(e) => setGmName(e.target.value.slice(0, 60))} style={{ ...field, width: 110 }} />}
                </div>
                <textarea aria-label="Message" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
                  placeholder="Say something, /r 1d20+5 Attack, /w GM psst, /em draws a blade" style={{ ...field, resize: "none" }} />
                {chatErr && <p role="status" style={{ color: "#e07a70", fontSize: 12, margin: "6px 0 0" }}>{chatErr}</p>}
              </div>
            </>
          )}

          {panel === "tokens" && isGm && (
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {!scene && <p style={{ color: C.muted, fontSize: 13 }}>Put a map on the table first (Scenes tab).</p>}
              {scene && sel.length > 0 && (
                <div style={{ padding: 10, border: `1px solid ${C.sun}`, borderRadius: 8, marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{sel.length === 1 ? sel[0].name : `${sel.length} tokens`}</div>
                  {sel.length === 1 && (
                    <>
                      <label style={label} htmlFor="tt-name">Name</label>
                      <input id="tt-name" defaultValue={sel[0].name} key={sel[0].id} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== sel[0].name) void updateTokens([sel[0].id], { name: v.slice(0, 80) }); }} style={field} />
                      <label style={label} htmlFor="tt-size">Size</label>
                      <select id="tt-size" value={sel[0].size} onChange={(e) => void updateTokens([sel[0].id], { size: Number(e.target.value) })} style={field}>
                        {SIZES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                      </select>
                      <label style={label} htmlFor="tt-ring">Ring colour</label>
                      <input id="tt-ring" type="color" value={typeof sel[0].style?.ring === "string" ? (sel[0].style.ring as string) : KIND_RING[sel[0].kind]}
                        onChange={(e) => void updateTokens([sel[0].id], { style: { ...sel[0].style, ring: e.target.value } })} style={{ ...field, height: 34, padding: 2 }} />
                      <label style={label}>Image</label>
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f, (url) => void updateTokens([sel[0].id], { image_url: url })); }} style={{ fontSize: 12, color: C.muted }} />
                      <label style={label} htmlFor="tt-ctrl">Also controlled by</label>
                      <select id="tt-ctrl" multiple value={sel[0].controlled_by ?? []} onChange={(e) => void updateTokens([sel[0].id], { controlled_by: [...e.target.selectedOptions].map((o) => o.value) })} style={{ ...field, height: 72 }}>
                        {party.filter((p) => p.character_id).map((p) => <option key={p.character_id!} value={p.profile_id}>{p.name}</option>)}
                      </select>
                    </>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
                    <button type="button" onClick={() => void updateTokens(sel.map((t) => t.id), { hidden: !sel.every((t) => t.hidden) }, true)} style={small}>{sel.every((t) => t.hidden) ? "Show to players" : "Hide from players"} (H)</button>
                    <button type="button" onClick={() => void updateTokens(sel.map((t) => t.id), { layer: sel.every((t) => t.layer === "gm") ? "token" : "gm" }, true)} style={small}>{sel.every((t) => t.layer === "gm") ? "Back to the table" : "To the GM layer"}</button>
                    <button type="button" onClick={() => turn(sel.map((t) => t.id), 45)} style={small}>Turn 45 (R)</button>
                    <button type="button" onClick={() => void deleteTokens(sel.map((t) => t.id))} style={{ ...small, color: "#e07a70" }}>Remove (Delete)</button>
                  </div>
                </div>
              )}
              {scene && (
                <>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>The party</div>
                  <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    {party.filter((p) => p.character_id).map((p) => (
                      <button key={p.character_id!} type="button" disabled={onSceneTokens.has(p.character_id)}
                        onClick={() => void addToken({ name: p.name, size: 1, kind: "pc", character_id: p.character_id, image_url: p.portrait_url })}
                        style={{ ...small, textAlign: "left", opacity: onSceneTokens.has(p.character_id) ? 0.45 : 1 }}>
                        {onSceneTokens.has(p.character_id) ? `${p.name} is on the table` : `Add ${p.name}`}
                      </button>
                    ))}
                    {party.filter((p) => p.character_id).length === 0 && <p style={{ color: C.muted, fontSize: 12.5, margin: 0 }}>No claimed player characters yet.</p>}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginTop: 18 }}>Monster, NPC or object</div>
                  {blocks.length > 0 && (
                    <>
                      <label style={label} htmlFor="tt-block">From your stat blocks</label>
                      <select id="tt-block" value="" onChange={(e) => { const b = blocks.find((x) => x.id === e.target.value); if (b) { setTName(b.name); setTSize(sizeFromText(b.size)); setTKind("monster"); } }} style={field}>
                        <option value="">Pick one to fill the form…</option>
                        {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </>
                  )}
                  <label style={label} htmlFor="tt-new-name">Name</label>
                  <input id="tt-new-name" value={tName} onChange={(e) => setTName(e.target.value.slice(0, 80))} style={field} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div><label style={label} htmlFor="tt-new-size">Size</label>
                      <select id="tt-new-size" value={tSize} onChange={(e) => setTSize(Number(e.target.value))} style={field}>{SIZES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</select></div>
                    <div><label style={label} htmlFor="tt-new-kind">Kind</label>
                      <select id="tt-new-kind" value={tKind} onChange={(e) => setTKind(e.target.value as Token["kind"])} style={field}>
                        <option value="monster">Monster</option><option value="npc">NPC</option><option value="object">Object</option></select></div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div><label style={label} htmlFor="tt-new-count">How many</label>
                      <input id="tt-new-count" type="number" min={1} max={12} value={tCount} onChange={(e) => setTCount(Math.max(1, Math.min(12, Math.round(Number(e.target.value) || 1))))} style={field} /></div>
                    <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
                      <label style={{ display: "flex", gap: 6, fontSize: 12.5, alignItems: "center" }}><input type="checkbox" checked={tHidden} onChange={(e) => setTHidden(e.target.checked)} style={{ accentColor: C.sun }} />Start hidden</label></div>
                  </div>
                  <label style={label}>Image (optional)</label>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f, setTImage); }} style={{ fontSize: 12, color: C.muted }} />
                  <input aria-label="Or paste an image link" value={tImage} onChange={(e) => setTImage(e.target.value.trim())} placeholder="or paste an image link" style={{ ...field, marginTop: 6 }} />
                  <p style={{ color: C.muted, fontSize: 11.5, margin: "6px 0 0" }}>No image: a disc with initials. Copies are numbered (Goblin 2, Goblin 3).</p>
                  <button type="button" disabled={!tName.trim() || uploading} onClick={() => void addToken({ name: tName.trim(), size: tSize, kind: tKind, image_url: tImage || null, hidden: tHidden }, tCount)}
                    style={{ ...small, marginTop: 10, width: "100%", background: C.sun, color: "#1b1712", border: "none", fontWeight: 600, padding: "9px 0" }}>
                    {uploading ? "Uploading…" : `Add ${tCount > 1 ? `${tCount} ` : ""}to the table`}
                  </button>
                </>
              )}
              {chatErr && <p role="status" style={{ color: "#e07a70", fontSize: 12, marginTop: 10 }}>{chatErr}</p>}
            </div>
          )}

          {panel === "scenes" && isGm && (
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Scenes</div>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {state.scenes.map((s) => (
                  <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ flex: 1, fontSize: 13, color: s.is_active ? C.sun : C.text }}>{s.name}{s.is_active ? " (on the table)" : ""}</span>
                    {!s.is_active && <button type="button" onClick={() => void activate(s.id)} style={small}>Put on table</button>}
                  </div>
                ))}
                {state.scenes.length === 0 && <p style={{ color: C.muted, fontSize: 12.5, margin: 0 }}>No scenes yet.</p>}
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, marginTop: 18 }}>New scene from a battle map</div>
              {state.battle_maps.length === 0 ? <p style={{ color: C.muted, fontSize: 12.5 }}>Make a map on the World page, Battle maps tab, first.</p> : (
                <>
                  <label style={label} htmlFor="tt-map">Battle map</label>
                  <select id="tt-map" value={newMap} onChange={(e) => { setNewMap(e.target.value); setNewLevel(0); }} style={field}>
                    <option value="">Choose…</option>
                    {state.battle_maps.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.kind})</option>)}
                  </select>
                  {newMap && (
                    <>
                      <label style={label} htmlFor="tt-level">Level</label>
                      <select id="tt-level" value={newLevel} onChange={(e) => setNewLevel(Number(e.target.value))} style={field}>
                        {[0, 1, 2].map((l) => <option key={l} value={l}>{state.battle_maps.find((b) => b.id === newMap)?.levelNames?.[l] || `Level ${l + 1}`}</option>)}
                      </select>
                    </>
                  )}
                  <label style={label} htmlFor="tt-scene-name">Scene name (optional)</label>
                  <input id="tt-scene-name" value={newSceneName} onChange={(e) => setNewSceneName(e.target.value.slice(0, 80))} style={field} />
                  <button type="button" disabled={!newMap} onClick={() => void makeScene()} style={{ ...small, marginTop: 10, width: "100%", background: newMap ? C.sun : "transparent", color: newMap ? "#1b1712" : C.muted, border: newMap ? "none" : `1px solid ${C.line}`, fontWeight: 600, padding: "9px 0" }}>Put it on the table</button>
                </>
              )}
              {scene && (
                <>
                  <div style={{ fontWeight: 600, fontSize: 13, marginTop: 18 }}>This scene</div>
                  <label style={label} htmlFor="tt-diag">Ruler diagonals</label>
                  <select id="tt-diag" value={rule} onChange={(e) => void sceneSetting({ diagonal: e.target.value as DiagonalRule })} style={field}>
                    {DIAGONAL_RULES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                  <label style={{ display: "flex", gap: 8, marginTop: 10, fontSize: 12.5, alignItems: "center" }}>
                    <input type="checkbox" checked={!!scene.settings?.show_labels} onChange={(e) => void sceneSetting({ show_labels: e.target.checked })} style={{ accentColor: C.sun }} />
                    Show the map&apos;s text labels to players
                  </label>
                  <p style={{ color: C.muted, fontSize: 11.5, margin: "6px 0 0" }}>Secret doors always show to players as plain wall.</p>
                </>
              )}
              <div style={{ fontWeight: 600, fontSize: 13, marginTop: 18 }}>Invite the players</div>
              <p style={{ color: C.muted, fontSize: 12, margin: "6px 0" }}>Players sign in the way they do for their character page; anyone with a claimed character in this campaign gets in.</p>
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/tabletop/${campaignId}`); setChatErr("Table link copied."); }} style={{ ...small, width: "100%" }}>Copy the table link</button>
              {chatErr && <p role="status" style={{ color: chatErr === "Table link copied." ? C.muted : "#e07a70", fontSize: 12, marginTop: 10 }}>{chatErr}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
