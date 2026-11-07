"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import { renderClassic, layoutBare } from "@/lib/dungeon/classic";
import { normalizeLevels, CELL_TYPES } from "@/lib/dungeon/render";
import { normCustom, normDoors, normElements, normBattleMeta } from "@/lib/dungeon/battle";
import {
  snapToken, snapCenter, measure, fitCamera, zoomAt, centerOn, toWorld, parseChat, DIAGONAL_RULES,
  templateCells, templateOutline, insideTemplate, snapOrigin, snapAngle, TEMPLATE_SHAPES,
  type Camera, type Pt, type DiagonalRule, type TemplateGeom, type TemplateShape,
} from "@/lib/tabletop/geometry";
import { loadSrd } from "@/lib/srd/srd";
import { sortForTurns, applyDamage, applyHealing, combatantId, pcCombatant, CONDITIONS, type Combatant } from "@/lib/combat";
import { monsterSourceLabel } from "@/lib/monster-sources";
import {
  decodeFog, encodeFog, isRevealed, setSquares, fillFog, brushCells, roomsOf, roomCells, doorAt, edgeSegment,
  doorsAsDrawn, PLAYER_DOORS, type MapShape,
} from "@/lib/tabletop/fog";
import { drawElement, type DoorKind, type MapElement } from "@/lib/dungeon/classic";
import { wallSegments, visibility, seenSquares, canSee, CANOPY_KINDS, type Seg } from "@/lib/tabletop/sight";
import { markerShort, markerKind, MARKER_COLORS } from "@/lib/combat-effects";
import { openTabletop } from "@/lib/tabletop/open";
import { AttackForm, MarkerChips, MarkerPicker, PlayerEntryControls, SaveBanner, isMyTurn, type FightEntry, type PendingSave } from "@/components/fight-controls";

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
//          Escape lets go, C re-centres, T templates, Q drops a ruler waypoint.
// Phase 2a: area templates (circle, cone, square, line) sized in feet, left on the table, moved and
//          turned by their owner or the GM (p106); token borders and auras; a fading trail with the
//          feet moved; tokens from the monster library; the battle map's painting on the table.
// Phase 2b: the turn tracker runs the Combat page's own fight (combats, p101): the GM reads and writes
//          it the way that page does (same turn stepping, same sort, same damage rules); players see it
//          through tabletop_combat (p107), which hides monster HP and hidden combatants. Each combatant
//          the table adds carries a tokenId, so its token shows the HP bar, conditions and whose turn.
//          N and P step the turn for the GM. Players roll their own initiative from the Turns tab.
// Phase 3a: fog of war and doors (p109). The GM reveals or hides a room with one click (the room comes
//          from the map's walls and doors) or paints squares with a brush; players get nothing from a
//          hidden square, filtered in the database. Doors open and close with a click: the GM any door,
//          Shift-click to pick several; a player a plain or double door beside their own token.
// Phase 3b: line of sight (scene setting, on top of the fog): a player sees what their own tokens can
//          see, walls and closed doors from the battle map blocking it; rooms they have seen stay drawn,
//          dimmed, with nobody shown in them. Remembered in this browser only. Trees are a canopy: drawn
//          over the tokens and faded while one stands beneath. The GM sees everything, and the sight of
//          the tokens they select as an outline.
// Phase 4a: players act on the fight from the Turns tab: their own HP and conditions, effects on
//          anyone else on their turn, and attacks on a target they pick (or the token they select):
//          the server compares the roll with the target's AC and lands the damage on a hit (p110).
//          Buffs and debuffs sit beside the conditions. The table opens in its own window too.
// Phase 4b: saving throws wait for the roll (p111). A player sees the saves waiting on their character
//          in the Turns tab and rolls them there; their own save effects (a Fireball) wait on each target.
//          The GM sees every pending save on the entries and settles them: saved, failed.
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
type MapJson = {
  id: string; kind: string; n: number; feet_per_square: number; grid: unknown; custom: unknown; doors: unknown; elements: unknown; meta: Record<string, unknown>;
  door_state?: Record<string, boolean>; fog?: { on: boolean; revealed: string }; walls?: string[];
};
type Scene = { id: string; name: string; battle_map_id: string; level: number; settings: { show_labels?: boolean; diagonal?: DiagonalRule; los?: boolean } };
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

type Tool = "select" | "ruler" | "template" | "hand" | "fog";
type FogMode = "reveal-room" | "hide-room" | "reveal-brush" | "hide-brush";
type Tpl = TemplateGeom & { id: string; owner: string; color: string; label: string | null; scene_id: string };
type Aura = { ft: number; color: string; players: boolean };
type Border = { pattern?: "solid" | "double" | "dashed" | "dotted"; width?: "thin" | "normal" | "thick" };
type Trail = { from: Pt; to: Pt; color: string; born: number; feet: number };
type TC = Combatant & { tokenId?: string | null };
type FightRow = { id: string; name: string; round: number; turn: number; combatants: TC[]; session_id: string | null };
type Entry = { id: string; name: string; kind: "pc" | "monster"; initiative: number | null; defeated: boolean; is_turn: boolean; tokenId?: string | null;
  characterId?: string | null; hp?: number | null; maxHp?: number | null; tempHp?: number; conditions?: string[]; ac?: number | null; hidden?: boolean; initBonus?: number; mine?: boolean;
  pendingSaves?: PendingSave[]; awaitingSave?: boolean;
  lastSave?: { label: string; by: string; total: number | null; dc: number; saved: boolean; damage: number; at: number } | null };
type Fight = { id: string; name: string; round: number; order: Entry[] };
const FIGHT_COLS = "id, name, round, turn, combatants, session_id";
type LibMonster = { name: string; size?: string; cr?: string | number; hp?: number; ac?: number; source_key?: string };
type Ping = { x: number; y: number; color: string; born: number };
type Ruler = { points: Pt[]; color: string; done: number | null; by: string };

