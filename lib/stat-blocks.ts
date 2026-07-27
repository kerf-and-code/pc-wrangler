import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Persistence for GM monster stat blocks. Mirrors lib/pc-library.ts in spirit: a stat block is a
 * living JSONB document (`block`) plus denormalized challenge columns (cr/xp/ac/hp/size/type) the
 * encounter builder reads without parsing JSON. A block with campaign_id null is library-wide
 * (usable in any of the GM's campaigns); a block pinned to a campaign is readable by its members.
 *
 * Unlike the Forge, there is NO derivation: a monster's numbers are authored directly, so what the
 * GM types into the block IS the stat block. The denorm columns are kept in sync on every save.
 */

// The full stat block document. Matches the shape templated from monsters-2014.json plus the
// custom-authoring fields the schema reserves (bonus_actions, reactions, special_attacks, link).
export type NamedEntry = { name: string; desc: string };

export type StatBlockDoc = {
  size: string;
  type: string;
  subtype?: string;
  tags?: string[];
  alignment: string;
  ac: number | null;
  ac_note?: string;
  hp: number | null;
  hit_dice?: string;
  speed: string;
  initiative?: number | null;
  str: number; dex: number; con: number; int: number; wis: number; cha: number;
  cr: string;
  xp: number | null;
  proficiency_bonus?: number | null;
  senses: string;
  languages: string;
  damage_vulnerabilities: string[];
  damage_resistances: string[];
  damage_immunities: string[];
  condition_immunities: string[];
  special_abilities: NamedEntry[];   // traits
  actions: NamedEntry[];
  bonus_actions: NamedEntry[];
  reactions: NamedEntry[];
  legendary_actions: NamedEntry[];
  special_attacks: NamedEntry[];
  link?: string;
  notes?: string;
};

export type StatBlockRow = {
  id: string;
  gm_id: string;
  campaign_id: string | null;
  name: string;
  cr: string | null;
  xp: number | null;
  ac: number | null;
  hp: number | null;
  size: string | null;
  type: string | null;
  portrait_path: string | null;
  source_edition: string;
  block: StatBlockDoc;
  created_at: string;
  updated_at: string;
};

export type StatBlockDenorm = {
  cr: string | null;
  xp: number | null;
  ac: number | null;
  hp: number | null;
  size: string | null;
  type: string | null;
};

// Pull the denorm columns out of a block so a save keeps them in sync with the JSONB.
export function denormFromBlock(block: StatBlockDoc): StatBlockDenorm {
  return {
    cr: block.cr || null,
    xp: block.xp ?? null,
    ac: block.ac ?? null,
    hp: block.hp ?? null,
    size: block.size || null,
    type: block.type || null,
  };
}

// List a GM's stat blocks (their own library plus anything pinned to their campaigns is covered by
// RLS). Newest first.
export async function listStatBlocks(sb: SupabaseClient): Promise<StatBlockRow[]> {
  const { data, error } = await sb
    .from("stat_blocks")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as StatBlockRow[]) || [];
}

export async function getStatBlock(sb: SupabaseClient, id: string): Promise<StatBlockRow | null> {
  const { data, error } = await sb.from("stat_blocks").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as StatBlockRow) || null;
}

