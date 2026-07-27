// lib/catalog.ts
//
// The shared content catalog: species, species variants, classes, and subclasses, read from the
// populated Supabase catalog tables (61 species, 75 variants, 14 classes, 316 subclasses, many
// partnered). This is the SOURCE OF THE PICKABLE LISTS for both the GM workspace (app/gm/page.tsx)
// and the player Forge (app/me/forge). It replaces the thin SRD JSON as the list of what a player
// can choose; the SRD JSON remains the MECHANICS source (ability bonuses, traits) that the
// derivation engine reads.
//
// Both pages call loadCatalog() once, then derive option lists with the same filters, so the two
// surfaces can never drift. The filters are:
//   - partnerOn(partner): a row shows if it's core (no partner) or its partner is enabled
//   - editionOn(edition): a row shows if it's edition-agnostic ("both") or matches the selected one
// Variants cascade from the chosen species (by species_id); subclasses cascade from the chosen
// class (via class_capabilities). Partnered content is OFF by default and toggled per partner.

import type { SupabaseClient } from "@supabase/supabase-js";

export type Edition = "2024" | "2014" | "both";

export type SpeciesRow = {
  id: string; name: string; source: string;
  partnered: boolean; partner: string | null; edition: string; sort: number;
};
export type VariantRow = {
  id: string; species_id: string; name: string; variant_kind: string; source: string;
  partnered: boolean; partner: string | null; edition: string; sort: number;
};
export type ClassRow = {
  id: string; name: string; source: string;
  partnered: boolean; partner: string | null; edition: string; sort: number;
};
export type CapabilityRow = {
  class: string; subclass: string | null; capabilities: unknown;
  partnered: boolean; partner: string | null;
};

export type Catalog = {
  species: SpeciesRow[];
  variants: VariantRow[];
  classes: ClassRow[];
  caps: CapabilityRow[];
};

// Load the four catalog tables in parallel. Ordered by (sort, name) so the option lists come out
// stable and the way the GM workspace already presents them. Throws on the first error so a
// partial catalog never renders as if it were complete.
export async function loadCatalog(supabase: SupabaseClient): Promise<Catalog> {
  const [sp, va, cl, ca] = await Promise.all([
    supabase.from("species")
      .select("id,name,source,partnered,partner,edition,sort").order("sort").order("name"),
    supabase.from("species_variants")
      .select("id,species_id,name,variant_kind,source,partnered,partner,edition,sort").order("sort").order("name"),
    supabase.from("classes")
      .select("id,name,source,partnered,partner,edition,sort").order("sort").order("name"),
    supabase.from("class_capabilities")
      .select("class,subclass,capabilities,partnered,partner"),
  ]);
  const firstErr = sp.error || va.error || cl.error || ca.error;
  if (firstErr) throw firstErr;
  return {
    species: (sp.data as SpeciesRow[]) || [],
    variants: (va.data as VariantRow[]) || [],
    classes: (cl.data as ClassRow[]) || [],
    caps: (ca.data as CapabilityRow[]) || [],
  };
}

// The set of partner names that appear anywhere in the catalog, for rendering the partner chips.
// Sourced from class_capabilities (the richest partner set) the same way the GM page does it.
export function partnerList(cat: Catalog): string[] {
  return [...new Set(cat.caps.filter((r) => r.partner).map((r) => r.partner as string))].sort();
}

// The two filter predicates. A row with no partner is core and always allowed; a partnered row is
// allowed only when its partner is in the enabled set. Edition "both" (either on the row or as the
// selection) always matches.
export function makeFilters(enabledPartners: Set<string>, edition: Edition) {
  const partnerOn = (p: string | null | undefined) => !p || enabledPartners.has(p);
  const editionOn = (e: string) => edition === "both" || e === "both" || e === edition;
  return { partnerOn, editionOn };
}

// Option lists, all filtered by partner + edition.
export function speciesOptions(cat: Catalog, enabledPartners: Set<string>, edition: Edition): SpeciesRow[] {
  const { partnerOn, editionOn } = makeFilters(enabledPartners, edition);
  return cat.species.filter((sp) => partnerOn(sp.partner) && editionOn(sp.edition));
}

export function classOptions(cat: Catalog, enabledPartners: Set<string>, edition: Edition): ClassRow[] {
  const { partnerOn, editionOn } = makeFilters(enabledPartners, edition);
  return cat.classes.filter((c) => partnerOn(c.partner) && editionOn(c.edition));
}

// Variants cascade from the chosen species (matched by name -> species_id). Returns [] until a
// species with variants is chosen.
export function variantOptions(
  cat: Catalog, speciesName: string, enabledPartners: Set<string>, edition: Edition,
): VariantRow[] {
  const sp = cat.species.find((x) => x.name === speciesName);
  if (!sp) return [];
  const { partnerOn, editionOn } = makeFilters(enabledPartners, edition);
  return cat.variants.filter(
    (v) => v.species_id === sp.id && partnerOn(v.partner) && editionOn(v.edition),
  );
}

// Subclasses cascade from the chosen class, deduped by subclass name. class_capabilities has no
// edition column, so only the partner filter applies (matching the GM page).
export function subclassOptions(
  cat: Catalog, className: string, enabledPartners: Set<string>,
): string[] {
  const { partnerOn } = makeFilters(enabledPartners, "both");
  const seen = new Set<string>();
  return cat.caps
    .filter((r) => r.subclass && partnerOn(r.partner) && (!className || r.class === className))
    .filter((r) => (seen.has(r.subclass as string) ? false : (seen.add(r.subclass as string), true)))
    .map((r) => r.subclass as string)
    .sort();
}

// The tactical ROLE tags for a subclass (e.g. ["tank","support"]), from class_capabilities. These
// are what the encounter balancer uses — they describe how the subclass plays, not its rules text
// (the catalog carries no prose). Returns [] when the subclass isn't found or has no tags. The UI
// must present these AS role tags, not as a rules description.
export function subclassRoles(cat: Catalog, className: string, subclassName: string): string[] {
  if (!subclassName) return [];
  const row = cat.caps.find((r) => r.class === className && r.subclass === subclassName);
  if (!row) return [];
  const cap = row.capabilities;
  // capabilities is a jsonb array of strings; be defensive about shape.
  if (Array.isArray(cap)) return cap.filter((x): x is string => typeof x === "string");
  if (typeof cap === "string") {
    try {
      const parsed = JSON.parse(cap);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
  }
  return [];
}
