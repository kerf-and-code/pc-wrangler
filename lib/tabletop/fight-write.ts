import type { SupabaseClient } from "@supabase/supabase-js";

// lib/tabletop/fight-write.ts (2026-11-12, push 45: audit round 2, B7)
//
// A GM's change to a running fight is read, change, write back: the tabletop and the Combat page read
// the fight row, apply the change, and save the whole combatants list. A player's save, attack or
// initiative landing between the read and the write was overwritten. p168 gives combats a `version`
// that the database raises on every update (any writer, the database functions included), so the write
// here only lands when nobody changed the row since it was read; otherwise the change is applied again
// to a fresh read, up to three times.
//
// Before p168 there is no version column: the read fails on it, and this falls back to the old,
// unchecked write so a fight still saves.

type Row = { id: string; version?: number };

export type FightWrite<R> = { row: R | null; error: string | null; conflicts: number };

export async function writeFight<R extends Row>(
  sb: SupabaseClient, id: string, cols: string, change: (fresh: R) => Record<string, unknown>, tries = 3,
): Promise<FightWrite<R>> {
  let conflicts = 0;
  for (let i = 0; i < tries; i++) {
    const read = await sb.from("combats").select(`${cols}, version`).eq("id", id).maybeSingle();
    if (read.error && /version/.test(read.error.message)) return legacy<R>(sb, id, cols, change);
    if (read.error) return { row: null, error: read.error.message, conflicts };
    const fresh = read.data as unknown as R | null;
    if (!fresh) return { row: null, error: "That fight is gone.", conflicts };
    const patch = { ...change(fresh), updated_at: new Date().toISOString() };
    const up = await sb.from("combats").update(patch).eq("id", id).eq("version", fresh.version ?? 0).select(`${cols}, version`).maybeSingle();
    if (up.error) return { row: null, error: up.error.message, conflicts };
    if (up.data) return { row: up.data as unknown as R, error: null, conflicts };
    conflicts += 1; // someone wrote in between: read again and apply the change to what is there now
  }
  return { row: null, error: "The fight kept changing while saving. Try again.", conflicts };
}

async function legacy<R extends Row>(sb: SupabaseClient, id: string, cols: string, change: (fresh: R) => Record<string, unknown>): Promise<FightWrite<R>> {
  const read = await sb.from("combats").select(cols).eq("id", id).maybeSingle();
  if (read.error) return { row: null, error: read.error.message, conflicts: 0 };
  const fresh = read.data as unknown as R | null;
  if (!fresh) return { row: null, error: "That fight is gone.", conflicts: 0 };
  const up = await sb.from("combats").update({ ...change(fresh), updated_at: new Date().toISOString() }).eq("id", id).select(cols).maybeSingle();
  if (up.error) return { row: null, error: up.error.message, conflicts: 0 };
  return { row: (up.data as unknown as R | null) ?? null, error: null, conflicts: 0 };
}
