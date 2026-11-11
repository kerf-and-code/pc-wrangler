import type { SupabaseClient } from "@supabase/supabase-js";
import { listAll, removeAll } from "@/lib/storage/purge";

// lib/campaign/duplicate.ts (2026-11-10, push 24, audit F16)
//
// Duplicate a campaign as a starting point for another table: the GM's prepared world, without the
// people or the history.
//
// COPIED: the codex (entries and the links between them), NPCs and other non-player characters, stat
// blocks and the campaign's compendium entries, encounters, roll tables, DM boards, prep items, every map
// (battle, dungeon, building and bastion maps, image maps with their pins and icons, and the world map
// with its layers, regions, hexes, features, markers, labels and images), the tabletop's scenes (fog
// and doors reset) and card decks (every card back in the draw pile), and the stored files those use.
//
// LEFT OUT, ON PURPOSE: players and their characters, memberships and invites, sessions, recaps,
// recordings and transcripts, moments and events, arcs, loot and the party stash, fights, tokens,
// handouts shown, chat, the public codex page, Discord links and add-on keys.
//
// HOW: every copied row gets a new id first, so references between copied rows can be pointed at the
// copies wherever they sit (a column, or deep inside a JSON value such as an encounter's monster list).
// A reference to something that is not copied (a player's character, a session) is cleared, or the row
// is dropped when it means nothing without it. Stored files under the campaign's folder are copied to
// the new campaign's folder and every path or link is rewritten to match. If anything fails, the new
// campaign and its copied files are removed again, so a half-made copy never stays behind.

export type Row = Record<string, unknown>;
type FkRule = "drop" | "null";
export type CopySpec = {
  table: string;
  /** Which rows: by campaign (default) or by the parent world map. */
  by?: "campaign" | "world_map";
  keep?: (r: Row) => boolean;
  /** Columns that point at another copied row: if the target is not copied, drop the row or clear it. */
  fk?: Record<string, FkRule>;
  /** Fixed values for the copy. "@caller" is the person duplicating. Only set where the row has the column. */
  set?: Record<string, unknown>;
  /** Columns left out so the database fills them afresh. */
  omit?: string[];
};

export const CALLER = "@caller";

/** In insert order: a row's targets are always copied before it. */
export const COPY_SPECS: CopySpec[] = [
  { table: "entries", set: { created_by: CALLER, is_public: false } },
  { table: "characters", keep: (r) => r.kind !== "pc", fk: { alter_ego_of: "null" },
    set: { profile_id: null, discord_user_id: null, ddb_character_id: null, identity_id: null, is_public: false }, omit: ["invite_code"] },
  { table: "stat_blocks", set: { gm_id: CALLER } },
  { table: "compendium_entries", set: { gm_id: CALLER } },
  { table: "dm_boards", set: { gm_id: CALLER } },
  { table: "encounters" },
  { table: "roll_tables", set: { created_by: CALLER } },
  { table: "battle_maps" },
  { table: "dungeon_maps" },
  { table: "building_maps" },
  { table: "bastion_maps" },
  { table: "maps", fk: { linked_entry_id: "null" } },
  { table: "map_pins", fk: { map_id: "drop", linked_id: "null" } },
  { table: "map_icons" },
  { table: "world_maps", set: { published: false } },
  { table: "map_layers", by: "world_map" },
  { table: "regions", by: "world_map", fk: { layer_id: "drop", parent_region_id: "null", entry_id: "null" } },
  { table: "world_hexes", by: "world_map", fk: { region_id: "null" } },
  { table: "map_features", by: "world_map" },
  { table: "map_pois", by: "world_map", fk: { entry_id: "null", character_id: "null", icon_id: "null" } },
  { table: "map_labels", by: "world_map" },
  { table: "map_images", by: "world_map" },
  { table: "vtt_scenes", fk: { battle_map_id: "drop" }, set: { revealed: "\\x", door_state: {} } },
  { table: "vtt_decks" },
  { table: "vtt_cards", fk: { deck_id: "drop" }, set: { pile: "draw", holder: null, played_by: null, face_up: false } },
  { table: "session_plan_items", fk: { linked_character_id: "null" }, set: { linked_event_id: null, done: false } },
  { table: "entity_links", fk: { source_id: "drop", target_id: "drop" } },
];

