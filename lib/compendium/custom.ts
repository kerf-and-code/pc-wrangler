import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CompendiumEntry, CompendiumSource, Ruleset,
  SpellDisplay, ItemDisplay, MonsterDisplay, CompendiumDisplay,
} from "@/lib/compendium/types";

// The categories a homebrew card can carry a full TYPED display for (so overriding a shipped spell edits
// it as a spell and renders through the real spell card, not the generic tag/meta/body shape). Everything
// else stores and renders through the generic "custom" display.
export const TYPED_CUSTOM = new Set(["spell", "magic-item", "monster"]);

// lib/compendium/custom.ts
//
// A GM's homebrew cards and non-destructive overrides for the voice compendium. Stored per GM in the
// compendium_entries table (migration p90), read client-side and layered over the static prebuilt index
// at load time. A row is either a brand-new card (overridesId null) or an override that shadows a
// shipped card by its id (e.g. "spell:fireball"); an override never touches the shipped JSON, so
// deleting the row reverts it.
//
// Every custom card - new or override - renders through the single "custom" display shape
// (tag / metaLines / body), so there is one editor and one card branch rather than a per-category
// matrix. The pure helpers (applicableRows / mergeCustom / rowToEntry / flattenForOverride) carry no
// React or Supabase, so they type-check and unit-check on their own.

export type Ruleset3 = "2014" | "2024" | "both";

// A row of compendium_entries. jsonb string[] columns are normalized to arrays on read.
export interface CustomRow {
  id: string;
  gm_id: string;
  campaign_id: string | null;
  system: string;
  ruleset: Ruleset3;
  category: string;
  overrides_id: string | null;
  name: string;
  source: string;
  tag: string | null;
  meta_lines: string[];
  body: string | null;
  // A full typed display (SpellDisplay | ItemDisplay | MonsterDisplay), stored as jsonb, for the categories
  // in TYPED_CUSTOM; null for a generic custom card. Added by migration p91 (nullable, so old rows read null).
  display: CompendiumDisplay | null;
  spoken: string[];
  aliases: string[];
  created_at: string;
  updated_at: string;
}

// What the editor produces and hands to create/update.
export interface CustomDraft {
  name: string;
  tag: string | null;
  ruleset: Ruleset3;
  metaLines: string[];
  body: string | null;
  display: CompendiumDisplay | null; // typed display for spell/magic-item/monster, else null (generic card)
  spoken: string[];
  aliases: string[];
  overridesId: string | null; // base entry id when overriding a shipped card, else null
  campaignId: string | null;  // pin to one campaign, or null for account-wide
  category: string;           // the base card's category on an override, else "custom"
  system?: string;            // default "dnd5e"
}

const TABLE = "compendium_entries";
const cleanPhrase = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);

function normalizeRow(r: CustomRow): CustomRow {
  return {
    ...r,
    meta_lines: arr(r.meta_lines),
    spoken: arr(r.spoken),
    aliases: arr(r.aliases),
    display: r.display && typeof r.display === "object" ? r.display : null,
  };
}

// ---- CRUD (RLS restricts every call to the caller's own rows: gm_id = auth.uid()) ----------------

export async function listCustomEntries(sb: SupabaseClient, system = "dnd5e"): Promise<CustomRow[]> {
  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .eq("system", system)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data as CustomRow[]) || []).map(normalizeRow);
}

