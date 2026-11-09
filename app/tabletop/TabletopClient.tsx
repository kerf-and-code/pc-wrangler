"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import { renderClassic, layoutBare } from "@/lib/dungeon/classic";
import { normalizeLevels, CELL_TYPES } from "@/lib/dungeon/render";
import { normCustom, normDoors, normElements, normBattleMeta, normSightWalls, piecesOverImage } from "@/lib/dungeon/battle";
import {
  snapToken, snapCenter, measure, fitCamera, zoomAt, centerOn, toWorld, parseChat, DIAGONAL_RULES,
  templateCells, templateOutline, insideTemplate, snapOrigin, snapAngle, TEMPLATE_SHAPES,
  type Camera, type Pt, type DiagonalRule, type TemplateGeom, type TemplateShape,
} from "@/lib/tabletop/geometry";
import { loadSrd } from "@/lib/srd/srd";
import { sortForTurns, applyDamage, applyHealing, combatantId, pcCombatant, type Combatant, type Econ } from "@/lib/combat";
import { monsterSourceLabel } from "@/lib/monster-sources";
import {
  decodeFog, encodeFog, isRevealed, setSquares, fillFog, brushCells, roomsOf, roomCells, doorAt, edgeSegment,
  doorsAsDrawn, PLAYER_DOORS, type MapShape,
} from "@/lib/tabletop/fog";
import { drawElement, type DoorKind, type MapElement } from "@/lib/dungeon/classic";
import {
  wallSegments, sightWallSegs, visibility, moveStop, seenSquares, canSeeLit, seesPoint, lightOf, darkvisionOf, lightModeOf,
  LIGHT_MODES, LIGHT_PRESETS, DARKVISION_FT, CANOPY_KINDS, type Seg, type Light, type Viewer, type LightMode,
} from "@/lib/tabletop/sight";
import { econOf, speedNow, cantAct, FRESH_ECON } from "@/lib/combat-effects";
import { drawMarkerRing, formatMarker, markerText, tokenMarkers, type TokenMarker } from "@/lib/tabletop/markers";
import { MarkerStylePicker, TokenMarkerPicker, useMarkerStyle } from "@/components/marker-icon";
import { drawFrame, frameMoves, normFrame, tracePath, type Frame } from "@/lib/tabletop/frames";
import TokenMaker, { type TokenMakerResult } from "@/components/token-maker";
import { openTabletop } from "@/lib/tabletop/open";
import MapUpload from "@/components/map-upload";
import { EFFECTS, drawEffect, isEffect, seedOf, type EffectKind } from "@/lib/tabletop/effects";
import HandoutView, { type Handout } from "@/components/handout-view";
import RollTablesPanel from "@/components/roll-tables-panel";
import TableSound, { useTableAudio } from "@/components/table-sound";
import SoundPanel from "@/components/sound-panel";
import { encodeDifficult, normDifficult, paintDifficult, pathExtra } from "@/lib/tabletop/terrain";
import { AttackForm, EconomyBar, MarkerChips, MarkerPicker, PlayerEntryControls, SaveBanner, TurnUsed, isMyTurn, type FightEntry, type PendingSave } from "@/components/fight-controls";

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
// Phase 4c: action economy (p112). A player's Turns tab shows what is left of their turn (action, bonus
//          action, reaction, movement, attacks left) and spends it; attacks and save effects say what
//          they use. In a fight a player's token moves only on its turn and only as far as its movement
//          left (checked in tabletop_move_token). The GM sees and toggles what each creature has used.
// Phase 4d: drawing and text on the table (D), a dry-erase board everyone uses (p113): pen, line, box,
//          ellipse and text; each person erases their own, the GM anything, and the GM can draw on a
//          GM-only layer players never receive. Handouts are wiki entries the GM shows from the table
//          (Handouts tab): they pop up for the players they are shown to and stay in their Codex.
//          Shift + double-click a token opens its sheet. The GM can upload a map image from a module,
//          line its grid up with the table's, and put it on the table as a scene (components/map-upload).
// Phase 4e: animated effects (fire, cold, acid, lightning, poison, darkness, fog, radiant, necrotic)
//          fill an area template or surround a token; anyone places them and removes their own (p114,
//          lib/tabletop/effects.ts). A split party: the GM sends players to different scenes and views
//          any scene without moving anyone; each player gets only their own scene. Touch: one finger
//          moves tokens or pans, two fingers pinch to zoom, a long press pings; the side panel folds
//          away on a small screen.
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
type Scene = { id: string; name: string; battle_map_id: string; level: number; settings: { show_labels?: boolean; diagonal?: DiagonalRule; los?: boolean; light?: LightMode; difficult?: number[] } };
type State = {
  role: "gm" | "player"; me: string; campaign: { id: string; name: string; gm_id: string }; session_id: string | null;
  scene: Scene | null; map: MapJson | null; tokens: Token[]; party: PartyMember[];
  scenes: { id: string; name: string; battle_map_id: string; level: number; is_active: boolean }[];
  placements?: { profile_id: string; scene_id: string }[];
  battle_maps: { id: string; name: string; kind: string; levelNames: string[] | null }[];
};
type RollDie = { sides: number; value: number; kept: boolean };
type Message = {
  id: string; session_id: string | null; author_profile: string; as_name: string | null; character_id: string | null;
  kind: "say" | "emote" | "whisper" | "roll" | "system"; body: string; whisper_to: string[] | null; gm_only: boolean; created_at: string;
  roll: { label?: string; notation?: string; total?: number; dice?: RollDie[]; natural?: number | null; logged?: boolean; table?: { id?: string; name: string; result: string; found?: boolean } } | null;
};
type OutsideRoll = { id: string; actor_name: string | null; character_id?: string | null; source: string; name: string | null; at: string;
  event_type?: string | null; applied_to?: string | null;
  rolls: { total?: number; dice?: { faces: number; results: number[] }[]; critical_success?: boolean | null; critical_failure?: boolean | null; damage_type?: string | null; discarded?: boolean } | null };
// Phase 5i: the chat shows one attack from D&D Beyond (its attack roll and every damage roll) as one card
type FeedRow = { key: string; msg?: Message; ext?: OutsideRoll; group?: OutsideRoll[] };
const GROUP_MS = 6000;
// Tiny 0.5, Small and Medium 1, Large 2, Huge 3, Gargantuan 4 squares
const sizeSquares = (size: string | null | undefined) => { const s = (size ?? "").toLowerCase(); return s.startsWith("tiny") ? 0.5 : s.startsWith("large") ? 2 : s.startsWith("huge") ? 3 : s.startsWith("garg") ? 4 : 1; };
type FeedItem = { t: number; key: string; msg?: Message; ext?: OutsideRoll };