export const FILE_BUCKETS = ["campaign-maps", "table-files"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every string in a value: an exact copied id becomes its copy; the old campaign id inside a path or
 *  link becomes the new one. Objects and arrays are walked; other values pass through. */
export function remapDeep(v: unknown, ids: Map<string, string>, oldCampaign: string, newCampaign: string): unknown {
  if (typeof v === "string") {
    const exact = UUID_RE.test(v) ? ids.get(v.toLowerCase()) : undefined;
    if (exact) return exact;
    return v.includes(oldCampaign) ? v.split(oldCampaign).join(newCampaign) : v;
  }
  if (Array.isArray(v)) return v.map((x) => remapDeep(x, ids, oldCampaign, newCampaign));
  if (v && typeof v === "object") {
    const out: Row = {};
    for (const [k, x] of Object.entries(v as Row)) out[k] = remapDeep(x, ids, oldCampaign, newCampaign);
    return out;
  }
  return v;
}

/**
 * The copy of one row, or null when it should not be copied (its required target is not copied). `ids`
 * holds every old id to new id, the campaign's included.
 */
export function copyRow(row: Row, spec: CopySpec, ids: Map<string, string>, oldCampaign: string, newCampaign: string, caller: string): Row | null {
  for (const [col, rule] of Object.entries(spec.fk ?? {})) {
    const v = row[col];
    if (v == null) continue;
    if (!ids.has(String(v).toLowerCase())) {
      if (rule === "drop") return null;
      row = { ...row, [col]: null };
    }
  }
  const out = remapDeep(row, ids, oldCampaign, newCampaign) as Row;
  for (const [k, v] of Object.entries(spec.set ?? {})) if (k in out) out[k] = v === CALLER ? caller : v;
  for (const k of spec.omit ?? []) delete out[k];
  return out;
}

export type DuplicateResult = { campaignId: string; name: string; counts: Record<string, number>; files: number; skipped: string[] };

const PAGE = 1000;
const MAX_ROWS = 50000;
const CHUNK = 500;

async function readAll(admin: SupabaseClient, table: string, col: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await admin.from(table).select("*").in(col, ids).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data as Row[]) ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Duplicate `sourceId` into a new campaign owned by `caller`. Takes the service-role client. */
export async function duplicateCampaign(admin: SupabaseClient, sourceId: string, caller: string, name?: string): Promise<DuplicateResult> {
  const { data: src, error: sErr } = await admin.from("campaigns")
    .select("id, name, system, time_zone, codex_cover_url").eq("id", sourceId).is("deleted_at", null).single();
  if (sErr || !src) throw new Error(`campaign: ${sErr?.message ?? "not found"}`);
  const s = src as { id: string; name: string; system: string | null; time_zone: string | null; codex_cover_url: string | null };

  // 1. Read everything first, so nothing is written for a campaign that cannot be read.
  const rows: Record<string, Row[]> = {};
  const skipped: string[] = [];
  for (const spec of COPY_SPECS.filter((x) => (x.by ?? "campaign") === "campaign")) {
    try {
      const all = await readAll(admin, spec.table, "campaign_id", [sourceId]);
      rows[spec.table] = spec.keep ? all.filter(spec.keep) : all;
    } catch (e) { skipped.push(e instanceof Error ? e.message : spec.table); rows[spec.table] = []; }
  }
  const worldIds = (rows.world_maps ?? []).map((w) => String(w.id));
  for (const spec of COPY_SPECS.filter((x) => x.by === "world_map")) {
    try { rows[spec.table] = worldIds.length ? await readAll(admin, spec.table, "world_map_id", worldIds) : []; }
    catch (e) { skipped.push(e instanceof Error ? e.message : spec.table); rows[spec.table] = []; }
  }

  // 2. New ids for every row, and for the campaign.
  const newId = crypto.randomUUID();
  const ids = new Map<string, string>([[sourceId.toLowerCase(), newId]]);
  for (const list of Object.values(rows)) for (const r of list) if (typeof r.id === "string") ids.set(r.id.toLowerCase(), crypto.randomUUID());

  // 3. The campaign itself, and its owner's membership.
  const copyName = (name?.trim() || `${s.name} (copy)`).slice(0, 120);
  const cover = s.codex_cover_url ? s.codex_cover_url.split(sourceId).join(newId) : null;
  // The table's language (p152) travels with the copy. Read on its own so a database without that
  // column still duplicates.
  const { data: langRow, error: langErr } = await admin.from("campaigns").select("audio_language").eq("id", sourceId).maybeSingle();
  const lang = !langErr ? (langRow as { audio_language: string | null } | null)?.audio_language ?? null : null;
  // The in-game calendar and the date the story stands at (p154), the same way: a module's calendar
  // is part of its world.
  const { data: calRow, error: calErr } = await admin.from("campaigns").select("world_calendar, world_day").eq("id", sourceId).maybeSingle();
  const world = !calErr && calRow ? (calRow as { world_calendar: unknown; world_day: number | null }) : null;
  const { error: cErr } = await admin.from("campaigns").insert({
    id: newId, name: copyName, system: s.system ?? "5e", gm_id: caller, time_zone: s.time_zone, codex_cover_url: cover,
    ...(lang ? { audio_language: lang } : {}),
    ...(world?.world_calendar ? { world_calendar: world.world_calendar, world_day: world.world_day } : {}),
  });
  if (cErr) throw new Error(`campaigns: ${cErr.message}`);
  const copiedFiles: { bucket: string; path: string }[] = [];
  try {
    const { error: mErr } = await admin.from("memberships").insert({ campaign_id: newId, profile_id: caller, role: "gm" });
    if (mErr) throw new Error(`memberships: ${mErr.message}`);

    // 4. The stored files, before the rows that point at them.
    for (const bucket of FILE_BUCKETS) {
      let paths: string[] = [];
      try { paths = await listAll(admin, bucket, sourceId); }
      catch (e) { skipped.push(e instanceof Error ? e.message : bucket); continue; }
      for (const path of paths) {
        const to = path.split(sourceId).join(newId);
        const { error } = await admin.storage.from(bucket).copy(path, to);
        if (error) throw new Error(`${bucket}/${path}: ${error.message}`);
        copiedFiles.push({ bucket, path: to });
      }
    }

    // 5. The rows, parents first.
    const counts: Record<string, number> = {};
    for (const spec of COPY_SPECS) {
      const out = (rows[spec.table] ?? [])
        .map((r) => copyRow(r, spec, ids, sourceId, newId, caller))
        .filter((r): r is Row => r !== null);
      for (let i = 0; i < out.length; i += CHUNK) {
        const { error } = await admin.from(spec.table).insert(out.slice(i, i + CHUNK));
        if (error) throw new Error(`${spec.table}: ${error.message}`);
      }
      counts[spec.table] = out.length;
    }
    return { campaignId: newId, name: copyName, counts, files: copiedFiles.length, skipped };
  } catch (e) {
    // Undo: the campaign goes (its rows cascade with it) and so do the copied files.
    await admin.from("campaigns").delete().eq("id", newId);
    for (const bucket of FILE_BUCKETS) {
      const mine = copiedFiles.filter((f) => f.bucket === bucket).map((f) => f.path);
      if (mine.length) await removeAll(admin, bucket, mine);
    }
    throw e;
  }
}
