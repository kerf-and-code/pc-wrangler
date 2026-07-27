// lib/pc-library.ts
//
// The PC library client helper: a player's personal store of portable character builds, plus the
// mechanism to launch a build into a campaign as a fresh, independent character.
//
// MODEL (see /areas/forge.md for the full reasoning):
//   - A pc_library row is the durable "this is my character" — a build with no campaign.
//   - Launching into a campaign INSTANTIATES a fresh characters row (a copy of the build). Each
//     launch is independent: its own character-level disposition (theta), its own sheet. Levelling
//     one instance does NOT sync to another. The player-level disposition (phi) already spans all
//     of a player's characters, so the person is recognized across tables even though each
//     character instance is measured per-table.
//   - A build can be launched into MANY campaigns at once (one Bobert, several live games). Nothing
//     about launching into B retires the instance in A.
//   - "No campaign" simply means the build stays in the library, unlaunched.
//
// All writes are owner-scoped by RLS (pc_library: profile_id = auth.uid(); characters INSERT:
// profile_id = auth.uid() AND is_campaign_member(campaign_id)), so a player can only touch their
// own library and can only launch into a campaign they already belong to.

import type { SupabaseClient } from "@supabase/supabase-js";

// The denormalized fields carried alongside the build, mirroring the columns the Forge already
// tracks on both pc_library and characters.
export type LibraryDenorm = {
  species?: string | null;
  class?: string | null;
  subclass?: string | null;
  species_variant?: string | null;
  level?: number | null;
  portrait_url?: string | null;
};

export type LibraryRow = LibraryDenorm & {
  id: string;
  name: string;
  build: unknown;
  created_at: string;
  updated_at: string;
};

export type CampaignOption = { campaign_id: string; campaign_name: string };

// A player's saved builds, newest-touched first.
export async function listLibrary(supabase: SupabaseClient): Promise<LibraryRow[]> {
  const { data, error } = await supabase
    .from("pc_library")
    .select("id, name, build, species, class, subclass, species_variant, level, portrait_url, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as LibraryRow[]) || [];
}

// Save a build to the library. Requires a signed-in user; profile_id is set to auth.uid() so the
// row satisfies the owner-insert policy. Returns the new library id.
export async function saveToLibrary(
  supabase: SupabaseClient,
  name: string,
  build: unknown,
  denorm: LibraryDenorm,
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to save to your library.");
  const { data, error } = await supabase
    .from("pc_library")
    .insert({
      profile_id: user.id,
      name: name || "Unnamed character",
      build: build as Record<string, unknown>,
      species: denorm.species ?? null,
      class: denorm.class ?? null,
      subclass: denorm.subclass ?? null,
      species_variant: denorm.species_variant ?? null,
      level: denorm.level ?? null,
      portrait_url: denorm.portrait_url ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

// Overwrite an existing library build (e.g. saving edits back to the library copy). The updated_at
// trigger bumps the timestamp. Owner-scoped by RLS.
export async function updateLibrary(
  supabase: SupabaseClient,
  id: string,
  name: string,
  build: unknown,
  denorm: LibraryDenorm,
): Promise<void> {
  const { error } = await supabase
    .from("pc_library")
    .update({
      name: name || "Unnamed character",
      build: build as Record<string, unknown>,
      species: denorm.species ?? null,
      class: denorm.class ?? null,
      subclass: denorm.subclass ?? null,
      species_variant: denorm.species_variant ?? null,
      level: denorm.level ?? null,
      portrait_url: denorm.portrait_url ?? null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteFromLibrary(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("pc_library").delete().eq("id", id);
  if (error) throw error;
}

// The campaigns this player can launch into. my_campaigns() derives membership from characters the
// player owns, which is exactly the set the characters INSERT policy will accept (is_campaign_member
// is true for these). A player joins a NEW campaign the normal way (invite / claim at the table);
// once in, additional characters can be launched here.
export async function listMyCampaigns(supabase: SupabaseClient): Promise<CampaignOption[]> {
  const { data, error } = await supabase.rpc("my_campaigns");
  if (error) throw error;
  return ((data as { campaign_id: string; campaign_name: string }[]) || [])
    .map((c) => ({ campaign_id: c.campaign_id, campaign_name: c.campaign_name }));
}

// Launch a library build into a campaign as a FRESH character (a copy). Returns the new character
// id so the caller can route straight to /me/forge?c=<id>. The insert relies on the existing
// "owner or gm adds character" policy: profile_id must be the caller and they must already be a
// member of the campaign — both are true here for a player launching their own build.
//
// This does NOT touch any other instance of the same build: launching into B leaves A alone.
export async function instantiateToCampaign(
  supabase: SupabaseClient,
  lib: LibraryRow,
  campaignId: string,
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to add a character.");
  const { data, error } = await supabase
    .from("characters")
    .insert({
      campaign_id: campaignId,
      profile_id: user.id,
      kind: "pc",
      name: lib.name,
      build: lib.build as Record<string, unknown>,
      species: lib.species ?? null,
      class: lib.class ?? null,
      subclass: lib.subclass ?? null,
      species_variant: lib.species_variant ?? null,
      level: lib.level ?? null,
      portrait_url: lib.portrait_url ?? null,
      // kind, active, tags, visibility, invite_code, timestamps all take their column defaults.
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

// The optional "I'm done playing this one here" cleanup: mark a campaign instance inactive. It then
// reads as retired in the stable (me/characters dims + labels inactive characters). Never called by
// a launch — only when the player explicitly retires an instance.
export async function retireInstance(supabase: SupabaseClient, characterId: string): Promise<void> {
  const { error } = await supabase.from("characters").update({ active: false }).eq("id", characterId);
  if (error) throw error;
}

// Save an already-played character up into the library (the "save this character to my library"
// path). Reads the character's current build + denorm, then creates a library row. Returns the new
// library id. The character stays where it is; this just captures a portable copy.
export async function saveCharacterToLibrary(
  supabase: SupabaseClient,
  characterId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("characters")
    .select("name, build, species, class, subclass, species_variant, level, portrait_url")
    .eq("id", characterId)
    .single();
  if (error) throw error;
  const c = data as {
    name: string; build: unknown; species: string | null; class: string | null;
    subclass: string | null; species_variant: string | null; level: number | null;
    portrait_url: string | null;
  };
  return saveToLibrary(supabase, c.name, c.build ?? {}, {
    species: c.species, class: c.class, subclass: c.subclass,
    species_variant: c.species_variant, level: c.level, portrait_url: c.portrait_url,
  });
}