export async function createCustomEntry(sb: SupabaseClient, gmId: string, draft: CustomDraft): Promise<string> {
  const { data, error } = await sb
    .from(TABLE)
    .insert({
      gm_id: gmId,
      campaign_id: draft.campaignId,
      system: draft.system ?? "dnd5e",
      ruleset: draft.ruleset,
      category: draft.category || "custom",
      overrides_id: draft.overridesId,
      name: draft.name || "Untitled",
      source: "kc",
      tag: draft.tag,
      meta_lines: draft.metaLines,
      body: draft.body,
      display: draft.display ?? null,
      spoken: draft.spoken,
      aliases: draft.aliases,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updateCustomEntry(sb: SupabaseClient, id: string, draft: CustomDraft): Promise<void> {
  const { error } = await sb
    .from(TABLE)
    .update({
      campaign_id: draft.campaignId,
      ruleset: draft.ruleset,
      category: draft.category || "custom",
      overrides_id: draft.overridesId,
      name: draft.name || "Untitled",
      tag: draft.tag,
      meta_lines: draft.metaLines,
      body: draft.body,
      display: draft.display ?? null,
      spoken: draft.spoken,
      aliases: draft.aliases,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCustomEntry(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}

// ---- pure mapping + merge ------------------------------------------------------------------------

// A stored row -> a CompendiumEntry the matcher and CardBody consume. `spoken` folds the name, any
// declared spoken phrases, and the aliases (cleaned + deduped) so the fuzzy matcher finds the card by
// name and by shorthand.
export function rowToEntry(r: CustomRow): CompendiumEntry {
  const spoken = new Set<string>();
  const add = (s: string) => { const p = cleanPhrase(s); if (p) spoken.add(p); };
  add(r.name);
  for (const s of r.spoken) add(s);
  for (const a of r.aliases) add(a);
  const source = (r.source === "srd" ? "srd" : "kc") as CompendiumSource;

  // Typed homebrew: a spell/magic-item/monster row carries a full display, so it renders through the real
  // per-category card. The id still carries the "custom:" prefix, so the tool tags it Homebrew and lets the
  // GM edit it, exactly like the generic cards.
  if (TYPED_CUSTOM.has(r.category) && r.display && typeof r.display === "object") {
    const base = { id: `custom:${r.id}`, name: r.name, ruleset: r.ruleset as Ruleset, source, spoken: [...spoken] };
    let typed: CompendiumEntry;
    if (r.category === "spell") typed = { ...base, category: "spell", display: r.display as SpellDisplay };
    else if (r.category === "magic-item") typed = { ...base, category: "magic-item", display: r.display as ItemDisplay };
    else typed = { ...base, category: "monster", display: r.display as MonsterDisplay };
    if (r.aliases.length) typed.aliases = r.aliases;
    return typed;
  }

  const entry: Extract<CompendiumEntry, { category: "custom" }> = {
    id: `custom:${r.id}`,
    name: r.name,
    category: "custom",
    ruleset: r.ruleset as Ruleset,
    source: (r.source === "srd" ? "srd" : "kc") as CompendiumSource,
    spoken: [...spoken],
    display: { tag: r.tag, metaLines: r.meta_lines, body: r.body },
  };
  if (r.aliases.length) entry.aliases = r.aliases;
  return entry;
}

// Rows that apply given the active edition toggle and active campaign: an entry shows when its ruleset
// matches the toggle (with "both" a wildcard on either side), and when it is account-wide or pinned to
// the active campaign.
export function applicableRows(rows: CustomRow[], ruleset: Ruleset3, activeCampaignId: string | null): CustomRow[] {
  return rows.filter((r) => {
    const rsOk = ruleset === "both" || r.ruleset === "both" || r.ruleset === ruleset;
    const campOk = r.campaign_id == null || r.campaign_id === activeCampaignId;
    return rsOk && campOk;
  });
}

// Layer the applicable custom rows over the static base entries: drop any base entry an override
// shadows, then append the custom entries. Pure.
export function mergeCustom(
  base: CompendiumEntry[],
  rows: CustomRow[],
  ruleset: Ruleset3,
  activeCampaignId: string | null,
): CompendiumEntry[] {
  const rel = applicableRows(rows, ruleset, activeCampaignId);
  const overrideIds = new Set(rel.map((r) => r.overrides_id).filter((x): x is string => !!x));
  const kept = base.filter((e) => !overrideIds.has(e.id));
  return [...kept, ...rel.map(rowToEntry)];
}

// Flatten any shipped entry into the editable custom shape, for prefilling the editor when a GM chooses
// to override it. Uses the category discriminant to reach the right display fields; the structured
// cards (monster/species/background) have no single description, so the body starts blank for the GM to
// write. The base id and category are carried so the save becomes a non-destructive override.
export function flattenForOverride(e: CompendiumEntry): {
  tag: string; metaLines: string[]; body: string; overridesId: string; category: string;
  display: SpellDisplay | ItemDisplay | MonsterDisplay | null;
} {
  const tag = e.category === "magic-item" ? "item" : e.category;
  let body = "";
  const meta: string[] = [];
  // The typed categories carry their full display into the editor, so an override edits a spell as a spell
  // (not a flattened blob). A structural clone keeps the editor from mutating the shipped entry in place.
  let display: SpellDisplay | ItemDisplay | MonsterDisplay | null = null;
  switch (e.category) {
    case "spell": display = structuredClone(e.display); break;
    case "magic-item": display = structuredClone(e.display); break;
    case "monster": display = structuredClone(e.display); break;
    case "equipment": body = e.display.description ?? ""; break;
    case "condition": body = e.display.description ?? ""; break;
    case "feat": body = e.display.description ?? ""; break;
    case "feature": body = e.display.description ?? ""; break;
    case "rule": body = e.display.description ?? ""; if (e.display.topic) meta.push(e.display.topic); break;
    case "custom": body = e.display.body ?? ""; meta.push(...e.display.metaLines); break;
    default: body = ""; break; // species / background: no single prose field
  }
  return { tag, metaLines: meta, body, overridesId: e.id, category: e.category, display };
}
