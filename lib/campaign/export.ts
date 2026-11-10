import type { SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { listAll } from "@/lib/storage/purge";

// lib/campaign/export.ts (2026-11-09)
//
// Audit F3: everything a GM built in a campaign, as one zip they can keep.
//
// WHAT IS IN IT: the campaign's own content (sessions and recaps, characters and NPCs, the codex, links,
// encounters, stat blocks, compendium entries, DM boards, arcs and moments, prep, loot and party stash,
// roll tables, battle maps, world map with its layers, regions, markers and labels, the other map
// builders, and the tabletop's scenes, tokens, pins, handouts, decks, drawings, templates and sounds)
// as JSON, the codex and recaps also as Markdown, and a list of the campaign's stored files.
//
// WHAT IS LEFT OUT, ON PURPOSE: players' private things (their notes, private character pages, self
// reports, dispositions, check-ins, consent records, attendance), people's chat and voice (table chat,
// transcripts, recordings: the transcripts page downloads transcripts), add-on keys and webhook addresses
// (secrets), and account ids (owner, Discord and invite ids are removed from character rows).

type Spec = { table: string; omit?: string[] };

const CAMPAIGN_TABLES: Spec[] = [
  { table: "sessions", omit: ["reminder_sent_at", "discord_recap_post"] },
  { table: "characters", omit: ["profile_id", "discord_user_id", "invite_code", "ddb_character_id", "identity_id"] },
  { table: "entries", omit: ["created_by"] },
  { table: "entity_links" },
  { table: "entry_reveals" },
  { table: "encounters" },
  { table: "stat_blocks", omit: ["gm_id"] },
  { table: "compendium_entries", omit: ["gm_id"] },
  { table: "dm_boards", omit: ["gm_id"] },
  { table: "arcs", omit: ["profile_id"] },
  { table: "arc_touches" },
  { table: "events" },
  { table: "gm_events" },
  { table: "session_plan_items" },
  { table: "loot_grants" },
  { table: "party_items" },
  { table: "party_funds" },
  { table: "roll_tables", omit: ["created_by"] },
  { table: "campaign_journals" },
  { table: "combats" },
  { table: "battle_maps" },
  { table: "dungeon_maps" },
  { table: "building_maps" },
  { table: "bastion_maps" },
  { table: "maps" },
  { table: "map_pins" },
  { table: "map_icons" },
  { table: "world_maps" },
  { table: "vtt_scenes" },
  { table: "vtt_tokens" },
  { table: "vtt_pins" },
  { table: "vtt_handouts" },
  { table: "vtt_decks" },
  { table: "vtt_cards" },
  { table: "vtt_drawings" },
  { table: "vtt_templates" },
  { table: "vtt_effects" },
  { table: "vtt_sounds" },
  { table: "vtt_audio" },
];
const WORLD_MAP_TABLES = ["map_layers", "regions", "world_hexes", "map_features", "map_pois", "map_labels", "map_images"];
const PAGE = 1000;
const MAX_ROWS = 50000;

async function readAll(admin: SupabaseClient, table: string, col: string, ids: string[]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const q = admin.from(table).select("*").range(from, from + PAGE - 1);
    const { data, error } = ids.length === 1 ? await q.eq(col, ids[0]) : await q.in(col, ids);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data as Record<string, unknown>[]) ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const strip = (rows: Record<string, unknown>[], omit?: string[]) =>
  omit?.length ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !omit.includes(k)))) : rows;

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";

export async function buildCampaignExport(admin: SupabaseClient, campaignId: string): Promise<{ zip: Buffer; name: string; counts: Record<string, number>; skipped: string[] }> {
  const { data: camp, error: cErr } = await admin.from("campaigns")
    .select("id, name, system, created_at, time_zone, recur_rule, public_slug, public_blurb, codex_cover_url")
    .eq("id", campaignId).single();
  if (cErr || !camp) throw new Error(`campaign: ${cErr?.message ?? "not found"}`);
  const c = camp as Record<string, unknown> & { name: string };

  const zip = new JSZip();
  const counts: Record<string, number> = {};
  const skipped: string[] = [];
  const data: Record<string, Record<string, unknown>[]> = {};

  for (const spec of CAMPAIGN_TABLES) {
    try {
      data[spec.table] = strip(await readAll(admin, spec.table, "campaign_id", [campaignId]), spec.omit);
    } catch (e) {
      // A table this database does not have (an optional feature never migrated) is noted, not fatal.
      skipped.push(e instanceof Error ? e.message : spec.table);
    }
  }
  const worldIds = (data.world_maps ?? []).map((w) => String(w.id));
  if (worldIds.length) {
    for (const t of WORLD_MAP_TABLES) {
      try { data[t] = await readAll(admin, t, "world_map_id", worldIds); }
      catch (e) { skipped.push(e instanceof Error ? e.message : t); }
    }
  }

  zip.file("campaign.json", JSON.stringify(c, null, 2));
  for (const [t, rows] of Object.entries(data)) {
    counts[t] = rows.length;
    if (rows.length) zip.file(`data/${t}.json`, JSON.stringify(rows, null, 2));
  }

  // The codex and the recaps, readable without any tool.
  for (const e of data.entries ?? []) {
    const title = String(e.title ?? "Untitled");
    const body = [`# ${title}`, "", `Type: ${e.type ?? ""}  `, `Visibility: ${e.visibility ?? ""}`, "", e.summary ? `${e.summary}\n` : "", String(e.body ?? "")].join("\n");
    zip.file(`codex/${slug(String(e.type ?? "entry"))}/${slug(title)}-${String(e.id).slice(0, 8)}.md`, body);
  }
  for (const s of data.sessions ?? []) {
    if (!s.recap) continue;
    const n = s.session_number != null ? String(s.session_number).padStart(3, "0") : String(s.id).slice(0, 8);
    zip.file(`recaps/session-${n}.md`, `# ${c.name}, Session ${s.session_number ?? ""}\n\n${String(s.recap)}\n`);
  }

  // The stored files: maps, portraits, tokens, sounds and pictures (not the voice recordings).
  const files: { bucket: string; path: string; url?: string }[] = [];
  for (const bucket of ["campaign-maps", "table-files"]) {
    try {
      for (const path of await listAll(admin, bucket, campaignId)) {
        files.push(bucket === "campaign-maps"
          ? { bucket, path, url: admin.storage.from(bucket).getPublicUrl(path).data.publicUrl }
          : { bucket, path });
      }
    } catch (e) { skipped.push(e instanceof Error ? e.message : bucket); }
  }
  zip.file("files.json", JSON.stringify(files, null, 2));

  zip.file("README.txt", [
    `Six Axes campaign export: ${c.name}`,
    `Made ${new Date().toISOString()}`,
    "",
    "campaign.json   the campaign's settings",
    "data/*.json     every record, one file per kind (sessions, characters, entries, maps, tabletop...)",
    "codex/          codex entries as Markdown",
    "recaps/         session recaps as Markdown",
    "files.json      the campaign's stored files; campaign-maps entries carry a public link",
    "",
    "Not included: players' private notes and pages, self-reports, dispositions, check-ins, consent and",
    "attendance records, table chat, transcripts and recordings (download transcripts from the",
    "Transcripts page), add-on keys and webhook addresses, and account ids.",
    skipped.length ? `\nCould not read: ${skipped.join("; ")}` : "",
  ].join("\n"));

  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return { zip: buf, name: `${slug(c.name)}-${stamp}.zip`, counts, skipped };
}