// Insert a new stat block. campaignId null = library-wide. Returns the new id.
export async function createStatBlock(
  sb: SupabaseClient,
  args: { gmId: string; campaignId: string | null; name: string; sourceEdition: string; block: StatBlockDoc },
): Promise<string> {
  const denorm = denormFromBlock(args.block);
  const { data, error } = await sb
    .from("stat_blocks")
    .insert({
      gm_id: args.gmId,
      campaign_id: args.campaignId,
      name: args.name,
      source_edition: args.sourceEdition,
      block: args.block,
      ...denorm,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

// Update an existing stat block's name + block + denorm columns.
export async function updateStatBlock(
  sb: SupabaseClient,
  id: string,
  args: { name: string; campaignId?: string | null; block: StatBlockDoc },
): Promise<void> {
  const denorm = denormFromBlock(args.block);
  const patch: Record<string, unknown> = {
    name: args.name,
    block: args.block,
    updated_at: new Date().toISOString(),
    ...denorm,
  };
  if (args.campaignId !== undefined) patch.campaign_id = args.campaignId;
  const { error } = await sb.from("stat_blocks").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteStatBlock(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from("stat_blocks").delete().eq("id", id);
  if (error) throw error;
}

// Persist the uploaded portrait path (object path in the campaign-maps bucket) on a stat block.
export async function updateStatBlockPortrait(sb: SupabaseClient, id: string, portraitPath: string): Promise<void> {
  const { error } = await sb.from("stat_blocks").update({ portrait_path: portraitPath }).eq("id", id);
  if (error) throw error;
}

// A blank stat block for start-from-scratch authoring. Sensible defaults; the GM fills the rest.
export function blankStatBlock(): StatBlockDoc {
  return {
    size: "Medium", type: "humanoid", subtype: "", tags: [], alignment: "unaligned",
    ac: 12, ac_note: "", hp: 10, hit_dice: "", speed: "30 ft.", initiative: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: "1", xp: 200, proficiency_bonus: 2,
    senses: "", languages: "",
    damage_vulnerabilities: [], damage_resistances: [], damage_immunities: [],
    condition_immunities: [],
    special_abilities: [], actions: [], bonus_actions: [], reactions: [],
    legendary_actions: [], special_attacks: [],
    link: "", notes: "",
  };
}

// Convert an SRD monster record (monsters-2014.json shape, or the thinner 2024 one) into a fully
// populated StatBlockDoc to prefill the editor. Missing fields fall back to blank defaults. The
// 2024 records carry only core stats (no actions/traits), so those arrive empty for the GM to
// author, exactly the honest-degradation pattern the rest of the builder uses.
export function statBlockFromMonster(m: Record<string, unknown>): StatBlockDoc {
  const base = blankStatBlock();
  const arr = (v: unknown): NamedEntry[] =>
    Array.isArray(v) ? v.map((e) => ({ name: String((e as NamedEntry)?.name || ""), desc: String((e as NamedEntry)?.desc || "") })) : [];
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const num = (v: unknown): number | null => (typeof v === "number" ? v : v == null || v === "" ? null : Number(v) || null);
  // senses can be an object ({darkvision, passive_perception}) or a string.
  const senses = (() => {
    const s = m.senses;
    if (typeof s === "string") return s;
    if (s && typeof s === "object") {
      return Object.entries(s as Record<string, unknown>)
        .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ");
    }
    return "";
  })();
  return {
    ...base,
    size: String(m.size || base.size),
    type: String(m.type || base.type),
    subtype: String(m.subtype || ""),
    alignment: String(m.alignment || base.alignment),
    ac: num(m.ac),
    hp: num(m.hp),
    hit_dice: String(m.hit_dice || ""),
    speed: String(m.speed || base.speed),
    str: num(m.str) ?? 10, dex: num(m.dex) ?? 10, con: num(m.con) ?? 10,
    int: num(m.int) ?? 10, wis: num(m.wis) ?? 10, cha: num(m.cha) ?? 10,
    cr: String(m.cr ?? base.cr),
    xp: num(m.xp),
    proficiency_bonus: num(m.proficiency_bonus),
    senses,
    languages: String(m.languages || ""),
    damage_vulnerabilities: strArr(m.damage_vulnerabilities),
    damage_resistances: strArr(m.damage_resistances),
    damage_immunities: strArr(m.damage_immunities),
    condition_immunities: strArr(m.condition_immunities),
    special_abilities: arr(m.special_abilities),
    actions: arr(m.actions),
    legendary_actions: arr(m.legendary_actions),
    bonus_actions: arr(m.bonus_actions),
    reactions: arr(m.reactions),
    special_attacks: [],
  };
}
