import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompendiumEntry } from "@/lib/compendium/types";

// lib/compendium/dm-board.ts
//
// The DM Screen: a GM's free-form boards of compendium cards (migration p92). A board is one row in
// dm_boards; its placed cards live in the `cards` jsonb array as SNAPSHOTS (the full CompendiumEntry at
// send time) plus a free-form position and size. Snapshots keep a board self-contained and stable, and
// mean viewing it needs no per-system index loaded.
//
// The pure helper (newPlacement / cascade) carries no Supabase; the CRUD wraps sb.from("dm_boards")
// under owner-only RLS (gm_id = auth.uid()), the same pattern as lib/compendium/custom.ts.

export interface PlacedCard {
  id: string;             // placement id (not the entry id: the same entry can be placed twice)
  entry: CompendiumEntry; // snapshot of the card at send time
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DmBoard {
  id: string;
  gm_id: string;
  campaign_id: string | null;
  name: string;
  cards: PlacedCard[];
  created_at: string;
  updated_at: string;
}

const TABLE = "dm_boards";
const uid = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Default card size and the cascade offset for a freshly sent card, so sends don't stack exactly.
export const DEFAULT_CARD_W = 320;
export const DEFAULT_CARD_H = 240;
export function newPlacement(entry: CompendiumEntry, index: number): PlacedCard {
  const step = (index % 8) * 28;
  return { id: uid(), entry, x: 28 + step, y: 28 + step, w: DEFAULT_CARD_W, h: DEFAULT_CARD_H };
}

function normalize(b: Record<string, unknown>): DmBoard {
  return { ...(b as unknown as DmBoard), cards: Array.isArray((b as { cards?: unknown }).cards) ? (b as { cards: PlacedCard[] }).cards : [] };
}

// ---- CRUD (RLS restricts every call to the caller's own rows) -------------------------------------

export async function listBoards(sb: SupabaseClient): Promise<DmBoard[]> {
  const { data, error } = await sb.from(TABLE).select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) || []).map(normalize);
}

export async function createBoard(sb: SupabaseClient, gmId: string, name: string, campaignId: string | null = null): Promise<DmBoard> {
  const { data, error } = await sb
    .from(TABLE)
    .insert({ gm_id: gmId, name: name || "New board", campaign_id: campaignId, cards: [] })
    .select("*")
    .single();
  if (error) throw error;
  return normalize(data as Record<string, unknown>);
}

export async function renameBoard(sb: SupabaseClient, id: string, name: string): Promise<void> {
  const { error } = await sb.from(TABLE).update({ name: name || "New board", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteBoard(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}

export async function saveBoardCards(sb: SupabaseClient, id: string, cards: PlacedCard[]): Promise<void> {
  const { error } = await sb.from(TABLE).update({ cards, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// Send a card to a board as a snapshot. Targets `boardId` when given and still present; otherwise the
// GM's most-recent board, creating a default one if they have none. Returns the board id it landed on,
// so the caller can remember it (localStorage) and keep future sends going to the same board.
export async function sendCardToScreen(
  sb: SupabaseClient,
  gmId: string,
  boardId: string | null,
  entry: CompendiumEntry,
): Promise<string> {
  let board: DmBoard | null = null;
  if (boardId) {
    const { data } = await sb.from(TABLE).select("*").eq("id", boardId).maybeSingle();
    if (data) board = normalize(data as Record<string, unknown>);
  }
  if (!board) {
    const boards = await listBoards(sb);
    board = boards[0] ?? (await createBoard(sb, gmId, "My DM Screen"));
  }
  const cards = [...board.cards, newPlacement(entry, board.cards.length)];
  await saveBoardCards(sb, board.id, cards);
  return board.id;
}