const SIZES: { v: number; label: string }[] = [
  { v: 0.5, label: "Tiny" }, { v: 1, label: "Small or Medium" }, { v: 2, label: "Large" }, { v: 3, label: "Huge" }, { v: 4, label: "Gargantuan" },
];
const KIND_RING: Record<Token["kind"], string> = { pc: "#d9a43a", npc: "#6fa3d8", monster: "#c9534a", object: "#9a9387" };
const SELECT = "#ffd36b";
const PING_MS = 3000, RULER_FADE_MS = 1500, DRAG_SEND_MS = 60, GLIDE_MS = 220, TRAIL_MS = 3500;
const BORDER_W: Record<NonNullable<Border["width"]>, number> = { thin: 0.05, normal: 0.08, thick: 0.13 };
const hexA = (hex: string, a: number) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : hex;
};

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
  const [panel, setPanel] = useState<"chat" | "turns" | "tokens" | "scenes">("chat");
  const [fight, setFight] = useState<Fight | null>(null);
  const fightRow = useRef<FightRow | null>(null);
  const fightRef = useRef<Fight | null>(null);
  const [selEntry, setSelEntry] = useState<string | null>(null);
  const [hpAmt, setHpAmt] = useState("");
  const [initBonus, setInitBonus] = useState("0");
  const [fightBusy, setFightBusy] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [draft, setDraft] = useState("");
  const [asWho, setAsWho] = useState<string>("");          // character id, or "" for yourself / GM name
  const [gmName, setGmName] = useState("GM");
  const [adv, setAdv] = useState<"flat" | "adv" | "dis">("flat");
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [present, setPresent] = useState<{ key: string; name: string; color: string }[]>([]);
  const [tick, setTick] = useState(0);
  const [fogMode, setFogMode] = useState<FogMode>("reveal-room");
  const [fogBrush, setFogBrush] = useState(1);
  const [fogOnUi, setFogOnUi] = useState(false);
  const [selDoors, setSelDoors] = useState<string[]>([]);
  const [selTpl, setSelTpl] = useState<string | null>(null);
  const [tplShape, setTplShape] = useState<TemplateShape>("circle");
  const [tplSize, setTplSize] = useState("");
  const [tplColor, setTplColor] = useState("#e0703a");
  const [tplLinger, setTplLinger] = useState(true);

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
  const templatesRef = useRef<Map<string, Tpl>>(new Map());
  const tplPreview = useRef<{ geom: TemplateGeom; color: string; done: number | null } | null>(null);
  const remoteTpl = useRef<Map<string, { geom: TemplateGeom; color: string; done: number | null }>>(new Map());
  const tplDrag = useRef<{ id: string; start: Pt; orig: Pt; now: Pt; moved: boolean } | null>(null);
  const tplSent = useRef(0);
  const trails = useRef<Trail[]>([]);
  const overlayUrl = useRef<string | null>(null);
  const fogBits = useRef<Uint8Array>(new Uint8Array(0));
  const fogOn = useRef(false);
  const fogCanvas = useRef<HTMLCanvasElement | null>(null);
  const fogEditedAt = useRef(0);
  const fogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brushing = useRef<{ on: boolean } | null>(null);
  const hoverSq = useRef<Pt | null>(null);
  const roomsCache = useRef<{ sig: string; rooms: Int32Array; shape: MapShape } | null>(null);
  const mapSig = useRef("");
  const selDoorsRef = useRef<string[]>([]);
  const sight = useRef<{ key: string; polys: { x: number; y: number }[][]; viewers: number } >({ key: "", polys: [], viewers: 0 });
  const segsCache = useRef<{ sig: string; segs: Seg[] } | null>(null);
  const explored = useRef<{ scene: string; bits: Uint8Array; canvas: HTMLCanvasElement | null; dirty: boolean; savedAt: number } | null>(null);
  const darkLayer = useRef<HTMLCanvasElement | null>(null);
  const canopy = useRef<MapElement[]>([]);
  const seenTokens = useRef<Set<string> | null>(null);
  const renderBaseRef = useRef<() => void>(() => {});
  const loadFightRef = useRef<() => Promise<void>>(async () => {});
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
  selDoorsRef.current = selDoors;
  const selTplRef = useRef<string | null>(null);
  selTplRef.current = selTpl;
  fightRef.current = fight;
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
    img.onload = () => {
      imgs.current.set(url, img);
      // the battle map's painting is part of the map underneath, so the map is rendered again with it
      if (url === overlayUrl.current) renderBaseRef.current();
      requestDraw(); setTick((v) => v + 1);
    };
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
    overlayUrl.current = ov && ov.show ? ov.url : null;
    let overlay: { img: HTMLImageElement; opacity: number; inkOnTop: boolean } | null = null;
    if (ov && ov.show) {
      const im = imgs.current.get(ov.url);
      if (!im) loadImage(ov.url);
      else if (typeof im !== "string") overlay = { img: im, opacity: ov.opacity, inkOnTop: ov.inkOnTop };
    }
    // trees are a canopy over the tokens, unless the painting already carries the pieces
    const allEls = normElements([m.elements], n)[0];
    const piecesInPaint = !!overlay && !ov?.piecesOnTop;
    canopy.current = piecesInPaint ? [] : allEls.filter((e) => CANOPY_KINDS.has(e.k));
    const baseEls = piecesInPaint ? allEls : allEls.filter((e) => !CANOPY_KINDS.has(e.k));
    const L = layoutBare(cell, { r0: 0, c0: 0, rows: n, cols: n });
    const cv = baseRef.current ?? document.createElement("canvas");
    cv.width = L.width; cv.height = L.height;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    renderClassic(ctx, {
      n, grid: normalizeLevels([m.grid], n)[0], custom: normCustom([m.custom], n)[0], tileImages: new Map(), tileColors: new Map(),
      marks: { features: {}, doors: doorsAsDrawn(normDoors([m.doors], n)[0], m.door_state ?? {}), labels: {} },
      meta: { title: "", levelNames: meta.levelNames, autoNumber: meta.autoNumber, grid: meta.showGrid },
      level: 0, feetPerSquare: m.feet_per_square, outdoor: kind === "outdoor", ground: meta.ground > 0 && meta.ground < CELL_TYPES.length ? meta.ground : undefined,
      gridLook: meta.grid, elements: baseEls, drawElements: true,
      topGrid: meta.topGrid.show ? meta.topGrid.opacity : null, overlay, piecesHidden: !!overlay && !ov?.piecesOnTop, bare: true,
    }, L);
    // closed secret doors, as players get them: plain wall drawn the way the renderer draws walls
    if (m.walls?.length) {
      ctx.save(); ctx.lineCap = "round";
      for (const [w, col] of [[Math.max(3, cell * 0.32), "rgba(70,50,25,0.13)"], [Math.max(2, cell * 0.11), "#2b2018"]] as [number, string][]) {
        ctx.lineWidth = w; ctx.strokeStyle = col; ctx.beginPath();
        for (const k of m.walls) { const sg = edgeSegment(k, n); if (!sg) continue; ctx.moveTo(sg.a.x * cell, sg.a.y * cell); ctx.lineTo(sg.b.x * cell, sg.b.y * cell); }
        ctx.stroke();
      }
      ctx.restore();
    }
    baseRef.current = cv;
  }, [loadImage]);
  renderBaseRef.current = renderBase;

  // The fog as an n by n image, one pixel per square, opaque where hidden; drawn scaled up with no
  // smoothing so the squares stay crisp.
  const rebuildFog = useCallback(() => {
    const m = stateRef.current?.map;
    if (!m || !fogOn.current) { fogCanvas.current = null; return; }
    const n = m.n > 0 ? m.n : 25;
    const cv = fogCanvas.current ?? document.createElement("canvas");
    cv.width = n; cv.height = n;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const img = ctx.createImageData(n, n), gm = stateRef.current?.role === "gm";
    // Indoors a player's hidden squares arrive as plain rock, so the one square of rock around what is
    // revealed is left clear: walls and hatching draw whole, and a hidden passage leaves no notch.
    const margin = !gm && m.kind !== "outdoor";
    const near = (c: number, r: number) => {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && isRevealed(fogBits.current, n, c + dc, r + dr)) return true;
      return false;
    };
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (isRevealed(fogBits.current, n, c, r) || (margin && near(c, r))) continue;
      const k = (r * n + c) * 4;
      img.data[k] = gm ? 8 : 13; img.data[k + 1] = gm ? 10 : 11; img.data[k + 2] = gm ? 26 : 9; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    fogCanvas.current = cv;
  }, []);

  // The map's shape for rooms and doors, cached per map content.
  const shapeOf = useCallback((): { rooms: Int32Array; shape: MapShape } | null => {
    const m = stateRef.current?.map; if (!m) return null;
    const n = m.n > 0 ? m.n : 25;
    if (roomsCache.current && roomsCache.current.sig === mapSig.current) return roomsCache.current;
    const shape: MapShape = { n, grid: normalizeLevels([m.grid], n)[0], custom: normCustom([m.custom], n)[0], doors: normDoors([m.doors], n)[0], outdoor: m.kind === "outdoor", walls: m.walls ?? [] };
    roomsCache.current = { sig: mapSig.current, rooms: roomsOf(shape), shape };
    return roomsCache.current;
  }, []);

  // Line of sight: who is looking (a player's own tokens on the map; for the GM, the tokens they have
  // selected, shown as an outline only), and what they can see. Recomputed only when a viewer moves or
  // the walls change.
  const losOn = () => !!stateRef.current?.scene?.settings?.los && !!stateRef.current?.map;
  const updateSight = (): void => {
    const st = stateRef.current, m = st?.map;
    if (!st || !m || !losOn()) { sight.current = { key: "", polys: [], viewers: 0 }; return; }
    const n = m.n > 0 ? m.n : 25, gm = st.role === "gm";
    const viewers = [...tokensRef.current.values()].filter((t) => (gm ? selRef.current.includes(t.id) : t.mine) && !t.hidden && t.layer !== "gm")
      .map((t) => shownPos(t)).filter((p) => p.x >= 0 && p.y >= 0 && p.x < n && p.y < n);
    const key = mapSig.current + "|" + viewers.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(";");
    if (key === sight.current.key) return;
    const sh = shapeOf(); if (!sh) return;
    if (!segsCache.current || segsCache.current.sig !== mapSig.current) segsCache.current = { sig: mapSig.current, segs: wallSegments(sh.shape, m.door_state ?? {}) };
    const polys = viewers.map((p) => visibility(p, segsCache.current!.segs));
    sight.current = { key, polys, viewers: viewers.length };
    if (gm || !st.scene) return;
    // remember what this player has seen, per scene, in this browser
    let ex = explored.current;
    if (!ex || ex.scene !== st.scene.id) {
      let bits: Uint8Array = new Uint8Array(Math.ceil((n * n) / 8));
      try { const raw = window.localStorage.getItem(`sixaxes:explored:${st.scene.id}:${st.me}`); if (raw) bits = decodeFog(raw, n); } catch { /* storage unavailable: memory lasts for this visit */ }
      ex = explored.current = { scene: st.scene.id, bits, canvas: null, dirty: true, savedAt: 0 };
    }
    const fresh: number[] = [];
    for (const poly of polys) for (const i of seenSquares(sh.shape, poly)) if (!isRevealed(ex.bits, n, i % n, (i / n) | 0)) fresh.push(i);
    if (fresh.length) {
      ex.bits = setSquares(ex.bits, n, fresh, true); ex.dirty = true;
      if (Date.now() - ex.savedAt > 1000) { ex.savedAt = Date.now(); try { window.localStorage.setItem(`sixaxes:explored:${st.scene.id}:${st.me}`, encodeFog(ex.bits)); } catch { /* ignore */ } }
    }
  };

  // Is this point hidden from players right now?
  const fogHides = useCallback((p: Pt): boolean => {
    const m = stateRef.current?.map;
    return !!m && fogOn.current && !isRevealed(fogBits.current, m.n, Math.floor(p.x), Math.floor(p.y));
  }, []);

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
      if (seenTokens.current && !seenTokens.current.has(t.id)) continue;
      const r = Math.max(0.35, t.size / 2) * cell;
      if (Math.hypot(w.x - p.x * cell, w.y - p.y * cell) <= r) return t;
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the fight entry for a token: the combatant the table stamped with its tokenId, else the pc by character
  function entryFor(t: Token): Entry | null {
    const f = fightRef.current; if (!f) return null;
    return f.order.find((e) => e.tokenId === t.id) ?? (t.character_id ? f.order.find((e) => e.kind === "pc" && e.characterId === t.character_id) ?? null : null);
  }

  // where a token is drawn right now: my drag, someone else's drag, or a glide to its saved square
  function shownPos(t: Token): Pt {
    const d = drag.current?.now.get(t.id); if (d) return d;
    const rd = remoteDrag.current.get(t.id); if (rd && rd.until > performance.now()) return rd;
    const g = shown.current.get(t.id);
    if (!g) return { x: t.x, y: t.y };
    const k = Math.min(1, (performance.now() - g.t0) / GLIDE_MS), e = 1 - (1 - k) * (1 - k);
    // A finished glide lets go, so the token is drawn (and clicked) where it actually is. Keeping the
    // entry pinned the token to that glide's end point after any later move.
    if (k >= 1 || g.x !== t.x || g.y !== t.y) { shown.current.delete(t.id); return { x: t.x, y: t.y }; }
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
    const n = stateRef.current?.map?.n ?? 0;

    // area templates, under the tokens: covered squares, the shape, its origin and size
    const drawTpl = (g: TemplateGeom, color: string, alpha: number, sel: boolean) => {
      ctx.save(); ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = hexA(color, 0.22);
      for (const [r, c] of templateCells(g, fps, n)) ctx.fillRect(c * cell, r * cell, cell, cell);
      const pts = templateOutline(g, fps);
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x * cell, p.y * cell) : ctx.moveTo(p.x * cell, p.y * cell))); ctx.closePath();
      ctx.fillStyle = hexA(color, 0.1); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, 2.5 / cam.s);
      if (sel) ctx.setLineDash([7 / cam.s, 4 / cam.s]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(g.x * cell, g.y * cell, Math.max(3, 4.5 / cam.s), 0, Math.PI * 2); ctx.fill();
      const fs = Math.max(11, 13 / cam.s);
      const text = `${Math.round(g.size_ft)} ft ${g.shape === "circle" ? "radius" : g.shape}`;
      ctx.font = `700 ${fs}px system-ui, sans-serif`; const w = ctx.measureText(text).width + fs;
      ctx.fillStyle = "rgba(20,16,12,0.85)"; ctx.fillRect(g.x * cell + 8 / cam.s, g.y * cell + 8 / cam.s, w, fs * 1.4);
      ctx.fillStyle = "#fff"; ctx.textBaseline = "top"; ctx.fillText(text, g.x * cell + 8 / cam.s + fs / 2, g.y * cell + 8 / cam.s + fs * 0.2);
      ctx.restore();
    };
    for (const t of templatesRef.current.values()) {
      const d = tplDrag.current && tplDrag.current.id === t.id ? tplDrag.current.now : null;
      drawTpl(d ? { ...t, x: d.x, y: d.y } : t, t.color, 1, selTplRef.current === t.id);
    }
    const fadeOf = (done: number | null) => (done === null ? 1 : 1 - (now - done) / RULER_FADE_MS);
    if (tplPreview.current) {
      const a = fadeOf(tplPreview.current.done);
      if (a <= 0) tplPreview.current = null; else { if (tplPreview.current.done !== null) animating = true; drawTpl(tplPreview.current.geom, tplPreview.current.color, a, false); }
    }
    for (const [k, rt] of remoteTpl.current) {
      const a = fadeOf(rt.done);
      if (a <= 0) remoteTpl.current.delete(k); else { if (rt.done !== null) animating = true; drawTpl(rt.geom, rt.color, a, false); }
    }

    // line of sight: which tokens this player can see right now (their own always)
    updateSight();
    const lineOfSight = losOn() && stateRef.current?.role !== "gm";
    if (lineOfSight) {
      const vis = new Set<string>();
      for (const t of tokensRef.current.values()) { const p = shownPos(t); if (t.mine || canSee(sight.current.polys, p.x, p.y, t.size / 2)) vis.add(t.id); }
      seenTokens.current = vis;
    } else seenTokens.current = null;
    const shownToMe = (t: Token) => !seenTokens.current || seenTokens.current.has(t.id);

    // auras, under the tokens, measured from the token's edge (as a 2024 emanation is)
    for (const t of tokensRef.current.values()) {
      if (!shownToMe(t)) continue;
      const auras = Array.isArray(t.style?.auras) ? (t.style.auras as Aura[]) : [];
      if (!auras.length) continue;
      const p = shownPos(t), base = (t.size / 2) * cell;
      for (const a of auras) {
        if (!a || !(a.ft > 0) || (!a.players && stateRef.current?.role !== "gm")) continue;
        const rr = base + (a.ft / fps) * cell;
        ctx.save(); ctx.beginPath(); ctx.arc(p.x * cell, p.y * cell, rr, 0, Math.PI * 2);
        ctx.fillStyle = hexA(a.color, 0.13); ctx.fill(); ctx.strokeStyle = hexA(a.color, 0.7); ctx.lineWidth = Math.max(1.5, 2 / cam.s);
        if (!a.players) ctx.setLineDash([6 / cam.s, 4 / cam.s]);
        ctx.stroke(); ctx.restore();
      }
    }

    // fog: opaque for players, a shade for the GM, who still sees what is underneath
    if (fogOn.current && fogCanvas.current && n) {
      ctx.save(); ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = stateRef.current?.role === "gm" ? 0.5 : 1;
      ctx.drawImage(fogCanvas.current, 0, 0, n * cell, n * cell);
      ctx.restore();
    }
    // the fog brush under the pointer
    if (tool === "fog" && hoverSq.current && (fogMode === "reveal-brush" || fogMode === "hide-brush") && n) {
      const h = Math.floor(fogBrush / 2), c0 = Math.floor(hoverSq.current.x) - h, r0 = Math.floor(hoverSq.current.y) - h;
      ctx.save(); ctx.strokeStyle = fogMode === "reveal-brush" ? "#9fd39a" : "#e07a70"; ctx.lineWidth = Math.max(1.5, 2 / cam.s); ctx.setLineDash([5 / cam.s, 4 / cam.s]);
      ctx.strokeRect(c0 * cell, r0 * cell, fogBrush * cell, fogBrush * cell); ctx.restore();
    }
    // doors picked by the GM
    if (selDoorsRef.current.length && n) {
      ctx.save(); ctx.strokeStyle = SELECT; ctx.lineWidth = Math.max(4, cell * 0.16); ctx.lineCap = "round"; ctx.globalAlpha = 0.85;
      for (const k of selDoorsRef.current) {
        const sg = edgeSegment(k, n); if (!sg) continue;
        ctx.beginPath(); ctx.moveTo(sg.a.x * cell, sg.a.y * cell); ctx.lineTo(sg.b.x * cell, sg.b.y * cell); ctx.stroke();
      }
      ctx.restore();
    }

    // tokens: map layer, then tokens, then the GM layer
    const list = [...tokensRef.current.values()];
    const order = (t: Token) => (t.layer === "map" ? 0 : t.layer === "token" ? 1 : 2);
    list.sort((a, b) => order(a) - order(b));
    const sel = new Set(selRef.current);
    for (const t of list) {
      if (!shownToMe(t)) continue;
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
      const border = (t.style?.border ?? {}) as Border;
      const bw = Math.max(2, cell * BORDER_W[border.width ?? "normal"] * Math.max(1, Math.sqrt(t.size)));
      ctx.lineWidth = bw; ctx.strokeStyle = ring;
      if (t.hidden || t.layer === "gm") ctx.setLineDash([cell * 0.15, cell * 0.1]);
      else if (border.pattern === "dashed") ctx.setLineDash([bw * 2.2, bw * 1.4]);
      else if (border.pattern === "dotted") { ctx.setLineDash([0.01, bw * 1.8]); ctx.lineCap = "round"; }
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.stroke();
      if (border.pattern === "double") {
        ctx.lineWidth = Math.max(1.2, bw * 0.45);
        ctx.beginPath(); ctx.arc(0, 0, rad + bw * 1.1, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      const en = entryFor(t);
      if (en?.is_turn) {
        animating = true;
        const pulse = 0.55 + 0.45 * Math.sin(now / 260);
        ctx.save(); ctx.globalAlpha = pulse; ctx.strokeStyle = "#ffd36b"; ctx.lineWidth = Math.max(3, cell * 0.1);
        ctx.shadowColor = "#ffd36b"; ctx.shadowBlur = cell * 0.4;
        ctx.beginPath(); ctx.arc(cx, cy, rad + Math.max(5, cell * 0.16), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      if (en?.defeated) {
        ctx.save(); ctx.fillStyle = "rgba(10,8,6,0.55)"; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#d0463c"; ctx.lineWidth = Math.max(2, cell * 0.08); ctx.lineCap = "round";
        const k = rad * 0.6; ctx.beginPath(); ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k); ctx.moveTo(cx + k, cy - k); ctx.lineTo(cx - k, cy + k); ctx.stroke(); ctx.restore();
      }
      if (en && en.hp != null && en.maxHp) {
        const w = rad * 2, h = Math.max(4, cell * 0.11), x0 = cx - rad, y0 = cy - rad - h - Math.max(3, cell * 0.06);
        const frac = Math.max(0, Math.min(1, en.hp / en.maxHp));
        ctx.save(); ctx.fillStyle = "rgba(15,12,10,0.85)"; ctx.fillRect(x0 - 1, y0 - 1, w + 2, h + 2);
        ctx.fillStyle = frac > 0.5 ? "#5fae5a" : frac > 0.25 ? "#d9a43a" : "#d0463c"; ctx.fillRect(x0, y0, w * frac, h);
        if (en.tempHp && en.tempHp > 0) { ctx.fillStyle = "#6fa3d8"; ctx.fillRect(x0 + w * Math.max(0, frac - Math.min(1, en.tempHp / en.maxHp)), y0, w * Math.min(frac, en.tempHp / en.maxHp), h * 0.45); }
        ctx.restore();
      }
      const conds = en?.conditions ?? [];
      if (conds.length) {
        const fs = Math.max(8, cell * 0.2), shown2 = conds.slice(0, 4);
        ctx.save(); ctx.font = `700 ${fs}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        shown2.forEach((cn, i) => {
          const a = Math.PI * 0.25 + i * 0.42, bx = cx + Math.cos(a) * rad, by = cy + Math.sin(a) * rad, r2 = fs * 0.85;
          const mc = MARKER_COLORS[markerKind(cn)];
          ctx.fillStyle = mc.fill; ctx.beginPath(); ctx.arc(bx, by, r2, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = mc.line; ctx.lineWidth = Math.max(1, fs * 0.12); ctx.stroke();
          ctx.fillStyle = "#fff"; ctx.fillText(markerShort(cn), bx, by);
        });
        if (conds.length > 4) { ctx.fillStyle = "#c2a8f0"; ctx.fillText(`+${conds.length - 4}`, cx + rad * 0.2, cy + rad + fs); }
        ctx.restore();
      }
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

    // the canopy: trees over the tokens, faded while a token this viewer can see stands beneath
    if (canopy.current.length) {
      const under = list.filter(shownToMe).map((t) => ({ p: shownPos(t), r: t.size / 2 }));
      for (const el of canopy.current) {
        const reach = (el.s > 0 ? el.s : 1) * 0.45;
        const covered = under.some(({ p, r }) => Math.hypot(p.x - el.x, p.y - el.y) < reach + r * 0.6);
        ctx.save(); ctx.globalAlpha = covered ? 0.28 : 1; drawElement(ctx, el, 0, 0, cell); ctx.restore();
      }
    }
    // darkness: everything this player's tokens cannot see; what they have seen before stays dim
    if (lineOfSight && n) {
      const W = cv.width, H = cv.height;
      const dl = darkLayer.current ?? document.createElement("canvas");
      if (dl.width !== W || dl.height !== H) { dl.width = W; dl.height = H; }
      darkLayer.current = dl;
      const d = dl.getContext("2d");
      if (d) {
        d.setTransform(1, 0, 0, 1, 0, 0); d.globalCompositeOperation = "source-over"; d.globalAlpha = 1;
        d.clearRect(0, 0, W, H); d.fillStyle = "#0b0a08"; d.fillRect(0, 0, W, H);
        d.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.ox, dpr * cam.oy);
        d.globalCompositeOperation = "destination-out";
        const ex = explored.current;
        if (ex) {
          if (ex.dirty || !ex.canvas) {
            const ec = ex.canvas ?? document.createElement("canvas"); ec.width = n; ec.height = n;
            const ectx = ec.getContext("2d");
            if (ectx) { const img = ectx.createImageData(n, n); for (let i = 0; i < n * n; i++) if (isRevealed(ex.bits, n, i % n, (i / n) | 0)) img.data[i * 4 + 3] = 255; ectx.putImageData(img, 0, 0); }
            ex.canvas = ec; ex.dirty = false;
          }
          d.imageSmoothingEnabled = false; d.globalAlpha = 0.42; d.drawImage(ex.canvas, 0, 0, n * cell, n * cell);
        }
        d.globalAlpha = 1; d.fillStyle = "#000"; d.strokeStyle = "#000"; d.lineJoin = "round"; d.lineWidth = cell * 0.35;
        for (const poly of sight.current.polys) {
          if (poly.length < 3) continue;
          d.beginPath(); poly.forEach((q, i) => (i ? d.lineTo(q.x * cell, q.y * cell) : d.moveTo(q.x * cell, q.y * cell))); d.closePath(); d.fill(); d.stroke();
        }
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(dl, 0, 0); ctx.restore();
      }
    }
    // the GM's check: the sight of the selected tokens as an outline
    if (losOn() && stateRef.current?.role === "gm" && sight.current.polys.length) {
      ctx.save(); ctx.strokeStyle = "#8fd0ff"; ctx.lineWidth = Math.max(1.5, 2 / cam.s); ctx.setLineDash([6 / cam.s, 4 / cam.s]); ctx.fillStyle = "rgba(143,208,255,0.06)";
      for (const poly of sight.current.polys) { if (poly.length < 3) continue; ctx.beginPath(); poly.forEach((q, i) => (i ? ctx.lineTo(q.x * cell, q.y * cell) : ctx.moveTo(q.x * cell, q.y * cell))); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }

    // movement trails: where a token came from, and how far, fading out
    trails.current = trails.current.filter((tr) => now - tr.born < TRAIL_MS);
    for (const tr of trails.current) {
      animating = true;
      const a = 1 - (now - tr.born) / TRAIL_MS;
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = tr.color; ctx.lineWidth = Math.max(2, 3 / cam.s); ctx.setLineDash([8 / cam.s, 6 / cam.s]);
      ctx.beginPath(); ctx.moveTo(tr.from.x * cell, tr.from.y * cell); ctx.lineTo(tr.to.x * cell, tr.to.y * cell); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = tr.color; ctx.beginPath(); ctx.arc(tr.from.x * cell, tr.from.y * cell, Math.max(3, 4 / cam.s), 0, Math.PI * 2); ctx.fill();
      const fs = Math.max(11, 13 / cam.s), text = `${tr.feet} ft`, mx = ((tr.from.x + tr.to.x) / 2) * cell, my = ((tr.from.y + tr.to.y) / 2) * cell;
      ctx.font = `700 ${fs}px system-ui, sans-serif`; const w = ctx.measureText(text).width + fs;
      ctx.fillStyle = "rgba(20,16,12,0.85)"; ctx.fillRect(mx - w / 2, my - fs * 0.7, w, fs * 1.4);
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, mx, my);
      ctx.restore();
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
    templatesRef.current = new Map();
    if (st.scene) {
      const { data: tpls } = await supabase.from("vtt_templates").select("*").eq("scene_id", st.scene.id);
      for (const t of (tpls ?? []) as Tpl[]) templatesRef.current.set(t.id, t);
    }
    // fog: a GM in the middle of painting keeps their own copy until it has been saved
    const pendingFog = st.role === "gm" && (fogTimer.current !== null || Date.now() - fogEditedAt.current < 1500);
    if (!pendingFog) {
      fogOn.current = !!st.map?.fog?.on; setFogOnUi(fogOn.current);
      fogBits.current = decodeFog(st.map?.fog?.revealed, st.map?.n ?? 0);
    }
    const sig = st.map ? JSON.stringify([st.map.id, st.map.grid, st.map.custom, st.map.doors, st.map.door_state, st.map.walls, st.map.elements, st.map.meta?.overlay]) : "";
    const changed = sig !== mapSig.current;
    mapSig.current = sig;
    if (st.map?.id !== prevMap || st.scene?.id !== prevScene || !baseRef.current) { renderBase(); fitPending.current = true; }
    else if (changed) renderBase();
    rebuildFog(); requestDraw();
  }, [supabase, campaignId, applyTokens, renderBase, rebuildFog, requestDraw]);

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

  // ---- the fight ----
  const toFight = (row: FightRow): Fight => ({
    id: row.id, name: row.name, round: row.round,
    order: row.combatants.map((c, i) => ({ id: c.id, name: c.name, kind: c.kind, initiative: c.initiative, defeated: c.defeated, is_turn: i === row.turn,
      tokenId: c.tokenId ?? null, characterId: c.characterId ?? null, hp: c.hp, maxHp: c.maxHp, tempHp: c.tempHp, conditions: c.conditions, ac: c.ac, hidden: c.hidden, initBonus: c.initBonus,
      pendingSaves: ((c as TC & { pendingSaves?: PendingSave[] }).pendingSaves ?? []) })),
  });
  const loadFight = useCallback(async () => {
    const st = stateRef.current; if (!st) return;
    if (st.role === "gm") {
      const { data } = await supabase.from("combats").select(FIGHT_COLS).eq("campaign_id", campaignId).eq("status", "active").order("updated_at", { ascending: false }).limit(1);
      const row = ((data ?? []) as FightRow[])[0] ?? null;
      fightRow.current = row; setFight(row ? toFight(row) : null);
    } else {
      const { data } = await supabase.rpc("tabletop_combat", { p_campaign: campaignId });
      setFight((data as Fight | null) ?? null);
    }
    requestDraw();
  }, [supabase, campaignId, requestDraw]);
  loadFightRef.current = loadFight;
  useEffect(() => { if (state?.me) void loadFight(); }, [state?.me, loadFight]);
  // players also poll: a fight started or changed on the Combat page reaches them even when the GM's
  // table is closed (the GM's table relays changes at once when it is open)
  useEffect(() => {
    if (!state || state.role === "gm") return;
    const id = setInterval(() => { if (!document.hidden) void loadFight(); }, fight ? 8000 : 30000);
    return () => clearInterval(id);
  }, [state, fight, loadFight]);

  // GM writes: read the row fresh, change it, save it, tell the players' tables. The same rules as the
  // Combat page, so either screen can run the fight.
  const mutateFight = useCallback(async (fn: (row: FightRow) => FightRow) => {
    const cur = fightRow.current; if (!cur) return;
    setFightBusy(true);
    try {
      const { data, error: e1 } = await supabase.from("combats").select(FIGHT_COLS).eq("id", cur.id).single();
      if (e1 || !data) { setChatErr(`Could not read the fight: ${e1?.message ?? "gone"}`); return; }
      const next = fn(data as FightRow);
      const { error: e2 } = await supabase.from("combats").update({ round: next.round, turn: next.turn, combatants: next.combatants, updated_at: new Date().toISOString() }).eq("id", cur.id);
      if (e2) { setChatErr(`Could not save the fight: ${e2.message}`); return; }
      fightRow.current = next; setFight(toFight(next)); send("combat", {}); requestDraw();
    } finally { setFightBusy(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, requestDraw]);

  const combatantFromToken = (t: Token): TC | null => {
    if (t.kind === "object") return null;
    if (t.kind === "pc" && t.character_id) return { ...pcCombatant({ id: t.character_id, name: t.name }), tokenId: t.id };
    const stats = (t.style?.stats ?? {}) as { hp?: number | null; ac?: number | null };
    return { id: combatantId(), kind: "monster", name: t.name, initiative: null, initBonus: 0, hp: stats.hp ?? null, maxHp: stats.hp ?? null, tempHp: 0,
      ac: stats.ac ?? null, conditions: [], hidden: t.hidden || t.layer === "gm", defeated: false, block: null, tokenId: t.id };
  };
  const addToFight = useCallback(async (ids: string[]) => {
    const st = stateRef.current; if (!st) return;
    const toks = ids.map((i) => tokensRef.current.get(i)).filter((t): t is Token => !!t);
    if (!toks.length) { setChatErr("Select tokens on the map first (click, Shift-click or drag a box)."); return; }
    if (!fightRow.current) {
      const combatants = toks.map(combatantFromToken).filter((c): c is TC => !!c);
      const { data, error: er } = await supabase.from("combats").insert({ campaign_id: campaignId, session_id: st.session_id, name: st.scene?.name ?? "Combat", rules: "2024", combatants }).select(FIGHT_COLS).single();
      if (er || !data) { setChatErr(`Could not start the fight: ${er?.message ?? "no row"}`); return; }
      fightRow.current = data as FightRow; setFight(toFight(data as FightRow)); send("combat", {}); setPanel("turns"); requestDraw();
      return;
    }
    await mutateFight((row) => {
      const have = (t: Token) => row.combatants.some((c) => c.tokenId === t.id || (t.kind === "pc" && c.kind === "pc" && c.characterId === t.character_id));
      const add = toks.filter((t) => !have(t)).map(combatantFromToken).filter((c): c is TC => !!c);
      return { ...row, combatants: [...row.combatants, ...add] };
    });
    setPanel("turns");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, campaignId, mutateFight]);

  // the Combat page's step(): skips defeated monsters, wraps the round
  const stepTurn = useCallback((dir: 1 | -1) => mutateFight((cb) => {
    const n = cb.combatants.length; if (!n) return cb;
    const canAct = (c: TC) => !(c.kind === "monster" && c.defeated);
    let turn = cb.turn, round = cb.round;
    for (let i = 0; i < n; i++) {
      turn += dir;
      if (turn >= n) { turn = 0; round += 1; }
      if (turn < 0) { turn = n - 1; round = Math.max(1, round - 1); }
      if (canAct(cb.combatants[turn])) break;
    }
    return { ...cb, turn, round };
  }), [mutateFight]);
  const sortFight = () => void mutateFight((cb) => {
    const currentId = cb.combatants[cb.turn]?.id;
    const sorted = sortForTurns(cb.combatants) as TC[];
    return { ...cb, combatants: sorted, turn: Math.max(0, sorted.findIndex((c) => c.id === currentId)) };
  });
  const editEntry = (id: string, fn: (c: TC) => TC) => void mutateFight((cb) => ({ ...cb, combatants: cb.combatants.map((c) => (c.id === id ? fn(c) : c)) }));
  const removeEntry = (id: string) => void mutateFight((cb) => {
    const index = cb.combatants.findIndex((c) => c.id === id); if (index < 0) return cb;
    const combatants = cb.combatants.filter((c) => c.id !== id);
    return { ...cb, combatants, turn: index < cb.turn ? cb.turn - 1 : Math.min(cb.turn, Math.max(0, combatants.length - 1)) };
  });
  const endFight = async () => {
    const cur = fightRow.current; if (!cur) return;
    if (!window.confirm(`End "${cur.name}"? Players stop seeing it here and on the Combat page. The rolls stay in this session's Mechanics.`)) return;
    const { error: er } = await supabase.from("combats").update({ status: "ended", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", cur.id);
    if (er) { setChatErr(`Not ended: ${er.message}`); return; }
    fightRow.current = null; setFight(null); setSelEntry(null); send("combat", {}); requestDraw();
  };
  const rollInitiative = async (who: Entry, bonus: number, asPlayer: boolean) => {
    const notation = bonus ? `1d20${bonus > 0 ? "+" : ""}${bonus}` : "1d20";
    const res = await fetch("/api/tabletop/roll", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, notation, label: "Initiative", gmOnly: !asPlayer, characterId: asPlayer ? who.characterId : null, asName: asPlayer ? undefined : who.name, initiative: asPlayer }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: Message };
    if (!res.ok || !j.message) { setChatErr(j.error || `Roll failed (${res.status}).`); return null; }
    addFeed([j.message], []);
    return j.message.roll?.total ?? null;
  };
  const rollMonsterInit = async () => {
    const row = fightRow.current; if (!row) return;
    const targets = row.combatants.filter((c) => c.kind === "monster" && c.initiative == null);
    if (!targets.length) { setChatErr("Every monster already has initiative."); return; }
    setFightBusy(true);
    const got: Record<string, number> = {};
    for (const c of targets) {
      const total = await rollInitiative({ ...c, is_turn: false } as Entry, c.initBonus, false);
      if (total == null) break;
      got[c.id] = total;
    }
    setFightBusy(false);
    await mutateFight((cb) => {
      const withInit = cb.combatants.map((c) => (got[c.id] != null ? { ...c, initiative: got[c.id] } : c));
      if (cb.round === 1 && cb.turn === 0) return { ...cb, combatants: sortForTurns(withInit) as TC[], turn: 0 };
      return { ...cb, combatants: withInit };
    });
  };
  const centreOnEntry = (e: Entry) => {
    const t = [...tokensRef.current.values()].find((x) => x.id === e.tokenId || (e.kind === "pc" && x.character_id === e.characterId));
    const cv = canvasRef.current; if (!t || !cv) return;
    const r = cv.getBoundingClientRect();
    camRef.current = centerOn(camRef.current, t.x * cellRef.current, t.y * cellRef.current, r.width, r.height);
    setSelected([t.id]); requestDraw();
  };

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
        const f = { x: prev.x, y: prev.y }, to = { x: t.x, y: t.y };
        const losHides = st.role !== "gm" && !!st.scene.settings?.los && !t.mine
          && !(canSee(sight.current.polys, f.x, f.y, t.size / 2) && canSee(sight.current.polys, to.x, to.y, t.size / 2));
        if (!t.hidden && t.layer !== "gm" && !losHides) trails.current.push({ from: f, to, color: hueOf(owner ?? st.campaign.gm_id), born: performance.now(), feet: measure([f, to], st.scene.settings?.diagonal ?? "five", st.map?.feet_per_square ?? 5).feet });
      }
      remoteDrag.current.delete(t.id);
      tokensRef.current.set(t.id, t);
      if (st.role !== "gm" && (t.hidden || t.layer === "gm" || (!t.mine && fogHides(t)))) tokensRef.current.delete(t.id);
      requestDraw();
    };
    const upsertTpl = (row: Tpl) => {
      const st = stateRef.current; if (!st?.scene || row.scene_id !== st.scene.id) return;
      if (tplDrag.current?.id === row.id) return;
      templatesRef.current.set(row.id, row); requestDraw();
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
        const t = tokensRef.current.get(d.id);
        if (!t || (stateRef.current?.role !== "gm" && !t.mine && fogHides(d))) return;
        remoteDrag.current.set(d.id, { x: d.x, y: d.y, until: performance.now() + 4000 }); requestDraw();
      })
      .on("broadcast", { event: "vanish" }, ({ payload }) => {
        // the GM moved these into the fog: players stop drawing them (the database stops sending them)
        if (stateRef.current?.role === "gm") return;
        for (const id of ((payload as { ids?: string[] }).ids ?? [])) { const t = tokensRef.current.get(id); if (t && !t.mine) { tokensRef.current.delete(id); remoteDrag.current.delete(id); } }
        requestDraw();
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
      .on("broadcast", { event: "combat" }, () => { void loadFightRef.current(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "combats", filter: `campaign_id=eq.${campaignId}` }, () => {
        // only the GM passes combats' RLS: an edit made on the Combat page reaches this table, which
        // reloads and tells the players' tables to do the same
        void loadFightRef.current().then(() => { void channelRef.current?.send({ type: "broadcast", event: "combat", payload: {} }); });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "vtt_templates", filter: `campaign_id=eq.${campaignId}` }, (p) => upsertTpl(p.new as Tpl))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "vtt_templates", filter: `campaign_id=eq.${campaignId}` }, (p) => upsertTpl(p.new as Tpl))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "vtt_templates" }, (p) => {
        const id = (p.old as { id?: string }).id; if (id && templatesRef.current.delete(id)) requestDraw();
      })
      .on("broadcast", { event: "tpl" }, ({ payload }) => {
        const r = payload as { by: string; color: string; geom: TemplateGeom; done: boolean; placed?: boolean };
        if (r.placed) remoteTpl.current.delete(r.by);
        else remoteTpl.current.set(r.by, { geom: r.geom, color: r.color, done: r.done ? performance.now() : null });
        requestDraw();
      })
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
  // fog and doors
  const saveFog = useCallback((on: boolean | null, now = false) => {
    const sc = stateRef.current?.scene; if (!sc) return;
    fogEditedAt.current = Date.now();
    if (fogTimer.current) clearTimeout(fogTimer.current);
    const run = () => {
      fogTimer.current = null;
      void supabase.rpc("tabletop_set_fog", { p_scene: sc.id, p_on: on, p_revealed: encodeFog(fogBits.current) }).then(({ error: er }) => {
        fogEditedAt.current = Date.now();
        if (er) setChatErr(`Could not save the fog: ${er.message}`);
      });
    };
    if (now) run(); else fogTimer.current = setTimeout(run, 300);
  }, [supabase]);

  const paintFog = useCallback((cells: number[], on: boolean) => {
    const m = stateRef.current?.map; if (!m || !cells.length) return;
    fogBits.current = setSquares(fogBits.current.length ? fogBits.current : decodeFog("", m.n), m.n, cells, on);
    rebuildFog(); requestDraw();
  }, [rebuildFog, requestDraw]);

  const setFogEnabled = useCallback((on: boolean) => {
    fogOn.current = on; setFogOnUi(on);
    rebuildFog(); requestDraw(); saveFog(on, true);
  }, [rebuildFog, requestDraw, saveFog]);

  const setLos = useCallback(async (on: boolean) => {
    const sc = stateRef.current?.scene; if (!sc) return;
    const settings = { ...(sc.settings ?? {}), los: on };
    const { error: er } = await supabase.from("vtt_scenes").update({ settings, updated_at: new Date().toISOString() }).eq("id", sc.id);
    if (er) { setChatErr(`Could not change line of sight: ${er.message}`); return; }
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const fogAll = useCallback((reveal: boolean) => {
    const m = stateRef.current?.map; if (!m) return;
    fogBits.current = fillFog(m.n, reveal);
    rebuildFog(); requestDraw(); saveFog(null, true);
  }, [rebuildFog, requestDraw, saveFog]);

  const fogClick = (sq: Pt, mode: FogMode) => {
    const m = stateRef.current?.map; if (!m) return;
    const c = Math.floor(sq.x), r = Math.floor(sq.y);
    if (mode === "reveal-room" || mode === "hide-room") {
      const sh = shapeOf(); if (!sh) return;
      const cells = roomCells(sh.shape, sh.rooms, c, r);
      if (!cells) { setChatErr("There is no room there. Use the brush for open ground."); return; }
      paintFog(cells, mode === "reveal-room"); saveFog(null);
    } else {
      brushing.current = { on: mode === "reveal-brush" };
      paintFog(brushCells(m.n, c, r, fogBrush), brushing.current.on);
    }
  };

  // Open or close doors. The new state shows at once; the scene's Realtime update brings everyone else
  // (and this table) the saved state.
  const setDoors = useCallback(async (edges: string[], open: boolean) => {
    const st = stateRef.current, sc = st?.scene, m = st?.map; if (!sc || !m || !edges.length) return;
    const before = m.door_state ?? {};
    const next = { ...before }; for (const k of edges) { if (open) next[k] = true; else delete next[k]; }
    m.door_state = next; mapSig.current = ""; renderBase(); requestDraw();
    const { error: er } = await supabase.rpc("tabletop_set_doors", { p_scene: sc.id, p_edges: edges, p_open: open });
    if (er) {
      setChatErr(/next to the door/.test(er.message) ? "Move your token next to the door first." : /only the GM/.test(er.message) ? "Only the GM can open that door." : `Could not change the door: ${er.message}`);
      m.door_state = before; renderBase(); requestDraw();
    }
  }, [supabase, renderBase, requestDraw]);

  const doorUnder = (sq: Pt): { key: string; kind: DoorKind; open: boolean } | null => {
    const m = stateRef.current?.map; if (!m) return null;
    const doors = normDoors([m.doors], m.n)[0];
    const key = doorAt(doors, m.n, sq.x, sq.y); if (!key) return null;
    return { key, kind: doors[key], open: !!m.door_state?.[key] };
  };

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

  const canEditTpl = (t: Tpl | undefined | null) => !!t && (stateRef.current?.role === "gm" || t.owner === stateRef.current?.me);
  const tplAt = (sq: Pt): Tpl | null => {
    const list = [...templatesRef.current.values()];
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      if (Math.hypot(sq.x - t.x, sq.y - t.y) < 0.5 || insideTemplate(t, fps, sq.x, sq.y)) return t;
    }
    return null;
  };
  const fixedSize = () => { const v = Number(tplSize); return Number.isFinite(v) && v > 0 ? Math.min(1000, v) : null; };
  const sendTpl = (done: boolean, placed = false) => {
    const pv = tplPreview.current; if (!pv) return;
    send("tpl", { by: me, color: pv.color, geom: pv.geom, done, placed });
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
    if (tool === "fog" && st.role === "gm") { fogClick(sq, fogMode); return; }
    if (tool === "template") {
      const o = e.altKey ? sq : snapOrigin(sq, tplShape);
      tplPreview.current = { geom: { shape: tplShape, x: o.x, y: o.y, size_ft: fixedSize() ?? 5, width_ft: 5, rot: 0 }, color: tplColor, done: null };
      setSelTpl(null); requestDraw(); return;
    }
    if (tool === "ruler") {
      const p = e.altKey ? sq : snapCenter(sq);
      myRuler.current = { points: [p, { ...p }], color: myColor, done: null, by: st.me };
      keepRuler.current = false;
      requestDraw(); return;
    }
    const hit = tokenAt({ x: sq.x * cellRef.current, y: sq.y * cellRef.current });
    if (!hit) {
      const dr = doorUnder(sq);
      if (dr) {
        if (st.role === "gm" && e.shiftKey) {
          const cur = selDoorsRef.current, next = cur.includes(dr.key) ? cur.filter((k) => k !== dr.key) : [...cur, dr.key];
          setSelDoors(next); selDoorsRef.current = next; requestDraw(); return;
        }
        if (st.role !== "gm" && !PLAYER_DOORS.has(dr.kind)) { setChatErr("Only the GM can open that door."); return; }
        setSelDoors([]); selDoorsRef.current = [];
        void setDoors([dr.key], !dr.open); return;
      }
      const th = tplAt(sq);
      if (th) {
        setSelTpl(th.id); setSelected([]); selRef.current = [];
        if (canEditTpl(th)) tplDrag.current = { id: th.id, start: sq, orig: { x: th.x, y: th.y }, now: { x: th.x, y: th.y }, moved: false };
        requestDraw(); return;
      }
    }
    setSelTpl(null);
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
    if (tool === "fog") { hoverSq.current = sq; requestDraw(); }
    if (brushing.current && (e.buttons & 1)) {
      const m = stateRef.current?.map;
      if (m) paintFog(brushCells(m.n, Math.floor(sq.x), Math.floor(sq.y), fogBrush), brushing.current.on);
      return;
    }
    if (pan.current) {
      const dx = sp.x - pan.current.sx, dy = sp.y - pan.current.sy;
      if (Math.hypot(dx, dy) > 4) pan.current.moved = true;
      if (pan.current.moved) { camRef.current = { ...camRef.current, ox: pan.current.ox + dx, oy: pan.current.oy + dy }; requestDraw(); }
      return;
    }
    if (tplPreview.current && tplPreview.current.done === null && (e.buttons & 1)) {
      const g = tplPreview.current.geom, dx = sq.x - g.x, dy = sq.y - g.y, fps2 = stateRef.current?.map?.feet_per_square ?? 5;
      const dist = Math.hypot(dx, dy);
      g.size_ft = fixedSize() ?? Math.max(fps2, Math.round((dist * fps2) / 5) * 5);
      if (dist > 0.2) { const deg = (Math.atan2(dy, dx) * 180) / Math.PI; g.rot = e.altKey ? ((deg % 360) + 360) % 360 : snapAngle(deg); }
      const t = performance.now();
      if (t - tplSent.current > DRAG_SEND_MS) { tplSent.current = t; sendTpl(false); }
      requestDraw(); return;
    }
    const td = tplDrag.current;
    if (td) {
      const t = templatesRef.current.get(td.id);
      const raw = { x: td.orig.x + sq.x - td.start.x, y: td.orig.y + sq.y - td.start.y };
      td.now = e.altKey || !t ? raw : snapOrigin(raw, t.shape);
      if (Math.hypot(sq.x - td.start.x, sq.y - td.start.y) > 0.1) td.moved = true;
      requestDraw(); return;
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
        for (const id of d.ids) {
          const t = tokensRef.current.get(id)!, p = d.now.get(id)!;
          if (t.hidden || t.layer === "gm") continue;
          if (stateRef.current?.role === "gm" && fogHides(p)) continue;     // never show players a move inside the fog
          send("drag", { id, x: p.x, y: p.y });
        }
      }
      requestDraw(); return;
    }
    if (box.current) { box.current.b = { x: sq.x * cellRef.current, y: sq.y * cellRef.current }; requestDraw(); return; }
    const h = tokenAt({ x: sq.x * cellRef.current, y: sq.y * cellRef.current })?.id ?? null;
    if (h !== hover.current) { hover.current = h; requestDraw(); }
    const cv = canvasRef.current;
    if (cv && tool === "select") cv.style.cursor = !h && doorUnder(sq) ? "pointer" : "default";
  };

  const onUp = (e: React.PointerEvent) => {
    const st = stateRef.current; if (!st) return;
    const sp = screenPt(e), sq = toSquares(sp);
    if (brushing.current) { brushing.current = null; saveFog(null); return; }
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
    if (tplPreview.current && tplPreview.current.done === null && e.button === 0) {
      const pv = tplPreview.current, sc = st.scene;
      if (tplLinger && sc) {
        const row = { campaign_id: campaignId, scene_id: sc.id, owner: st.me, ...pv.geom, color: pv.color };
        void supabase.from("vtt_templates").insert(row).select("*").single().then(({ data, error: er }) => {
          if (er || !data) { setChatErr(`Could not leave the template: ${er?.message ?? "no row"}`); return; }
          templatesRef.current.set((data as Tpl).id, data as Tpl); setSelTpl((data as Tpl).id); requestDraw();
        });
        sendTpl(true, true); tplPreview.current = null;
      } else { pv.done = performance.now(); sendTpl(true); }
      requestDraw(); return;
    }
    const td = tplDrag.current;
    if (td) {
      tplDrag.current = null;
      const t = templatesRef.current.get(td.id);
      if (t && td.moved) {
        templatesRef.current.set(t.id, { ...t, x: td.now.x, y: td.now.y });
        void supabase.from("vtt_templates").update({ x: td.now.x, y: td.now.y, updated_at: new Date().toISOString() }).eq("id", t.id).then(({ error: er }) => {
          if (er) { setChatErr(`Could not move the template: ${er.message}`); templatesRef.current.set(t.id, t); requestDraw(); }
        });
      }
      requestDraw(); return;
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
        if (st.role === "gm" && fogOn.current) {
          const gone = d.ids.filter((id) => { const t = tokensRef.current.get(id); return t && !t.hidden && t.layer !== "gm" && fogHides(d.now.get(id)!); });
          if (gone.length) send("vanish", { ids: gone });
        }
        for (const id of d.ids) {
          const p = d.now.get(id)!, t = tokensRef.current.get(id);
          if (!t) continue;
          const o = d.orig.get(id)!;
          trails.current.push({ from: o, to: p, color: myColor, born: performance.now(), feet: measure([o, p], rule, fps).feet });
          shown.current.delete(id);
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
      // A Supabase query only runs once something awaits it or calls then(); a bare `void` never sends it.
      void supabase.rpc("tabletop_move_token", { p_token: id, p_x: t.x, p_y: t.y, p_rot: rot }).then(({ error: er }) => {
        if (er) { setChatErr(`Could not turn ${t.name}: ${er.message}`); tokensRef.current.set(id, t); requestDraw(); }
      });
    }
    requestDraw();
  }, [supabase, requestDraw]);

  const turnTpl = useCallback((by: number) => {
    const t = selTplRef.current ? templatesRef.current.get(selTplRef.current) : null;
    if (!t || !canEditTpl(t)) return;
    const rot = (((t.rot + by) % 360) + 360) % 360;
    templatesRef.current.set(t.id, { ...t, rot }); requestDraw();
    void supabase.from("vtt_templates").update({ rot, updated_at: new Date().toISOString() }).eq("id", t.id).then(({ error: er }) => {
      if (er) { setChatErr(`Could not turn the template: ${er.message}`); templatesRef.current.set(t.id, t); requestDraw(); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, requestDraw]);
  const removeTpl = useCallback(async () => {
    const t = selTplRef.current ? templatesRef.current.get(selTplRef.current) : null;
    if (!t || !canEditTpl(t)) return;
    const { error: er } = await supabase.from("vtt_templates").delete().eq("id", t.id);
    if (er) { setChatErr(`Could not remove the template: ${er.message}`); return; }
    templatesRef.current.delete(t.id); setSelTpl(null); requestDraw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, requestDraw]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === " ") { space.current = true; e.preventDefault(); return; }
      const k = e.key.toLowerCase();
      if (k === "escape") { setSelected([]); setSelTpl(null); setSelDoors([]); selDoorsRef.current = []; if (tplPreview.current) { tplPreview.current.done = performance.now(); sendTpl(true); } if (myRuler.current) { myRuler.current.done = performance.now(); send("ruler", { by: me, color: myColor, points: myRuler.current.points, done: true }); } requestDraw(); return; }
      if (k === "v") { setTool("select"); return; }
      if (k === "m") { setTool("ruler"); return; }
      if (k === "q") { addWaypoint(); return; }
      if (k === "t") { setTool("template"); return; }
      if (k === "u" && isGm) { setTool("fog"); return; }
      if (selTplRef.current) {
        if (k === "r") { turnTpl(e.shiftKey ? -15 : 15); return; }
        if (k === "delete" || k === "backspace") { e.preventDefault(); void removeTpl(); return; }
      }
      if (k === "c") { fit(); return; }
      if (k === "r") { turn(selRef.current, e.shiftKey ? -45 : 45); return; }
      if (!isGm) return;
      if (fightRef.current && (k === "n" || k === "p") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); void stepTurn(k === "n" ? 1 : -1); return; }
      if (k === "f" && !e.ctrlKey && !e.metaKey) { void addToFight(selRef.current); return; }
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
  }, [isGm, me, myColor, fit, turn, deleteTokens, updateTokens, requestDraw, turnTpl, removeTpl, stepTurn, addToFight]);

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
        name, image_url: t.image_url ?? null, x: p.x, y: p.y, size: t.size, rot: 0, layer: "token", hidden: !!t.hidden, controlled_by: [], style: t.style ?? {} });
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
  const [tStats, setTStats] = useState<{ hp: number | null; ac: number | null } | null>(null);
  const [libEdition, setLibEdition] = useState<"2014" | "2024">("2024");
  const [libQuery, setLibQuery] = useState("");
  const library = useMemo(() => (isGm && panel === "tokens" ? (loadSrd("monsters", libEdition) as unknown as LibMonster[]) : []), [isGm, panel, libEdition]);
  const libHits = useMemo(() => {
    const q = libQuery.trim().toLowerCase(); if (q.length < 2) return [];
    return library.filter((m) => m.name.toLowerCase().includes(q)).sort((a, b) => a.name.length - b.name.length).slice(0, 25);
  }, [library, libQuery]);
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
    return l.startsWith("tiny") ? 0.5 : l.startsWith("large") ? 2 : l.startsWith("huge") ? 3 : l.startsWith("garg") || l.startsWith("titan") ? 4 : 1;
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
        {fight && (() => { const cur = fight.order.find((e) => e.is_turn); return (
          <button type="button" onClick={() => setPanel("turns")} style={{ background: "rgba(217,164,58,0.12)", border: `1px solid ${C.sun}`, color: C.sun, borderRadius: 999, padding: "3px 10px", fontSize: 12.5, cursor: "pointer" }}>
            Round {fight.round}{cur ? ` · ${cur.name}'s turn` : ""}
          </button>); })()}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" onClick={() => openTabletop(campaignId)} title="Open the table in its own window, for a second screen" style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, border: `1px solid ${C.line}`, background: "transparent", color: C.muted, cursor: "pointer" }}>New window</button>
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
          <button type="button" title="Area template (T): circle, cone, square or line. Drag to size and aim, or type an exact size." onClick={() => setTool("template")} style={railBtn(tool === "template")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12L20 4v16z"/><circle cx="8" cy="12" r="1.5" fill="currentColor"/></svg>Area
          </button>
          {isGm && (
            <button type="button" title="Fog of war (U): reveal or hide a room with a click, or paint squares with the brush" onClick={() => setTool("fog")} style={railBtn(tool === "fog")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 8h12a3 3 0 1 0-3-3 M3 12h17 M5 16h11a3 3 0 1 1-3 3"/></svg>Fog
            </button>
          )}
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
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: tool === "ruler" || tool === "fog" ? "crosshair" : tool === "hand" ? "grab" : "default" }} />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, padding: 24, textAlign: "center" }}>
              {isGm ? "Put a battle map on the table from the Scenes tab on the right." : "The GM has not put a map on the table yet. Chat and dice work in the meantime."}
            </div>
          )}
          {scene && tool === "template" && (
            <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", background: "rgba(28,24,20,0.95)", border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 8px" }}>
              {TEMPLATE_SHAPES.map((sh) => <button key={sh.key} type="button" onClick={() => setTplShape(sh.key)} style={{ ...seg(tplShape === sh.key), flex: "0 0 auto", padding: "6px 10px" }}>{sh.label}</button>)}
              <input aria-label="Exact size in feet" value={tplSize} onChange={(e) => setTplSize(e.target.value.replace(/[^0-9.]/g, "").slice(0, 5))} placeholder="ft" title="Exact size in feet (radius for a circle, length otherwise). Leave empty to size it by dragging." style={{ ...field, width: 56, padding: "6px 6px" }} />
              <input aria-label="Template colour" type="color" value={tplColor} onChange={(e) => setTplColor(e.target.value)} style={{ width: 34, height: 30, padding: 0, border: "none", background: "transparent" }} />
              <label style={{ display: "flex", gap: 5, fontSize: 12, alignItems: "center", color: C.text }}><input type="checkbox" checked={tplLinger} onChange={(e) => setTplLinger(e.target.checked)} style={{ accentColor: C.sun }} />Leave it on the table</label>
            </div>
          )}
          {scene && isGm && tool === "fog" && (
            <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100% - 20px)", background: "rgba(28,24,20,0.95)", border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 8px" }}>
              <label style={{ display: "flex", gap: 5, fontSize: 12.5, alignItems: "center", color: C.text, marginRight: 4 }}>
                <input type="checkbox" checked={fogOnUi} onChange={(e) => setFogEnabled(e.target.checked)} style={{ accentColor: C.sun }} />Fog on
              </label>
              {([["reveal-room", "Reveal room"], ["hide-room", "Hide room"], ["reveal-brush", "Reveal brush"], ["hide-brush", "Hide brush"]] as [FogMode, string][]).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFogMode(k)} style={{ ...seg(fogMode === k), flex: "0 0 auto", padding: "6px 10px" }}>{l}</button>
              ))}
              {(fogMode === "reveal-brush" || fogMode === "hide-brush") && [1, 3, 5].map((b) => (
                <button key={b} type="button" title={`Brush ${b} by ${b} squares`} onClick={() => setFogBrush(b)} style={{ ...seg(fogBrush === b), flex: "0 0 auto", padding: "6px 8px" }}>{b}</button>
              ))}
              <label title="Players see only what their own tokens can see, inside what the fog reveals" style={{ display: "flex", gap: 5, fontSize: 12.5, alignItems: "center", color: C.text, margin: "0 4px" }}>
                <input type="checkbox" checked={!!scene.settings?.los} onChange={(e) => void setLos(e.target.checked)} style={{ accentColor: C.sun }} />Line of sight
              </label>
              <button type="button" onClick={() => fogAll(true)} style={small}>Reveal all</button>
              <button type="button" onClick={() => fogAll(false)} style={small}>Hide all</button>
              {!fogOnUi && <span style={{ fontSize: 12, color: "#d9a43a" }}>Fog is off: players see the whole map.</span>}
            </div>
          )}
          {scene && isGm && selDoors.length > 0 && (
            <div style={{ position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, alignItems: "center", background: "rgba(28,24,20,0.95)", border: `1px solid ${C.sun}`, borderRadius: 10, padding: "6px 8px", fontSize: 12.5 }}>
              <span>{selDoors.length} door{selDoors.length === 1 ? "" : "s"}</span>
              <button type="button" onClick={() => { void setDoors(selDoors, true); setSelDoors([]); }} style={small}>Open</button>
              <button type="button" onClick={() => { void setDoors(selDoors, false); setSelDoors([]); }} style={small}>Close</button>
              <button type="button" onClick={() => setSelDoors([])} style={{ ...small, color: C.muted }}>Clear</button>
            </div>
          )}
          {scene && selTpl && templatesRef.current.get(selTpl) && (
            <div style={{ position: "absolute", top: tool === "template" ? 58 : 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, alignItems: "center", background: "rgba(28,24,20,0.95)", border: `1px solid ${C.sun}`, borderRadius: 10, padding: "6px 8px", fontSize: 12.5 }}>
              <span>{(() => { const t = templatesRef.current.get(selTpl)!; return `${Math.round(t.size_ft)} ft ${t.shape === "circle" ? "radius" : t.shape}`; })()}</span>
              {canEditTpl(templatesRef.current.get(selTpl)) ? (
                <>
                  <button type="button" onClick={() => turnTpl(-15)} style={small} title="Shift+R">&#8634; 15</button>
                  <button type="button" onClick={() => turnTpl(15)} style={small} title="R">15 &#8635;</button>
                  <button type="button" onClick={() => void removeTpl()} style={{ ...small, color: "#e07a70" }}>Remove</button>
                </>
              ) : <span style={{ color: C.muted }}>placed by someone else</span>}
            </div>
          )}
          {scene && !isGm && scene.settings?.los && ![...tokensRef.current.values()].some((t) => t.mine && !t.hidden && t.layer !== "gm") && (
            <div role="status" style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", background: "rgba(28,24,20,0.95)", border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 10px", fontSize: 12.5, color: C.text }}>
              Line of sight is on and you have no token on this map yet, so you see only what you have seen before.
            </div>
          )}
          {scene && (
            <div style={{ position: "absolute", left: 10, bottom: 10, fontSize: 11.5, color: C.muted, background: "rgba(20,16,12,0.75)", padding: "4px 8px", borderRadius: 6, pointerEvents: "none" }}>
              Wheel zooms · right-drag pans · right-click pings{isGm ? " (Shift: bring everyone)" : ""} · click a door to open it{isGm ? " (Shift: pick several)" : ""} · R turns · M ruler · T area{isGm ? " · U fog" : ""}
            </div>
          )}
        </div>

        {/* side panel */}
        <div style={{ width: 360, display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.line}`, background: C.surface, minHeight: 0 }}>
          <div style={{ display: "flex", gap: 6, padding: 8, borderBottom: `1px solid ${C.line}` }}>
            <button type="button" onClick={() => setPanel("chat")} style={seg(panel === "chat")}>Chat</button>
            <button type="button" onClick={() => setPanel("turns")} style={seg(panel === "turns")}>Turns{fight ? ` (${fight.round})` : ""}</button>
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
                    const ag = (m.roll as { against?: { target: string; hit: boolean | null; crit: boolean; applied?: boolean; defeated?: boolean } | null }).against;
                    const title = ag ? `${m.roll.label ?? ""} vs ${ag.target}: ${ag.applied ? `damage lands${ag.crit ? " (crit)" : ""}${ag.defeated ? `, ${ag.target} goes down` : ""}` : ag.hit === null ? "the GM decides" : ag.crit ? "critical hit" : ag.hit ? "hit" : "miss"}` : m.roll.label ?? "";
                    return <div key={f.key}>{renderRoll(who, title, m.roll.total, dice, m.roll.natural ?? null, m.gm_only ? "GM only" : m.roll.logged === false ? "not logged" : null)}</div>;
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

          {panel === "turns" && (
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {!fight ? (
                <>
                  <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>No fight running.</p>
                  {isGm && <p style={{ color: C.muted, fontSize: 12.5 }}>Select tokens on the map (click, Shift-click, or drag a box), then press F or use &quot;Start a fight with these&quot; in the Tokens tab. A fight started on the Combat page shows up here too.</p>}
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <div style={{ fontWeight: 700 }}>{fight.name}</div>
                    <div style={{ color: C.sun, fontSize: 13 }}>Round {fight.round}</div>
                  </div>
                  {isGm && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
                      <button type="button" disabled={fightBusy} onClick={() => void stepTurn(-1)} style={small} title="P">&larr; Previous (P)</button>
                      <button type="button" disabled={fightBusy} onClick={() => void stepTurn(1)} style={{ ...small, background: C.sun, color: "#1b1712", border: "none", fontWeight: 600 }} title="N">Next turn (N) &rarr;</button>
                      <button type="button" disabled={fightBusy} onClick={() => void rollMonsterInit()} style={small}>Roll monster initiative</button>
                      <button type="button" disabled={fightBusy} onClick={sortFight} style={small}>Sort by initiative</button>
                    </div>
                  )}
                  {!isGm && (() => {
                    const mineE = fight.order.find((e) => e.kind === "pc" && myChars.some((c) => c.character_id === e.characterId));
                    if (!mineE?.characterId) return null;
                    const selTok = selected.length === 1 ? selected[0] : null;
                    const preset = selTok ? fight.order.find((e) => e.tokenId === selTok && e.id !== mineE.id)?.id ?? "" : "";
                    const myTurnNow = isMyTurn(fight as unknown as Parameters<typeof isMyTurn>[0], mineE.characterId);
                    return (
                      <>
                      {(mineE.pendingSaves ?? []).length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <SaveBanner campaignId={campaignId} characterId={mineE.characterId} entry={mineE as unknown as FightEntry} onDone={() => { void loadFight(); send("combat", {}); }} />
                        </div>
                      )}
                      {mineE.lastSave && Date.now() / 1000 - mineE.lastSave.at < 600 && (
                        <p role="status" style={{ fontSize: 12.5, color: C.muted, margin: "10px 0 0" }}>
                          Last save: {mineE.lastSave.label} from {mineE.lastSave.by}{mineE.lastSave.total != null ? `, ${mineE.lastSave.total} vs DC ${mineE.lastSave.dc}` : ""}, {mineE.lastSave.saved ? "saved" : "failed"}{mineE.lastSave.damage ? `, ${mineE.lastSave.damage} damage` : ""}.
                        </p>
                      )}
                      <div style={{ marginTop: 12, padding: "8px 10px", border: `1px solid ${myTurnNow ? C.sun : C.line}`, borderRadius: 8 }}>
                        <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: myTurnNow ? C.sun : C.muted, marginBottom: 6 }}>{myTurnNow ? `Your turn: ${mineE.name} attacks` : `${mineE.name} attacks on their turn`}</div>
                        <AttackForm key={preset || "none"} campaignId={campaignId} characterId={mineE.characterId} presetTarget={preset}
                          fight={fight as unknown as Parameters<typeof AttackForm>[0]["fight"]}
                          onDone={() => { void loadFight(); send("combat", {}); }} />
                        <p style={{ fontSize: 11.5, color: C.muted, margin: "6px 0 0" }}>Select a monster&apos;s token to make it the target.</p>
                      </div>
                      </>
                    );
                  })()}
                  <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
                    {fight.order.map((e) => {
                      const mineEntry = e.kind === "pc" && myChars.some((c) => c.character_id === e.characterId);
                      const open = selEntry === e.id;
                      const frac = e.hp != null && e.maxHp ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : null;
                      return (
                        <div key={e.id} style={{ border: `1px solid ${e.is_turn ? C.sun : C.line}`, borderLeft: `4px solid ${e.is_turn ? C.sun : "transparent"}`, borderRadius: 8, padding: "7px 9px", opacity: e.defeated ? 0.55 : 1, background: e.is_turn ? "rgba(217,164,58,0.08)" : "transparent" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 28, textAlign: "center", fontWeight: 700, color: e.initiative == null ? C.muted : C.text }}>{e.initiative ?? "?"}</span>
                            <button type="button" onClick={() => { centreOnEntry(e); setSelEntry(open ? null : e.id); }} style={{ flex: 1, textAlign: "left", background: "none", border: "none", color: C.text, cursor: "pointer", padding: 0, fontSize: 13.5, fontWeight: e.is_turn ? 700 : 500, textDecoration: e.defeated ? "line-through" : "none" }}>
                              {e.name}{e.hidden ? " (hidden)" : ""}
                            </button>
                            {e.hp != null && <span style={{ fontSize: 12, color: C.muted }}>{e.hp}{e.maxHp ? `/${e.maxHp}` : ""}{e.tempHp ? ` +${e.tempHp}` : ""}</span>}
                            {isGm && e.ac != null && <span style={{ fontSize: 11.5, color: C.muted }}>AC {e.ac}</span>}
                          </div>
                          {frac != null && <div style={{ height: 4, background: "#2a241d", borderRadius: 2, marginTop: 5 }}><div style={{ width: `${frac * 100}%`, height: 4, borderRadius: 2, background: frac > 0.5 ? "#5fae5a" : frac > 0.25 ? "#d9a43a" : "#d0463c" }} /></div>}
                          {(e.conditions ?? []).length > 0 && <div style={{ marginTop: 5 }}><MarkerChips list={e.conditions ?? []} /></div>}
                          {!isGm && e.awaitingSave && !mineEntry && <div style={{ fontSize: 11, color: "#e07a70", marginTop: 4 }}>saving throw due</div>}
                          {isGm && (e.pendingSaves ?? []).map((ps) => (
                            <div key={ps.id} style={{ marginTop: 6, padding: "5px 7px", border: "1px solid #e07a70", borderRadius: 6, fontSize: 12 }}>
                              <div>{ps.ability.toUpperCase()} save DC {ps.dc} vs {ps.by}&apos;s {ps.label}{ps.damage ? `: ${ps.damage}${ps.half ? ", half on a success" : ""}` : ""}{e.kind === "pc" ? " (waiting for the player)" : ""}</div>
                              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                {([true, false] as const).map((ok) => (
                                  <button key={String(ok)} type="button" onClick={() => editEntry(e.id, (c) => {
                                    const dmg = ok ? (ps.half ? Math.floor(ps.damage / 2) : 0) : ps.damage;
                                    let y = (dmg > 0 ? applyDamage(c, dmg) : c) as TC & { pendingSaves?: PendingSave[] };
                                    if (!ok && ps.conditions?.length) y = { ...y, conditions: [...new Set([...y.conditions, ...ps.conditions])] };
                                    return { ...y, pendingSaves: (y.pendingSaves ?? []).filter((p) => p.id !== ps.id), lastSave: { label: ps.label, by: ps.by, total: null, dc: ps.dc, saved: ok, damage: dmg, at: Date.now() / 1000 } } as TC;
                                  })} style={{ ...small, padding: "2px 8px", color: ok ? "#8fd18a" : "#e07a70" }}>{ok ? "Saved" : "Failed"}</button>
                                ))}
                              </div>
                            </div>
                          ))}
                          {!isGm && open && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
                              <PlayerEntryControls fightId={fight.id} entry={{ ...e, mine: mineEntry } as FightEntry}
                                myTurn={isMyTurn(fight as unknown as Parameters<typeof isMyTurn>[0], myChars.find((c) => fight.order.some((x) => x.characterId === c.character_id))?.character_id ?? null)}
                                onChanged={() => { void loadFight(); send("combat", {}); }} />
                            </div>
                          )}
                          {!isGm && mineEntry && e.initiative == null && (
                            <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                              <label style={{ fontSize: 12, color: C.muted }} htmlFor={`ib-${e.id}`}>Bonus</label>
                              <input id={`ib-${e.id}`} value={initBonus} onChange={(ev) => setInitBonus(ev.target.value.replace(/[^0-9+-]/g, "").slice(0, 3))} style={{ ...field, width: 52, padding: "4px 6px" }} />
                              <button type="button" onClick={async () => { const b2 = parseInt(initBonus, 10) || 0; await rollInitiative(e, b2, true); await loadFight(); }} style={{ ...small, borderColor: C.sun, color: C.sun }}>Roll initiative</button>
                            </div>
                          )}
                          {isGm && open && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
                              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <input aria-label={`Amount for ${e.name}`} value={hpAmt} onChange={(ev) => setHpAmt(ev.target.value.replace(/[^0-9]/g, "").slice(0, 4))} placeholder="HP" style={{ ...field, width: 60, padding: "5px 6px" }} />
                                <button type="button" onClick={() => { const n2 = parseInt(hpAmt, 10); if (n2 > 0) { editEntry(e.id, (c) => applyDamage(c, n2) as TC); setHpAmt(""); } }} style={{ ...small, color: "#e07a70" }}>Damage</button>
                                <button type="button" onClick={() => { const n2 = parseInt(hpAmt, 10); if (n2 > 0) { editEntry(e.id, (c) => applyHealing(c, n2) as TC); setHpAmt(""); } }} style={{ ...small, color: "#8fd18a" }}>Heal</button>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 6 }}>
                                <label style={{ fontSize: 11.5, color: C.muted }}>Init<input aria-label={`Initiative for ${e.name}`} defaultValue={e.initiative ?? ""} key={`i${e.id}${e.initiative}`} onBlur={(ev) => { const v = ev.target.value.trim(); editEntry(e.id, (c) => ({ ...c, initiative: v === "" ? null : Number(v) || 0 })); }} style={{ ...field, padding: "4px 6px" }} /></label>
                                <label style={{ fontSize: 11.5, color: C.muted }}>Max HP<input aria-label={`Max HP for ${e.name}`} defaultValue={e.maxHp ?? ""} key={`m${e.id}${e.maxHp}`} onBlur={(ev) => { const v = parseInt(ev.target.value, 10); editEntry(e.id, (c) => ({ ...c, maxHp: Number.isFinite(v) ? v : null, hp: c.hp == null && Number.isFinite(v) ? v : c.hp })); }} style={{ ...field, padding: "4px 6px" }} /></label>
                                <label style={{ fontSize: 11.5, color: C.muted }}>Temp<input aria-label={`Temp HP for ${e.name}`} defaultValue={e.tempHp ?? 0} key={`t${e.id}${e.tempHp}`} onBlur={(ev) => { const v = parseInt(ev.target.value, 10); editEntry(e.id, (c) => ({ ...c, tempHp: Number.isFinite(v) ? Math.max(0, v) : 0 })); }} style={{ ...field, padding: "4px 6px" }} /></label>
                              </div>
                              <div style={{ marginTop: 4 }}>
                                <MarkerPicker current={e.conditions ?? []}
                                  onToggle={(cn, on) => editEntry(e.id, (c) => ({ ...c, conditions: on ? (c.conditions.includes(cn) ? c.conditions : [...c.conditions, cn]) : c.conditions.filter((x) => x !== cn) }))} />
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 8 }}>
                                <button type="button" onClick={() => editEntry(e.id, (c) => ({ ...c, defeated: !c.defeated }))} style={small}>{e.defeated ? "Not defeated" : "Defeated"}</button>
                                <button type="button" onClick={() => editEntry(e.id, (c) => ({ ...c, hidden: !c.hidden }))} style={small}>{e.hidden ? "Reveal" : "Hide"}</button>
                                <button type="button" onClick={() => { removeEntry(e.id); setSelEntry(null); }} style={{ ...small, color: "#e07a70" }}>Remove</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {isGm && <button type="button" onClick={() => void endFight()} style={{ ...small, width: "100%", marginTop: 14, color: "#e07a70" }}>End the fight</button>}
                  {!isGm && <p style={{ color: C.muted, fontSize: 11.5, marginTop: 10 }}>Click a name to change your own HP and conditions, or (on your turn) mark your effects on someone else. Monster HP stays with the GM. Your own initiative roll goes straight into the order.</p>}
                </>
              )}
              {chatErr && <p role="status" style={{ color: "#e07a70", fontSize: 12, marginTop: 10 }}>{chatErr}</p>}
            </div>
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
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div><label style={label} htmlFor="tt-bpat">Border</label>
                          <select id="tt-bpat" value={((sel[0].style?.border ?? {}) as Border).pattern ?? "solid"} onChange={(e) => void updateTokens([sel[0].id], { style: { ...sel[0].style, border: { ...((sel[0].style?.border ?? {}) as Border), pattern: e.target.value as Border["pattern"] } } })} style={field}>
                            <option value="solid">Solid</option><option value="double">Double</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
                          </select></div>
                        <div><label style={label} htmlFor="tt-bw">Thickness</label>
                          <select id="tt-bw" value={((sel[0].style?.border ?? {}) as Border).width ?? "normal"} onChange={(e) => void updateTokens([sel[0].id], { style: { ...sel[0].style, border: { ...((sel[0].style?.border ?? {}) as Border), width: e.target.value as Border["width"] } } })} style={field}>
                            <option value="thin">Thin</option><option value="normal">Normal</option><option value="thick">Thick</option>
                          </select></div>
                      </div>
                      <label style={label}>Auras (from the token&apos;s edge)</label>
                      {[0, 1].map((i) => {
                        const auras = (Array.isArray(sel[0].style?.auras) ? (sel[0].style.auras as Aura[]) : []).slice(0, 2);
                        const a = auras[i] ?? { ft: 0, color: i === 0 ? "#f0c040" : "#60a0ff", players: true };
                        const setA = (patch: Partial<Aura>) => {
                          const next = [auras[0] ?? { ft: 0, color: "#f0c040", players: true }, auras[1] ?? { ft: 0, color: "#60a0ff", players: true }];
                          next[i] = { ...a, ...patch };
                          void updateTokens([sel[0].id], { style: { ...sel[0].style, auras: next.filter((x) => x.ft > 0) } });
                        };
                        return (
                          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                            <input aria-label={`Aura ${i + 1} radius in feet`} type="number" min={0} max={300} step={5} value={a.ft || ""} placeholder="ft"
                              onChange={(e) => setA({ ft: Math.max(0, Math.min(300, Number(e.target.value) || 0)) })} style={{ ...field, width: 70 }} />
                            <input aria-label={`Aura ${i + 1} colour`} type="color" value={a.color} onChange={(e) => setA({ color: e.target.value })} style={{ width: 34, height: 30, padding: 0, border: "none", background: "transparent" }} />
                            <label style={{ display: "flex", gap: 5, fontSize: 12, alignItems: "center" }}><input type="checkbox" checked={a.players} onChange={(e) => setA({ players: e.target.checked })} style={{ accentColor: C.sun }} />Players see it</label>
                          </div>
                        );
                      })}
                      <label style={label}>Image</label>
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f, (url) => void updateTokens([sel[0].id], { image_url: url })); }} style={{ fontSize: 12, color: C.muted }} />
                      <label style={label} htmlFor="tt-ctrl">Also controlled by</label>
                      <select id="tt-ctrl" multiple value={sel[0].controlled_by ?? []} onChange={(e) => void updateTokens([sel[0].id], { controlled_by: [...e.target.selectedOptions].map((o) => o.value) })} style={{ ...field, height: 72 }}>
                        {party.filter((p) => p.character_id).map((p) => <option key={p.character_id!} value={p.profile_id}>{p.name}</option>)}
                      </select>
                    </>
                  )}
                  <button type="button" disabled={fightBusy} onClick={() => void addToFight(sel.map((t) => t.id))} style={{ ...small, width: "100%", marginTop: 10, borderColor: C.sun, color: C.sun }}>
                    {fight ? "Add to the fight (F)" : "Start a fight with these (F)"}
                  </button>
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
                  <label style={label} htmlFor="tt-lib">From the monster library</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input id="tt-lib" value={libQuery} onChange={(e) => setLibQuery(e.target.value.slice(0, 60))} placeholder="Search, e.g. ogre" style={{ ...field, flex: 1 }} />
                    <select aria-label="Rules edition" value={libEdition} onChange={(e) => setLibEdition(e.target.value as "2014" | "2024")} style={{ ...field, width: 74 }}>
                      <option value="2024">2024</option><option value="2014">2014</option>
                    </select>
                  </div>
                  {libHits.length > 0 && (
                    <div style={{ maxHeight: 180, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 7, marginTop: 6 }}>
                      {libHits.map((m, i) => (
                        <button key={`${m.name}-${m.source_key ?? ""}-${i}`} type="button"
                          onClick={() => { setTName(m.name); setTSize(sizeFromText(m.size ?? null)); setTKind("monster"); setTStats({ hp: typeof m.hp === "number" ? m.hp : null, ac: typeof m.ac === "number" ? m.ac : null }); setLibQuery(""); }}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", background: "transparent", color: C.text, border: "none", borderBottom: `1px solid ${C.line}`, fontSize: 12.5, cursor: "pointer" }}>
                          {m.name} <span style={{ color: C.muted }}>· CR {String(m.cr ?? "?")} · {m.size ?? "?"}{m.source_key ? ` · ${monsterSourceLabel(m.source_key)}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {libQuery.trim().length >= 2 && libHits.length === 0 && <p style={{ color: C.muted, fontSize: 12, margin: "6px 0 0" }}>No monster by that name in the {libEdition} library.</p>}
                  {blocks.length > 0 && (
                    <>
                      <label style={label} htmlFor="tt-block">From your stat blocks</label>
                      <select id="tt-block" value="" onChange={(e) => { const b = blocks.find((x) => x.id === e.target.value); if (b) { setTName(b.name); setTSize(sizeFromText(b.size)); setTKind("monster"); setTStats(null); } }} style={field}>
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
                  {tStats && <p style={{ color: C.muted, fontSize: 11.5, margin: "6px 0 0" }}>From the library: {tStats.hp ?? "?"} HP, AC {tStats.ac ?? "?"} (kept with the token for the HP bars coming next).</p>}
                  <button type="button" disabled={!tName.trim() || uploading} onClick={() => void addToken({ name: tName.trim(), size: tSize, kind: tKind, image_url: tImage || null, hidden: tHidden, style: tStats ? { stats: tStats } : {} }, tCount)}
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