type Tool = "select" | "ruler" | "template" | "hand" | "fog" | "draw" | "terrain";
type DrawKind = "pen" | "line" | "rect" | "ellipse" | "text" | "erase";
type Drawing = {
  id: string; scene_id: string; owner: string; layer: "table" | "gm"; kind: Exclude<DrawKind, "erase">;
  points: [number, number][]; color: string; width: number; fill: boolean; text: string | null; size: number;
};
const DRAW_COLORS = ["#e0703a", "#d9a43a", "#5fae5a", "#6fa3d8", "#b07ad8", "#e0e0e0", "#1b1712"];
const DRAW_WIDTHS: [string, number][] = [["Thin", 0.05], ["Medium", 0.1], ["Thick", 0.2]];
type FogMode = "reveal-room" | "hide-room" | "reveal-brush" | "hide-brush";
type Tpl = TemplateGeom & { id: string; owner: string; color: string; label: string | null; scene_id: string; effect?: string | null };
type TokenEffect = { id: string; scene_id: string; token_id: string; owner: string; kind: string; radius_ft: number };
type Aura = { ft: number; color: string; players: boolean };
type Border = { pattern?: "solid" | "double" | "dashed" | "dotted"; width?: "thin" | "normal" | "thick" };
type Trail = { from: Pt; to: Pt; color: string; born: number; feet: number };
type TC = Combatant & { tokenId?: string | null };
type FightRow = { id: string; name: string; round: number; turn: number; combatants: TC[]; session_id: string | null };
type Entry = { id: string; name: string; kind: "pc" | "monster"; initiative: number | null; defeated: boolean; is_turn: boolean; tokenId?: string | null;
  characterId?: string | null; hp?: number | null; maxHp?: number | null; tempHp?: number; conditions?: string[]; ac?: number | null; hidden?: boolean; initBonus?: number; mine?: boolean;
  pendingSaves?: PendingSave[]; awaitingSave?: boolean;
  lastSave?: { label: string; by: string; total: number | null; dc: number; saved: boolean; damage: number; at: number } | null;
  econ?: Econ | null; speed?: number | null; speedNow?: number | null; attacksPerAction?: number; cantAct?: string | null;
  turnUsed?: { action: boolean; bonus: boolean; moved: number } | null };
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
  // phase 5s: what the table hears (music and ambient loops), followed live by every browser here
  const tableAudio = useTableAudio(campaignId, supabase);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [panel, setPanel] = useState<"chat" | "turns" | "tokens" | "scenes" | "handouts" | "tables" | "sound">("chat");
  const [fight, setFight] = useState<Fight | null>(null);
  const fightRow = useRef<FightRow | null>(null);
  const fightRef = useRef<Fight | null>(null);
  const [selEntry, setSelEntry] = useState<string | null>(null);
  // phase 5i: the target picked on each D&D Beyond attack card, and what applying it did
  const [applyTo, setApplyTo] = useState<Record<string, string>>({});
  const [applyNote, setApplyNote] = useState<Record<string, { text: string; bad: boolean }>>({});
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
  // phase 5u: difficult terrain (the scene's settings.difficult), and the GM's terrain brush
  const [terrainMode, setTerrainMode] = useState<"paint" | "erase">("paint");
  const [terrainBrush, setTerrainBrush] = useState(1);
  const difficultRef = useRef<Set<number>>(new Set());
  const terrainPaint = useRef<{ on: boolean } | null>(null);
  const [fogOnUi, setFogOnUi] = useState(false);
  const [selDoors, setSelDoors] = useState<string[]>([]);
  const [selTpl, setSelTpl] = useState<string | null>(null);
  const [tplShape, setTplShape] = useState<TemplateShape>("circle");
  const [tplSize, setTplSize] = useState("");
  const [tplColor, setTplColor] = useState("#e0703a");
  const [tplLinger, setTplLinger] = useState(true);
  const [drawKind, setDrawKind] = useState<DrawKind>("pen");
  const [drawColor, setDrawColor] = useState("#e0703a");
  const [drawWidth, setDrawWidth] = useState(0.1);
  const [drawFill, setDrawFill] = useState(false);
  const [drawGm, setDrawGm] = useState(false);
  const [drawText, setDrawText] = useState("");
  const [handouts, setHandouts] = useState<Handout[]>([]);
  const [openHandout, setOpenHandout] = useState<Handout | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [hoEntries, setHoEntries] = useState<{ id: string; title: string; type: string; visibility: string }[] | null>(null);
  const [hoQuery, setHoQuery] = useState("");
  const [hoPick, setHoPick] = useState("");
  const [hoTo, setHoTo] = useState<string[] | null>(null);       // character ids, or null for everyone
  const [hoBusy, setHoBusy] = useState(false);
  const [tplEffect, setTplEffect] = useState<EffectKind | "">("");
  const [fxKind, setFxKind] = useState<EffectKind>("fire");
  const [fxRadius, setFxRadius] = useState(0);
  const [sendPick, setSendPick] = useState<{ scene: string; who: string[] } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [narrow, setNarrow] = useState(false);

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
  const drawingsRef = useRef<Map<string, Drawing>>(new Map());
  const effectsRef = useRef<Map<string, TokenEffect>>(new Map());
  const reducedMotion = useRef(false);
  // coloured or black-and-white marker icons on tokens and in the panels, chosen per viewer
  const [markerStyle, setMarkerStyle] = useMarkerStyle();
  const markerStyleRef = useRef(markerStyle);
  markerStyleRef.current = markerStyle;
  // the marker picker for the selected token (status markers kept on the token, beside the fight's conditions)
  const [markerOpen, setMarkerOpen] = useState(false);
  const [markerBusy, setMarkerBusy] = useState(false);
  // the token maker, open for one token (picture, shape, border, animated frame)
  const [makerFor, setMakerFor] = useState<string | null>(null);
  // Phase 5o: darkvision read off each character's saved sheet (characters.build.sheetSnapshot, written
  // by the Forge on save). A darkvision the GM sets on the token itself wins over it.
  const sheetDv = useRef<Map<string, number>>(new Map());
  const tokenDv = (t: Token) => darkvisionOf(t.style) || (t.character_id ? sheetDv.current.get(t.character_id) ?? 0 : 0);
  const touches = useRef<Map<number, Pt>>(new Map());
  const pinch = useRef<{ d: number; mid: Pt } | null>(null);
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout>; at: Pt; fired: boolean } | null>(null);
  const drawPreview = useRef<{ kind: Exclude<DrawKind, "erase" | "text">; points: [number, number][]; color: string; width: number; fill: boolean; layer: "table" | "gm" } | null>(null);
  const onHandoutRef = useRef<(p: { id: string; characters: string[] | null }) => void>(() => {});
  const loadHandoutsRef = useRef<() => Promise<unknown>>(async () => {});
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
  // polys: each viewer's line of sight; seers and lights add the scene's light (Phase 5k)
  const sight = useRef<{ key: string; polys: { x: number; y: number }[][]; viewers: number; seers: Viewer[]; lights: Light[]; mode: LightMode }>({ key: "", polys: [], viewers: 0, seers: [], lights: [], mode: "bright" });
  const lightPolys = useRef<{ sig: string; at: Map<string, { x: number; y: number }[]> }>({ sig: "", at: new Map() });
  const dimLayer = useRef<HTMLCanvasElement | null>(null);
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
  useEffect(() => { requestDraw(); }, [markerStyle, requestDraw]);

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
    const piecesInPaint = !!overlay && !!ov && !piecesOverImage(ov);
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
      topGrid: meta.topGrid.show ? meta.topGrid.opacity : null, overlay, piecesHidden: piecesInPaint, bare: true,
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
  // the scene's walls as segments (map walls, closed doors, sight walls), shared by sight and movement
  const wallSegsNow = (): Seg[] | null => {
    const m = stateRef.current?.map; if (!m) return null;
    const sh = shapeOf(); if (!sh) return null;
    const n = m.n > 0 ? m.n : 25;
    if (!segsCache.current || segsCache.current.sig !== mapSig.current) segsCache.current = { sig: mapSig.current, segs: wallSegments(sh.shape, m.door_state ?? {}, sightWallSegs(normSightWalls(m.meta?.sightWalls, n))) };
    return segsCache.current.segs;
  };
  const updateSight = (): void => {
    const st = stateRef.current, m = st?.map;
    if (!st || !m || !losOn()) { sight.current = { key: "", polys: [], viewers: 0, seers: [], lights: [], mode: "bright" }; return; }
    const n = m.n > 0 ? m.n : 25, gm = st.role === "gm", feet = m.feet_per_square > 0 ? m.feet_per_square : 5;
    const mode = lightModeOf(st.scene?.settings?.light);
    const onMap = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x < n && p.y < n;
    const lookers = [...tokensRef.current.values()].filter((t) => (gm ? selRef.current.includes(t.id) : t.mine) && !t.hidden && t.layer !== "gm")
      .map((t) => ({ ...shownPos(t), dv: tokenDv(t) > 0 ? t.size / 2 + tokenDv(t) / feet : 0 })).filter(onMap);
    // light sources: any token on the map carrying one (a player only has the tokens they are sent)
    const sources = mode === "bright" ? [] : [...tokensRef.current.values()].filter((t) => t.layer !== "gm" || gm).flatMap((t) => {
      const l = lightOf(t.style); if (!l) return [];
      const p = shownPos(t); if (!onMap(p)) return [];
      return [{ x: p.x, y: p.y, bright: l.bright > 0 ? t.size / 2 + l.bright / feet : 0, r: t.size / 2 + (l.bright + l.dim) / feet }];
    });
    const key = mapSig.current + "|" + mode + "|" + lookers.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.dv}`).join(";")
      + "|" + sources.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.r}`).join(";");
    if (key === sight.current.key) return;
    const sh = shapeOf(); if (!sh) return;
    const segs = wallSegsNow() ?? [];
    const polys = lookers.map((p) => visibility(p, segs));
    // a light's polygon only changes when it moves or the walls do
    if (lightPolys.current.sig !== mapSig.current) lightPolys.current = { sig: mapSig.current, at: new Map() };
    const lights: Light[] = sources.map((s0) => {
      const k = `${s0.x.toFixed(2)},${s0.y.toFixed(2)}`;
      let poly = lightPolys.current.at.get(k);
      if (!poly) { poly = visibility(s0, segs); if (lightPolys.current.at.size > 400) lightPolys.current.at.clear(); lightPolys.current.at.set(k, poly); }
      return { ...s0, poly };
    });
    const seers: Viewer[] = lookers.map((p, i) => ({ x: p.x, y: p.y, dv: p.dv, poly: polys[i] }));
    sight.current = { key, polys, viewers: lookers.length, seers, lights, mode };
    if (gm || !st.scene) return;
    // remember what this player has seen, per scene, in this browser
    let ex = explored.current;
    if (!ex || ex.scene !== st.scene.id) {
      let bits: Uint8Array = new Uint8Array(Math.ceil((n * n) / 8));
      try { const raw = window.localStorage.getItem(`sixaxes:explored:${st.scene.id}:${st.me}`); if (raw) bits = decodeFog(raw, n); } catch { /* storage unavailable: memory lasts for this visit */ }
      ex = explored.current = { scene: st.scene.id, bits, canvas: null, dirty: true, savedAt: 0 };
    }
    const fresh: number[] = [];
    // in the dark only what was actually seen (lit, or within darkvision) is remembered
    for (const v of seers) for (const i of seenSquares(sh.shape, v.poly)) {
      if (isRevealed(ex.bits, n, i % n, (i / n) | 0)) continue;
      if (mode === "dark" && !seesPoint(v, lights, mode, (i % n) + 0.5, ((i / n) | 0) + 0.5)) continue;
      fresh.push(i);
    }
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
    // effects filling area templates, inside the template's outline
    const fxTime = reducedMotion.current ? 0 : now / 1000;
    for (const t of templatesRef.current.values()) {
      if (!isEffect(t.effect)) continue;
      const d = tplDrag.current && tplDrag.current.id === t.id ? tplDrag.current.now : null;
      const pts = templateOutline(d ? { ...t, x: d.x, y: d.y } : t, fps).map((q) => ({ x: q.x * cell, y: q.y * cell }));
      if (pts.length < 3) continue;
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y), x0 = Math.min(...xs), y0 = Math.min(...ys);
      drawEffect(ctx, t.effect, { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0,
        path: (c) => { c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); } }, fxTime, seedOf(t.id), cell);
      if (!reducedMotion.current) animating = true;
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

    // drawings and text, a dry-erase layer over the map (the GM's own layer drawn dashed and fainter)
    const drawOne = (d: Pick<Drawing, "kind" | "points" | "color" | "width" | "fill" | "text" | "size" | "layer">) => {
      const pts = d.points; if (!pts.length) return;
      ctx.save();
      if (d.layer === "gm") { ctx.globalAlpha = 0.6; ctx.setLineDash([8 / cam.s, 5 / cam.s]); }
      ctx.strokeStyle = d.color; ctx.lineWidth = Math.max(1, d.width * cell); ctx.lineCap = "round"; ctx.lineJoin = "round";
      if (d.kind === "text") {
        const fs = Math.max(6, d.size * cell);
        ctx.font = `700 ${fs}px system-ui, sans-serif`; ctx.textBaseline = "alphabetic"; ctx.setLineDash([]);
        ctx.lineWidth = Math.max(2, fs * 0.16); ctx.strokeStyle = "rgba(15,12,9,0.85)"; ctx.strokeText(d.text ?? "", pts[0][0] * cell, pts[0][1] * cell);
        ctx.fillStyle = d.color; ctx.fillText(d.text ?? "", pts[0][0] * cell, pts[0][1] * cell);
      } else if (d.kind === "pen" || d.kind === "line") {
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * cell, y * cell) : ctx.moveTo(x * cell, y * cell)));
        if (pts.length === 1) ctx.lineTo(pts[0][0] * cell + 0.01, pts[0][1] * cell);
        ctx.stroke();
      } else if (pts.length >= 2) {
        const [a, b] = [pts[0], pts[pts.length - 1]];
        const x0 = Math.min(a[0], b[0]) * cell, y0 = Math.min(a[1], b[1]) * cell, w = Math.abs(b[0] - a[0]) * cell, h = Math.abs(b[1] - a[1]) * cell;
        ctx.beginPath();
        if (d.kind === "rect") ctx.rect(x0, y0, w, h); else ctx.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (d.fill) { ctx.fillStyle = hexA(d.color, 0.2); ctx.fill(); }
        ctx.stroke();
      }
      ctx.restore();
    };
    for (const d of drawingsRef.current.values()) drawOne(d);
    if (drawPreview.current) drawOne({ ...drawPreview.current, text: null, size: 0.6 });

    // line of sight: which tokens this player can see right now (their own always)
    updateSight();
    const lineOfSight = losOn() && stateRef.current?.role !== "gm";
    if (lineOfSight) {
      const vis = new Set<string>();
      const sc = sight.current;
      for (const t of tokensRef.current.values()) { const p = shownPos(t); if (t.mine || canSeeLit(sc.seers, sc.lights, sc.mode, p.x, p.y, t.size / 2)) vis.add(t.id); }
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

    // phase 5u: difficult terrain, hatched, under the fog (players see it only where the fog is lifted)
    if (difficultRef.current.size && n) {
      ctx.save(); ctx.beginPath();
      for (const i of difficultRef.current) ctx.rect((i % n) * cell, Math.floor(i / n) * cell, cell, cell);
      ctx.clip();
      ctx.fillStyle = "rgba(150,100,45,0.2)"; ctx.fillRect(0, 0, n * cell, n * cell);
      ctx.strokeStyle = "rgba(235,175,95,0.6)"; ctx.lineWidth = Math.max(1, cell * 0.05);
      ctx.beginPath();
      for (let d = -n * cell; d < n * cell; d += cell / 3) { ctx.moveTo(d, 0); ctx.lineTo(d + n * cell, n * cell); }
      ctx.stroke(); ctx.restore();
    }
    if (tool === "terrain" && hoverSq.current && n) {
      const h = Math.floor(terrainBrush / 2), c0 = Math.floor(hoverSq.current.x) - h, r0 = Math.floor(hoverSq.current.y) - h;
      ctx.save(); ctx.strokeStyle = terrainMode === "paint" ? "#ebaf5f" : "#e07a70"; ctx.lineWidth = Math.max(1.5, 2 / cam.s); ctx.setLineDash([5 / cam.s, 4 / cam.s]);
      ctx.strokeRect(c0 * cell, r0 * cell, terrainBrush * cell, terrainBrush * cell); ctx.restore();
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
      const fr = normFrame(t.style?.frame);
      if (fr) tracePath(ctx, fr.shape, rad); else { ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); }
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
      if (fr) {
        // a frame from the token maker replaces the ring; drawn live so its animation plays
        drawFrame(ctx, fr, rad, reducedMotion.current ? 0 : now / 1000, (url) => {
          const fi = imgs.current.get(url);
          if (!fi) { loadImage(url); return null; }
          return typeof fi === "string" ? null : fi;
        });
        if (frameMoves(fr) && !reducedMotion.current) animating = true;
        if (t.hidden || t.layer === "gm") { ctx.setLineDash([cell * 0.15, cell * 0.1]); ctx.lineWidth = 2; ctx.strokeStyle = "#f2e6c9"; tracePath(ctx, fr.shape, rad); ctx.stroke(); }
        ctx.restore();
      } else {
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
      }
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
      const marks: TokenMarker[] = [...conds.map((c) => ({ id: c, n: null })), ...tokenMarkers(t.style).filter((m) => !conds.includes(m.id))];
      if (marks.length) drawMarkerRing(ctx, marks, cx, cy, rad, Math.max(7, cell * 0.16), markerStyleRef.current);
      if (sel.has(t.id)) {
        ctx.save(); ctx.lineWidth = Math.max(2, 3 / cam.s); ctx.strokeStyle = SELECT; ctx.setLineDash([6 / cam.s, 4 / cam.s]);
        ctx.beginPath(); ctx.arc(cx, cy, rad + Math.max(4, cell * 0.12), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      if (sel.has(t.id) || hover.current === t.id) {
        const fs = Math.max(11, 13 / cam.s);
        ctx.save(); ctx.font = `600 ${fs}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "top";
        const label = (t.hidden ? `${t.name} (hidden)` : t.name) + (marks.length ? `: ${marks.map(markerText).join(", ")}` : ""), w = ctx.measureText(label).width + fs;
        ctx.fillStyle = "rgba(20,16,12,0.85)"; ctx.fillRect(cx - w / 2, cy + rad + 4 / cam.s, w, fs * 1.5);
        ctx.fillStyle = "#f2e6c9"; ctx.fillText(label, cx, cy + rad + 4 / cam.s + fs * 0.25); ctx.restore();
      }
    }

    // effects on or around tokens, over them (a burning creature, a cloud of darkness around one)
    for (const f of effectsRef.current.values()) {
      const t = tokensRef.current.get(f.token_id);
      if (!t || !shownToMe(t) || !isEffect(f.kind)) continue;
      const p = shownPos(t), r = ((t.size / 2) * (f.radius_ft > 0 ? 1 : 1.05) + (f.radius_ft > 0 ? f.radius_ft / fps : 0)) * cell;
      const cx = p.x * cell, cy = p.y * cell;
      drawEffect(ctx, f.kind, { x: cx - r, y: cy - r, w: r * 2, h: r * 2, path: (c) => { c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); } }, fxTime, seedOf(f.id), cell);
      if (!reducedMotion.current) animating = true;
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
    // light (Phase 5k): in a dim or dark scene, a shade over the map with each light's area cut out of
    // it (fully in its bright radius, half in its dim ring). Players see it under their darkness; the GM
    // sees a lighter version, so the lights they place show.
    const scLight = sight.current;
    if (losOn() && n && scLight.mode !== "bright") {
      const W = cv.width, H = cv.height;
      const ml = dimLayer.current ?? document.createElement("canvas");
      if (ml.width !== W || ml.height !== H) { ml.width = W; ml.height = H; }
      dimLayer.current = ml;
      const g = ml.getContext("2d");
      if (g) {
        const gmView = stateRef.current?.role === "gm";
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
        g.clearRect(0, 0, W, H);
        g.fillStyle = `rgba(6,8,18,${(scLight.mode === "dark" ? 0.55 : 0.4) * (gmView ? 0.6 : 1)})`; g.fillRect(0, 0, W, H);
        g.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.ox, dpr * cam.oy);
        g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000";
        for (const L of scLight.lights) {
          if (L.poly.length < 3) continue;
          g.save(); g.beginPath(); L.poly.forEach((q, i) => (i ? g.lineTo(q.x * cell, q.y * cell) : g.moveTo(q.x * cell, q.y * cell))); g.closePath(); g.clip();
          g.globalAlpha = 0.5; g.beginPath(); g.arc(L.x * cell, L.y * cell, L.r * cell, 0, Math.PI * 2); g.fill();
          if (L.bright > 0) { g.globalAlpha = 1; g.beginPath(); g.arc(L.x * cell, L.y * cell, L.bright * cell, 0, Math.PI * 2); g.fill(); }
          g.restore();
        }
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(ml, 0, 0); ctx.restore();
      }
    }
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
        const path = (poly: { x: number; y: number }[]) => { d.beginPath(); poly.forEach((q, i) => (i ? d.lineTo(q.x * cell, q.y * cell) : d.moveTo(q.x * cell, q.y * cell))); d.closePath(); };
        if (sight.current.mode !== "dark") {
          for (const poly of sight.current.polys) { if (poly.length < 3) continue; path(poly); d.fill(); d.stroke(); }
        } else {
          // in the dark: inside each viewer's sight, only their darkvision and the lit areas
          for (const v of sight.current.seers) {
            if (v.poly.length < 3) continue;
            d.save(); path(v.poly); d.clip();
            if (v.dv > 0) { d.beginPath(); d.arc(v.x * cell, v.y * cell, v.dv * cell, 0, Math.PI * 2); d.fill(); }
            for (const L of sight.current.lights) {
              if (L.poly.length < 3) continue;
              d.save(); path(L.poly); d.clip(); d.beginPath(); d.arc(L.x * cell, L.y * cell, L.r * cell, 0, Math.PI * 2); d.fill(); d.restore();
            }
            d.restore();
          }
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
      // phase 5u: what difficult terrain adds, leg by leg, as the move check counts it
      const xtra = difficultRef.current.size && n ? pathExtra(difficultRef.current, n, pts, (a, b) => measure([a, b], rule, fps).feet, fps) : 0;
      const fs = Math.max(12, 15 / cam.s), text = xtra ? `${d.feet + xtra} ft (${xtra} difficult)` : `${d.feet} ft`;
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

  // Darkvision off each character's saved sheet. Read when the table loads, and again (audit A8) when the
  // tab comes back into view and once a minute, so a sheet saved mid-session reaches the table without a
  // reload. Returns whether anything changed.
  const refreshSheetDv = useCallback(async (tokens: Token[]): Promise<boolean> => {
    const charIds = [...new Set(tokens.map((t) => t.character_id).filter(Boolean))] as string[];
    const dvs = new Map<string, number>();
    if (charIds.length) {
      const { data: cs, error: er } = await supabase.from("characters").select("id, snap:build->sheetSnapshot").in("id", charIds);
      if (er) return false;
      for (const c of (cs ?? []) as unknown as { id: string; snap: { darkvision?: number } | null }[]) {
        const dv = Math.min(600, Number(c.snap?.darkvision) || 0); if (dv > 0) dvs.set(c.id, dv);
      }
    }
    const prev = sheetDv.current;
    const same = prev.size === dvs.size && [...dvs].every(([k, v]) => prev.get(k) === v);
    sheetDv.current = dvs;
    return !same;
  }, [supabase]);
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== "visible") return;
      void refreshSheetDv([...tokensRef.current.values()]).then((changed) => { if (changed) { setTick((v) => v + 1); requestDraw(); } });
    };
    const timer = window.setInterval(again, 60_000);
    document.addEventListener("visibilitychange", again);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", again); };
  }, [refreshSheetDv, requestDraw]);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("tabletop_state", { p_campaign: campaignId });
    if (e) { setError(/not at this table/.test(e.message) ? "You are not at this table. Ask your GM to add your character to the campaign." : /not signed in/.test(e.message) ? "Sign in to join the table." : `Could not load the table: ${e.message}`); return; }
    const st = data as State;
    const prevMap = stateRef.current?.map?.id, prevScene = stateRef.current?.scene?.id;
    stateRef.current = st; setState(st); setError(null);
    difficultRef.current = normDifficult(st.scene?.settings?.difficult, st.map?.n ?? 0);
    applyTokens(st.tokens);
    // darkvision from the character sheets behind the tokens (a player can read only their own)
    await refreshSheetDv(st.tokens ?? []);
    templatesRef.current = new Map();
    if (st.scene) {
      const { data: tpls } = await supabase.from("vtt_templates").select("*").eq("scene_id", st.scene.id);
      for (const t of (tpls ?? []) as Tpl[]) templatesRef.current.set(t.id, t);
    }
    drawingsRef.current = new Map();
    if (st.scene) {
      const { data: drs } = await supabase.from("vtt_drawings").select("*").eq("scene_id", st.scene.id).order("created_at");
      for (const d of (drs ?? []) as Drawing[]) drawingsRef.current.set(d.id, d);
    }
    effectsRef.current = new Map();
    if (st.scene) {
      const { data: fx } = await supabase.from("vtt_effects").select("id, scene_id, token_id, owner, kind, radius_ft").eq("scene_id", st.scene.id);
      for (const f of (fx ?? []) as TokenEffect[]) effectsRef.current.set(f.id, f);
    }
    // fog: a GM in the middle of painting keeps their own copy until it has been saved
    const pendingFog = st.role === "gm" && (fogTimer.current !== null || Date.now() - fogEditedAt.current < 1500);
    if (!pendingFog) {
      fogOn.current = !!st.map?.fog?.on; setFogOnUi(fogOn.current);
      fogBits.current = decodeFog(st.map?.fog?.revealed, st.map?.n ?? 0);
    }
    const sig = st.map ? JSON.stringify([st.map.id, st.map.grid, st.map.custom, st.map.doors, st.map.door_state, st.map.walls, st.map.elements, st.map.meta?.overlay, st.map.meta?.sightWalls]) : "";
    const changed = sig !== mapSig.current;
    mapSig.current = sig;
    if (st.map?.id !== prevMap || st.scene?.id !== prevScene || !baseRef.current) { renderBase(); fitPending.current = true; }
    else if (changed) renderBase();
    rebuildFog(); requestDraw();
  }, [supabase, campaignId, applyTokens, renderBase, rebuildFog, requestDraw, refreshSheetDv]);

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

  // One attack from D&D Beyond arrives as several rows (the attack roll, then each damage roll), with
  // the same character, the same item name and moments apart: shown together as one card. A second
  // attack roll after damage starts a new card.
  const feedRows = useMemo<FeedRow[]>(() => {
    const out: FeedRow[] = [];
    type Open = FeedRow & { t: number; who: string };
    let last: Open | null = null;
    for (const f of feed) {
      if (!f.ext) { out.push({ key: f.key, msg: f.msg }); last = null; continue; }
      const who = f.ext.character_id || f.ext.actor_name || "";
      const g = last?.group;
      const joins = !!g && last!.who === who && (g[0].name ?? "") === (f.ext.name ?? "") && Math.abs(f.t - last!.t) <= GROUP_MS
        && !(f.ext.event_type === "to-hit" && g.some((x) => x.event_type === "damage"));
      if (joins) { g!.push(f.ext); last!.t = f.t; continue; }
      const row: Open = { key: f.key, ext: f.ext, group: [f.ext], t: f.t, who };
      out.push(row); last = row;
    }
    return out;
  }, [feed]);

  // Apply the damage an outside roll rolled to a creature in the fight (p117). The server reads the
  // logged rows, checks whose they are, the turn and (for a player) the hit, and applies them once.
  const applyOutside = async (key: string, ids: string[], target: string, half: boolean) => {
    const f = fightRef.current;
    if (!f || !target) return;
    const { data, error: er } = await supabase.rpc("combat_apply_outside_roll", { p_combat: f.id, p_target: target, p_events: ids, p_half: half });
    if (er) {
      setApplyNote((m) => ({ ...m, [key]: { text: /does not exist|schema cache/.test(er.message) ? "Damage from D&D Beyond needs migration p117 on the server." : er.message, bad: true } }));
      return;
    }
    const r = data as { target: string; damage: number; hit: boolean; attack: number | null; ac: number | null };
    const label = r.hit ? r.target : `missed ${r.target}`;
    setFeed((prev) => prev.map((fi) => (fi.ext && ids.includes(fi.ext.id) ? { ...fi, ext: { ...fi.ext, applied_to: label } } : fi)));
    setApplyNote((m) => ({ ...m, [key]: { text: r.hit ? `${r.damage} damage to ${r.target}.` : `${r.attack ?? "The attack"} misses ${r.target}.`, bad: false } }));
  };

  // A combatant with no token on this scene (made on the Combat page, or its token deleted): put one on
  // the table, sized from its stat block, and link it so the token shows its HP and its turn.
  const tokenForEntry = (e: Entry) => [...tokensRef.current.values()].find((x) => x.id === e.tokenId || (e.kind === "pc" && x.character_id === e.characterId)) ?? null;
  const addTokenFor = async (entries: Entry[]) => {
    const st = stateRef.current; if (!st?.scene) { setChatErr("Open a scene first: a token goes on the scene in front of you."); return; }
    const c = viewCentre();
    const rows = entries.map((e, i) => {
      const cb = fightRow.current?.combatants.find((x) => x.id === e.id);
      const size = sizeSquares(cb?.block?.size);
      const p = snapToken(c.x + (i % 4) * Math.max(1, size), c.y + Math.floor(i / 4) * Math.max(1, size), size);
      return { campaign_id: campaignId, scene_id: st.scene!.id, kind: e.kind === "pc" ? "pc" : "monster", character_id: e.kind === "pc" ? e.characterId ?? null : null,
        stat_block_id: null, name: e.name, image_url: null, x: p.x, y: p.y, size, rot: 0, layer: "token", hidden: !!e.hidden, controlled_by: [],
        style: e.kind === "pc" ? {} : { stats: { hp: cb?.maxHp ?? null, ac: cb?.ac ?? null } } };
    });
    const { data, error: er } = await supabase.from("vtt_tokens").insert(rows).select("*");
    if (er) { setChatErr(`Could not add the token: ${er.message}`); return; }
    const made = (data ?? []) as Token[];
    for (const t of made) tokensRef.current.set(t.id, { ...t, mine: true });
    // link each monster's token to its entry (a pc finds its token by character)
    const link = new Map(entries.map((e, i) => [e.id, made[i]?.id]).filter(([, id]) => !!id) as [string, string][]);
    if (link.size) await mutateFight((cb) => ({ ...cb, combatants: cb.combatants.map((x) => (link.has(x.id) ? { ...x, tokenId: link.get(x.id)! } : x)) }));
    setSelected(made.map((t) => t.id)); requestDraw();
  };

  // ---- the fight ----
  const toFight = (row: FightRow): Fight => ({
    id: row.id, name: row.name, round: row.round,
    order: row.combatants.map((c, i) => ({ id: c.id, name: c.name, kind: c.kind, initiative: c.initiative, defeated: c.defeated, is_turn: i === row.turn,
      tokenId: c.tokenId ?? null, characterId: c.characterId ?? null, hp: c.hp, maxHp: c.maxHp, tempHp: c.tempHp, conditions: c.conditions, ac: c.ac, hidden: c.hidden, initBonus: c.initBonus,
      pendingSaves: ((c as TC & { pendingSaves?: PendingSave[] }).pendingSaves ?? []),
      econ: econOf(c), speed: c.speed ?? null, speedNow: speedNow(c.speed, c.conditions), attacksPerAction: c.attacksPerAction ?? 1, cantAct: cantAct(c.conditions) })),
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
      const { data: saved, error: e2 } = await supabase.from("combats").update({ round: next.round, turn: next.turn, combatants: next.combatants, updated_at: new Date().toISOString() }).eq("id", cur.id).select(FIGHT_COLS).maybeSingle();
      if (e2) { setChatErr(`Could not save the fight: ${e2.message}`); return; }
      const shown = (saved as FightRow | null) ?? next;   // as saved: the database starts a fresh turn when the turn moves
      fightRow.current = shown; setFight(toFight(shown)); send("combat", {}); requestDraw();
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
          && !(canSeeLit(sight.current.seers, sight.current.lights, sight.current.mode, f.x, f.y, t.size / 2) && canSeeLit(sight.current.seers, sight.current.lights, sight.current.mode, to.x, to.y, t.size / 2));
        if (!t.hidden && t.layer !== "gm" && !losHides) trails.current.push({ from: f, to, color: hueOf(owner ?? st.campaign.gm_id), born: performance.now(), feet: measure([f, to], st.scene.settings?.diagonal ?? "five", st.map?.feet_per_square ?? 5).feet });
      }
      remoteDrag.current.delete(t.id);
      tokensRef.current.set(t.id, t);
      if (st.role !== "gm" && (t.hidden || t.layer === "gm" || (!t.mine && fogHides(t)))) tokensRef.current.delete(t.id);
      requestDraw();
    };
    const upsertDrawing = (row: Drawing) => {
      const st = stateRef.current; if (!st?.scene || row.scene_id !== st.scene.id) return;
      drawingsRef.current.set(row.id, row); requestDraw();
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
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "vtt_drawings", filter: `campaign_id=eq.${campaignId}` }, (p) => upsertDrawing(p.new as Drawing))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "vtt_drawings", filter: `campaign_id=eq.${campaignId}` }, (p) => upsertDrawing(p.new as Drawing))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "vtt_drawings" }, (p) => {
        const id = (p.old as { id?: string }).id; if (id && drawingsRef.current.delete(id)) requestDraw();
      })
      .on("broadcast", { event: "drawings" }, () => { void reloadDrawingsRef.current(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "vtt_effects", filter: `campaign_id=eq.${campaignId}` }, (p) => {
        const row = p.new as TokenEffect; if (row.scene_id === stateRef.current?.scene?.id) { effectsRef.current.set(row.id, row); requestDraw(); }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "vtt_effects" }, (p) => {
        const id = (p.old as { id?: string }).id; if (id && effectsRef.current.delete(id)) requestDraw();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "vtt_scene_players" }, () => { void load(); })
      .on("broadcast", { event: "handout" }, ({ payload }) => { onHandoutRef.current(payload as { id: string; characters: string[] | null }); })
      .on("broadcast", { event: "handout-gone" }, () => { void loadHandoutsRef.current(); })
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

  // phase 5u: the GM paints difficult terrain; the scene's settings carry it to everyone (the scene's
  // Realtime update reloads every table, this one included)
  const paintTerrain = useCallback((cells: number[], on: boolean) => {
    if (!cells.length) return;
    difficultRef.current = paintDifficult(difficultRef.current, cells, on); requestDraw();
  }, [requestDraw]);
  const saveTerrain = useCallback(async () => {
    const sc = stateRef.current?.scene; if (!sc) return;
    setTick((v) => v + 1);
    const settings = { ...(sc.settings ?? {}), difficult: encodeDifficult(difficultRef.current) };
    const { error: er } = await supabase.from("vtt_scenes").update({ settings, updated_at: new Date().toISOString() }).eq("id", sc.id);
    if (er) setChatErr(`Could not save the terrain: ${er.message}`);
  }, [supabase]);
  const terrainDown = (sq: Pt) => {
    const m = stateRef.current?.map; if (!m) return;
    terrainPaint.current = { on: terrainMode === "paint" };
    paintTerrain(brushCells(m.n, Math.floor(sq.x), Math.floor(sq.y), terrainBrush), terrainPaint.current.on);
  };

  const setFogEnabled = useCallback((on: boolean) => {
    fogOn.current = on; setFogOnUi(on);
    rebuildFog(); requestDraw(); saveFog(on, true);
  }, [rebuildFog, requestDraw, saveFog]);

  const setLos = useCallback(async (patch: { los?: boolean; light?: LightMode }) => {
    const sc = stateRef.current?.scene; if (!sc) return;
    const settings = { ...(sc.settings ?? {}), ...patch };
    const { error: er } = await supabase.from("vtt_scenes").update({ settings, updated_at: new Date().toISOString() }).eq("id", sc.id);
    if (er) { setChatErr(`Could not change ${patch.light ? "the light" : "line of sight"}: ${er.message}`); return; }
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

  // ---- drawing ----
  const canEditDrawing = (d: Drawing | undefined | null) => !!d && (stateRef.current?.role === "gm" || d.owner === stateRef.current?.me);
  const drawingAt = (sq: Pt): Drawing | null => {
    const near = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };
    const list = [...drawingsRef.current.values()].filter(canEditDrawing);
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i], pts = d.points, tol = Math.max(0.25, d.width);
      if (d.kind === "text") {
        const w = (d.text ?? "").length * d.size * 0.6, [x, y] = pts[0];
        if (sq.x >= x - 0.1 && sq.x <= x + w && sq.y >= y - d.size && sq.y <= y + 0.2) return d;
      } else if (d.kind === "rect" || d.kind === "ellipse") {
        const [a, b] = [pts[0], pts[pts.length - 1]];
        if (sq.x >= Math.min(a[0], b[0]) - tol && sq.x <= Math.max(a[0], b[0]) + tol && sq.y >= Math.min(a[1], b[1]) - tol && sq.y <= Math.max(a[1], b[1]) + tol) return d;
      } else {
        for (let k = 0; k < pts.length; k++) {
          const a = pts[k], b = pts[Math.min(k + 1, pts.length - 1)];
          if (near(sq.x, sq.y, a[0], a[1], b[0], b[1]) <= tol) return d;
        }
      }
    }
    return null;
  };
  const eraseDrawings = async (ids: string[]) => {
    if (!ids.length) return;
    const keep = ids.map((id) => drawingsRef.current.get(id)).filter((d): d is Drawing => !!d);
    for (const id of ids) drawingsRef.current.delete(id);
    requestDraw();
    const { error: er } = await supabase.from("vtt_drawings").delete().in("id", ids);
    if (er) { for (const d of keep) drawingsRef.current.set(d.id, d); requestDraw(); setChatErr(`Could not erase: ${er.message}`); }
  };
  const saveDrawing = async (row: Omit<Drawing, "id" | "owner">) => {
    const st = stateRef.current; if (!st) return;
    const { data, error: er } = await supabase.from("vtt_drawings").insert({ ...row, campaign_id: campaignId, owner: st.me }).select("*").single();
    if (er || !data) { setChatErr(`Could not draw that: ${er?.message ?? "no row"}`); return; }
    drawingsRef.current.set((data as Drawing).id, data as Drawing); requestDraw();
  };
  const drawDown = (sq: Pt, free: boolean) => {
    const st = stateRef.current; if (!st?.scene) return;
    const layer: "table" | "gm" = st.role === "gm" && drawGm ? "gm" : "table";
    if (drawKind === "erase") { const d = drawingAt(sq); if (d) void eraseDrawings([d.id]); return; }
    if (drawKind === "text") {
      const t = drawText.trim();
      if (!t) { setChatErr("Type the words in the drawing bar first, then click where they go."); return; }
      void saveDrawing({ scene_id: st.scene.id, layer, kind: "text", points: [[sq.x, sq.y]], color: drawColor, width: 0.05, fill: false, text: t.slice(0, 200), size: Math.max(0.4, drawWidth * 6) });
      return;
    }
    const p: [number, number] = free || drawKind === "pen" ? [sq.x, sq.y] : [Math.round(sq.x * 2) / 2, Math.round(sq.y * 2) / 2];
    drawPreview.current = { kind: drawKind, points: [p], color: drawColor, width: drawWidth, fill: drawFill, layer };
    requestDraw();
  };
  const finishDrawing = () => {
    const dp = drawPreview.current, st = stateRef.current; drawPreview.current = null;
    if (!dp || !st?.scene) { requestDraw(); return; }
    const pts = dp.points, a = pts[0], b = pts[pts.length - 1];
    const size = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (dp.kind !== "pen" && size < 0.25) { requestDraw(); return; }       // a click, not a shape
    void saveDrawing({ scene_id: st.scene.id, layer: dp.layer, kind: dp.kind, points: dp.kind === "pen" ? pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as [number, number]) : [a, b],
      color: dp.color, width: dp.width, fill: dp.kind === "rect" || dp.kind === "ellipse" ? dp.fill : false, text: null, size: 0.6 });
    requestDraw();
  };
  const reloadDrawingsRef = useRef<() => Promise<void>>(async () => {});
  reloadDrawingsRef.current = async () => {
    const st = stateRef.current; if (!st?.scene) return;
    const { data: drs } = await supabase.from("vtt_drawings").select("*").eq("scene_id", st.scene.id).order("created_at");
    drawingsRef.current = new Map(((drs ?? []) as Drawing[]).map((d) => [d.id, d])); requestDraw();
  };
  const clearDrawings = async (all: boolean) => {
    const st = stateRef.current; if (!st?.scene) return;
    const ids = [...drawingsRef.current.values()].filter((d) => (all ? true : d.owner === st.me)).map((d) => d.id);
    if (!ids.length) { setChatErr(all ? "There are no drawings on this scene." : "You have no drawings on this scene."); return; }
    if (all && !window.confirm(`Erase all ${ids.length} drawings on this scene, everyone's? This cannot be undone.`)) return;
    await eraseDrawings(ids); send("drawings", {});
  };
  const undoMyDrawing = () => {
    const st = stateRef.current; if (!st) return;
    const mine = [...drawingsRef.current.values()].filter((d) => d.owner === st.me);
    const last = mine[mine.length - 1];
    if (last) void eraseDrawings([last.id]); else setChatErr("Nothing of yours to take back on this scene.");
  };

  // Shift + double-click a token: its sheet, in a new tab. A player's own character opens on its character sheet;
  // for the GM a character opens in the Codex and a monster in its stat block.
  const openSheet = (e: React.MouseEvent) => {
    if (!e.shiftKey) return;
    const st = stateRef.current; if (!st) return;
    const sq = toSquares(screenPt(e)), t = tokenAt({ x: sq.x * cellRef.current, y: sq.y * cellRef.current });
    if (!t) return;
    const gm = st.role === "gm";
    const ownChar = !!t.character_id && st.party.some((p) => p.profile_id === st.me && p.character_id === t.character_id);
    const url = t.character_id && ownChar ? `/me/sheet?c=${t.character_id}`
      : t.character_id && gm ? `/gm/codex?character=${t.character_id}`
      : t.stat_block_id && gm ? `/gm/statblock?sb=${t.stat_block_id}`
      : gm && entryFor(t) ? `/gm/combat` : null;
    if (!url) { setChatErr(gm ? `${t.name} has no sheet: it is not a character and has no stat block.` : `Only ${t.name}'s player and the GM can open that sheet.`); return; }
    window.open(url, "_blank", "noopener");
  };

  // ---- touch: two fingers pinch and pan; a long press pings ----
  const cancelGesture = () => {
    drag.current = null; box.current = null; drawPreview.current = null; brushing.current = null;
    if (myRuler.current && myRuler.current.done === null) myRuler.current = null;
    if (tplPreview.current && tplPreview.current.done === null) tplPreview.current = null;
    tplDrag.current = null; pan.current = null;
    if (longPress.current) { clearTimeout(longPress.current.timer); longPress.current = null; }
    requestDraw();
  };
  const touchMid = (): { d: number; mid: Pt } | null => {
    const v = [...touches.current.values()]; if (v.length < 2) return null;
    return { d: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y), mid: { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2 } };
  };

  const onDown = (e: React.PointerEvent) => {
    const st = stateRef.current; if (!st) return;
    const sp = screenPt(e), sq = toSquares(sp);
    try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, sp);
      if (touches.current.size >= 2) { cancelGesture(); pinch.current = touchMid(); return; }
      // a long press without moving is a ping (the touch version of a right-click)
      longPress.current = { at: sp, fired: false, timer: setTimeout(() => {
        const lp = longPress.current; if (!lp) return;
        lp.fired = true; cancelGesture();
        const w = toSquares(lp.at);
        pings.current.push({ x: w.x, y: w.y, color: myColor, born: performance.now() });
        send("ping", { x: w.x, y: w.y, color: myColor, pull: false }); requestDraw();
      }, 550) };
    }
    // right button inside the ruler: a waypoint
    if (e.button === 2 && addWaypoint()) return;
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (tool === "hand" || space.current))) {
      pan.current = { sx: sp.x, sy: sp.y, ox: camRef.current.ox, oy: camRef.current.oy, moved: false, button: e.button, shift: e.shiftKey };
      return;
    }
    if (e.button !== 0) return;
    if (tool === "fog" && st.role === "gm") { fogClick(sq, fogMode); return; }
    if (tool === "terrain" && st.role === "gm") { terrainDown(sq); return; }
    if (tool === "draw") { drawDown(sq, e.altKey); return; }
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
    } else if (e.pointerType === "touch") {
      setSelected([]); selRef.current = [];
      pan.current = { sx: sp.x, sy: sp.y, ox: camRef.current.ox, oy: camRef.current.oy, moved: false, button: 0, shift: false };
    } else {
      if (!e.shiftKey) { setSelected([]); selRef.current = []; }
      box.current = { a: { x: sq.x * cellRef.current, y: sq.y * cellRef.current }, b: { x: sq.x * cellRef.current, y: sq.y * cellRef.current } };
    }
    requestDraw();
  };

  const onMove = (e: React.PointerEvent) => {
    const sp = screenPt(e), sq = toSquares(sp);
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, sp);
      const lp = longPress.current;
      if (lp && Math.hypot(sp.x - lp.at.x, sp.y - lp.at.y) > 10) { clearTimeout(lp.timer); longPress.current = null; }
      if (pinch.current) {
        const now2 = touchMid();
        if (now2 && pinch.current.d > 0) {
          let cam = zoomAt(camRef.current, now2.d / pinch.current.d, now2.mid.x, now2.mid.y);
          cam = { ...cam, ox: cam.ox + now2.mid.x - pinch.current.mid.x, oy: cam.oy + now2.mid.y - pinch.current.mid.y };
          camRef.current = cam; pinch.current = now2; requestDraw();
        }
        return;
      }
      if (lp?.fired) return;
    }
    if (tool === "fog" || tool === "terrain") { hoverSq.current = sq; requestDraw(); }
    const dp = drawPreview.current;
    if (dp && (e.buttons & 1)) {
      const p: [number, number] = e.altKey || dp.kind === "pen" ? [sq.x, sq.y] : [Math.round(sq.x * 2) / 2, Math.round(sq.y * 2) / 2];
      if (dp.kind === "pen") {
        const last = dp.points[dp.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.06 && dp.points.length < 4000) dp.points.push(p);
      } else dp.points = [dp.points[0], p];
      requestDraw(); return;
    }
    if (terrainPaint.current && (e.buttons & 1)) {
      const m = stateRef.current?.map;
      if (m) paintTerrain(brushCells(m.n, Math.floor(sq.x), Math.floor(sq.y), terrainBrush), terrainPaint.current.on);
      return;
    }
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
      // Phase 5o: a player's token stops at a wall, a closed door or a sight wall; the GM moves freely
      const segs = stateRef.current?.role === "gm" ? null : wallSegsNow();
      for (const id of d.ids) {
        const o = d.orig.get(id)!, t = tokensRef.current.get(id)!;
        const want = d.free || e.altKey ? { x: o.x + dx, y: o.y + dy } : snapToken(o.x + dx, o.y + dy, t.size);
        const stop = segs ? moveStop(o, want, segs) : null;
        d.now.set(id, stop?.blocked ? { x: stop.x, y: stop.y } : want);
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
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId);
      const lp = longPress.current; if (lp) { clearTimeout(lp.timer); longPress.current = null; }
      if (pinch.current) { if (touches.current.size < 2) pinch.current = null; return; }
      if (lp?.fired) return;
    }
    if (brushing.current) { brushing.current = null; saveFog(null); return; }
    if (terrainPaint.current) { terrainPaint.current = null; void saveTerrain(); return; }
    if (drawPreview.current) { finishDrawing(); return; }
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
        const row = { campaign_id: campaignId, scene_id: sc.id, owner: st.me, ...pv.geom, color: pv.color, effect: tplEffect || null };
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
            if (er) {
              const m = er.message;
              setChatErr(/wait for your turn/.test(m) ? `Wait for your turn to move ${t.name}.`
                : /not enough movement left: (\d+)/.test(m) ? `${t.name} has ${m.match(/(\d+) ft/)?.[1] ?? 0} ft of movement left this turn. Dash adds more.`
                : /speed is 0/.test(m) ? `${t.name} cannot move right now (speed 0).`
                : /wall is in the way/.test(m) ? `A wall is in the way of ${t.name}.`
                : `Could not move ${t.name}: ${m}`);
              tokensRef.current.set(id, t); requestDraw();
            } else if (fightRef.current && st.role !== "gm") { void loadFightRef.current?.(); send("combat", {}); }
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

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    reducedMotion.current = !!mq?.matches;
    const nq = window.matchMedia?.("(max-width: 900px)");
    const apply = () => { const small2 = !!nq?.matches; setNarrow(small2); if (small2) setPanelOpen(false); };
    apply();
    const onMq = () => { reducedMotion.current = !!mq?.matches; requestDraw(); };
    mq?.addEventListener?.("change", onMq); nq?.addEventListener?.("change", apply);
    return () => { mq?.removeEventListener?.("change", onMq); nq?.removeEventListener?.("change", apply); };
  }, [requestDraw]);
  // the canvas changes size when the side panel opens or closes
  useEffect(() => { requestDraw(); }, [panelOpen, requestDraw]);

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

  // A token's own markers: the GM writes the token directly; a player goes through
  // tabletop_set_token_markers (p119), which only lets them mark a token they control.
  const setTokenMarkers = useCallback(async (id: string, list: TokenMarker[]) => {
    const t = tokensRef.current.get(id); if (!t) return;
    const markers = list.map(formatMarker), style = { ...t.style, markers };
    setMarkerBusy(true);
    if (stateRef.current?.role === "gm") await updateTokens([id], { style });
    else {
      const { error: er } = await supabase.rpc("tabletop_set_token_markers", { p_token: id, p_markers: markers });
      if (er) setChatErr(`Could not change the markers: ${er.message}`);
      else { const cur = tokensRef.current.get(id); if (cur) tokensRef.current.set(id, { ...cur, style }); setTick((v) => v + 1); requestDraw(); }
    }
    setMarkerBusy(false);
  }, [supabase, updateTokens, requestDraw]);
  useEffect(() => { setMarkerOpen(false); }, [selected]);

  // Saves what the token maker made: uploads the cut-out picture (and an imported border), then sets the
  // picture and frame through tabletop_set_token_look (p120), which lets the GM change any token and a
  // player change their own. Audit A4: afterwards the pictures it replaced are offered for removal, and
  // when the save fails the ones it just uploaded are; the route keeps any picture a token still shows.
  const saveLook = useCallback(async (tokenId: string, r: TokenMakerResult): Promise<string | null> => {
    const uploaded: string[] = [];
    const up = async (blob: Blob, file: string) => {
      const fd = new FormData(); fd.append("campaignId", campaignId); fd.append("tokenId", tokenId); fd.append("file", blob, file);
      const res = await fetch("/api/tabletop/token-image", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !j.url) throw new Error(j.error || `Upload failed (${res.status}).`);
      uploaded.push(j.url);
      return j.url;
    };
    const tidy = (urls: (string | null | undefined)[]) => {
      const list = urls.filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u));
      if (list.length) void fetch("/api/tabletop/token-image", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, tokenId, urls: list }) }).catch(() => {});
    };
    const before = tokensRef.current.get(tokenId);
    const oldImage = before?.image_url ?? null;
    const oldBorder = normFrame(before?.style?.frame)?.importUrl ?? null;
    try {
      const image = await up(r.portrait, "token.png");
      let frame: Frame | null = r.clearFrame ? null : { ...r.frame };
      if (frame && r.border) frame = { ...frame, importUrl: await up(r.border, "border.png") };
      else if (frame?.importUrl?.startsWith("blob:")) frame = { ...frame, importUrl: null };
      const { error: er } = await supabase.rpc("tabletop_set_token_look", { p_token: tokenId, p_image_url: image, p_frame: frame, p_clear_frame: r.clearFrame });
      if (er) { tidy(uploaded); return `Could not save the token: ${er.message}`; }
      tidy([oldImage !== image ? oldImage : null, oldBorder && oldBorder !== frame?.importUrl ? oldBorder : null]);
      const cur = tokensRef.current.get(tokenId);
      if (cur) {
        const style: Record<string, unknown> = { ...cur.style };
        if (frame) style.frame = frame; else delete style.frame;
        tokensRef.current.set(tokenId, { ...cur, image_url: image, style });
      }
      setTick((v) => v + 1); requestDraw(); setMakerFor(null);
      return null;
    } catch (e) {
      tidy(uploaded);
      return (e as Error).message;
    }
  }, [campaignId, supabase, requestDraw]);
  useEffect(() => {
    if (!makerFor) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMakerFor(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [makerFor]);

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
      if (k === "escape") { drawPreview.current = null; setSelected([]); setSelTpl(null); setSelDoors([]); selDoorsRef.current = []; if (tplPreview.current) { tplPreview.current.done = performance.now(); sendTpl(true); } if (myRuler.current) { myRuler.current.done = performance.now(); send("ruler", { by: me, color: myColor, points: myRuler.current.points, done: true }); } requestDraw(); return; }
      if (k === "v") { setTool("select"); return; }
      if (k === "m") { setTool("ruler"); return; }
      if (k === "q") { addWaypoint(); return; }
      if (k === "t") { setTool("template"); return; }
      if (k === "d") { setTool("draw"); return; }
      if (k === "u" && isGm) { setTool("fog"); return; }
      if (k === "g" && isGm) { setTool("terrain"); return; }
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
  // handouts (p113): wiki entries the GM shows from the table
  const loadHandouts = useCallback(async (): Promise<Handout[]> => {
    const { data, error: er } = await supabase.rpc("tabletop_handouts", { p_campaign: campaignId });
    if (er) { setChatErr(`Could not read the handouts: ${er.message}`); return []; }
    const list = (data as Handout[] | null) ?? [];
    setHandouts(list); return list;
  }, [supabase, campaignId]);
  loadHandoutsRef.current = loadHandouts;
  useEffect(() => { if (state?.me) void loadHandouts(); }, [state?.me, loadHandouts]);
  useEffect(() => {
    if (!isGm || panel !== "handouts" || hoEntries !== null) return;
    void supabase.from("entries").select("id, title, type, visibility").eq("campaign_id", campaignId).order("title").then(({ data, error: er }) => {
      if (er) { setChatErr(`Could not read the wiki: ${er.message}`); setHoEntries([]); return; }
      setHoEntries((data ?? []) as { id: string; title: string; type: string; visibility: string }[]);
    });
  }, [isGm, panel, hoEntries, supabase, campaignId]);
  // a handout shown at the table: pop it up for the players it was shown to
  onHandoutRef.current = (p) => {
    const st = stateRef.current; if (!st || st.role === "gm") return;
    const mine = st.party.filter((m) => m.profile_id === st.me && m.character_id).map((m) => m.character_id as string);
    if (p.characters && !p.characters.some((c) => mine.includes(c))) return;
    void loadHandouts().then((list) => { const h = list.find((x) => x.id === p.id); if (h) setOpenHandout(h); });
  };
  const showHandout = async () => {
    if (!hoPick) return;
    setHoBusy(true);
    try {
      const { data, error: er } = await supabase.rpc("tabletop_show_handout", { p_campaign: campaignId, p_entry: hoPick, p_characters: hoTo });
      if (er) { setChatErr(/no player characters/.test(er.message) ? "There are no player characters to show it to." : `Could not show it: ${er.message}`); return; }
      const r = data as { id: string; characters: string[] };
      send("handout", { id: r.id, characters: hoTo === null ? null : r.characters });
      setHoPick(""); setChatErr(null);
      await loadHandouts();
    } finally { setHoBusy(false); }
  };
  const hideHandout = async (id: string) => {
    const { error: er } = await supabase.rpc("tabletop_hide_handout", { p_handout: id });
    if (er) { setChatErr(`Could not hide it: ${er.message}`); return; }
    send("handout-gone", { id });
    await loadHandouts();
  };

  // ---------------------------------------------------------------------------------------------------
  // effects on tokens (p114)
  const addTokenEffect = async (tokenId: string) => {
    const st = stateRef.current; if (!st?.scene) return;
    const { data, error: er } = await supabase.from("vtt_effects").insert({ campaign_id: campaignId, scene_id: st.scene.id, token_id: tokenId, owner: st.me, kind: fxKind, radius_ft: fxRadius })
      .select("id, scene_id, token_id, owner, kind, radius_ft").single();
    if (er || !data) { setChatErr(`Could not add the effect: ${er?.message ?? "no row"}`); return; }
    effectsRef.current.set((data as TokenEffect).id, data as TokenEffect); requestDraw(); setTick((v) => v + 1);
  };
  const removeTokenEffect = async (id: string) => {
    const f = effectsRef.current.get(id); if (!f) return;
    effectsRef.current.delete(id); requestDraw(); setTick((v) => v + 1);
    const { error: er } = await supabase.from("vtt_effects").delete().eq("id", id);
    if (er) { effectsRef.current.set(id, f); requestDraw(); setChatErr(`Could not remove the effect: ${er.message}`); }
  };
  const setTplEffectOn = async (id: string, effect: EffectKind | "") => {
    const t = templatesRef.current.get(id); if (!t) return;
    templatesRef.current.set(id, { ...t, effect: effect || null }); requestDraw(); setTick((v) => v + 1);
    const { error: er } = await supabase.from("vtt_templates").update({ effect: effect || null, updated_at: new Date().toISOString() }).eq("id", id);
    if (er) { templatesRef.current.set(id, t); requestDraw(); setChatErr(`Could not change the effect: ${er.message}`); }
  };

  // split party (p114): who is on which scene, sending players, and the GM's own view
  const placeOn = async (sceneId: string, profiles: string[]) => {
    if (!profiles.length) return;
    const { error: er } = await supabase.rpc("tabletop_place", { p_scene: sceneId, p_profiles: profiles });
    if (er) { setChatErr(`Could not move them: ${er.message}`); return; }
    setSendPick(null); send("refresh", {}); await load();
  };
  const viewScene = async (sceneId: string) => {
    const { error: er } = await supabase.rpc("tabletop_view_scene", { p_scene: sceneId });
    if (er) { setChatErr(er.message); return; }
    await load();
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
    if (er) setChatErr(er.message); else { send("refresh", {}); await load(); }
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

  // One attack from outside (D&D Beyond): its attack roll(s), its damage rolls with their types and the
  // total, and the controls to land the damage on a creature in the fight.
  const renderAttack = (key: string, g: OutsideRoll[]) => {
    const first = g[0];
    const who = first.actor_name ?? party.find((p) => p.character_id && p.character_id === first.character_id)?.name ?? "A player";
    const attacks = g.filter((x) => x.event_type === "to-hit");
    const kept = attacks.find((x) => !x.rolls?.discarded) ?? attacks[0];
    const dmg = g.filter((x) => x.event_type === "damage");
    const other = g.filter((x) => x.event_type !== "to-hit" && x.event_type !== "damage");
    const total = dmg.reduce((n, x) => n + (Number(x.rolls?.total) || 0), 0);
    const crit = !!kept?.rolls?.critical_success, fumble = !!kept?.rolls?.critical_failure;
    const chips = (x: OutsideRoll) => (x.rolls?.dice ?? []).flatMap((d) => d.results.map((v, i) => (
      <span key={`${x.id}-${d.faces}-${i}`} style={{ fontSize: 11, padding: "0 5px", borderRadius: 5, border: `1px solid ${C.line}`, color: C.muted }}>{v}/d{d.faces}</span>)));
    const applied = dmg.length > 0 && dmg.every((x) => !!x.applied_to) ? dmg[0].applied_to : null;
    const fightNow = fight;
    const mineRoll = g.every((x) => !!x.character_id && myChars.some((c) => c.character_id === x.character_id));
    const canApply = !!fightNow && dmg.length > 0 && (isGm || mineRoll) && (!applied || (isGm && applied.startsWith("missed ")));
    const preset = isGm ? (selEntry && fightNow?.order.some((e) => e.id === selEntry) ? selEntry : (selected[0] ? fightNow?.order.find((e) => e.tokenId === selected[0])?.id ?? "" : "")) : "";
    const target = applyTo[key] ?? preset;
    const tgt = fightNow?.order.find((e) => e.id === target) ?? null;
    const choices = (fightNow?.order ?? []).filter((e) => isGm || (!e.hidden && !(e.kind === "pc" && myChars.some((c) => c.character_id === e.characterId))));
    const ids = g.map((x) => x.id);
    const note = applyNote[key];
    return (
      <div style={{ background: "#1c1814", border: `1px solid ${crit ? "#5f9c5a" : fumble ? "#a8483f" : C.line}`, borderRadius: 8, padding: "8px 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: C.muted, fontSize: 12 }}>
          <span><b style={{ color: C.text }}>{who}</b>{first.name ? ` · ${first.name}` : ""}</span>
          <span style={{ fontSize: 11, color: C.sun }}>{first.source === "foundry" ? "Foundry" : "D&D Beyond"}</span>
        </div>
        {kept && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, minWidth: 50 }}>Attack</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: crit ? "#8fd18a" : fumble ? "#e07a70" : C.text }}>{kept.rolls?.total ?? "?"}</span>
            {attacks.map((x) => <span key={x.id} style={{ display: "inline-flex", gap: 3, textDecoration: x.rolls?.discarded ? "line-through" : "none", opacity: x.rolls?.discarded ? 0.6 : 1 }}>{chips(x)}</span>)}
            {crit && <span style={{ fontSize: 12, color: "#8fd18a" }}>critical hit</span>}
            {fumble && <span style={{ fontSize: 12, color: "#e07a70" }}>natural 1</span>}
            {isGm && tgt?.ac != null && !crit && !fumble && <span style={{ fontSize: 12, color: C.muted }}>vs AC {tgt.ac}: {Number(kept.rolls?.total) >= tgt.ac ? "hits" : "misses"}</span>}
          </div>
        )}
        {dmg.length > 0 && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, minWidth: 50 }}>Damage</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{total}</span>
            <span style={{ fontSize: 12.5, color: C.muted }}>{dmg.map((x) => `${x.rolls?.total ?? "?"}${x.rolls?.damage_type ? ` ${x.rolls.damage_type.toLowerCase()}` : ""}`).join(" + ")}</span>
            <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap" }}>{dmg.flatMap(chips)}</span>
          </div>
        )}
        {other.map((x) => (
          <div key={x.id} style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>{x.event_type}: <b style={{ color: C.text }}>{x.rolls?.total ?? "?"}</b></div>
        ))}
        {crit && dmg.length > 0 && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>Damage as D&amp;D Beyond rolled it (it doubles the dice on a critical, and adds what the sheet adds, such as Rage).</div>}
        {applied && <div style={{ fontSize: 12.5, color: applied.startsWith("missed ") ? "#e07a70" : "#8fd18a", marginTop: 5 }}>{applied.startsWith("missed ") ? `Missed ${applied.slice(7)}` : `Applied to ${applied}`}</div>}
        {canApply && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
            <select aria-label="Who the damage lands on" value={target} onChange={(ev) => setApplyTo((m) => ({ ...m, [key]: ev.target.value }))} style={{ ...field, flex: "1 1 120px", padding: "4px 6px" }}>
              <option value="">Target…</option>
              {choices.map((e) => <option key={e.id} value={e.id}>{e.name}{e.defeated ? " (down)" : ""}</option>)}
            </select>
            <button type="button" disabled={!target} onClick={() => void applyOutside(key, ids, target, false)} style={{ ...small, padding: "4px 9px", color: "#e07a70" }}>{applied ? "Apply anyway" : `Apply ${total}`}</button>
            <button type="button" disabled={!target} onClick={() => void applyOutside(key, ids, target, true)} style={{ ...small, padding: "4px 9px" }}>Half ({Math.floor(total / 2)})</button>
          </div>
        )}
        {!fightNow && dmg.length > 0 && !applied && (isGm || mineRoll) && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>Start a fight to land this damage on a creature.</div>}
        {note && <div role={note.bad ? "alert" : "status"} style={{ fontSize: 12, color: note.bad ? "#e07a70" : "#8fd18a", marginTop: 4 }}>{note.text}</div>}
      </div>
    );
  };

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

  // A roll on a rollable table (phase 5r): the table's name, the number, and the entry it landed on.
  const renderTableRoll = (who: string, tb: { name: string; result: string; found?: boolean }, total: number | undefined, dice: { v: number; sides: number; kept: boolean }[], gmOnly: boolean) => (
    <div style={{ background: "#1c1814", border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.sun}`, borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: C.muted, fontSize: 12 }}>
        <span><b style={{ color: C.text }}>{who}</b> rolls on {tb.name}</span>
        {gmOnly && <span style={{ fontSize: 11, color: C.sun }}>GM only</span>}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
        {dice.length > 0 && <span title={dice.map((d) => `${d.v}/d${d.sides}`).join(" + ")} style={{ fontSize: 18, fontWeight: 700, color: C.sun, minWidth: 26 }}>{total ?? "?"}</span>}
        <span style={{ fontSize: 14, color: tb.found === false ? C.muted : C.text, lineHeight: 1.35 }}>{tb.result}</span>
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
        {isGm && scene && state.scenes.some((s) => s.is_active) && !state.scenes.find((s) => s.id === scene.id)?.is_active && (
          <span style={{ fontSize: 12, color: "#d9a43a", border: "1px solid #d9a43a", borderRadius: 999, padding: "2px 9px" }}>Viewing: players who were not sent here cannot see it</span>
        )}
        {!state.session_id && <div style={{ color: "#d9a43a", fontSize: 12 }}>No open session: rolls show here but are not logged for Mechanics.</div>}
        {fight && (() => { const cur = fight.order.find((e) => e.is_turn); return (
          <button type="button" onClick={() => setPanel("turns")} style={{ background: "rgba(217,164,58,0.12)", border: `1px solid ${C.sun}`, color: C.sun, borderRadius: 999, padding: "3px 10px", fontSize: 12.5, cursor: "pointer" }}>
            Round {fight.round}{cur ? ` · ${cur.name}'s turn` : ""}
          </button>); })()}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen} title="Show or hide the side panel (chat, turns, handouts)" style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, border: `1px solid ${panelOpen ? C.sun : C.line}`, background: "transparent", color: panelOpen ? C.sun : C.muted, cursor: "pointer" }}>{panelOpen ? "Hide panel" : "Panel"}</button>
          <button type="button" onClick={() => openTabletop(campaignId)} title="Open the table in its own window, for a second screen" style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, border: `1px solid ${C.line}`, background: "transparent", color: C.muted, cursor: "pointer" }}>New window</button>
          {present.map((p) => (
            <span key={p.key} title={p.name} style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, border: `1px solid ${p.color}`, color: p.color }}>{p.name}</span>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
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
          <button type="button" title="Draw and write on the table (D): pen, line, box, ellipse, text. Each person erases their own." onClick={() => setTool("draw")} style={railBtn(tool === "draw")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20l4-1 11-11-3-3L5 16z M14 6l3 3"/></svg>Draw
          </button>
          {isGm && (
            <button type="button" title="Fog of war (U): reveal or hide a room with a click, or paint squares with the brush" onClick={() => setTool("fog")} style={railBtn(tool === "fog")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 8h12a3 3 0 1 0-3-3 M3 12h17 M5 16h11a3 3 0 1 1-3 3"/></svg>Fog
            </button>
          )}
          {isGm && (
            <button type="button" title="Difficult terrain (G): paint squares where every foot of movement costs two" onClick={() => setTool("terrain")} style={railBtn(tool === "terrain")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 20l5-8 4 5 3-4 6 7z M4 9l4-4 M9 9l4-4 M14 9l4-4"/></svg>Terrain
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
              onPointerLeave={() => { hover.current = null; requestDraw(); }} onContextMenu={(e) => e.preventDefault()} onDoubleClick={openSheet}
              aria-label={`Table: ${scene.name}`}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: tool === "ruler" || tool === "fog" || (tool === "draw" && drawKind !== "erase") ? "crosshair" : tool === "draw" ? "pointer" : tool === "hand" ? "grab" : "default" }} />
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
              <select aria-label="Effect in the template" value={tplEffect} onChange={(e) => setTplEffect(e.target.value as EffectKind | "")} style={{ ...field, width: "auto", padding: "6px 6px" }}>
                <option value="">No effect</option>
                {EFFECTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
              <label style={{ display: "flex", gap: 5, fontSize: 12, alignItems: "center", color: C.text }}><input type="checkbox" checked={tplLinger} onChange={(e) => setTplLinger(e.target.checked)} style={{ accentColor: C.sun }} />Leave it on the table</label>
            </div>
          )}
          {scene && tool === "draw" && (
            <div role="toolbar" aria-label="Drawing" style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100% - 20px)", background: "rgba(28,24,20,0.95)", border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 8px" }}>
              {([["pen", "Pen"], ["line", "Line"], ["rect", "Box"], ["ellipse", "Ellipse"], ["text", "Text"], ["erase", "Erase"]] as [DrawKind, string][]).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={drawKind === k} onClick={() => setDrawKind(k)} style={{ ...seg(drawKind === k), flex: "0 0 auto", padding: "6px 10px" }}>{l}</button>
              ))}
              {drawKind === "text" && <input aria-label="Words to write" value={drawText} onChange={(e) => setDrawText(e.target.value.slice(0, 200))} placeholder="words, then click the map" style={{ ...field, width: 180, padding: "6px 8px" }} />}
              {drawKind !== "erase" && (
                <>
                  <span role="group" aria-label="Colour" style={{ display: "flex", gap: 3 }}>
                    {DRAW_COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={drawColor === c} onClick={() => setDrawColor(c)} style={{ width: 20, height: 20, borderRadius: 999, background: c, border: `2px solid ${drawColor === c ? "#fff" : "rgba(255,255,255,0.15)"}`, cursor: "pointer", padding: 0 }} />)}
                  </span>
                  {DRAW_WIDTHS.map(([l, w]) => <button key={l} type="button" aria-pressed={drawWidth === w} onClick={() => setDrawWidth(w)} title={drawKind === "text" ? `${l} text` : `${l} line`} style={{ ...seg(drawWidth === w), flex: "0 0 auto", padding: "6px 8px" }}>{l}</button>)}
                  {(drawKind === "rect" || drawKind === "ellipse") && <label style={{ display: "flex", gap: 5, fontSize: 12, alignItems: "center", color: C.text }}><input type="checkbox" checked={drawFill} onChange={(e) => setDrawFill(e.target.checked)} style={{ accentColor: C.sun }} />Fill</label>}
                  {isGm && <label title="Only you see it; players never receive it" style={{ display: "flex", gap: 5, fontSize: 12, alignItems: "center", color: C.text }}><input type="checkbox" checked={drawGm} onChange={(e) => setDrawGm(e.target.checked)} style={{ accentColor: C.sun }} />GM only</label>}
                </>
              )}
              <button type="button" onClick={undoMyDrawing} style={small}>Undo mine</button>
              <button type="button" onClick={() => void clearDrawings(false)} style={small}>Clear mine</button>
              {isGm && <button type="button" onClick={() => void clearDrawings(true)} style={{ ...small, color: "#e07a70" }}>Clear all</button>}
            </div>
          )}
          {scene && isGm && tool === "terrain" && (
            <div role="toolbar" aria-label="Difficult terrain" style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100% - 20px)", background: "rgba(28,24,20,0.95)", border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 8px" }}>
              <span style={{ fontSize: 12.5, color: C.text, marginRight: 2 }}>Difficult terrain</span>
              {([["paint", "Paint"], ["erase", "Erase"]] as ["paint" | "erase", string][]).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={terrainMode === k} onClick={() => setTerrainMode(k)} style={{ ...seg(terrainMode === k), flex: "0 0 auto", padding: "6px 10px" }}>{l}</button>
              ))}
              {[1, 3, 5].map((b) => (
                <button key={b} type="button" title={`Brush ${b} by ${b} squares`} aria-pressed={terrainBrush === b} onClick={() => setTerrainBrush(b)} style={{ ...seg(terrainBrush === b), flex: "0 0 auto", padding: "6px 8px" }}>{b}</button>
              ))}
              <button type="button" disabled={!difficultRef.current.size} onClick={() => { difficultRef.current = new Set(); requestDraw(); void saveTerrain(); }} style={{ ...small, padding: "6px 10px" }}>Clear all</button>
              <span style={{ fontSize: 12, color: C.muted }}>{difficultRef.current.size} square{difficultRef.current.size === 1 ? "" : "s"}. Moving through them costs double.</span>
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
                <input type="checkbox" checked={!!scene.settings?.los} onChange={(e) => void setLos({ los: e.target.checked })} style={{ accentColor: C.sun }} />Line of sight
              </label>
              {!!scene.settings?.los && (
                <label title="Dim: everything in sight is seen, shaded, and lights brighten their area. Dark: players see only lit areas and what their darkvision reaches. Set lights and darkvision on tokens (Tokens tab)." style={{ display: "flex", gap: 5, fontSize: 12.5, alignItems: "center", color: C.text, margin: "0 4px" }}>
                  Light
                  <select aria-label="Scene light" value={lightModeOf(scene.settings?.light)} onChange={(e) => void setLos({ light: e.target.value as LightMode })} style={{ ...field, width: "auto", padding: "4px 6px" }}>
                    {LIGHT_MODES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                  </select>
                </label>
              )}
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
                  <select aria-label="Effect in this template" value={templatesRef.current.get(selTpl)?.effect ?? ""} onChange={(e) => void setTplEffectOn(selTpl, e.target.value as EffectKind | "")} style={{ ...field, width: "auto", padding: "5px 6px" }}>
                    <option value="">No effect</option>
                    {EFFECTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                  <button type="button" onClick={() => void removeTpl()} style={{ ...small, color: "#e07a70" }}>Remove</button>
                </>
              ) : <span style={{ color: C.muted }}>placed by someone else</span>}
            </div>
          )}
          {scene && tool === "select" && selected.length === 1 && tokensRef.current.get(selected[0]) && (() => {
            const tk = tokensRef.current.get(selected[0])!;
            const list = [...effectsRef.current.values()].filter((f) => f.token_id === tk.id);
            return (
              <div role="group" aria-label={`Effects on ${tk.name}`} style={{ position: "absolute", bottom: selDoors.length ? 92 : 40, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100% - 20px)", background: "rgba(28,24,20,0.95)", border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 8px", fontSize: 12.5 }}>
                <span style={{ color: C.muted }}>Effects on {tk.name}</span>
                {list.map((f) => {
                  const ef = EFFECTS.find((x) => x.key === f.kind), mineFx = isGm || f.owner === state.me;
                  return (
                    <span key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: `1px solid ${ef?.color ?? C.line}`, color: ef?.color ?? C.text, borderRadius: 999, padding: "1px 8px" }}>
                      {ef?.label ?? f.kind}{f.radius_ft > 0 ? ` ${f.radius_ft} ft` : ""}
                      {mineFx && <button type="button" aria-label={`Remove ${ef?.label ?? f.kind}`} onClick={() => void removeTokenEffect(f.id)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: 14 }}>&times;</button>}
                    </span>
                  );
                })}
                <select aria-label="Effect to add" value={fxKind} onChange={(e) => setFxKind(e.target.value as EffectKind)} style={{ ...field, width: "auto", padding: "5px 6px" }}>
                  {EFFECTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                <select aria-label="Reach of the effect" value={fxRadius} onChange={(e) => setFxRadius(Number(e.target.value))} style={{ ...field, width: "auto", padding: "5px 6px" }}>
                  {[0, 5, 10, 15, 20, 30].map((r) => <option key={r} value={r}>{r ? `${r} ft around` : "On the token"}</option>)}
                </select>
                <button type="button" onClick={() => void addTokenEffect(tk.id)} style={small}>Add</button>
                {(isGm || tk.mine) && <button type="button" onClick={() => setMakerFor(tk.id)} style={small}>Token maker</button>}
                {(isGm || tk.mine) && (
                  <button type="button" aria-expanded={markerOpen} onClick={() => setMarkerOpen((v) => !v)} style={{ ...small, borderColor: markerOpen ? C.sun : C.line, color: markerOpen ? C.sun : C.text }}>
                    Markers{tokenMarkers(tk.style).length ? ` (${tokenMarkers(tk.style).length})` : ""}
                  </button>
                )}
                {markerOpen && (isGm || tk.mine) && (
                  <div role="dialog" aria-label={`Markers on ${tk.name}`} style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", width: "min(560px, calc(100vw - 40px))", maxHeight: "55vh", overflowY: "auto", background: "rgba(28,24,20,0.98)", border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, textAlign: "left", boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                      <strong style={{ flex: 1, fontSize: 13 }}>Markers on {tk.name}</strong>
                      <button type="button" onClick={() => setMarkerOpen(false)} style={small}>Done</button>
                    </div>
                    <TokenMarkerPicker value={tokenMarkers(tk.style)} busy={markerBusy} style={markerStyle} onStyle={setMarkerStyle}
                      onChange={(next) => void setTokenMarkers(tk.id, next)} />
                    <p style={{ fontSize: 11.5, color: C.muted, margin: "8px 0 0" }}>Everyone who can see this token sees its markers. Conditions from the fight show on the token too, and change in the Turns tab.</p>
                  </div>
                )}
              </div>
            );
          })()}
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
          {/* phase 5s: the table's music and ambient sound, with this person's own volume */}
          <div style={{ position: "absolute", right: 10, bottom: 10, zIndex: 5 }}>
            <TableSound audio={tableAudio.audio} serverNow={tableAudio.serverNow} />
          </div>
        </div>

        {/* side panel */}
        <div style={{ width: narrow ? "min(360px, 88vw)" : 360, display: panelOpen ? "flex" : "none", flexDirection: "column", borderLeft: `1px solid ${C.line}`, background: C.surface, minHeight: 0,
          ...(narrow ? { position: "absolute" as const, right: 0, top: 0, bottom: 0, zIndex: 20, boxShadow: "-8px 0 24px rgba(0,0,0,0.5)" } : {}) }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 8, borderBottom: `1px solid ${C.line}` }}>
            <button type="button" onClick={() => setPanel("chat")} style={seg(panel === "chat")}>Chat</button>
            <button type="button" onClick={() => setPanel("turns")} style={seg(panel === "turns")}>Turns{fight ? ` (${fight.round})` : ""}</button>
            {isGm && <button type="button" onClick={() => setPanel("tokens")} style={seg(panel === "tokens")}>Tokens</button>}
            {isGm && <button type="button" onClick={() => setPanel("scenes")} style={seg(panel === "scenes")}>Scenes</button>}
            <button type="button" onClick={() => setPanel("handouts")} style={seg(panel === "handouts")}>Handouts{handouts.length ? ` (${handouts.length})` : ""}</button>
            <button type="button" onClick={() => setPanel("tables")} style={seg(panel === "tables")}>Tables</button>
            {isGm && <button type="button" onClick={() => setPanel("sound")} style={seg(panel === "sound")}>Sound</button>}
          </div>

          {panel === "chat" && (
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {feed.length === 0 && <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Nothing said yet. Type below, or roll with the dice buttons. /r 1d20+5 Attack rolls, /w name whispers.</p>}
                {feedRows.map((f) => {
                  if (f.group && (f.group.length > 1 || f.group.some((x) => x.event_type === "damage"))) return <div key={f.key}>{renderAttack(f.key, f.group)}</div>;
                  if (f.ext) {
                    const r = f.ext.rolls, dice = (r?.dice ?? []).flatMap((g) => g.results.map((v) => ({ v, sides: g.faces, kept: true })));
                    const nat = r?.critical_success ? 20 : r?.critical_failure ? 1 : null;
                    // Who rolled: the name written with the roll, else the party member it belongs to (rolls
                    // from the character sheet carried no name before phase 5d). Only rolls from outside
                    // Six Axes get a badge saying where they came from; our own rollers show none.
                    const who = f.ext.actor_name ?? party.find((p) => p.character_id && p.character_id === f.ext!.character_id)?.name ?? "A player";
                    const badge = f.ext.source === "beyond20" ? "D&D Beyond" : f.ext.source === "foundry" ? "Foundry" : null;
                    return <div key={f.key}>{renderRoll(who, f.ext.name ?? "", r?.total, dice, nat, badge)}</div>;
                  }
                  const m = f.msg!;
                  const who = nameOf(m);
                  if (m.kind === "roll" && m.roll) {
                    const dice = (m.roll.dice ?? []).map((d) => ({ v: d.value, sides: d.sides, kept: d.kept }));
                    // phase 5r: a roll on a rollable table shows the entry it landed on
                    if (m.roll.table) return <div key={f.key}>{renderTableRoll(who, m.roll.table, m.roll.total, dice, m.gm_only)}</div>;
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
                      {(() => {
                        const missing = fight.order.filter((e) => !tokenForEntry(e) && !e.defeated);
                        return missing.length > 0 ? (
                          <button type="button" disabled={fightBusy} onClick={() => void addTokenFor(missing)} style={{ ...small, gridColumn: "1 / -1" }}
                            title="Everyone in the fight without a token on this scene gets one, in the middle of your view">Add the {missing.length} missing token{missing.length === 1 ? "" : "s"}</button>
                        ) : null;
                      })()}
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
                        <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: myTurnNow ? C.sun : C.muted, marginBottom: 6 }}>{myTurnNow ? `Your turn: ${mineE.name}` : `${mineE.name}'s turn so far`}</div>
                        <EconomyBar key={`${fight.id}:${fight.round}:${mineE.speed ?? ""}:${mineE.attacksPerAction ?? 1}`} fightId={fight.id} entry={mineE as unknown as FightEntry} myTurn={myTurnNow}
                          onChanged={() => { void loadFight(); send("combat", {}); }} />
                      </div>
                      <div style={{ marginTop: 8, padding: "8px 10px", border: `1px solid ${C.line}`, borderRadius: 8 }}>
                        <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>Attack or cast</div>
                        <AttackForm key={preset || "none"} campaignId={campaignId} characterId={mineE.characterId} presetTarget={preset}
                          fight={fight as unknown as Parameters<typeof AttackForm>[0]["fight"]}
                          onDone={() => { void loadFight(); send("combat", {}); }} />
                        <p style={{ fontSize: 11.5, color: C.muted, margin: "6px 0 0" }}>Select a monster&apos;s token to make it the target.</p>
                      </div>
                      </>
                    );
                  })()}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, color: C.muted }}>
                    <MarkerStylePicker style={markerStyle} onChange={setMarkerStyle} />
                  </div>
                  <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
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
                            {isGm && !tokenForEntry(e) && <button type="button" onClick={() => void addTokenFor([e])} title={`${e.name} has no token on this scene: put one on the table, linked to this entry`} aria-label={`Add a token for ${e.name}`} style={{ ...small, padding: "1px 7px", fontSize: 11 }}>Add token</button>}
                          </div>
                          {frac != null && <div style={{ height: 4, background: "#2a241d", borderRadius: 2, marginTop: 5 }}><div style={{ width: `${frac * 100}%`, height: 4, borderRadius: 2, background: frac > 0.5 ? "#5fae5a" : frac > 0.25 ? "#d9a43a" : "#d0463c" }} /></div>}
                          {(e.conditions ?? []).length > 0 && <div style={{ marginTop: 5 }}><MarkerChips list={e.conditions ?? []} /></div>}
                          {e.is_turn && !isGm && !mineEntry && <div style={{ marginTop: 3 }}><TurnUsed entry={e as unknown as FightEntry} /></div>}
                          {isGm && e.econ && (e.is_turn || e.econ.reaction) && (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 5 }} role="group" aria-label={`${e.name}'s turn`}>
                              {(["action", "bonus", "reaction"] as const).map((k) => {
                                const used = !!e.econ?.[k];
                                return (
                                  <button key={k} type="button" aria-pressed={used} title={used ? "Used: click to give it back" : "Ready: click to mark it used"}
                                    onClick={() => editEntry(e.id, (c) => ({ ...c, econ: { ...econOf(c), [k]: !used, ...(k === "action" && used ? { attacks: 0 } : {}) } }))}
                                    style={{ ...small, padding: "1px 7px", fontSize: 11, textDecoration: used ? "line-through" : "none", color: used ? C.muted : k === "action" ? "#d9a43a" : k === "bonus" ? "#8fd18a" : "#c2a8f0" }}>
                                    {k === "bonus" ? "Bonus" : k === "action" ? "Action" : "Reaction"}
                                  </button>
                                );
                              })}
                              {e.is_turn && <span style={{ fontSize: 11, color: C.muted }}>moved {e.econ.moved}{e.speedNow != null ? ` of ${e.speedNow + e.econ.dash}` : ""} ft{e.econ.attacks ? `, ${e.econ.attacks} attack${e.econ.attacks === 1 ? "" : "s"} left` : ""}</span>}
                              {e.is_turn && <button type="button" onClick={() => editEntry(e.id, (c) => ({ ...c, econ: { ...FRESH_ECON } }))} style={{ ...small, padding: "1px 7px", fontSize: 11, color: C.muted }} title="Give back everything this turn">Fresh turn</button>}
                            </div>
                          )}
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
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div><label style={label} htmlFor="tt-light">Carries a light</label>
                          {(() => {
                            const l = lightOf(sel[0].style);
                            const pre = l ? LIGHT_PRESETS.find((x) => x.bright === l.bright && x.dim === l.dim)?.key ?? "custom" : "";
                            return (
                              <select id="tt-light" value={pre} onChange={(e) => {
                                const p0 = LIGHT_PRESETS.find((x) => x.key === e.target.value);
                                const style = { ...sel[0].style }; if (p0) style.light = { bright: p0.bright, dim: p0.dim }; else delete style.light;
                                void updateTokens([sel[0].id], { style }, true);
                              }} style={field}>
                                <option value="">None</option>
                                {LIGHT_PRESETS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                                {pre === "custom" && l && <option value="custom" disabled>{l.bright} + {l.dim} ft</option>}
                              </select>
                            );
                          })()}</div>
                        <div><label style={label} htmlFor="tt-dv">Darkvision</label>
                          <select id="tt-dv" value={darkvisionOf(sel[0].style) || ""} onChange={(e) => {
                            const v = Number(e.target.value) || 0, style = { ...sel[0].style }; if (v) style.darkvision = v; else delete style.darkvision;
                            void updateTokens([sel[0].id], { style }, true);
                          }} style={field}>
                            <option value="">{sel[0].character_id && sheetDv.current.get(sel[0].character_id) ? `From the sheet (${sheetDv.current.get(sel[0].character_id)} ft)` : "None"}</option>
                            {DARKVISION_FT.map((f) => <option key={f} value={f}>{f} ft</option>)}
                            {darkvisionOf(sel[0].style) > 0 && !DARKVISION_FT.includes(darkvisionOf(sel[0].style)) && <option value={darkvisionOf(sel[0].style)}>{darkvisionOf(sel[0].style)} ft</option>}
                          </select></div>
                      </div>
                      {(lightOf(sel[0].style) || darkvisionOf(sel[0].style) > 0) && <p style={{ color: C.muted, fontSize: 11.5, margin: "4px 0 0" }}>Used when the scene has line of sight on and its light set to Dim or Dark. Measured from the token&apos;s edge; walls stop light.</p>}
                      <label style={label}>Image</label>
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f, (url) => void updateTokens([sel[0].id], { image_url: url })); }} style={{ fontSize: 12, color: C.muted }} />
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => setMakerFor(sel[0].id)} style={small}>Open the token maker</button>
                        <span style={{ fontSize: 11.5, color: C.muted }}>Remove a background, cut a shape, add a border or an animated frame.</span>
                      </div>
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
                {(() => {
                  const activeId = state.scenes.find((s) => s.is_active)?.id ?? null;
                  const place = new Map((state.placements ?? []).map((p) => [p.profile_id, p.scene_id]));
                  const sceneOf = (profile: string) => place.get(profile) ?? activeId;
                  const players = party.filter((p) => p.character_id && p.profile_id !== state.campaign.gm_id);
                  const split = players.some((p) => sceneOf(p.profile_id) !== activeId);
                  return (
                    <>
                      {split && <p style={{ fontSize: 12, color: "#d9a43a", margin: "0 0 4px" }}>The party is split. &quot;Everyone here&quot; brings them back together.</p>}
                      {state.scenes.map((s) => {
                        const here = players.filter((p) => sceneOf(p.profile_id) === s.id);
                        const viewing = scene?.id === s.id;
                        const picking = sendPick?.scene === s.id;
                        return (
                          <div key={s.id} style={{ border: `1px solid ${viewing ? C.sun : C.line}`, borderRadius: 8, padding: "6px 8px" }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ flex: 1, fontSize: 13, color: s.is_active ? C.sun : C.text }}>{s.name}{s.is_active ? " (on the table)" : ""}</span>
                              {!viewing && <button type="button" onClick={() => void viewScene(s.id)} title="Look at this scene yourself; nobody moves" style={{ ...small, padding: "3px 8px" }}>View</button>}
                              <button type="button" onClick={() => setSendPick(picking ? null : { scene: s.id, who: [] })} aria-expanded={picking} style={{ ...small, padding: "3px 8px" }}>Send players</button>
                              {(!s.is_active || split) && <button type="button" onClick={() => void activate(s.id)} style={{ ...small, padding: "3px 8px" }}>Everyone here</button>}
                            </div>
                            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>{viewing ? "You are looking at it. " : ""}{here.length ? `Players here: ${here.map((p) => p.name).join(", ")}` : "No players here."}</div>
                            {picking && (
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 6 }} role="group" aria-label={`Send players to ${s.name}`}>
                                {players.map((p) => {
                                  const on = sendPick!.who.includes(p.profile_id);
                                  return <button key={p.profile_id} type="button" aria-pressed={on} onClick={() => setSendPick((cur) => cur && { ...cur, who: on ? cur.who.filter((x) => x !== p.profile_id) : [...cur.who, p.profile_id] })}
                                    style={{ ...small, padding: "2px 8px", color: on ? C.sun : C.muted, borderColor: on ? C.sun : C.line }}>{p.name}</button>;
                                })}
                                <button type="button" disabled={!sendPick!.who.length} onClick={() => void placeOn(s.id, sendPick!.who)} style={{ ...small, padding: "2px 10px", background: sendPick!.who.length ? C.sun : "transparent", color: sendPick!.who.length ? "#1b1712" : C.muted, border: "none", fontWeight: 600 }}>Send</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
                {state.scenes.length === 0 && <p style={{ color: C.muted, fontSize: 12.5, margin: 0 }}>No scenes yet.</p>}
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, marginTop: 18 }}>Map from a module or campaign</div>
              <p style={{ color: C.muted, fontSize: 12, margin: "6px 0" }}>Upload a map image and line its grid up with the table&apos;s. It becomes a battle map and a scene.</p>
              <button type="button" onClick={() => setShowUpload(true)} style={{ ...small, width: "100%" }}>Upload a map image</button>
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

          {panel === "sound" && isGm && (
            <SoundPanel campaignId={campaignId} supabase={supabase} audio={tableAudio.audio} serverNow={tableAudio.serverNow} save={tableAudio.save} missing={tableAudio.missing} />
          )}

          {panel === "tables" && (
            <RollTablesPanel campaignId={campaignId} isGm={isGm} supabase={supabase} asWho={asWho} gmName={gmName}
              onPosted={(m) => addFeed([m as Message], [])} />
          )}

          {panel === "handouts" && (
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {isGm && (
                <>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Show a handout</div>
                  <p style={{ color: C.muted, fontSize: 12, margin: "6px 0" }}>A handout is a wiki entry. It pops up for the players you pick and stays in their Codex.</p>
                  <input aria-label="Find an entry" value={hoQuery} onChange={(e) => setHoQuery(e.target.value.slice(0, 60))} placeholder="Find an entry…" style={field} />
                  <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 6, border: `1px solid ${C.line}`, borderRadius: 7 }} role="listbox" aria-label="Wiki entries">
                    {hoEntries === null && <p style={{ color: C.muted, fontSize: 12, margin: 8 }}>Loading the wiki…</p>}
                    {hoEntries !== null && hoEntries.length === 0 && <p style={{ color: C.muted, fontSize: 12, margin: 8 }}>No wiki entries yet. Write one in the Codex first.</p>}
                    {(hoEntries ?? []).filter((x) => !hoQuery.trim() || x.title.toLowerCase().includes(hoQuery.trim().toLowerCase())).slice(0, 60).map((x) => (
                      <button key={x.id} type="button" role="option" aria-selected={hoPick === x.id} onClick={() => setHoPick(x.id)}
                        style={{ display: "flex", width: "100%", gap: 6, padding: "6px 8px", background: hoPick === x.id ? C.surface2 : "transparent", color: hoPick === x.id ? C.sun : C.text, border: "none", borderBottom: `1px solid ${C.line}`, textAlign: "left", fontSize: 12.5, cursor: "pointer" }}>
                        <span style={{ flex: 1 }}>{x.title}</span><span style={{ color: C.muted, fontSize: 11 }}>{x.type}{x.visibility === "gm" ? ", GM only" : ""}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }} role="group" aria-label="Show it to">
                    <button type="button" aria-pressed={hoTo === null} onClick={() => setHoTo(null)} style={{ ...small, padding: "3px 9px", color: hoTo === null ? C.sun : C.muted, borderColor: hoTo === null ? C.sun : C.line }}>Everyone</button>
                    {party.filter((p) => p.character_id).map((p) => {
                      const on = !!hoTo && hoTo.includes(p.character_id as string);
                      return <button key={p.character_id} type="button" aria-pressed={on} onClick={() => setHoTo((cur) => { const list = cur ?? []; const next = on ? list.filter((c) => c !== p.character_id) : [...list, p.character_id as string]; return next.length ? next : null; })}
                        style={{ ...small, padding: "3px 9px", color: on ? C.sun : C.muted, borderColor: on ? C.sun : C.line }}>{p.name}</button>;
                    })}
                  </div>
                  <button type="button" disabled={!hoPick || hoBusy} onClick={() => void showHandout()} style={{ ...small, marginTop: 8, width: "100%", background: hoPick ? C.sun : "transparent", color: hoPick ? "#1b1712" : C.muted, border: hoPick ? "none" : `1px solid ${C.line}`, fontWeight: 600, padding: "8px 0" }}>
                    {hoBusy ? "Showing…" : hoTo === null ? "Show it to everyone" : `Show it to ${hoTo.length}`}
                  </button>
                  <a href="/gm/codex" target="_blank" rel="noopener" style={{ display: "block", marginTop: 6, fontSize: 12, color: C.muted }}>Write a new entry in the Codex</a>
                </>
              )}
              <div style={{ fontWeight: 600, fontSize: 13, marginTop: isGm ? 18 : 0 }}>{isGm ? "Shown at this table" : "Handouts"}</div>
              {handouts.length === 0 && <p style={{ color: C.muted, fontSize: 12.5 }}>{isGm ? "Nothing shown yet." : "The GM has not shown you anything yet."}</p>}
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {handouts.map((h) => (
                  <div key={h.id} style={{ display: "flex", gap: 6, alignItems: "center", border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px" }}>
                    <button type="button" onClick={() => setOpenHandout(h)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", color: C.text, cursor: "pointer", padding: 0, fontSize: 13 }}>
                      {h.title}
                      <span style={{ display: "block", fontSize: 11, color: C.muted }}>{isGm ? `to ${h.shownTo ? h.shownTo.join(", ") : "everyone"}, ` : ""}{new Date(h.shownAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </button>
                    {isGm && <button type="button" onClick={() => send("handout", { id: h.id, characters: null })} title="Pop it up again for the players it was shown to" style={{ ...small, padding: "3px 8px" }}>Again</button>}
                    {isGm && <button type="button" onClick={() => void hideHandout(h.id)} title="Take it back: the players lose what this showing revealed" style={{ ...small, padding: "3px 8px", color: "#e07a70" }}>Hide</button>}
                  </div>
                ))}
              </div>
              {chatErr && <p role="status" style={{ color: "#e07a70", fontSize: 12, marginTop: 10 }}>{chatErr}</p>}
            </div>
          )}
        </div>
      </div>
      {showUpload && <MapUpload campaignId={campaignId} onClose={() => setShowUpload(false)} onDone={() => { setShowUpload(false); void load().then(() => { fit(); send("refresh", {}); }); }} />}
      {openHandout && <HandoutView h={openHandout} onClose={() => setOpenHandout(null)} />}
      {makerFor && tokensRef.current.get(makerFor) && (() => {
        const tk = tokensRef.current.get(makerFor)!;
        return (
          <div role="dialog" aria-modal="true" aria-label={`Token maker for ${tk.name}`} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(10,8,6,0.78)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "24px 12px" }}>
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, width: "min(1000px, 100%)", boxSizing: "border-box" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <strong style={{ flex: 1, fontSize: 16 }}>Token maker: {tk.name}</strong>
                <button type="button" onClick={() => setMakerFor(null)} style={small}>Close</button>
              </div>
              <TokenMaker mode="app" name={tk.name} initialImage={tk.image_url} initialFrame={tk.style?.frame}
                onSave={(r) => saveLook(tk.id, r)} onCancel={() => setMakerFor(null)} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
