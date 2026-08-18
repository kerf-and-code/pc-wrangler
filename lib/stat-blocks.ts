import type { SupabaseClient } from "@supabase/supabase-js";
import type { PF2Creature } from "@/lib/pf2e/creature";
import type { DHAdversary } from "@/lib/daggerheart/adversary";
import type { DSAdversary } from "@/lib/drawsteel/adversary";

/**
 * Persistence for GM monster stat blocks. Mirrors lib/pc-library.ts in spirit: a stat block is a
 * living JSONB document (`block`) plus denormalized challenge columns (cr/xp/ac/hp/size/type, and
 * level for PF2e) the encounter builder reads without parsing JSON. A block with campaign_id null is
 * library-wide (usable in any of the GM's campaigns); a block pinned to a campaign is readable by its
 * members.
 *
 * Unlike the Forge, there is NO derivation: a monster's numbers are authored directly, so what the
 * GM types into the block IS the stat block. The denorm columns are kept in sync on every save.
 *
 * Multi-system: every block carries a `system` ('dnd5e' default, 'pf2e', ...). A D&D block is a
 * StatBlockDoc; a PF2e block is a PF2Creature. The row keeps `block` typed as the D&D shape for
 * back-compat with existing callers - the PF2e editor narrows by `system` and casts. The denorm
 * dispatches on system (D&D uses cr/xp; PF2e uses level).
 */

// The full D&D stat block document. Matches the shape templated from monsters-2014.json plus the
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

// A stored block is one system's document. Callers that know the system narrow by it.
export type AnyStatBlock = StatBlockDoc | PF2Creature | DHAdversary | DSAdversary;

export type StatBlockRow = {
  id: string;
  gm_id: string;
  campaign_id: string | null;
  name: string;
  system: string;              // 'dnd5e' | 'pf2e' | ...
  cr: string | null;
  xp: number | null;
  level: number | null;        // PF2e priced by level; null for D&D
  ac: number | null;
  hp: number | null;
  size: string | null;
  type: string | null;
  portrait_path: string | null;
  source_edition: string;
  block: StatBlockDoc;         // for PF2e rows this is actually a PF2Creature; narrow by `system`
  created_at: string;
  updated_at: string;
};

export type StatBlockDenorm = {
  cr: string | null;
  xp: number | null;
  level: number | null;
  ac: number | null;
  hp: number | null;
  size: string | null;
  type: string | null;
};

// Pull the denorm columns out of a block so a save keeps them in sync with the JSONB. Dispatches on
// system: D&D uses cr/xp (level null); PF2e uses level (cr/xp null), and takes its "type" from the
// first creature trait.
export function denormFromBlock(system: string, block: AnyStatBlock): StatBlockDenorm {
  if (system === "pf2e") {
    const c = block as PF2Creature;
    return {
      cr: null, xp: null,
      level: typeof c.level === "number" ? c.level : null,
      ac: c.ac ?? null, hp: c.hp ?? null,
      size: c.size || null,
      type: (c.traits && c.traits[0]) || "creature",
    };
  }
  if (system === "daggerheart") {
    const a = block as DHAdversary;
    return {
      cr: null, xp: null,
      level: typeof a.tier === "number" ? a.tier : null,   // Daggerheart adversaries priced by tier
      ac: null, hp: a.hp ?? null,
      size: null, type: a.type || null,
    };
  }
  if (system === "drawsteel") {
    const a = block as DSAdversary;
    return {
      // Draw Steel monsters are priced by Encounter Value (EV): stored in `xp` so the encounter builder
      // reads the authored cost straight from the denorm without parsing the block. `level` is the
      // creature's level (used for the level-cap check), `type` its organization, `hp` its Stamina.
      cr: null, xp: typeof a.ev === "number" ? a.ev : null,
      level: typeof a.level === "number" ? a.level : null,
      ac: null, hp: a.stamina ?? null,
      size: a.size || null, type: a.organization || null,
    };
  }
  const b = block as StatBlockDoc;
  return {
    cr: b.cr || null, xp: b.xp ?? null, level: null,
    ac: b.ac ?? null, hp: b.hp ?? null,
    size: b.size || null, type: b.type || null,
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

// Insert a new stat block. campaignId null = library-wide. `system` defaults to 'dnd5e' so existing
// callers keep working unchanged. Returns the new id.
export async function createStatBlock(
  sb: SupabaseClient,
  args: { gmId: string; campaignId: string | null; name: string; system?: string; sourceEdition: string; block: AnyStatBlock },
): Promise<string> {
  const system = args.system ?? "dnd5e";
  const denorm = denormFromBlock(system, args.block);
  const { data, error } = await sb
    .from("stat_blocks")
    .insert({
      gm_id: args.gmId,
      campaign_id: args.campaignId,
      name: args.name,
      system,
      source_edition: args.sourceEdition,
      block: args.block,
      ...denorm,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

// Update an existing stat block's name + block + denorm columns. `system` defaults to 'dnd5e'.
export async function updateStatBlock(
  sb: SupabaseClient,
  id: string,
  args: { name: string; campaignId?: string | null; system?: string; block: AnyStatBlock },
): Promise<void> {
  const system = args.system ?? "dnd5e";
  const denorm = denormFromBlock(system, args.block);
  const patch: Record<string, unknown> = {
    name: args.name,
    system,
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

// A blank D&D stat block for start-from-scratch authoring. Sensible defaults; the GM fills the rest.
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
