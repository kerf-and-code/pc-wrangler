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
  system?: string;
  build: unknown;
  created_at: string;
  updated_at: string;
};

export type CampaignOption = { campaign_id: string; campaign_name: string };

// A player's saved builds, newest-touched first.
export async function listLibrary(supabase: SupabaseClient): Promise<LibraryRow[]> {
  const { data, error } = await supabase
    .from("pc_library")
    .select("id, name, system, build, species, class, subclass, species_variant, level, portrait_url, created_at, updated_at")
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
  system?: string,
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to save to your library.");
  const { data, error } = await supabase
    .from("pc_library")
    .insert({
      profile_id: user.id,
      name: name || "Unnamed character",
      system: system ?? "dnd5e",
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
  system?: string,
): Promise<void> {
  const { error } = await supabase
    .from("pc_library")
    .update({
      name: name || "Unnamed character",
      ...(system ? { system } : {}),
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

// PHASE 1 of "Bobert across campaigns": find or create the persistent CHARACTER IDENTITY for a
// library build, so every instance launched from that build links to the same "Bobert." Binding is
// automatic by shared library build — the identity is keyed on (profile_id, source_library_id), so
// a second launch of the same build reuses the first launch's identity rather than creating a
// duplicate. Returns the identity id, or null if we couldn't resolve one (in which case the launch
// still proceeds unlinked — identity linkage is additive and must never block getting a character
// to the table).
//
// This does NOT change disposition estimation. It only records which instances are the same
// character, so the data is ready when the three-level estimator (instance theta -> identity beta
// -> player phi) is built later.
export async function resolveIdentityForBuild(
  supabase: SupabaseClient,
  userId: string,
  lib: LibraryRow,
): Promise<string | null> {
  try {
    // Reuse the existing identity for this (player, build) if there is one.
    const { data: existing } = await supabase
      .from("character_identities")
      .select("id")
      .eq("profile_id", userId)
      .eq("source_library_id", lib.id)
      .maybeSingle();
    if (existing) return (existing as { id: string }).id;

    // Otherwise create it, seeded with the build's fixed attributes (constant across instances).
    const { data: created, error } = await supabase
      .from("character_identities")
      .insert({
        profile_id: userId,
        source_library_id: lib.id,
        name: lib.name || "Unnamed character",
        species: lib.species ?? null,
        class: lib.class ?? null,
        subclass: lib.subclass ?? null,
        species_variant: lib.species_variant ?? null,
      })
      .select("id")
      .single();
    if (error) {
      // A concurrent launch may have created it between our read and insert (unique index on
      // (profile_id, source_library_id)). Re-read and use that one.
      const { data: raced } = await supabase
        .from("character_identities")
        .select("id")
        .eq("profile_id", userId)
        .eq("source_library_id", lib.id)
        .maybeSingle();
      return raced ? (raced as { id: string }).id : null;
    }
    return (created as { id: string }).id;
  } catch {
    return null;
  }
}

// Launch a library build into a campaign as a FRESH character (a copy). Returns the new character
// id so the caller can route straight to /me/forge?c=<id>. The insert relies on the existing
// "owner or gm adds character" policy: profile_id must be the caller and they must already be a
// member of the campaign — both are true here for a player launching their own build.
//
// This does NOT touch any other instance of the same build: launching into B leaves A alone. It
// DOES link the new instance to the build's persistent character identity (find-or-create), so the
// same Bobert launched into several campaigns shares one identity for later cross-campaign pooling.
export async function instantiateToCampaign(
  supabase: SupabaseClient,
  lib: LibraryRow,
  campaignId: string,
): Promise<string> {
  return (await launchWithAlters(supabase, lib, campaignId)).primaryId;
}

/**
 * Launch a build AND any alter egos linked to it, returning the primary's id.
 *
 * WHY THE ALTERS COME TOO
 *   An alter ego is part of what the character is, not a thing they acquire at a table. A player
 *   who built a changeling's two faces in their library and had only one arrive would have to
 *   rebuild the other by hand in every campaign they took the character to.
 *
 * THE ALTERS ARE LINKED AFTER, NOT DURING
 *   characters.alter_ego_of has to point at a row that already exists, so the primary is inserted
 *   first and the alters reference it. Doing both in one insert would need the id before the
 *   database has assigned it.
 *
 * IT NEVER FAILS THE LAUNCH. If an alter cannot be created the primary is already at the table and
 * that is the thing the player asked for; losing the whole launch over a second persona would be a
 * worse outcome than arriving without it.
 */
export async function launchWithAlters(
  supabase: SupabaseClient,
  lib: LibraryRow,
  campaignId: string,
): Promise<{ primaryId: string; alterIds: string[] }> {
  const primaryId = await insertInstance(supabase, lib, campaignId, null);

  const alterIds: string[] = [];
  try {
    const { data } = await supabase
      .from("pc_library")
      .select("*")
      .eq("alter_ego_of", lib.id);
    for (const alt of ((data as LibraryRow[]) || [])) {
      try {
        alterIds.push(await insertInstance(supabase, alt, campaignId, primaryId));
      } catch {
        // One alter failing does not cost the others, or the primary.
      }
    }
  } catch {
    // See above: the primary is already in play.
  }
  return { primaryId, alterIds };
}

async function insertInstance(
  supabase: SupabaseClient,
  lib: LibraryRow,
  campaignId: string,
  alterEgoOf: string | null,
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to add a character.");

  // Resolve the identity first so we can stamp it on the new instance. Never blocks the launch: a
  // null identity just means the instance starts unlinked (it can be linked later).
  const identityId = await resolveIdentityForBuild(supabase, user.id, lib);

  const { data, error } = await supabase
    .from("characters")
    .insert({
      campaign_id: campaignId,
      profile_id: user.id,
      kind: "pc",
      name: lib.name,
      system: lib.system ?? "dnd5e",
      build: lib.build as Record<string, unknown>,
      species: lib.species ?? null,
      class: lib.class ?? null,
      subclass: lib.subclass ?? null,
      species_variant: lib.species_variant ?? null,
      level: lib.level ?? null,
      portrait_url: lib.portrait_url ?? null,
      identity_id: identityId,
      alter_ego_of: alterEgoOf,
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
    .select("name, system, build, species, class, subclass, species_variant, level, portrait_url")
    .eq("id", characterId)
    .single();
  if (error) throw error;
  const c = data as {
    name: string; system: string | null; build: unknown; species: string | null; class: string | null;
    subclass: string | null; species_variant: string | null; level: number | null;
    portrait_url: string | null;
  };
  return saveToLibrary(supabase, c.name, c.build ?? {}, {
    species: c.species, class: c.class, subclass: c.subclass,
    species_variant: c.species_variant, level: c.level, portrait_url: c.portrait_url,
  }, c.system ?? "dnd5e");
}
