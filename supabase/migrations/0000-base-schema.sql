-- supabase/migrations/0000-base-schema.sql (2026-11-09)
--
-- The public schema of the production database as of 2026-11-09 (after p133), rebuilt from the system
-- catalogs by supabase/checks/generate-base-schema.sql and exported from the SQL editor (1,425 statements).
-- Audit T5: until now about twenty functions (is_campaign_gm, delete_campaign among them) and several
-- early tables existed only in the live database. This file puts all of it in the repo.
--
-- What it is: a record, and the way to stand up a fresh copy (a staging or local project). It is not a
-- migration to apply to production, which already has all of it. p1 to p133 are history; on a fresh
-- database run only this file, then p134 and every migration after it, in order.
--
-- Not included: data, sequence positions, the auth and storage schemas (Supabase creates those), storage
-- buckets and their policies, vault secrets, cron jobs, table grants beyond anon, authenticated and
-- service_role, and grants on functions (the export did not capture who may run each function; the
-- revoke and grant lines in the numbered migrations are the record of that).
--
-- Idempotent: tables, indexes and extensions use if not exists; functions, views and triggers use
-- create or replace; policies are dropped and recreated; constraints skip when already present.
-- Order differs from the generator in two ways: functions come straight after tables (with body checks
-- off, as pg_dump does), because some check constraints call them; and views follow their dependencies.

set check_function_bodies = off;


-- ================================================================================================
-- 01 extensions (4)
-- ================================================================================================

create extension if not exists "pg_stat_statements" with schema extensions;

create extension if not exists "pgcrypto" with schema extensions;

create extension if not exists "supabase_vault" with schema vault;

create extension if not exists "uuid-ossp" with schema extensions;


-- ================================================================================================
-- 02 tables (95)
-- ================================================================================================

create table if not exists public.addon_hooks (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  name text not null,
  url text not null,
  secret text not null,
  events text[] default '{roll}'::text[] not null,
  include_secret boolean default false not null,
  enabled boolean default true not null,
  fail_count integer default 0 not null,
  last_status integer,
  last_error text,
  last_attempt_at timestamp with time zone,
  last_ok_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.addon_keys (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  name text not null,
  prefix text not null,
  key_hash text not null,
  scopes text[] default '{read}'::text[] not null,
  created_by uuid not null,
  created_at timestamp with time zone default now() not null,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  window_start timestamp with time zone default now() not null,
  window_count integer default 0 not null
);

create table if not exists public.addon_outbox (
  id bigint not null,
  hook_id uuid not null,
  campaign_id uuid not null,
  event text not null,
  payload jsonb not null,
  created_at timestamp with time zone default now() not null,
  attempts integer default 0 not null,
  next_at timestamp with time zone default now() not null,
  claimed_until timestamp with time zone,
  delivered_at timestamp with time zone,
  dropped_at timestamp with time zone
);

create table if not exists public.ai_map_renders (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  profile_id uuid not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.arc_touches (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  arc_id uuid not null,
  session_id uuid,
  event_id uuid,
  note text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.arcs (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  character_id uuid,
  profile_id uuid,
  title text not null,
  description text,
  status text default 'open'::text not null,
  opened_session_id uuid,
  last_touched_session_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.attendance (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_id uuid not null,
  profile_id uuid,
  status text default 'present'::text not null,
  character_id uuid
);

create table if not exists public.audio_tracks (
  id uuid default gen_random_uuid() not null,
  job_id uuid not null,
  campaign_id uuid not null,
  character_id uuid,
  storage_path text,
  duration_seconds numeric,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null,
  gm_identity_id uuid,
  purged_at timestamp with time zone,
  kind text default 'speaker'::text not null,
  speaker_map jsonb,
  timeline_map jsonb
);

create table if not exists public.bastion_maps (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  plan jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.battle_maps (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  name text default 'Untitled map'::text not null,
  kind text default 'indoor'::text not null,
  n integer default 25 not null,
  feet_per_square integer default 5 not null,
  levels jsonb default '[]'::jsonb not null,
  custom_cells jsonb default '[]'::jsonb not null,
  doors jsonb default '[]'::jsonb not null,
  elements jsonb default '[]'::jsonb not null,
  meta jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.biomes (
  id smallint not null,
  key text not null,
  label text not null,
  category text not null,
  color text not null,
  sort smallint default 0 not null
);

create table if not exists public.building_maps (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  plan jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.campaign_journals (
  campaign_id uuid not null,
  content jsonb not null,
  generated_at timestamp with time zone default now() not null
);

create table if not exists public.campaigns (
  id uuid default gen_random_uuid() not null,
  name text not null,
  system text default '5e'::text not null,
  gm_id uuid not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  share_code text default substr(md5((gen_random_uuid())::text), 1, 10),
  discord_guild_id text,
  discord_channel_id text,
  recur_rule jsonb,
  public_slug text,
  public_published_at timestamp with time zone,
  public_blurb text,
  public_listed boolean default false not null,
  codex_cover_url text
);

create table if not exists public.capture_control (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_id uuid,
  guild_id text not null,
  requested_by_discord_id text not null,
  status text default 'requested'::text not null,
  capture_job_id uuid,
  error text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  channel_id text,
  heartbeat_at timestamp with time zone,
  owner text
);

create table if not exists public.capture_jobs (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_id uuid not null,
  source text default 'online'::text not null,
  status text default 'draft'::text not null,
  extractor_version text,
  error text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  extract_cursor integer default 0 not null,
  recode_cursor integer default 0 not null,
  gm_extract_cursor integer default 0 not null,
  room_consent_by uuid,
  room_consent_at timestamp with time zone
);

create table if not exists public.character_identities (
  id uuid default gen_random_uuid() not null,
  profile_id uuid not null,
  source_library_id uuid,
  name text not null,
  species text,
  class text,
  subclass text,
  species_variant text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.character_wiki_gm_edit (
  character_id uuid not null,
  campaign_id uuid,
  granted_by uuid default auth.uid() not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.character_wiki_sections (
  id uuid default gen_random_uuid() not null,
  character_id uuid not null,
  campaign_id uuid,
  owner_id uuid,
  title text default ''::text not null,
  body text default ''::text not null,
  visibility text default 'private'::text not null,
  "position" integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.characters (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  profile_id uuid,
  kind text default 'pc'::text not null,
  name text not null,
  species text,
  class text,
  subclass text,
  level smallint,
  alignment text,
  build jsonb,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  description text,
  tags text[] default '{}'::text[] not null,
  visibility text default 'player'::text not null,
  invite_code text default substr(md5((gen_random_uuid())::text), 1, 10),
  discord_user_id text,
  ddb_character_id text,
  species_variant text,
  portrait_url text,
  identity_id uuid,
  is_public boolean default false not null,
  alter_ego_of uuid,
  system text default 'dnd5e'::text not null,
  blocks jsonb,
  summary text
);

create table if not exists public.chat_grants (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  player_profile uuid not null,
  from_ts timestamp with time zone not null,
  to_ts timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.chat_messages (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  author_profile uuid not null,
  display_name text,
  body text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.class_capabilities (
  id uuid default gen_random_uuid() not null,
  system text default '5e'::text not null,
  class text not null,
  subclass text,
  capabilities text[] default '{}'::text[] not null,
  partnered boolean default false not null,
  partner text
);

create table if not exists public.classes (
  id uuid default gen_random_uuid() not null,
  system text default '5e'::text not null,
  name text not null,
  source text default 'core'::text not null,
  partnered boolean default false not null,
  partner text,
  edition text default 'both'::text not null,
  sort integer default 100 not null
);

create table if not exists public.combats (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  encounter_id uuid,
  session_id uuid,
  name text default 'Combat'::text not null,
  rules text default '2024'::text not null,
  status text default 'active'::text not null,
  round integer default 1 not null,
  turn integer default 0 not null,
  combatants jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  ended_at timestamp with time zone
);

create table if not exists public.compendium_entries (
  id uuid default gen_random_uuid() not null,
  gm_id uuid not null,
  campaign_id uuid,
  system text default 'dnd5e'::text not null,
  ruleset text default 'both'::text not null,
  category text default 'custom'::text not null,
  overrides_id text,
  name text default 'Untitled'::text not null,
  source text default 'kc'::text not null,
  tag text,
  meta_lines jsonb default '[]'::jsonb not null,
  body text,
  spoken jsonb default '[]'::jsonb not null,
  aliases jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  display jsonb
);

create table if not exists public.disposition_reveals (
  id uuid default gen_random_uuid() not null,
  profile_id uuid not null,
  revealed_by uuid not null,
  campaign_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.disposition_runs (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  status text default 'fitting'::text not null,
  execution text,
  error text,
  triggered_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.dispositions (
  id uuid default gen_random_uuid() not null,
  profile_id uuid not null,
  campaign_id uuid,
  source text not null,
  axis_scores jsonb not null,
  weights jsonb,
  model_version text not null,
  session_id uuid,
  as_of timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  character_id uuid,
  scope text default 'character'::text not null
);

create table if not exists public.dm_boards (
  id uuid default gen_random_uuid() not null,
  gm_id uuid not null,
  campaign_id uuid,
  name text default 'New board'::text not null,
  cards jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.dungeon_maps (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  levels jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.encounters (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  name text not null,
  rules text default '2024'::text not null,
  foes jsonb default '[]'::jsonb not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.entity_links (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  source_type text not null,
  source_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  relation text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.entries (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  type text not null,
  title text not null,
  body text,
  visibility text default 'gm'::text not null,
  created_by uuid default auth.uid() not null,
  tags text[] default '{}'::text[] not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  is_public boolean default false not null,
  slug text,
  image_url text,
  summary text,
  blocks jsonb
);

create table if not exists public.entry_reveals (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  revealed_to_character_id uuid not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.event_types (
  key text not null,
  label text not null,
  category text not null,
  default_axis text,
  default_frame text,
  default_target text
);

create table if not exists public.events (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_id uuid not null,
  character_id uuid,
  actor_profile_id uuid,
  event_type text not null,
  axis text,
  frame text,
  target text,
  ts_offset_ms bigint,
  payload jsonb,
  source text default 'manual'::text not null,
  confidence numeric(4,3),
  transcript_span jsonb,
  extractor_version text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.gm_event_kinds (
  kind text not null,
  category text not null,
  label text not null,
  feeds text[] default '{}'::text[] not null,
  sort integer default 0 not null
);

create table if not exists public.gm_events (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_id uuid not null,
  kind text not null,
  summary text not null,
  detail text,
  quote text,
  npc_id uuid,
  npc_name text,
  location_name text,
  target_character_id uuid,
  thread_status text default 'n/a'::text,
  resolved_by_event_id uuid,
  resolved_session_id uuid,
  audio_track_id uuid,
  t_start_seconds numeric,
  proposed_from uuid,
  occurred_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  faction_name text,
  location_id uuid,
  faction_id uuid,
  lore_disposition text
);

create table if not exists public.gm_identities (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  profile_id uuid,
  discord_user_id text,
  display_name text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.gm_proposed_events (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_id uuid not null,
  job_id uuid,
  kind text not null,
  summary text not null,
  detail text,
  quote text,
  npc_name text,
  npc_id uuid,
  location_name text,
  target_character_id uuid,
  audio_track_id uuid,
  t_start_seconds numeric,
  t_end_seconds numeric,
  confidence numeric,
  status text default 'proposed'::text not null,
  extractor_version text,
  created_at timestamp with time zone default now() not null,
  faction_name text,
  location_id uuid,
  faction_id uuid
);

create table if not exists public.import_candidates (
  id uuid default gen_random_uuid() not null,
  job_id uuid not null,
  campaign_id uuid not null,
  kind text not null,
  name text not null,
  body text,
  links jsonb default '[]'::jsonb not null,
  confidence numeric,
  origin text,
  source_note text,
  dedupe_kind text,
  dedupe_id uuid,
  decision text default 'pending'::text not null,
  created_kind text,
  created_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.import_jobs (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  created_by uuid default auth.uid() not null,
  status text default 'parsing'::text not null,
  source_format text,
  session_mode text,
  file_count integer default 0 not null,
  note_count integer default 0 not null,
  candidate_count integer default 0 not null,
  session_count integer default 0 not null,
  stats jsonb,
  warnings jsonb default '[]'::jsonb not null,
  error text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.import_sessions (
  id uuid default gen_random_uuid() not null,
  job_id uuid not null,
  campaign_id uuid not null,
  idx integer not null,
  label text,
  occurred_on date,
  recap text,
  entity_names jsonb default '[]'::jsonb not null,
  decision text default 'pending'::text not null,
  created_session_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.loot_grants (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_id uuid,
  character_id uuid,
  event_id uuid,
  item_name text not null,
  rarity text,
  est_value numeric,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.lore_backup (
  backup_id uuid default gen_random_uuid() not null,
  entry_id uuid not null,
  campaign_id uuid,
  type text,
  title text,
  body text,
  visibility text,
  created_by uuid,
  tags text[],
  is_public boolean,
  slug text,
  image_url text,
  backed_up_at timestamp with time zone default now() not null,
  reason text
);

create table if not exists public.map_features (
  id uuid default gen_random_uuid() not null,
  world_map_id uuid not null,
  kind text not null,
  class integer default 1 not null,
  path jsonb not null,
  created_at timestamp with time zone default now() not null,
  name text
);

create table if not exists public.map_fog (
  map_id uuid not null,
  campaign_id uuid not null,
  cols integer default 64 not null,
  rows integer default 48 not null,
  cells text default ''::text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.map_icons (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  key text not null,
  label text not null,
  url text not null,
  bytes integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.map_images (
  id uuid default gen_random_uuid() not null,
  world_map_id uuid not null,
  url text not null,
  x double precision default 0 not null,
  y double precision default 0 not null,
  scale double precision default 1 not null,
  z integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.map_labels (
  id uuid default gen_random_uuid() not null,
  world_map_id uuid not null,
  x double precision not null,
  y double precision not null,
  text text default 'Label'::text not null,
  size integer default 18 not null,
  color text,
  visibility text default 'common'::text not null,
  created_at timestamp with time zone default now() not null,
  locked boolean default false not null
);

create table if not exists public.map_layers (
  id uuid default gen_random_uuid() not null,
  world_map_id uuid not null,
  name text not null,
  ord integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.map_pins (
  id uuid default gen_random_uuid() not null,
  map_id uuid not null,
  campaign_id uuid not null,
  x double precision not null,
  y double precision not null,
  label text,
  linked_type text,
  linked_id uuid,
  visibility text default 'player'::text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.map_pois (
  id uuid default gen_random_uuid() not null,
  world_map_id uuid not null,
  x double precision not null,
  y double precision not null,
  col smallint,
  "row" smallint,
  icon_key text,
  icon_id uuid,
  name text default 'New marker'::text not null,
  note text,
  entry_id uuid,
  character_id uuid,
  visibility text default 'common'::text not null,
  size real default 1 not null,
  created_at timestamp with time zone default now() not null,
  color text,
  locked boolean default false not null
);

create table if not exists public.maps (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  name text default 'Map'::text not null,
  image_path text not null,
  visibility text default 'player'::text not null,
  created_at timestamp with time zone default now() not null,
  linked_entry_id uuid
);

create table if not exists public.memberships (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  profile_id uuid not null,
  role text default 'player'::text not null,
  active boolean default true not null,
  joined_at timestamp with time zone default now() not null
);

create table if not exists public.party_funds (
  campaign_id uuid not null,
  pp integer default 0 not null,
  gp integer default 0 not null,
  ep integer default 0 not null,
  sp integer default 0 not null,
  cp integer default 0 not null,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.party_items (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  name text not null,
  qty integer default 1 not null,
  weight real,
  note text,
  custom boolean default false not null,
  mod smallint,
  variant text,
  added_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.pc_library (
  id uuid default gen_random_uuid() not null,
  profile_id uuid not null,
  name text not null,
  build jsonb default '{}'::jsonb not null,
  species text,
  class text,
  subclass text,
  species_variant text,
  level smallint,
  portrait_url text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  alter_ego_of uuid,
  system text default 'dnd5e'::text not null
);

create table if not exists public.player_notes (
  id uuid default gen_random_uuid() not null,
  profile_id uuid not null,
  campaign_id uuid not null,
  entry_id uuid,
  body text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.poll_responses (
  id uuid default gen_random_uuid() not null,
  poll_id uuid not null,
  discord_user_id text,
  character_id uuid,
  available jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.profiles (
  id uuid not null,
  display_name text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  email text,
  avatar_url text,
  is_anonymous boolean default true not null,
  upgraded_at timestamp with time zone,
  access_granted boolean default false not null,
  access_role text
);

create table if not exists public.proposed_events (
  id uuid default gen_random_uuid() not null,
  job_id uuid not null,
  campaign_id uuid not null,
  session_id uuid not null,
  character_id uuid,
  event_type text,
  axis text,
  frame text,
  target text,
  confidence numeric,
  segment_id uuid,
  extractor_version text,
  rationale text,
  status text default 'proposed'::text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.recodings (
  id uuid default gen_random_uuid() not null,
  job_id uuid not null,
  campaign_id uuid not null,
  segment_id uuid,
  coder_version text,
  event_type text,
  axis text,
  confidence numeric,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.recording_consents (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_id uuid,
  character_id uuid,
  profile_id uuid,
  consented boolean default false not null,
  method text,
  recorded_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null
);

create table if not exists public.regions (
  id uuid default gen_random_uuid() not null,
  world_map_id uuid not null,
  layer_id uuid not null,
  name text not null,
  parent_region_id uuid,
  entry_id uuid,
  visibility text default 'common'::text not null,
  tint text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.roll_tables (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  name text not null,
  body text default ''::text not null,
  players_can_roll boolean default false not null,
  results_gm_only boolean default false not null,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.session_plan_items (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  title text not null,
  note text,
  kind text default 'scene'::text not null,
  difficulty text,
  linked_event_id uuid,
  linked_character_id uuid,
  "position" integer default 0 not null,
  done boolean default false not null,
  created_at timestamp with time zone default now() not null,
  source text default 'gm'::text not null
);

create table if not exists public.session_polls (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  created_by uuid,
  status text default 'open'::text not null,
  slots jsonb default '[]'::jsonb not null,
  recurring boolean default false not null,
  channel_id text,
  message_id text,
  chosen_slot text,
  session_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.sessions (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_number integer,
  scheduled_at timestamp with time zone,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  status text default 'scheduled'::text not null,
  consent_recorded boolean default false not null,
  capture_modality text default 'none'::text not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  processed_at timestamp with time zone,
  recap text,
  reminder_sent_at timestamp with time zone
);

create table if not exists public.species (
  id uuid default gen_random_uuid() not null,
  system text default '5e'::text not null,
  name text not null,
  source text default 'core'::text not null,
  partnered boolean default false not null,
  partner text,
  edition text default 'both'::text not null,
  sort integer default 100 not null
);

create table if not exists public.species_variants (
  id uuid default gen_random_uuid() not null,
  species_id uuid not null,
  name text not null,
  variant_kind text default 'subrace'::text not null,
  source text default 'core'::text not null,
  partnered boolean default false not null,
  partner text,
  edition text default 'both'::text not null,
  sort integer default 100 not null
);

create table if not exists public.stat_blocks (
  id uuid default gen_random_uuid() not null,
  gm_id uuid not null,
  campaign_id uuid,
  name text not null,
  block jsonb,
  cr text,
  xp integer,
  ac integer,
  hp integer,
  size text,
  type text,
  portrait_path text,
  source_edition text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  system text default 'dnd5e'::text not null,
  level integer
);

create table if not exists public.threads (
  id uuid default gen_random_uuid() not null,
  profile_id uuid default auth.uid() not null,
  campaign_id uuid,
  character_id uuid,
  title text not null,
  detail text,
  kind text default 'thread'::text not null,
  status text default 'open'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.tool_render_log (
  id bigint not null,
  tool text default 'map-render'::text not null,
  ip text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.tpdi_responses (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  respondent_id uuid,
  instrument_version text not null,
  answers jsonb not null,
  scores jsonb,
  item_order jsonb,
  player_name text,
  campaign_id uuid,
  assigned_character_id uuid,
  safety jsonb,
  scope text default 'character'::text not null
);

create table if not exists public.transcript_segments (
  id uuid default gen_random_uuid() not null,
  job_id uuid not null,
  track_id uuid,
  campaign_id uuid not null,
  character_id uuid,
  start_ms integer,
  end_ms integer,
  text text not null,
  created_at timestamp with time zone default now() not null,
  speaker smallint,
  gm_identity_id uuid
);

create table if not exists public.vibe_checks (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_id uuid not null,
  profile_id uuid,
  satisfaction smallint,
  spotlight_feeling text,
  note text,
  created_at timestamp with time zone default now() not null,
  player_name text
);

create table if not exists public.vtt_audio (
  campaign_id uuid not null,
  state jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.vtt_cards (
  id uuid default gen_random_uuid() not null,
  deck_id uuid not null,
  campaign_id uuid not null,
  name text not null,
  body text default ''::text not null,
  suit text,
  rank text,
  pile text default 'draw'::text not null,
  holder uuid,
  face_up boolean default false not null,
  played_by uuid,
  ord integer default 0 not null,
  moved_at timestamp with time zone default now() not null,
  image_path text
);

create table if not exists public.vtt_decks (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  name text not null,
  kind text default 'custom'::text not null,
  back_color text default '#7a2e2e'::text not null,
  players_draw boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  back_path text
);

create table if not exists public.vtt_drawings (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  scene_id uuid not null,
  owner uuid default auth.uid() not null,
  layer text default 'table'::text not null,
  kind text not null,
  points jsonb not null,
  color text default '#e0703a'::text not null,
  width real default 0.08 not null,
  fill boolean default false not null,
  text text,
  size real default 0.6 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.vtt_effects (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  scene_id uuid not null,
  token_id uuid not null,
  owner uuid default auth.uid() not null,
  kind text not null,
  radius_ft real default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.vtt_events (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_id uuid not null,
  character_id uuid,
  source text default 'beyond20'::text not null,
  ddb_character_id text,
  actor_name text,
  event_type text not null,
  name text,
  rolls jsonb,
  state jsonb,
  fidelity text default 'unverified'::text not null,
  rolled_at timestamp with time zone,
  received_at timestamp with time zone default now() not null,
  applied_at timestamp with time zone,
  applied_to text
);

create table if not exists public.vtt_handouts (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  entry_id uuid,
  shown_to uuid[],
  added_reveals uuid[] default '{}'::uuid[] not null,
  shown_by uuid default auth.uid(),
  shown_at timestamp with time zone default now() not null,
  title text,
  image_path text,
  note text
);

create table if not exists public.vtt_messages (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  session_id uuid,
  author_profile uuid not null,
  as_name text,
  character_id uuid,
  kind text default 'say'::text not null,
  body text default ''::text not null,
  roll jsonb,
  vtt_event_id uuid,
  whisper_to uuid[],
  gm_only boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.vtt_pins (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  scene_id uuid not null,
  x real not null,
  y real not null,
  label text not null,
  color text default '#d9a43a'::text not null,
  entry_id uuid,
  gm_note text default ''::text not null,
  players_see boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.vtt_scene_players (
  campaign_id uuid not null,
  profile_id uuid not null,
  scene_id uuid not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.vtt_scenes (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  battle_map_id uuid not null,
  level integer default 0 not null,
  name text default 'Scene'::text not null,
  is_active boolean default false not null,
  settings jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  fog_on boolean default false not null,
  revealed bytea default '\x'::bytea not null,
  door_state jsonb default '{}'::jsonb not null
);

create table if not exists public.vtt_sounds (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  name text not null,
  kind text default 'music'::text not null,
  url text not null,
  duration real,
  bytes integer,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.vtt_templates (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  scene_id uuid not null,
  owner uuid default auth.uid() not null,
  shape text not null,
  x real not null,
  y real not null,
  size_ft real not null,
  width_ft real default 5 not null,
  rot real default 0 not null,
  color text default '#e0703a'::text not null,
  label text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  effect text
);

create table if not exists public.vtt_token_notes (
  token_id uuid not null,
  campaign_id uuid not null,
  body text default ''::text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.vtt_tokens (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  scene_id uuid not null,
  kind text default 'monster'::text not null,
  character_id uuid,
  stat_block_id uuid,
  name text default 'Token'::text not null,
  image_url text,
  x real default 0.5 not null,
  y real default 0.5 not null,
  size real default 1 not null,
  rot real default 0 not null,
  layer text default 'token'::text not null,
  hidden boolean default false not null,
  controlled_by uuid[] default '{}'::uuid[] not null,
  style jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.world_hexes (
  id uuid default gen_random_uuid() not null,
  world_map_id uuid not null,
  col smallint not null,
  "row" smallint not null,
  region_id uuid not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.world_maps (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  name text default 'World map'::text not null,
  width smallint default 100 not null,
  height smallint default 100 not null,
  origin_col smallint default '-50'::integer not null,
  origin_row smallint default '-50'::integer not null,
  format_version smallint default 1 not null,
  terrain text,
  editable_by text default 'gm'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  image_url text,
  snapshot_url text,
  published boolean default false not null,
  gen_config jsonb,
  gen_seed text,
  ai_image_url text,
  ai_image_at timestamp with time zone,
  style text default 'fantasy'::text,
  miles_per_hex integer,
  custom_hexes jsonb
);


-- ================================================================================================
-- 06 functions (163)
-- ================================================================================================

CREATE OR REPLACE FUNCTION public.addon_auth(p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_k public.addon_keys;
  v_c public.campaigns;
begin
  select * into v_k from public.addon_keys where key_hash = p_hash for update;
  if v_k.id is null or v_k.revoked_at is not null then return null; end if;
  select * into v_c from public.campaigns where id = v_k.campaign_id;
  if v_c.id is null or v_c.gm_id is distinct from v_k.created_by then return null; end if;
  if now() - v_k.window_start > interval '1 minute' then
    update public.addon_keys set window_start = now(), window_count = 1, last_used_at = now() where id = v_k.id;
    v_k.window_count := 1;
  else
    update public.addon_keys set window_count = window_count + 1, last_used_at = now() where id = v_k.id;
    v_k.window_count := v_k.window_count + 1;
  end if;
  return jsonb_build_object('id', v_k.id, 'campaignId', v_k.campaign_id, 'campaignName', v_c.name, 'name', v_k.name,
                            'scopes', to_jsonb(v_k.scopes), 'owner', v_k.created_by, 'limited', v_k.window_count > 60);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.addon_claim(p_campaign uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_out jsonb;
begin
  with c as (
    select o.id from public.addon_outbox o join public.addon_hooks h on h.id = o.hook_id
     where o.delivered_at is null and o.dropped_at is null and o.next_at <= now()
       and (o.claimed_until is null or o.claimed_until < now())
       and h.enabled and (p_campaign is null or o.campaign_id = p_campaign)
     order by o.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update of o skip locked
  ), u as (
    update public.addon_outbox o set claimed_until = now() + interval '45 seconds'
      from c where o.id = c.id
    returning o.id, o.hook_id, o.campaign_id, o.event, o.payload, o.created_at, o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id, 'hookId', u.hook_id, 'event', u.event, 'payload', u.payload, 'createdAt', u.created_at, 'attempts', u.attempts,
           'url', h.url, 'secret', h.secret, 'campaignId', u.campaign_id, 'campaignName', cp.name) order by u.id), '[]'::jsonb)
    into v_out
    from u join public.addon_hooks h on h.id = u.hook_id join public.campaigns cp on cp.id = u.campaign_id;
  return v_out;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.addon_on_combat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_started boolean := new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active');
  v_ended   boolean := tg_op = 'UPDATE' and new.status is distinct from 'active' and old.status = 'active';
  v_turned  boolean := tg_op = 'UPDATE' and new.status = 'active' and old.status = 'active'
                       and (new.round is distinct from old.round or new.turn is distinct from old.turn);
  v_cur     jsonb;
begin
  if not (v_started or v_ended or v_turned) then return new; end if;
  if not exists (select 1 from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and h.events && array['turn', 'combat']) then
    return new;
  end if;
  if v_started or v_ended then
    insert into public.addon_outbox (hook_id, campaign_id, event, payload)
    select h.id, new.campaign_id, 'combat',
           jsonb_build_object('combatId', new.id, 'state', case when v_started then 'started' else 'ended' end, 'name', new.name, 'round', new.round, 'at', now())
      from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and 'combat' = any (h.events);
  end if;
  if v_turned or v_started then
    -- whose turn it is; a combatant the GM hides from the tracker stays hidden here too
    v_cur := new.combatants -> coalesce(new.turn, 0);
    insert into public.addon_outbox (hook_id, campaign_id, event, payload)
    select h.id, new.campaign_id, 'turn',
           jsonb_build_object('combatId', new.id, 'round', new.round,
             'current', case when v_cur is null or coalesce((v_cur ->> 'hidden')::boolean, false) then null
                             else jsonb_build_object('name', v_cur ->> 'name', 'kind', v_cur ->> 'kind') end,
             'at', now())
      from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and 'turn' = any (h.events);
  end if;
  return new;
exception when others then
  raise warning 'addon_on_combat: %', sqlerrm;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.addon_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ev      text;
  v_payload jsonb;
begin
  if new.whisper_to is not null then return new; end if;
  v_ev := case when new.kind = 'roll' then 'roll' when new.kind in ('say', 'emote') then 'chat' end;
  if v_ev is null then return new; end if;
  if not exists (select 1 from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and v_ev = any (h.events)) then
    return new;
  end if;
  v_payload := jsonb_build_object(
      'messageId', new.id,
      'who', coalesce(new.as_name, (select c.name from public.characters c where c.id = new.character_id),
                      public.tabletop_seat_name(new.campaign_id, new.author_profile)),
      'kind', new.kind,
      'text', new.body,
      'secret', new.gm_only,
      -- set when an add-on posted it, so a bot can skip its own lines
      'addon', new.roll ->> 'addon',
      'at', new.created_at)
    || case when v_ev = 'roll' and new.roll is not null then jsonb_build_object('roll', jsonb_strip_nulls(jsonb_build_object(
         'label', new.roll -> 'label', 'notation', new.roll -> 'notation', 'total', new.roll -> 'total',
         'natural', new.roll -> 'natural', 'dice', new.roll -> 'dice', 'table', new.roll -> 'table')))
       else '{}'::jsonb end;
  insert into public.addon_outbox (hook_id, campaign_id, event, payload)
  select h.id, new.campaign_id, v_ev, v_payload
    from public.addon_hooks h
   where h.campaign_id = new.campaign_id and h.enabled and v_ev = any (h.events) and (not new.gm_only or h.include_secret);
  return new;
exception when others then
  raise warning 'addon_on_message: %', sqlerrm;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.addon_ping(p_hook uuid)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.addon_outbox (hook_id, campaign_id, event, payload)
  select h.id, h.campaign_id, 'ping', jsonb_build_object('message', 'A test from Six Axes. Your webhook works.', 'at', now())
    from public.addon_hooks h where h.id = p_hook
  returning id;
$function$
;

CREATE OR REPLACE FUNCTION public.addon_prune()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with d as (
    delete from public.addon_outbox
     where (coalesce(delivered_at, dropped_at) < now() - interval '7 days')
        or (delivered_at is null and created_at < now() - interval '2 days')
    returning 1)
  select count(*)::integer from d;
$function$
;

CREATE OR REPLACE FUNCTION public.addon_settle(p_id bigint, p_ok boolean, p_status integer, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_o public.addon_outbox;
begin
  select * into v_o from public.addon_outbox where id = p_id for update;
  if v_o.id is null then return; end if;
  if p_ok then
    update public.addon_outbox set delivered_at = now(), claimed_until = null, attempts = attempts + 1 where id = p_id;
    update public.addon_hooks set fail_count = 0, last_status = p_status, last_error = null, last_attempt_at = now(), last_ok_at = now()
     where id = v_o.hook_id;
  else
    update public.addon_outbox
       set attempts = attempts + 1, claimed_until = null,
           dropped_at = case when attempts + 1 >= 6 then now() end,
           next_at = now() + make_interval(secs => 30 * power(2, least(attempts, 8)))
     where id = p_id;
    update public.addon_hooks
       set fail_count = fail_count + 1, last_status = p_status, last_error = left(coalesce(p_error, 'failed'), 300), last_attempt_at = now(),
           enabled = case when fail_count + 1 >= 25 then false else enabled end
     where id = v_o.hook_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.alter_ego_is_flat()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  n integer;
begin
  if new.alter_ego_of is null then
    return new;
  end if;
  if new.alter_ego_of = new.id then
    raise exception 'A character cannot be its own alter ego.';
  end if;
  if exists (
    select 1 from public.characters c
    where c.id = new.alter_ego_of and c.alter_ego_of is not null
  ) then
    raise exception 'That character is already an alter ego. Link to the primary instead.';
  end if;

  -- Excluding this row so an UPDATE that merely re-points an existing alter does not count itself
  -- and fail at the boundary.
  select count(*) into n
  from public.characters c
  where c.alter_ego_of = new.alter_ego_of and c.id <> new.id;
  if n >= 10 then
    raise exception 'A character can have at most 10 alter egos.';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_response_to_character(p_response uuid, p_character uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_campaign uuid; v_resp uuid;
begin
  select campaign_id, respondent_id into v_campaign, v_resp
  from public.tpdi_responses where id = p_response;
  if v_campaign is null then raise exception 'response not found or not tied to a campaign'; end if;
  if not public.is_campaign_gm(v_campaign) then raise exception 'not permitted'; end if;
  if not exists (
    select 1 from public.characters
    where id = p_character and campaign_id = v_campaign and kind = 'pc'
  ) then
    raise exception 'character is not a PC in this campaign';
  end if;

  -- one inventory per character: clear any prior binding on this PC
  update public.tpdi_responses set assigned_character_id = null
    where assigned_character_id = p_character and id <> p_response;

  update public.tpdi_responses set assigned_character_id = p_character where id = p_response;
  update public.characters set profile_id = v_resp where id = p_character;
end; $function$
;

CREATE OR REPLACE FUNCTION public.bump_arc_on_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  update public.arcs
     set last_touched_session_id = coalesce(new.session_id, last_touched_session_id),
         status = case when status = 'open' then 'progressing' else status end,
         updated_at = now()
   where id = new.arc_id;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.can_write_character_portrait(p_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select case
    when p_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then false
    else exists (
      select 1
      from public.characters c
      left join public.campaigns g on g.id = c.campaign_id
      where c.id = p_id::uuid
        and (c.profile_id = auth.uid() or g.gm_id = auth.uid())
    )
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.can_write_statblock_portrait(p_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select case
    when p_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then false
    else exists (
      select 1 from public.stat_blocks s
      where s.id = p_id::uuid and s.gm_id = auth.uid()
    )
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.character_identities_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.character_wiki_fill()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  select ch.campaign_id, ch.profile_id
    into new.campaign_id, new.owner_id
  from public.characters ch
  where ch.id = new.character_id;
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.character_wiki_grant_fill()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  select ch.campaign_id into new.campaign_id from public.characters ch where ch.id = new.character_id;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_context(code text)
 RETURNS TABLE(campaign_name text, locked boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.name, public.chat_locked(code)
  from public.campaigns c where c.share_code = code limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_fetch(code text)
 RETURNS TABLE(id uuid, author_profile uuid, display_name text, body text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.id, m.author_profile, m.display_name, m.body, m.created_at
  from public.chat_messages m
  join public.campaigns c on c.id = m.campaign_id
  where c.share_code = code and not public.chat_locked(code)
  order by m.created_at asc;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_grant(code text, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_campaign uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select id into v_campaign from public.campaigns where share_code = code limit 1;
  if v_campaign is null then raise exception 'invalid link'; end if;
  insert into public.chat_grants (campaign_id, player_profile, from_ts, to_ts)
    values (v_campaign, v_uid, p_from, p_to);
end; $function$
;

CREATE OR REPLACE FUNCTION public.chat_grant_revoke(grant_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from public.chat_grants where id = grant_id and player_profile = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.chat_grants_mine(code text)
 RETURNS TABLE(id uuid, from_ts timestamp with time zone, to_ts timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select g.id, g.from_ts, g.to_ts
  from public.chat_grants g
  join public.campaigns c on c.id = g.campaign_id
  where c.share_code = code and g.player_profile = auth.uid()
  order by g.created_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_locked(code text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Party chat now stays open during live sessions.
  -- (Was: select exists (select 1 from campaigns c join sessions s on s.campaign_id = c.id
  --        where c.share_code = code and s.status = 'live');)
  select false;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_post(code text, p_body text, p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_campaign uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_body),'') = '' then return; end if;
  select id into v_campaign from public.campaigns where share_code = code limit 1;
  if v_campaign is null then raise exception 'invalid link'; end if;
  if public.chat_locked(code) then raise exception 'chat is closed during a live session'; end if;
  insert into public.chat_messages (campaign_id, author_profile, display_name, body)
    values (v_campaign, v_uid, nullif(trim(p_name), ''), trim(p_body));
end; $function$
;

CREATE OR REPLACE FUNCTION public.claim_by_discord()
 RETURNS TABLE(out_share_code text, out_character_id uuid, out_character_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_discord   text;
  v_char      record;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- The caller's Discord id, read from their OWN identity row. A caller cannot pass this
  -- in, so they can only claim characters bound to the Discord account they authenticated
  -- with. provider_id is the snowflake the bot also wrote to characters.discord_user_id.
  select i.provider_id
    into v_discord
  from auth.identities i
  where i.user_id = v_uid
    and i.provider = 'discord'
  limit 1;

  if v_discord is null then
    raise exception 'not signed in with discord';
  end if;

  -- Every PC bound to this Discord id, whoever currently owns it. Full transfer: an
  -- existing owner that is not this caller is re-pointed below.
  for v_char in
    select c.id, c.campaign_id, c.profile_id as old_owner
    from public.characters c
    where c.discord_user_id = v_discord
      and c.kind = 'pc'
  loop
    -- Move the character.
    update public.characters
       set profile_id = v_uid
     where id = v_char.id;

    -- Move the history that is keyed on the PRIOR owner, so a transfer does not strand the
    -- player's own self-reports or disposition rows on an identity they no longer use.
    -- Only runs when there was a different prior owner; a first claim has none.
    if v_char.old_owner is not null and v_char.old_owner <> v_uid then
      update public.tpdi_responses
         set respondent_id = v_uid
       where respondent_id = v_char.old_owner
         and campaign_id = v_char.campaign_id;

      update public.dispositions d
         set profile_id = v_uid
       where d.profile_id = v_char.old_owner
         and (d.character_id = v_char.id or d.scope = 'player');

      update public.disposition_reveals
         set profile_id = v_uid
       where profile_id = v_char.old_owner;
    end if;

    -- Back-assign TPDI responses this caller filled in before they had a character here,
    -- matching claim_character_invite's behaviour.
    update public.tpdi_responses
       set assigned_character_id = v_char.id
     where respondent_id = v_uid
       and campaign_id = v_char.campaign_id
       and assigned_character_id is null;
  end loop;

  -- Return everything now owned by this caller that matches the Discord id, so the page can
  -- route them (typically to the first, or a chooser if several).
  return query
    select cm.share_code, c.id, c.name
    from public.characters c
    join public.campaigns cm on cm.id = c.campaign_id
    where c.discord_user_id = v_discord
      and c.kind = 'pc'
      and c.profile_id = v_uid
    order by cm.share_code, c.name;
  -- Output columns are out_share_code / out_character_id / out_character_name; the select
  -- list maps to them positionally, so no table column can shadow an output name again.
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_character_invite(p_code text)
 RETURNS TABLE(campaign_share_code text, character_id uuid, character_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_char     uuid;
  v_campaign uuid;
  v_owner    uuid;
  v_uid      uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select c.id, c.campaign_id, c.profile_id
    into v_char, v_campaign, v_owner
  from public.characters c
  where c.invite_code = p_code and c.kind = 'pc';

  if v_char is null then
    raise exception 'invalid invite';
  end if;

  -- The fix.
  if v_owner is not null and v_owner <> v_uid then
    raise exception 'this character has already been claimed by another player';
  end if;

  update public.characters
     set profile_id = v_uid
   where id = v_char;

  -- Back-assign any TPDI responses this person filled in for this campaign before
  -- they had a character. Unchanged from the original.
  update public.tpdi_responses
     set assigned_character_id = v_char
   where respondent_id = v_uid
     and campaign_id = v_campaign
     and assigned_character_id is null;

  return query
    select cm.share_code, v_char, ch.name
    from public.campaigns cm, public.characters ch
    where cm.id = v_campaign and ch.id = v_char;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.codex_for_campaign(p_campaign uuid)
 RETURNS TABLE(item_kind text, item_type text, id uuid, title text, summary text, body text, blocks jsonb, tags text[], image_url text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (
    -- The gate AND the reveal target, in one: you must own a PC here to see anything, and reveals
    -- are addressed to that PC.
    select ch.id
    from public.characters ch
    where ch.campaign_id = p_campaign
      and ch.kind = 'pc'
      and ch.profile_id = auth.uid()
    limit 1
  ),
  revealed as (
    select er.target_type, er.target_id
    from public.entry_reveals er, me
    where er.revealed_to_character_id = me.id
  )
  select 'entry'::text, e.type, e.id, e.title, e.summary, e.body, e.blocks, e.tags, e.image_url
  from public.entries e
  where exists (select 1 from me)
    and e.campaign_id = p_campaign
    and (e.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type = 'entry' and r.target_id = e.id))
  union all
  select 'npc'::text, 'npc'::text, ch.id, ch.name, null::text, ch.description, null::jsonb, ch.tags, ch.portrait_url
  from public.characters ch
  where exists (select 1 from me)
    and ch.campaign_id = p_campaign
    and ch.kind = 'npc'
    and (ch.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type = 'character' and r.target_id = ch.id));
$function$
;

CREATE OR REPLACE FUNCTION public.codex_for_player(p_share text)
 RETURNS TABLE(item_kind text, item_type text, id uuid, title text, body text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with camp as (select id from public.campaigns where share_code = p_share),
  me as (
    select ch.id from public.characters ch, camp
    where ch.campaign_id = camp.id and ch.kind = 'pc' and ch.profile_id = auth.uid() limit 1
  ),
  revealed as (
    select er.target_type, er.target_id from public.entry_reveals er, me
    where er.revealed_to_character_id = me.id
  )
  select 'entry'::text, e.type, e.id, e.title, e.body
  from public.entries e, camp
  where e.campaign_id = camp.id
    and (e.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type='entry' and r.target_id=e.id))
  union all
  select 'npc'::text, 'npc'::text, ch.id, ch.name, ch.description
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'npc'
    and (ch.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type='character' and r.target_id=ch.id));
$function$
;

CREATE OR REPLACE FUNCTION public.combat_act(p_combat uuid, p_target text, p_action text, p_value integer DEFAULT NULL::integer, p_condition text DEFAULT NULL::text, p_ac integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_cb    public.combats;
  v_gm    boolean;
  v_c     jsonb;
  v_ord   bigint;
  v_mine  boolean;
  v_turn  boolean;
  v_hp    integer;
  v_max   integer;
  v_temp  integer;
  v_n     integer;
  v_conds jsonb;
  v_e     jsonb;
  v_last  jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_cb from public.combats where id = p_combat for update;
  if v_cb.id is null then raise exception 'fight not found'; end if;
  if v_cb.status <> 'active' then raise exception 'that fight is over'; end if;
  v_gm := public.is_campaign_gm(v_cb.campaign_id);
  if not v_gm and not public.tabletop_is_player(v_cb.campaign_id) then raise exception 'not at this table'; end if;

  select e.c, e.ord into v_c, v_ord
    from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where e.c ->> 'id' = p_target
   limit 1;
  if v_c is null then raise exception 'no such combatant'; end if;

  v_mine := (v_c ->> 'kind') = 'pc'
            and coalesce(v_c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
            and exists (select 1 from public.characters ch where ch.id = (v_c ->> 'characterId')::uuid and ch.profile_id = v_uid);
  v_turn := v_ord - 1 = v_cb.turn;

  if not v_gm then
    if coalesce((v_c ->> 'hidden')::boolean, false) then raise exception 'no such combatant'; end if;
    -- the turn gate: affecting anyone else needs your own character to hold the turn
    if not v_mine and not exists (
      select 1 from jsonb_array_elements(v_cb.combatants) with ordinality as t(c, ord)
       where t.ord - 1 = v_cb.turn and (t.c ->> 'kind') = 'pc'
         and coalesce(t.c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
         and exists (select 1 from public.characters ch where ch.id = (t.c ->> 'characterId')::uuid and ch.profile_id = v_uid)
    ) then
      raise exception 'it is not your turn';
    end if;
    if p_action in ('add_condition', 'remove_condition') then
      null;                                   -- anyone the players can see, on your turn
    elsif p_action in ('damage', 'heal', 'temp', 'sync_sheet', 'set_speed', 'set_attacks') and v_mine then
      null;                                   -- their own character
    elsif p_action in ('spend', 'undo', 'move') and v_mine then
      if not v_turn and not (p_action = 'spend' and p_condition = 'reaction') then
        raise exception 'it is not your turn';
      end if;
    else
      raise exception 'only the GM can do that';
    end if;
  end if;

  v_hp := case when jsonb_typeof(v_c -> 'hp') = 'number' then (v_c ->> 'hp')::numeric::integer end;
  v_max := case when jsonb_typeof(v_c -> 'maxHp') = 'number' then (v_c ->> 'maxHp')::numeric::integer end;
  v_temp := coalesce(case when jsonb_typeof(v_c -> 'tempHp') = 'number' then (v_c ->> 'tempHp')::numeric::integer end, 0);
  v_conds := case when jsonb_typeof(v_c -> 'conditions') = 'array' then v_c -> 'conditions' else '[]'::jsonb end;

  if p_action = 'damage' then
    v_n := greatest(0, coalesce(p_value, 0));
    if v_n > 9999 then raise exception 'that is too much damage for one hit'; end if;
    v_c := public.combat_hurt(v_c, v_n);
  elsif p_action = 'heal' then
    v_n := greatest(0, coalesce(p_value, 0));
    if v_n > 9999 then raise exception 'that is too much healing at once'; end if;
    if v_hp is not null then
      v_hp := case when v_max is null then v_hp + v_n else least(v_max, v_hp + v_n) end;
      v_c := v_c || jsonb_build_object('hp', v_hp);
      if v_hp > 0 then v_c := v_c || jsonb_build_object('defeated', false); end if;
    end if;
  elsif p_action = 'temp' then
    v_c := v_c || jsonb_build_object('tempHp', least(9999, greatest(0, coalesce(p_value, 0))));
  elsif p_action = 'sync_sheet' then
    if p_value is not null and p_value between 1 and 9999 and v_max is null then
      v_c := v_c || jsonb_build_object('maxHp', p_value);
      if v_hp is null then v_c := v_c || jsonb_build_object('hp', p_value); end if;
    end if;
    if p_ac is not null and p_ac between 1 and 60 and jsonb_typeof(v_c -> 'ac') is distinct from 'number' then
      v_c := v_c || jsonb_build_object('ac', p_ac);
    end if;
  elsif p_action = 'add_condition' then
    if p_condition is null or not (p_condition = any (public.combat_markers())) then raise exception 'not a condition the table knows'; end if;
    if not (v_conds ? p_condition) then v_c := v_c || jsonb_build_object('conditions', v_conds || to_jsonb(p_condition)); end if;
  elsif p_action = 'remove_condition' then
    v_c := v_c || jsonb_build_object('conditions', coalesce((select jsonb_agg(x) from jsonb_array_elements(v_conds) x where x <> to_jsonb(p_condition)), '[]'::jsonb));
  elsif p_action = 'spend' then
    v_c := public.combat_spend(v_c, coalesce(p_condition, ''), p_note, v_gm);
  elsif p_action = 'move' then
    v_c := public.combat_move(v_c, coalesce(p_value, 0), v_gm);
  elsif p_action = 'undo' then
    v_e := public.combat_econ(v_c);
    v_last := v_e -> 'log' -> -1;
    if v_last is null then raise exception 'nothing to undo this turn'; end if;
    if not v_gm and coalesce((v_last ->> 'locked')::boolean, false) then raise exception 'that already happened at the table; ask the GM to undo it'; end if;
    v_c := v_c || jsonb_build_object('econ', (public.combat_fresh_econ() || coalesce(v_last -> 'prev', '{}'::jsonb))
             || jsonb_build_object('log', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o)
                                                    where o < jsonb_array_length(v_e -> 'log')), '[]'::jsonb)));
  elsif p_action = 'set_speed' then
    if p_value is null or p_value < 0 or p_value > 300 then raise exception 'speed must be between 0 and 300 feet'; end if;
    v_c := v_c || jsonb_build_object('speed', p_value);
  elsif p_action = 'set_attacks' then
    if p_value is null or p_value < 1 or p_value > 8 then raise exception 'attacks per action must be between 1 and 8'; end if;
    v_c := v_c || jsonb_build_object('attacksPerAction', p_value);
  else
    raise exception 'unknown action';
  end if;

  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_ord then v_c else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = p_combat;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_apply_outside_roll(p_combat uuid, p_target text, p_events uuid[], p_half boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_cb     public.combats;
  v_gm     boolean;
  v_c      jsonb;
  v_ord    bigint;
  v_n      integer;
  v_found  integer;
  v_attack integer;
  v_crit   boolean := false;
  v_fumble boolean := false;
  v_arolls jsonb;
  v_kind   text;
  v_cost   text := 'attack';
  v_ac     integer;
  v_hit    boolean := true;
  v_dmg    integer;
  v_char   uuid;
  v_att    jsonb;
  v_aord   bigint;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_events is null or cardinality(p_events) = 0 or cardinality(p_events) > 20 then raise exception 'Pick the rolls to apply.'; end if;
  select * into v_cb from public.combats where id = p_combat for update;
  if v_cb.id is null then raise exception 'fight not found'; end if;
  if v_cb.status <> 'active' then raise exception 'that fight is over'; end if;
  v_gm := public.is_campaign_gm(v_cb.campaign_id);
  if not v_gm and not public.tabletop_is_player(v_cb.campaign_id) then raise exception 'not at this table'; end if;

  -- the rows: this table's outside rolls, none applied yet, locked while we work
  perform 1 from public.vtt_events where id = any(p_events) for update;
  select count(*) into v_found from public.vtt_events e
   where e.id = any(p_events) and e.campaign_id = v_cb.campaign_id and e.source in ('beyond20', 'foundry');
  if v_found <> cardinality(p_events) then raise exception 'Those rolls are not from this table.'; end if;
  -- applied once; a player's miss is marked too, but the GM may overrule a miss
  if exists (select 1 from public.vtt_events where id = any(p_events) and applied_at is not null
              and not (v_gm and coalesce(applied_to, '') like 'missed %')) then
    raise exception 'That damage was already applied.';
  end if;

  if not v_gm then
    -- a player applies only their own character's rolls, on that character's turn
    if exists (select 1 from public.vtt_events e where e.id = any(p_events)
                and (e.character_id is null or not exists (select 1 from public.characters ch where ch.id = e.character_id and ch.profile_id = v_uid))) then
      raise exception 'Only your own character''s rolls.';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_cb.combatants) with ordinality as t(c, ord)
       where t.ord - 1 = v_cb.turn and (t.c ->> 'kind') = 'pc'
         and coalesce(t.c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
         and exists (select 1 from public.vtt_events e where e.id = any(p_events) and e.character_id = (t.c ->> 'characterId')::uuid)
    ) then
      raise exception 'it is not your turn';
    end if;
  end if;

  select e.c, e.ord into v_c, v_ord
    from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where e.c ->> 'id' = p_target
   limit 1;
  if v_c is null then raise exception 'no such combatant'; end if;
  if not v_gm and coalesce((v_c ->> 'hidden')::boolean, false) then raise exception 'no such combatant'; end if;

  -- the attack roll, if one came with the damage (the last one not discarded by advantage)
  select (e.rolls ->> 'total')::numeric::integer,
         coalesce((e.rolls ->> 'critical_success')::boolean, false),
         coalesce((e.rolls ->> 'critical_failure')::boolean, false),
         e.rolls
    into v_attack, v_crit, v_fumble, v_arolls
    from public.vtt_events e
   where e.id = any(p_events) and e.event_type = 'to-hit' and coalesce((e.rolls ->> 'discarded')::boolean, false) = false
     and jsonb_typeof(e.rolls -> 'total') = 'number'
   order by e.received_at desc limit 1;

  select coalesce(sum((e.rolls ->> 'total')::numeric), 0)::integer, count(*) into v_dmg, v_n
    from public.vtt_events e
   where e.id = any(p_events) and e.event_type = 'damage' and jsonb_typeof(e.rolls -> 'total') = 'number';
  if v_n = 0 then raise exception 'No damage in those rolls.'; end if;

  v_ac := case when jsonb_typeof(v_c -> 'ac') = 'number' then (v_c ->> 'ac')::numeric::integer end;
  if not v_gm and v_attack is not null and v_ac is not null then
    v_hit := not v_fumble and (v_crit or v_attack >= v_ac);
  end if;

  -- p122: what the attack roll spends. A spell attack (extension 2.2.0 sends roll_type / request_type)
  -- spends the action, or the bonus action when its casting time says so; anything else an attack.
  v_kind := lower(coalesce(v_arolls ->> 'roll_type', '') || ' ' || coalesce(v_arolls ->> 'request_type', ''));
  if v_kind ~ '(^|\s)spell' then
    v_cost := case when lower(coalesce(v_arolls ->> 'casting_time', '')) like '%bonus%' then 'bonus' else 'action' end;
  end if;

  -- p121: an attack roll spends the roller's attack (p122: or action), hit or miss (combat_spend raises
  -- for a player with nothing left, which undoes the whole apply)
  if v_attack is not null then
    select min(e.character_id::text)::uuid into v_char from public.vtt_events e where e.id = any(p_events) and e.character_id is not null;
    if v_char is not null then
      select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
       where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = v_char::text limit 1;
      if v_att is not null and v_aord <> v_ord then
        v_att := public.combat_lock_last(public.combat_spend(v_att, v_cost,
          left(case when v_cost = 'attack' then 'Attack on ' else 'Spell at ' end
               || coalesce(v_c ->> 'name', 'a target') || ' (rolled outside)', 60), v_gm));
        update public.combats
           set combatants = jsonb_set(combatants, array[(v_aord - 1)::text], v_att), updated_at = now()
         where id = v_cb.id;
      end if;
    end if;
  end if;

  v_dmg := greatest(0, least(9999, case when p_half then v_dmg / 2 else v_dmg end));
  if v_hit then
    v_c := public.combat_hurt(v_c, v_dmg);
    update public.combats
       set combatants = jsonb_set(combatants, array[(v_ord - 1)::text], v_c), updated_at = now()
     where id = v_cb.id;
  end if;
  update public.vtt_events
     set applied_at = now(), applied_to = left(case when v_hit then '' else 'missed ' end || coalesce(v_c ->> 'name', 'a creature'), 200)
   where id = any(p_events);

  return jsonb_build_object('target', v_c ->> 'name', 'damage', case when v_hit then v_dmg else 0 end, 'hit', v_hit,
    'attack', v_attack, 'ac', case when v_gm then v_ac end, 'critical', v_crit, 'spent', v_cost);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_attack_damage(p_campaign uuid, p_character uuid, p_target text, p_amount integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cb    public.combats;
  v_aord  bigint;
  v_att   jsonb;
  v_tord  bigint;
  v_tgt   jsonb;
  v_la    jsonb;
  v_hp    integer;
  v_temp  integer;
  v_n     integer := greatest(0, least(9999, coalesce(p_amount, 0)));
begin
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  v_la := v_att -> 'lastAttack';
  if v_att is null or v_la is null or v_la ->> 'target' <> p_target or (v_la ->> 'hit') is distinct from 'true'
     or coalesce((v_la ->> 'applied')::boolean, false) or extract(epoch from now()) - (v_la ->> 'at')::numeric > 180 then
    raise exception 'roll a hit on them first';
  end if;
  select e.c, e.ord into v_tgt, v_tord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord) where e.c ->> 'id' = p_target limit 1;
  if v_tgt is null then raise exception 'no such combatant'; end if;
  v_hp := case when jsonb_typeof(v_tgt -> 'hp') = 'number' then (v_tgt ->> 'hp')::numeric::integer end;
  v_temp := coalesce(case when jsonb_typeof(v_tgt -> 'tempHp') = 'number' then (v_tgt ->> 'tempHp')::numeric::integer end, 0);
  v_tgt := v_tgt || jsonb_build_object('tempHp', v_temp - least(v_temp, v_n));
  if v_hp is not null then
    v_hp := greatest(0, v_hp - (v_n - least(v_temp, v_n)));
    v_tgt := v_tgt || jsonb_build_object('hp', v_hp);
    if v_hp = 0 and (v_tgt ->> 'kind') = 'monster' then v_tgt := v_tgt || jsonb_build_object('defeated', true); end if;
  end if;
  v_att := v_att || jsonb_build_object('lastAttack', v_la || jsonb_build_object('applied', true, 'damage', v_n));
  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_aord then v_att when e.ord = v_tord then v_tgt else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = v_cb.id;
  return jsonb_build_object('applied', true, 'target', v_tgt ->> 'name', 'defeated', coalesce((v_tgt ->> 'defeated')::boolean, false));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_attack_resolve(p_campaign uuid, p_character uuid, p_target text, p_total integer, p_natural integer, p_label text, p_gm boolean, p_cost text DEFAULT 'attack'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cb    public.combats;
  v_aord  bigint;
  v_att   jsonb;
  v_tgt   jsonb;
  v_ac    integer;
  v_hit   boolean;
  v_crit  boolean := coalesce(p_natural, 0) = 20;
  v_cost  text := coalesce(p_cost, 'attack');
  v_e     jsonb;
  v_last  jsonb;
  v_stem  text := split_part(coalesce(nullif(p_label, ''), 'Attack'), ' (', 1);
  v_n     integer;
begin
  if v_cost not in ('attack', 'action', 'bonus', 'reaction', 'free', 'followup') or (v_cost = 'free' and not p_gm) then raise exception 'unknown cost'; end if;
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  if v_att is null then raise exception 'your character is not in the fight'; end if;
  if not p_gm and v_cost <> 'reaction' and v_aord - 1 <> v_cb.turn then raise exception 'it is not your turn'; end if;
  -- a follow-up: another attack from the same casting (Eldritch Blast's beams, Scorching Ray's rays).
  -- Allowed when the attacker's last spend was that same spell within the last 90 seconds, up to ten
  -- in a row; it spends nothing more and is logged.
  if v_cost = 'followup' then
    v_e := public.combat_econ(v_att);
    v_last := v_e -> 'log' -> -1;
    if v_last is null or split_part(v_last ->> 'what', ' (', 1) <> v_stem
       or extract(epoch from now()) - coalesce((v_last ->> 'at')::numeric, 0) > 90 then
      raise exception 'cast the spell first';
    end if;
    select count(*) into v_n from jsonb_array_elements(v_e -> 'log') l where split_part(l ->> 'what', ' (', 1) = v_stem;
    if v_n >= 10 then raise exception 'that casting has no attacks left'; end if;
  end if;
  select e.c into v_tgt from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord) where e.c ->> 'id' = p_target limit 1;
  if v_tgt is null or (not p_gm and coalesce((v_tgt ->> 'hidden')::boolean, false)) then raise exception 'no such combatant'; end if;
  if v_tgt ->> 'id' = v_att ->> 'id' then raise exception 'pick someone else to attack'; end if;
  if v_cost = 'followup' then
    v_att := v_att || jsonb_build_object('econ', v_e || jsonb_build_object('log',
      (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (select x, o from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o) order by o desc limit 9) k)
      || jsonb_build_array(jsonb_build_object('cost', 'followup', 'what', left(coalesce(nullif(p_label, ''), 'Attack') || ' on ' || coalesce(v_tgt ->> 'name', 'a target'), 60),
                                              'at', extract(epoch from now()), 'locked', true, 'prev', v_e - 'log'))));
  else
    v_att := public.combat_lock_last(public.combat_spend(v_att, v_cost, coalesce(nullif(p_label, ''), 'Attack') || ' on ' || coalesce(v_tgt ->> 'name', 'a target'), p_gm));
  end if;
  v_ac := case when jsonb_typeof(v_tgt -> 'ac') = 'number' then (v_tgt ->> 'ac')::numeric::integer end;
  v_hit := case when coalesce(p_natural, 0) = 20 then true
                when coalesce(p_natural, 0) = 1 then false
                when v_ac is null then null
                else p_total >= v_ac end;
  v_att := v_att || jsonb_build_object('lastAttack', jsonb_build_object(
    'target', p_target, 'hit', v_hit, 'crit', v_crit and v_hit is true, 'label', left(coalesce(p_label, ''), 120),
    'at', extract(epoch from now()), 'applied', false));
  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_aord then v_att else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = v_cb.id;
  return jsonb_build_object('hit', v_hit, 'crit', v_crit and v_hit is true, 'target', v_tgt ->> 'name', 'combat', v_cb.id,
                            'attacksLeft', (public.combat_econ(v_att) ->> 'attacks')::integer);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_cant_act(p_c jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select x from unnest(array['Unconscious', 'Petrified', 'Paralyzed', 'Stunned', 'Incapacitated']) x
   where jsonb_typeof(p_c -> 'conditions') = 'array' and (p_c -> 'conditions') ? x
   limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_econ(p_c jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select public.combat_fresh_econ()
         || case when jsonb_typeof(p_c -> 'econ') = 'object' then p_c -> 'econ' else '{}'::jsonb end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_for_player(p_share text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with camp as (
    select id from public.campaigns where share_code = p_share limit 1
  ),
  cb as (
    select * from public.combats
    where campaign_id = (select id from camp) and status = 'active'
    order by updated_at desc
    limit 1
  )
  select case
    when (select id from cb) is null then null::jsonb
    else jsonb_build_object(
      'name',  (select name from cb),
      'round', (select round from cb),
      'order', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id',         e.c->>'id',
                 'name',       e.c->>'name',
                 'kind',       e.c->>'kind',
                 'initiative', e.c->'initiative',
                 'defeated',   coalesce((e.c->>'defeated')::boolean, false),
                 'is_turn',    (e.ord - 1) = (select turn from cb),
                 'conditions', case when e.c->>'kind' = 'pc' then coalesce(e.c->'conditions', '[]'::jsonb) else '[]'::jsonb end
               ) order by e.ord), '[]'::jsonb)
        from cb, jsonb_array_elements(cb.combatants) with ordinality as e(c, ord)
        where not coalesce((e.c->>'hidden')::boolean, false)
      )
    )
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_fresh_econ()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select '{"action":false,"bonus":false,"reaction":false,"moved":0,"dash":0,"attacks":0,"log":[]}'::jsonb;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_hurt(p_c jsonb, p_amount integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_n    integer := greatest(0, least(9999, coalesce(p_amount, 0)));
  v_hp   integer := case when jsonb_typeof(p_c -> 'hp') = 'number' then (p_c ->> 'hp')::numeric::integer end;
  v_temp integer := coalesce(case when jsonb_typeof(p_c -> 'tempHp') = 'number' then (p_c ->> 'tempHp')::numeric::integer end, 0);
  v_c    jsonb := p_c;
begin
  v_c := v_c || jsonb_build_object('tempHp', v_temp - least(v_temp, v_n));
  if v_hp is not null then
    v_hp := greatest(0, v_hp - (v_n - least(v_temp, v_n)));
    v_c := v_c || jsonb_build_object('hp', v_hp);
    if v_hp = 0 and (v_c ->> 'kind') = 'monster' then v_c := v_c || jsonb_build_object('defeated', true); end if;
  end if;
  return v_c;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_lock_last(p_c jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when jsonb_typeof(p_c -> 'econ' -> 'log') = 'array' and jsonb_array_length(p_c -> 'econ' -> 'log') > 0
              then jsonb_set(p_c, '{econ,log,-1,locked}', 'true'::jsonb) else p_c end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_markers()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select array[
    'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
    'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Concentrating',
    'Blessed', 'Hasted', 'Inspired', 'Raging', 'Dodging', 'Shielded',
    'Baned', 'Slowed', 'Hexed', 'Marked', 'Outlined', 'Vulnerable'
  ]::text[];
$function$
;

CREATE OR REPLACE FUNCTION public.combat_move(p_c jsonb, p_feet integer, p_force boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_e     jsonb := public.combat_econ(p_c);
  v_speed integer := public.combat_speed(p_c);
  v_moved integer := coalesce((v_e ->> 'moved')::integer, 0);
  v_left  integer;
begin
  if coalesce(p_feet, 0) <= 0 then return p_c; end if;
  if p_feet > 2000 then raise exception 'that is too far for one move'; end if;
  if not p_force and v_speed is not null then
    v_left := v_speed + coalesce((v_e ->> 'dash')::integer, 0) - v_moved;
    if v_speed = 0 and coalesce((v_e ->> 'dash')::integer, 0) = 0 then raise exception 'your speed is 0 right now'; end if;
    if p_feet > v_left then raise exception 'not enough movement left: % ft', greatest(0, v_left); end if;
  end if;
  v_e := v_e || jsonb_build_object('moved', v_moved + p_feet,
    'log', (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
              select x, o from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o) order by o desc limit 9) k)
           || jsonb_build_array(jsonb_build_object('cost', 'move', 'what', p_feet || ' ft', 'at', extract(epoch from now()), 'prev', v_e - 'log')));
  return p_c || jsonb_build_object('econ', v_e);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_request_save(p_campaign uuid, p_character uuid, p_targets text[], p_ability text, p_dc integer, p_damage integer, p_type text, p_half boolean, p_label text, p_gm boolean, p_cost text DEFAULT 'action'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cb    public.combats;
  v_att   jsonb;
  v_aord  bigint;
  v_names text[] := '{}';
  v_save  jsonb;
  v_new   jsonb;
  v_cost  text := coalesce(p_cost, 'action');
begin
  if v_cost not in ('action', 'bonus', 'reaction', 'free') or (v_cost = 'free' and not p_gm) then raise exception 'unknown cost'; end if;
  if p_ability not in ('str', 'dex', 'con', 'int', 'wis', 'cha') then raise exception 'pick an ability for the save'; end if;
  if p_dc is null or p_dc < 1 or p_dc > 40 then raise exception 'the DC must be between 1 and 40'; end if;
  if coalesce(array_length(p_targets, 1), 0) = 0 then raise exception 'pick at least one target'; end if;
  if array_length(p_targets, 1) > 30 then raise exception 'too many targets at once'; end if;
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  if v_att is null then raise exception 'your character is not in the fight'; end if;
  if not p_gm and v_cost <> 'reaction' and v_aord - 1 <> v_cb.turn then raise exception 'it is not your turn'; end if;

  select coalesce(array_agg(e.c ->> 'name'), '{}') into v_names
    from jsonb_array_elements(v_cb.combatants) e(c)
   where e.c ->> 'id' = any (p_targets) and (p_gm or not coalesce((e.c ->> 'hidden')::boolean, false));
  if coalesce(array_length(v_names, 1), 0) = 0 then raise exception 'no such combatant'; end if;

  v_att := public.combat_lock_last(public.combat_spend(v_att, v_cost, left(coalesce(p_label, 'Save effect'), 60), p_gm));

  v_save := jsonb_build_object(
    'by', v_att ->> 'name', 'byId', v_att ->> 'id', 'label', left(coalesce(p_label, 'Save'), 120),
    'ability', p_ability, 'dc', p_dc, 'damage', greatest(0, least(9999, coalesce(p_damage, 0))),
    'type', left(coalesce(p_type, ''), 30), 'half', coalesce(p_half, true), 'conditions', '[]'::jsonb,
    'at', extract(epoch from now()));

  select jsonb_agg(
           case when e.ord = v_aord and not (e.c ->> 'id' = any (p_targets)) then v_att
                when e.c ->> 'id' = any (p_targets) and (p_gm or not coalesce((e.c ->> 'hidden')::boolean, false))
                then (case when e.ord = v_aord then v_att else e.c end) || jsonb_build_object('pendingSaves',
                       coalesce(case when jsonb_typeof(e.c -> 'pendingSaves') = 'array' then e.c -> 'pendingSaves' end, '[]'::jsonb)
                       || jsonb_build_array(v_save || jsonb_build_object('id', gen_random_uuid()::text)))
                when e.ord = v_aord then v_att
                else e.c end
           order by e.ord)
    into v_new
    from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord);
  update public.combats set combatants = v_new, updated_at = now() where id = v_cb.id;
  return jsonb_build_object('targets', to_jsonb(v_names));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_resolve_save(p_campaign uuid, p_character uuid, p_save text, p_total integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cb    public.combats;
  v_c     jsonb;
  v_ord   bigint;
  v_ps    jsonb;
  v_ok    boolean;
  v_dmg   integer;
  v_conds jsonb;
  v_x     jsonb;
begin
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_c, v_ord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  if v_c is null then raise exception 'your character is not in the fight'; end if;
  select s into v_ps from jsonb_array_elements(case when jsonb_typeof(v_c -> 'pendingSaves') = 'array' then v_c -> 'pendingSaves' else '[]'::jsonb end) s
   where s ->> 'id' = p_save limit 1;
  if v_ps is null then raise exception 'that save is already settled'; end if;

  v_ok := coalesce(p_total, 0) >= (v_ps ->> 'dc')::integer;
  v_dmg := case when v_ok then (case when coalesce((v_ps ->> 'half')::boolean, true) then ((v_ps ->> 'damage')::integer / 2) else 0 end)
                else (v_ps ->> 'damage')::integer end;
  v_c := public.combat_hurt(v_c, v_dmg);
  if not v_ok and jsonb_typeof(v_ps -> 'conditions') = 'array' then
    v_conds := case when jsonb_typeof(v_c -> 'conditions') = 'array' then v_c -> 'conditions' else '[]'::jsonb end;
    for v_x in select * from jsonb_array_elements(v_ps -> 'conditions') loop
      if not (v_conds @> jsonb_build_array(v_x)) then v_conds := v_conds || jsonb_build_array(v_x); end if;
    end loop;
    v_c := v_c || jsonb_build_object('conditions', v_conds);
  end if;
  v_c := v_c || jsonb_build_object(
    'pendingSaves', coalesce((select jsonb_agg(s) from jsonb_array_elements(v_c -> 'pendingSaves') s where s ->> 'id' <> p_save), '[]'::jsonb),
    'lastSave', jsonb_build_object('label', v_ps ->> 'label', 'by', v_ps ->> 'by', 'total', p_total, 'dc', v_ps -> 'dc', 'saved', v_ok, 'damage', v_dmg, 'at', extract(epoch from now())));
  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_ord then v_c else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = v_cb.id;
  return jsonb_build_object('saved', v_ok, 'damage', v_dmg, 'dc', (v_ps ->> 'dc')::integer, 'label', v_ps ->> 'label', 'by', v_ps ->> 'by');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_speed(p_c jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_base  integer := case when jsonb_typeof(p_c -> 'speed') = 'number' then (p_c ->> 'speed')::numeric::integer end;
  v_conds jsonb := case when jsonb_typeof(p_c -> 'conditions') = 'array' then p_c -> 'conditions' else '[]'::jsonb end;
begin
  if v_base is null then return null; end if;
  if v_conds ?| array['Grappled', 'Restrained', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'] then return 0; end if;
  if v_conds ? 'Hasted' then v_base := v_base * 2; end if;
  if v_conds ? 'Slowed' then v_base := v_base / 2; end if;
  return v_base;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_spend(p_c jsonb, p_cost text, p_what text, p_force boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_e    jsonb := public.combat_econ(p_c);
  v_prev jsonb;
  v_stop text := public.combat_cant_act(p_c);
  v_per  integer := greatest(1, least(8, coalesce(case when jsonb_typeof(p_c -> 'attacksPerAction') = 'number' then (p_c ->> 'attacksPerAction')::numeric::integer end, 1)));
  v_left integer;
  v_what text := left(coalesce(nullif(trim(p_what), ''), initcap(p_cost)), 60);
begin
  if p_cost = 'free' then return p_c; end if;
  if p_cost not in ('action', 'attack', 'bonus', 'reaction') then raise exception 'unknown cost'; end if;
  if not p_force and v_stop is not null then raise exception 'cannot act while %', v_stop; end if;
  v_prev := v_e - 'log';
  v_left := coalesce((v_e ->> 'attacks')::integer, 0);

  if p_cost = 'attack' and v_left > 0 then
    v_e := v_e || jsonb_build_object('attacks', v_left - 1);
  elsif p_cost in ('action', 'attack') then
    if not p_force and (v_e ->> 'action')::boolean then raise exception 'you have used your action this turn'; end if;
    v_e := v_e || jsonb_build_object('action', true, 'attacks', case when p_cost = 'attack' then v_per - 1 else 0 end);
  elsif p_cost = 'bonus' then
    if not p_force and (v_e ->> 'bonus')::boolean then raise exception 'you have used your bonus action this turn'; end if;
    v_e := v_e || jsonb_build_object('bonus', true);
  else
    if not p_force and (v_e ->> 'reaction')::boolean then raise exception 'you have used your reaction this round'; end if;
    v_e := v_e || jsonb_build_object('reaction', true);
  end if;

  if (lower(v_what) = 'dash' or lower(v_what) like '%: dash') and p_cost in ('action', 'bonus') then
    v_e := v_e || jsonb_build_object('dash', coalesce((v_e ->> 'dash')::integer, 0) + coalesce(public.combat_speed(p_c), 0));
  end if;

  v_e := v_e || jsonb_build_object('log',
    (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
       select x, o from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o)
        order by o desc limit 9) k)
    || jsonb_build_array(jsonb_build_object('cost', p_cost, 'what', v_what, 'at', extract(epoch from now()), 'prev', v_prev)));
  return p_c || jsonb_build_object('econ', v_e);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.combat_turn_econ()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_n int := coalesce(jsonb_array_length(new.combatants), 0);
begin
  if v_n = 0 or new.turn is null or new.turn < 0 or new.turn >= v_n then return new; end if;
  if new.round is not distinct from old.round
     and (new.combatants -> new.turn ->> 'id') is not distinct from (old.combatants -> old.turn ->> 'id') then
    return new;
  end if;
  new.combatants := jsonb_set(new.combatants, array[new.turn::text, 'econ'], public.combat_fresh_econ());
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_campaign(p_campaign uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_campaign_gm(p_campaign) then
    raise exception 'not authorized to delete this campaign';
  end if;
  delete from public.campaigns where id = p_campaign;
end; $function$
;

CREATE OR REPLACE FUNCTION public.entries_set_slug()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.slug is null or new.slug = '' then
    new.slug := public.free_entry_slug(new.campaign_id, new.title, new.id);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.export_my_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'notice', 'Everything Six Axes holds that is linked to your account. Session audio is deleted automatically 60 days after recording, so older recordings will not appear here because they no longer exist.',

    'profile', (
      select to_jsonb(p) - 'id'
      from public.profiles p where p.id = v_uid
    ),

    'characters', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', ch.name, 'campaign', c.name, 'species', ch.species,
        'species_variant', ch.species_variant, 'class', ch.class,
        'subclass', ch.subclass, 'level', ch.level, 'alignment', ch.alignment,
        'description', ch.description, 'created_at', ch.created_at
      ) order by c.name, ch.name), '[]'::jsonb)
      from public.characters ch
      join public.campaigns c on c.id = ch.campaign_id
      where ch.profile_id = v_uid
    ),

    -- The self-perception series. Every snapshot, dated, not just the latest.
    'self_reports', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'scope', t.scope, 'taken_at', t.created_at,
        'instrument_version', t.instrument_version,
        'answers', t.answers, 'scores', t.scores, 'safety', t.safety
      ) order by t.created_at), '[]'::jsonb)
      from public.tpdi_responses t where t.respondent_id = v_uid
    ),

    'dispositions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'scope', d.scope, 'source', d.source, 'as_of', d.as_of,
        'model_version', d.model_version, 'axis_scores', d.axis_scores,
        'uncertainty', d.weights
      ) order by d.as_of desc), '[]'::jsonb)
      from public.dispositions d where d.profile_id = v_uid
    ),

    'threads', (
      select coalesce(jsonb_agg(to_jsonb(th) - 'profile_id' - 'id'), '[]'::jsonb)
      from public.threads th where th.profile_id = v_uid
    ),

    'check_ins', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'satisfaction', v.satisfaction, 'spotlight', v.spotlight_feeling,
        'note', v.note, 'at', v.created_at
      ) order by v.created_at), '[]'::jsonb)
      from public.vibe_checks v where v.profile_id = v_uid
    ),

    'chat_messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'body', m.body, 'at', m.created_at
      ) order by m.created_at), '[]'::jsonb)
      from public.chat_messages m where m.author_profile = v_uid
    ),

    -- What you said and rolled in table chat on the tabletop (p105).
    'table_chat', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', tm.kind, 'as', tm.as_name, 'body', tm.body, 'roll', tm.roll, 'at', tm.created_at
      ) order by tm.created_at), '[]'::jsonb)
      from public.vtt_messages tm where tm.author_profile = v_uid
    ),

    -- Your words, as transcribed. This is the most personal thing in the system
    -- after the audio itself, and it belongs in an export.
    'transcript_segments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'text', ts.text, 'start_ms', ts.start_ms, 'at', ts.created_at
      ) order by ts.created_at), '[]'::jsonb)
      from public.transcript_segments ts
      join public.characters ch on ch.id = ts.character_id
      where ch.profile_id = v_uid
    ),

    'recordings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'recorded_at', a.created_at,
        'duration_seconds', a.duration_seconds,
        'status', case when a.purged_at is not null
                       then 'deleted under the 60-day retention policy'
                       else 'retained' end,
        'deleted_at', a.purged_at
      ) order by a.created_at desc), '[]'::jsonb)
      from public.audio_tracks a
      join public.characters ch on ch.id = a.character_id
      where ch.profile_id = v_uid
    ),

    'recording_consents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'consented', rc.consented, 'method', rc.method, 'at', rc.created_at,
        'scope', case when rc.session_id is null then 'standing (campaign-wide)'
                      else 'this session only' end
      ) order by rc.created_at), '[]'::jsonb)
      from public.recording_consents rc where rc.profile_id = v_uid
    )
  ) into v_out;

  return v_out;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.free_entry_slug(p_campaign uuid, p_base text, p_self uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  base text := coalesce(public.slugify(p_base), 'entry');
  try  text := base;
  n    integer := 1;
begin
  while exists (
    select 1 from public.entries e
    where e.campaign_id = p_campaign
      and e.slug = try
      and (p_self is null or e.id <> p_self)
  ) loop
    n := n + 1;
    try := base || '-' || n;
  end loop;
  return try;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.gm_chat_read(p_campaign uuid)
 RETURNS TABLE(display_name text, body text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.display_name, m.body, m.created_at
  from public.chat_messages m
  where m.campaign_id = p_campaign
    and public.is_campaign_gm(p_campaign)
    and exists (
      select 1 from public.chat_grants g
      where g.campaign_id = m.campaign_id
        and g.player_profile = m.author_profile
        and m.created_at between g.from_ts and g.to_ts
    )
  order by m.created_at asc;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_anon boolean := coalesce((new.is_anonymous)::boolean, false);
  v_meta jsonb   := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, display_name, email, avatar_url, is_anonymous)
  values (
    new.id,
    nullif(coalesce(v_meta->>'full_name', v_meta->>'name', v_meta->>'user_name', ''), ''),
    nullif(coalesce(new.email, v_meta->>'email', ''), ''),
    nullif(coalesce(v_meta->>'avatar_url', v_meta->>'picture', ''), ''),
    v_anon
  )
  on conflict (id) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_campaign_gm(p_campaign uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from campaigns c
    where c.id = p_campaign and c.gm_id = auth.uid()
  ) or exists (
    select 1 from memberships m
    where m.campaign_id = p_campaign and m.profile_id = auth.uid()
      and m.role in ('gm','co-gm') and m.active
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_campaign_gm_segment(p_segment text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when p_segment is null then false
    when p_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then false
    else public.is_campaign_gm(p_segment::uuid)
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_campaign_member(p_campaign uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from memberships m
    where m.campaign_id = p_campaign and m.profile_id = auth.uid() and m.active
  );
$function$
;

CREATE OR REPLACE FUNCTION public.journal_for_share(p_share text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select cj.content
  from public.campaign_journals cj
  join public.campaigns c on c.id = cj.campaign_id
  where c.share_code = p_share;
$function$
;

CREATE OR REPLACE FUNCTION public.latest_processed_session(code text)
 RETURNS TABLE(campaign_name text, session_id uuid, session_number integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.name, s.id, s.session_number
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code and s.status in ('processed','completed')
  order by s.session_number desc nulls last
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.library_alter_ego_is_flat()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  n integer;
begin
  if new.alter_ego_of is null then
    return new;
  end if;
  if new.alter_ego_of = new.id then
    raise exception 'A build cannot be its own alter ego.';
  end if;
  if exists (
    select 1 from public.pc_library l
    where l.id = new.alter_ego_of and l.alter_ego_of is not null
  ) then
    raise exception 'That build is already an alter ego. Link to the primary instead.';
  end if;

  select count(*) into n
  from public.pc_library l
  where l.alter_ego_of = new.alter_ego_of and l.id <> new.id;
  if n >= 10 then
    raise exception 'A build can have at most 10 alter egos.';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.map_fog_for_share(p_share text)
 RETURNS TABLE(map_id uuid, cols integer, rows integer, cells text, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select f.map_id, f.cols, f.rows, f.cells, f.updated_at
  from public.map_fog f
  join public.maps m on m.id = f.map_id
  join public.campaigns c on c.id = f.campaign_id
  where c.share_code = p_share
    and m.visibility <> 'gm';
$function$
;

CREATE OR REPLACE FUNCTION public.map_for_player(p_share text)
 RETURNS TABLE(map_id uuid, map_name text, image_path text, pin_id uuid, x double precision, y double precision, label text, linked_type text, linked_title text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with camp as (
    select id from public.campaigns where share_code = p_share
  ),
  vis_maps as (
    select m.id, m.name, m.image_path
    from public.maps m, camp
    where m.campaign_id = camp.id and m.visibility in ('common', 'player')
  )
  select
    vm.id as map_id, vm.name as map_name, vm.image_path,
    p.id as pin_id, p.x, p.y, p.label, p.linked_type,
    case
      when p.linked_type = 'entry' then (select e.title from public.entries e where e.id = p.linked_id)
      when p.linked_type = 'character' then (select ch.name from public.characters ch where ch.id = p.linked_id)
      else null
    end as linked_title
  from vis_maps vm
  left join public.map_pins p
    on p.map_id = vm.id and p.visibility in ('common', 'player')
  order by vm.name;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_audio_purged(p_track_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.audio_tracks
     set purged_at = now(),
         storage_path = null
   where id = p_track_id
     and purged_at is null;
$function$
;

CREATE OR REPLACE FUNCTION public.mint_public_slug(p_campaign uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
declare
  s text;
begin
  if not public.is_campaign_gm(p_campaign) then
    raise exception 'Only the GM of this campaign can publish it.';
  end if;
  loop
    -- 16 hex chars. Collisions are handled by the loop rather than assumed away.
    s := encode(gen_random_bytes(8), 'hex');
    exit when not exists (select 1 from public.campaigns where public_slug = s);
  end loop;
  update public.campaigns set public_slug = s where id = p_campaign;
  return s;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.my_campaigns()
 RETURNS TABLE(campaign_id uuid, campaign_name text, system text, share_code text, gm_name text, my_characters bigint, last_session_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.id,
    c.name,
    c.system,
    c.share_code,
    coalesce(nullif(gm.display_name, ''), 'Your GM'),
    count(ch.id),
    (select max(s.started_at)
       from public.sessions s
      where s.campaign_id = c.id and s.started_at is not null)
  from public.characters ch
  join public.campaigns c  on c.id = ch.campaign_id
  left join public.profiles gm on gm.id = c.gm_id
  where ch.profile_id = auth.uid()
    and ch.kind = 'pc'
  group by c.id, c.name, c.system, c.share_code, gm.display_name
  order by c.name;
$function$
;

CREATE OR REPLACE FUNCTION public.my_character(p_share text)
 RETURNS TABLE(character_id uuid, name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ch.id, ch.name
  from public.campaigns c
  join public.characters ch on ch.campaign_id = c.id
  where c.share_code = p_share and ch.kind = 'pc' and ch.profile_id = auth.uid()
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.my_characters()
 RETURNS TABLE(character_id uuid, name text, campaign_id uuid, campaign_name text, species text, class text, subclass text, level smallint, alignment text, kind text, active boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ch.id, ch.name, c.id, c.name,
         ch.species, ch.class, ch.subclass, ch.level, ch.alignment, ch.kind, ch.active
  from public.characters ch
  join public.campaigns c on c.id = ch.campaign_id
  where ch.profile_id = auth.uid()
  order by c.name, ch.name;
$function$
;

CREATE OR REPLACE FUNCTION public.my_deletion_blockers()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'campaigns_i_run', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)), '[]'::jsonb)
      from public.campaigns c where c.gm_id = auth.uid()
    ),
    'can_delete', not exists (select 1 from public.campaigns c where c.gm_id = auth.uid())
  );
$function$
;

CREATE OR REPLACE FUNCTION public.my_rsvp_for_share(code text, p_session_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    return null;
  end if;
 
  -- The session must belong to the campaign behind this share code (same check rsvp_for_share makes).
  if not exists (
    select 1
    from public.campaigns c
    join public.sessions s on s.campaign_id = c.id
    where c.share_code = code and s.id = p_session_id
  ) then
    return null;
  end if;
 
  select a.status
    into v_status
  from public.attendance a
  where a.session_id = p_session_id
    and a.profile_id = v_uid;
 
  return v_status;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.my_vibe_check(code text, p_session_number integer)
 RETURNS TABLE(satisfaction integer, spotlight_feeling text, note text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.satisfaction, v.spotlight_feeling, v.note
  from public.vibe_checks v
  join public.sessions s on s.id = v.session_id
  join public.campaigns c on c.id = s.campaign_id
  where c.share_code = code
    and s.session_number = p_session_number
    and v.profile_id = auth.uid()
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.next_scheduled_for_share(code text)
 RETURNS TABLE(session_id uuid, session_number integer, scheduled_at timestamp with time zone, campaign_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, s.session_number::int, s.scheduled_at, c.name
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code
    and s.scheduled_at is not null
    and s.scheduled_at >= now()
  order by s.scheduled_at asc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.party_fund_change(p_campaign uuid, p_delta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.party_funds%rowtype;
  d record;
  k text;
begin
  if not (is_campaign_gm(p_campaign) or tabletop_is_player(p_campaign)) then raise exception 'not at this table'; end if;
  if p_delta is null or jsonb_typeof(p_delta) <> 'object' then raise exception 'Say which coins.'; end if;
  for k in select jsonb_object_keys(p_delta) loop
    if k not in ('pp', 'gp', 'ep', 'sp', 'cp') then raise exception 'Unknown coin: %', k; end if;
    if jsonb_typeof(p_delta -> k) <> 'number' or abs((p_delta ->> k)::numeric) > 10000000 then raise exception 'Bad amount for %', k; end if;
  end loop;
  insert into public.party_funds (campaign_id) values (p_campaign) on conflict (campaign_id) do nothing;
  select * into f from public.party_funds where campaign_id = p_campaign for update;
  select coalesce((p_delta ->> 'pp')::int, 0) as pp, coalesce((p_delta ->> 'gp')::int, 0) as gp, coalesce((p_delta ->> 'ep')::int, 0) as ep,
         coalesce((p_delta ->> 'sp')::int, 0) as sp, coalesce((p_delta ->> 'cp')::int, 0) as cp into d;
  if f.pp + d.pp < 0 or f.gp + d.gp < 0 or f.ep + d.ep < 0 or f.sp + d.sp < 0 or f.cp + d.cp < 0 then
    raise exception 'The party does not have that many coins.';
  end if;
  update public.party_funds
     set pp = pp + d.pp, gp = gp + d.gp, ep = ep + d.ep, sp = sp + d.sp, cp = cp + d.cp, updated_by = auth.uid(), updated_at = now()
   where campaign_id = p_campaign
   returning * into f;
  return jsonb_build_object('pp', f.pp, 'gp', f.gp, 'ep', f.ep, 'sp', f.sp, 'cp', f.cp);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.party_take(p_item uuid, p_qty integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.party_items%rowtype;
  n integer;
begin
  select * into r from public.party_items where id = p_item for update;
  if not found then raise exception 'That item is no longer in the party inventory.'; end if;
  if not (is_campaign_gm(r.campaign_id) or tabletop_is_player(r.campaign_id)) then
    raise exception 'not at this table';
  end if;
  n := coalesce(p_qty, r.qty);
  if n < 1 then raise exception 'Take at least one.'; end if;
  if n > r.qty then raise exception 'The party has only % of those.', r.qty; end if;
  if n = r.qty then
    delete from public.party_items where id = r.id;
  else
    update public.party_items set qty = qty - n, updated_at = now() where id = r.id;
  end if;
  return jsonb_build_object('name', r.name, 'qty', n, 'weight', r.weight, 'note', r.note, 'custom', r.custom,
    'mod', r.mod, 'variant', r.variant, 'left', r.qty - n);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pc_library_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.player_journal(p_share text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_campaign uuid;
  v_char uuid;
  v_name text;
  v_post jsonb;
  v_beats jsonb;
begin
  select c.id into v_campaign from public.campaigns c where c.share_code = p_share;
  if v_campaign is null then return null; end if;

  select ch.id, ch.name into v_char, v_name
  from public.characters ch
  where ch.campaign_id = v_campaign and ch.kind = 'pc' and ch.profile_id = auth.uid()
  limit 1;
  if v_char is null then
    return jsonb_build_object('character', null);
  end if;

  select d.axis_scores into v_post
  from public.dispositions d
  where d.character_id = v_char and d.source = 'posterior'
  order by d.as_of desc limit 1;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.n nulls last), '[]'::jsonb) into v_beats
  from (
    select s.session_number as n,
           coalesce(nullif(e.payload->>'rationale',''), e.event_type) as summary,
           e.event_type as kind,
           'you'::text as who
    from public.events e
    left join public.sessions s on s.id = e.session_id
    where e.character_id = v_char
    union all
    select s.session_number as n, g.summary as summary, g.kind as kind, 'gm'::text as who
    from public.gm_events g
    left join public.sessions s on s.id = g.session_id
    where g.target_character_id = v_char
  ) b;

  return jsonb_build_object(
    'character', jsonb_build_object('id', v_char, 'name', v_name),
    'posterior', v_post,
    'beats', v_beats
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.public_campaign(p_slug text)
 RETURNS TABLE(name text, blurb text, published_at timestamp with time zone, items bigint, codex_cover_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select c.name, c.public_blurb, c.public_published_at,
         (select count(*) from public.public_codex(p_slug)),
         c.codex_cover_url
  from public.campaigns c
  where c.public_slug = p_slug and c.public_published_at is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.public_campaign_listing(p_slug text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(
    (select c.public_listed from public.campaigns c
      where c.public_slug = p_slug and c.public_published_at is not null),
    false);
$function$
;

CREATE OR REPLACE FUNCTION public.public_codex(p_slug text)
 RETURNS TABLE(item_kind text, item_type text, id uuid, title text, summary text, body text, blocks jsonb, tags text[], slug text, image_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with camp as (
    select id from public.campaigns
    where public_slug = p_slug and public_published_at is not null
  )
  select 'entry'::text, e.type::text, e.id, e.title, e.summary, e.body, e.blocks, e.tags, e.slug, e.image_url
  from public.entries e, camp
  where e.campaign_id = camp.id and e.is_public
  union all
  -- NPCs bring the portrait the GM already uploaded in the Forge; no summary or blocks of their own.
  select 'npc'::text, 'npc'::text, ch.id, ch.name, null::text, ch.description, null::jsonb, ch.tags,
         public.slugify(ch.name), ch.portrait_url
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'npc' and ch.is_public
  union all
  -- Player characters the PLAYER has opted in (is_public, set by the owner via the existing character
  -- UPDATE policy). Unlike NPCs they carry their own summary + blocks (the player's rich page); the
  -- hero image reuses the Forge portrait. Campaign must still be published (the camp CTE gate).
  select 'pc'::text, 'pc'::text, ch.id, ch.name, ch.summary, ch.description, ch.blocks, ch.tags,
         public.slugify(ch.name), ch.portrait_url
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'pc' and ch.is_public;
$function$
;

CREATE OR REPLACE FUNCTION public.public_codex_links(p_slug text)
 RETURNS TABLE(source_type text, source_id uuid, target_type text, target_id uuid, relation text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with camp as (
    select id from public.campaigns
    where public_slug = p_slug and public_published_at is not null
  ),
  pub as (
    -- the publicly visible items, typed the way entity_links refers to them
    select 'entry'::text as etype, e.id
    from public.entries e, camp
    where e.campaign_id = camp.id and e.is_public
    union all
    select 'character'::text, ch.id
    from public.characters ch, camp
    where ch.campaign_id = camp.id and ch.kind in ('npc', 'pc') and ch.is_public
  )
  select l.source_type, l.source_id, l.target_type, l.target_id, l.relation
  from public.entity_links l, camp
  where l.campaign_id = camp.id
    and exists (select 1 from pub p where p.etype = l.source_type and p.id = l.source_id)
    and exists (select 1 from pub p where p.etype = l.target_type and p.id = l.target_id);
$function$
;

CREATE OR REPLACE FUNCTION public.public_listed_campaigns()
 RETURNS TABLE(slug text, name text, published_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select c.public_slug, c.name, c.public_published_at
  from public.campaigns c
  where c.public_published_at is not null
    and c.public_listed
    and c.public_slug is not null
  order by c.public_published_at desc
  limit 5000;
$function$
;

CREATE OR REPLACE FUNCTION public.public_world_snapshot(p_slug text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select wm.snapshot_url
  from public.campaigns c
  join public.world_maps wm on wm.campaign_id = c.id
  where c.public_slug = p_slug
    and c.public_published_at is not null
    and wm.published
    and wm.snapshot_url is not null
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.recaps_for_share(code text)
 RETURNS TABLE(session_id uuid, session_number integer, recap text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, s.session_number::int, s.recap
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code
    and s.recap is not null
    and s.status in ('processed', 'completed', 'done')
  order by s.session_number desc nulls last;
$function$
;

CREATE OR REPLACE FUNCTION public.record_consent_for_share(code text, p_session_number integer, p_character_id uuid, p_consented boolean, p_method text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_campaign uuid;
  v_session uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select id into v_campaign from public.campaigns where share_code = code;
  if v_campaign is null then raise exception 'campaign not found for share'; end if;

  if p_session_number is not null then
    select id into v_session from public.sessions
    where campaign_id = v_campaign and session_number = p_session_number;
  end if;

  if exists (
    select 1 from public.recording_consents
    where campaign_id = v_campaign and profile_id = v_uid
      and session_id is not distinct from v_session
  ) then
    update public.recording_consents
      set consented = p_consented, method = p_method, character_id = p_character_id,
          recorded_by = v_uid, created_at = now()
    where campaign_id = v_campaign and profile_id = v_uid
      and session_id is not distinct from v_session;
  else
    insert into public.recording_consents
      (campaign_id, session_id, character_id, profile_id, consented, method, recorded_by)
    values (v_campaign, v_session, p_character_id, v_uid, p_consented, p_method, v_uid);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_context(code text)
 RETURNS TABLE(campaign_name text, open boolean, session_number integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.name,
    exists (select 1 from public.capture_jobs j where j.campaign_id = c.id and j.status = 'draft'),
    (select s.session_number
       from public.capture_jobs j
       join public.sessions s on s.id = j.session_id
      where j.campaign_id = c.id and j.status = 'draft'
      order by j.created_at desc limit 1)
  from public.campaigns c
  where c.share_code = code
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.regenerate_entry_slug(p_entry uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_campaign uuid;
  v_title    text;
  v_slug     text;
begin
  select e.campaign_id, e.title into v_campaign, v_title
  from public.entries e where e.id = p_entry;

  if v_campaign is null then
    raise exception 'No such entry.';
  end if;
  if not public.is_campaign_gm(v_campaign) then
    raise exception 'Only the GM of this campaign can change its URLs.';
  end if;

  -- Passing the entry's own id so the collision check ignores its CURRENT slug: without it, an
  -- entry whose title has not changed would collide with itself and come back as "-2".
  v_slug := public.free_entry_slug(v_campaign, v_title, p_entry);

  update public.entries set slug = v_slug where id = p_entry;
  return v_slug;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reserved_slug(p_slug text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_slug = any (array[
    'admin','api','auth','login','logout','signup','sign-up','signin','sign-in',
    'new','edit','delete','settings','account','billing','support','help',
    'gm','me','play','chat','codex','journal','record','claim','join','setup',
    'privacy','terms','about','pricing','blog','docs','status','six-axes','sixaxes'
  ]);
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_share_code(code text)
 RETURNS TABLE(campaign_id uuid, campaign_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id, name from public.campaigns where share_code = code limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.review_proposed_event(p_id uuid, p_accept boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p   public.proposed_events%rowtype;
  seg public.transcript_segments%rowtype;
  v_axis text; v_frame text; v_target text;
  v_event uuid;
begin
  select * into p from public.proposed_events where id = p_id;
  if not found then raise exception 'proposal not found'; end if;
  if not public.is_campaign_gm(p.campaign_id) then raise exception 'not permitted'; end if;
  if p.status <> 'proposed' then return null; end if;

  if not p_accept then
    update public.proposed_events set status = 'rejected' where id = p_id;
    return null;
  end if;

  if not exists (select 1 from public.event_types where key = p.event_type) then
    raise exception 'unknown event_type %', p.event_type;
  end if;

  v_axis   := case when p.axis   in ('N','T','O','S','E','I') then p.axis end;
  v_frame  := case when p.frame  in ('ic','ooc')              then p.frame end;
  v_target := case when p.target in ('fiction','player','system') then p.target end;

  if p.segment_id is not null then
    select * into seg from public.transcript_segments where id = p.segment_id;
  end if;

  insert into public.events
    (campaign_id, session_id, character_id, event_type, axis, frame, target,
     ts_offset_ms, payload, source, confidence, transcript_span, extractor_version)
  values
    (p.campaign_id, p.session_id, p.character_id, p.event_type, v_axis, v_frame, v_target,
     seg.start_ms,
     case when p.rationale is not null then jsonb_build_object('rationale', p.rationale) end,
     'transcript', p.confidence,
     case when seg.id is not null
          then jsonb_build_object('start_ms', seg.start_ms, 'end_ms', seg.end_ms, 'text', seg.text) end,
     p.extractor_version)
  returning id into v_event;

  update public.proposed_events set status = 'accepted' where id = p_id;
  return v_event;
end; $function$
;

CREATE OR REPLACE FUNCTION public.roster_for_share(code text)
 RETURNS TABLE(character_id uuid, name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ch.id, ch.name
  from public.campaigns c
  join public.characters ch on ch.campaign_id = c.id
  where c.share_code = code and ch.kind = 'pc'
  order by ch.name;
$function$
;

CREATE OR REPLACE FUNCTION public.rsvp_for_share(code text, p_session_id uuid, p_status text, p_display_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_campaign uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_status not in ('going','maybe','declined') then raise exception 'invalid status'; end if;

  select c.id into v_campaign
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code and s.id = p_session_id;
  if v_campaign is null then raise exception 'session not found for share'; end if;

  if p_display_name is not null and length(trim(p_display_name)) > 0 then
    update public.profiles set display_name = p_display_name
    where id = v_uid and (display_name is null or length(trim(display_name)) = 0);
  end if;

  if exists (select 1 from public.attendance where session_id = p_session_id and profile_id = v_uid) then
    update public.attendance set status = p_status
    where session_id = p_session_id and profile_id = v_uid;
  else
    insert into public.attendance (campaign_id, session_id, profile_id, status)
    values (v_campaign, p_session_id, v_uid, p_status);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rsvps_for_gm(p_session_id uuid)
 RETURNS TABLE(status text, display_name text, character_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.status, p.display_name, ch.name
  from public.sessions s
  join public.campaigns c on c.id = s.campaign_id
  join public.attendance a on a.session_id = s.id
  left join public.profiles p on p.id = a.profile_id
  left join public.characters ch on ch.id = a.character_id
  where s.id = p_session_id
    and c.gm_id = auth.uid()
  order by
    case a.status when 'going' then 0 when 'maybe' then 1 when 'declined' then 2 else 3 end,
    p.display_name nulls last;
$function$
;

CREATE OR REPLACE FUNCTION public.schema_health()
 RETURNS TABLE(check_key text, label text, ok boolean, detail text, migration text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_catalog'
AS $function$
  select 'portrait_player'::text,
         'Players can upload portraits for their own characters'::text,
         exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                   and policyname='player writes own pc portrait'),
         'storage.objects policy "player writes own pc portrait"'::text,
         'p14-portrait-uploads.sql'::text
  union all
  select 'portrait_statblock',
         'GMs can upload portraits for their own monster stat blocks',
         exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                   and policyname='gm writes own statblock portrait'),
         'storage.objects policy "gm writes own statblock portrait"',
         'p14-portrait-uploads.sql'
  union all
  select 'portrait_helpers',
         'The portrait policies can actually see who owns what',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public'
             and p.proname in ('can_write_character_portrait','can_write_statblock_portrait')) = 2,
         'functions public.can_write_character_portrait / can_write_statblock_portrait',
         'p17-portrait-policy-definer.sql'
  union all
  select 'map_path_guard',
         'Uploads outside a campaign folder do not abort on a bad path',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='is_campaign_gm_segment'),
         'function public.is_campaign_gm_segment',
         'p18-map-policy-uuid-guard.sql'
  union all
  select 'room_capture',
         'In-person sessions can be recorded from one microphone',
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='audio_tracks' and column_name='kind')
         and exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='capture_jobs'
                    and column_name='room_consent_by'),
         'audio_tracks.kind and capture_jobs.room_consent_by',
         'p19-room-capture.sql'
  union all
  select 'pc_library',
         'Players can save reusable character builds',
         to_regclass('public.pc_library') is not null,
         'table public.pc_library',
         'p13-pc-library.sql'
  union all
  select 'character_identities',
         'Characters link across campaigns',
         to_regclass('public.character_identities') is not null,
         'table public.character_identities',
         'p15-character-identities.sql'
  union all
  select 'capture_heartbeat',
         'The voice sidecar can claim and recover recordings',
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='capture_control'
                    and column_name='heartbeat_at'),
         'column public.capture_control.heartbeat_at',
         'p7-capture-heartbeat.sql'
$function$
;

CREATE OR REPLACE FUNCTION public.session_consent_ok(p_session uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with s as (
    select id, campaign_id from public.sessions where id = p_session
  ),
  present as (
    select a.character_id
    from public.attendance a
    where a.session_id = p_session
      and a.status in ('present', 'late', 'partial')
      and a.character_id is not null
  ),
  blanket as (  -- characters with standing (campaign-wide) consent
    select rc.character_id
    from public.recording_consents rc, s
    where rc.campaign_id = s.campaign_id
      and rc.session_id is null
      and rc.consented
  ),
  optout as (   -- characters the GM opted out of THIS session
    select rc.character_id
    from public.recording_consents rc
    where rc.session_id = p_session
      and rc.consented = false
  ),
  room as (     -- in-person: the GM affirmed the whole room agreed, before recording started
    select 1
    from public.capture_jobs j
    where j.session_id = p_session
      and j.room_consent_at is not null
      and exists (
        select 1 from public.audio_tracks a
        where a.job_id = j.id and a.kind = 'room'
      )
  )
  select
    exists (select 1 from room)
    or (
      -- at least one recordable character: consented and not opted out
      exists (
        select 1 from present p
        where p.character_id in (select character_id from blanket)
          and p.character_id not in (select character_id from optout)
      )
      -- and nobody present is un-consented AND not excluded
      and not exists (
        select 1 from present p
        where p.character_id not in (select character_id from blanket)
          and p.character_id not in (select character_id from optout)
      )
    );
$function$
;

CREATE OR REPLACE FUNCTION public.set_public_slug(p_campaign uuid, p_slug text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  s text;
begin
  if not public.is_campaign_gm(p_campaign) then
    raise exception 'Only the GM of this campaign can change its address.';
  end if;

  s := lower(trim(coalesce(p_slug, '')));

  if s = '' then
    raise exception 'Give the address some text.';
  end if;
  if length(s) < 3 or length(s) > 40 then
    raise exception 'An address has to be between 3 and 40 characters.';
  end if;
  -- Letters, digits and single inner hyphens. No leading or trailing hyphen, because a trailing one
  -- is invisible when someone reads the link aloud and produces a 404 nobody can explain.
  if s !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Use lowercase letters, numbers and hyphens only, and do not start or end with a hyphen.';
  end if;
  if public.reserved_slug(s) then
    raise exception 'That address is reserved. Pick another.';
  end if;

  -- Only for a campaign that has asked to be findable. See the note at the top: on an unlisted
  -- campaign the random address IS the privacy, and replacing it with a guessable one would quietly
  -- remove a protection the GM never agreed to give up.
  if not exists (
    select 1 from public.campaigns
    where id = p_campaign and public_listed and public_published_at is not null
  ) then
    raise exception 'Publish the campaign and turn on search indexing first. While a campaign is unlisted, its random address is what keeps it private.';
  end if;

  if exists (select 1 from public.campaigns where public_slug = s and id <> p_campaign) then
    raise exception 'Another campaign already uses that address.';
  end if;

  update public.campaigns set public_slug = s where id = p_campaign;
  return s;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end; $function$
;

CREATE OR REPLACE FUNCTION public.slugify(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  with cleaned as (
    select trim(both '-' from
      regexp_replace(
        regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g')) as s
  )
  select nullif(
    case
      when length(s) <= 60 then s
      -- Back up to the last hyphen inside the limit so the cut lands between words.
      else trim(both '-' from left(s, 60 - position('-' in reverse(left(s, 61)))))
    end, '')
  from cleaned;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_vibe_check(code text, p_session_number integer, p_satisfaction integer, p_spotlight text, p_note text, p_player_name text, p_anonymous boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_campaign uuid;
  v_session  uuid;
  v_uid      uuid := auth.uid();
begin
  -- Still required. The caller has to be SOMEBODY for the share link to be checked at all; being
  -- anonymous is about what is STORED, not about skipping the gate.
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select c.id, s.id into v_campaign, v_session
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code and s.session_number = p_session_number
  limit 1;
  if v_session is null then
    raise exception 'invalid link or session';
  end if;

  if p_satisfaction is not null and (p_satisfaction < 1 or p_satisfaction > 5) then
    raise exception 'satisfaction out of range';
  end if;
  if p_spotlight is not null
     and p_spotlight not in ('wanted_more','about_right','wanted_less') then
    raise exception 'invalid spotlight value';
  end if;

  if coalesce(p_anonymous, false) then
    -- No profile_id, so no upsert: there is deliberately nothing to match against. The name is
    -- forced null even if one was typed, because a form that lets you tick "anonymous" and still
    -- sends your name is a trap rather than a choice.
    insert into public.vibe_checks
      (campaign_id, session_id, profile_id, satisfaction, spotlight_feeling, note, player_name, created_at)
    values
      (v_campaign, v_session, null, p_satisfaction, p_spotlight,
       nullif(trim(p_note), ''), null, date_trunc('hour', now()));
    return;
  end if;

  -- the signup trigger normally makes this; ensure it for anon players
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  insert into public.vibe_checks
    (campaign_id, session_id, profile_id, satisfaction, spotlight_feeling, note, player_name)
  values
    (v_campaign, v_session, v_uid, p_satisfaction, p_spotlight,
     nullif(trim(p_note), ''), nullif(trim(p_player_name), ''))
  on conflict (session_id, profile_id) do update
    set satisfaction      = excluded.satisfaction,
        spotlight_feeling = excluded.spotlight_feeling,
        note              = excluded.note,
        player_name       = excluded.player_name,
        created_at        = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_activate_scene(p_scene uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_campaign uuid;
begin
  select campaign_id into v_campaign from public.vtt_scenes where id = p_scene;
  if v_campaign is null then raise exception 'scene not found'; end if;
  if not public.is_campaign_gm(v_campaign) then raise exception 'only the GM can change the scene'; end if;
  update public.vtt_scenes set is_active = false, updated_at = now() where campaign_id = v_campaign and is_active and id <> p_scene;
  update public.vtt_scenes set is_active = true, updated_at = now() where id = p_scene;
  delete from public.vtt_scene_players where campaign_id = v_campaign;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_can_edit_token(p_token uuid, p_campaign uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.vtt_tokens;
begin
  if v_uid is null then return false; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null or v_t.campaign_id <> p_campaign then return false; end if;
  return public.is_campaign_gm(v_t.campaign_id)
      or (not v_t.hidden and v_t.layer <> 'gm' and (
            v_uid = any (v_t.controlled_by)
            or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_card_json(c vtt_cards, p_show boolean)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', c.id, 'deckId', c.deck_id, 'pile', c.pile, 'faceUp', c.face_up,
                            'holder', c.holder, 'playedBy', c.played_by, 'shown', p_show)
      || case when p_show then jsonb_build_object('name', c.name, 'body', c.body, 'suit', c.suit, 'rank', c.rank,
                                                  'picture', public.tabletop_file_url(c.image_path)) else '{}'::jsonb end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_card_move(p_card uuid, p_to text, p_face_up boolean DEFAULT true, p_holder uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_c    public.vtt_cards;
  v_d    public.vtt_decks;
  v_gm   boolean;
  v_to   uuid;
  v_ord  integer;
  v_up   boolean := coalesce(p_face_up, true);
  v_msg  text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_to not in ('table', 'discard', 'hand', 'draw') then raise exception 'cards go to the table, the discards, a hand or the deck'; end if;
  select * into v_c from public.vtt_cards where id = p_card for update;
  if v_c.id is null then raise exception 'card not found'; end if;
  select * into v_d from public.vtt_decks where id = v_c.deck_id;
  v_gm := public.is_campaign_gm(v_c.campaign_id);
  if not v_gm then
    if not public.tabletop_is_player(v_c.campaign_id) then raise exception 'not at this table'; end if;
    if not ((v_c.pile = 'hand' and v_c.holder = v_uid) or (v_c.pile = 'table' and v_c.played_by = v_uid)) then
      raise exception 'that card is not yours to move';
    end if;
    if p_to = 'draw' then raise exception 'only the GM puts cards back in the deck'; end if;
  end if;

  if p_to = 'hand' then
    v_to := coalesce(p_holder, v_uid);
    if not public.tabletop_card_seat(v_c.campaign_id, v_to) then raise exception 'that person is not at this table'; end if;
  end if;

  -- where it goes in its new pile: on top of the deck, or after what is already there
  if p_to = 'draw' then
    select coalesce(min(ord), 1) - 1 into v_ord from public.vtt_cards where deck_id = v_c.deck_id and pile = 'draw';
  elsif p_to = 'discard' then
    select coalesce(max(ord), 0) + 1 into v_ord from public.vtt_cards where deck_id = v_c.deck_id and pile = 'discard';
  elsif p_to = 'table' then
    v_ord := case when v_c.pile = 'table' then v_c.ord
                  else (select coalesce(max(ord), 0) + 1 from public.vtt_cards where campaign_id = v_c.campaign_id and pile = 'table') end;
  else
    select coalesce(max(ord), 0) + 1 into v_ord from public.vtt_cards where campaign_id = v_c.campaign_id and pile = 'hand' and holder = v_to;
  end if;

  -- what chat says: a card's name only once everyone can see it
  v_msg := case
    when p_to = 'table' and v_c.pile = 'table' and v_up and not v_c.face_up then format('reveals %s', v_c.name)
    when p_to = 'table' and v_c.pile = 'table' and not v_up and v_c.face_up then format('turns %s face down', v_c.name)
    when p_to = 'table' and v_c.pile = 'table' then null
    when p_to = 'table' and v_up then format('plays %s', v_c.name)
    when p_to = 'table' then 'plays a card face down'
    when p_to = 'discard' then format('discards %s', v_c.name)
    when p_to = 'draw' then format('puts a card back on top of %s', v_d.name)
    when v_to = v_uid and v_c.pile = 'table' then format('takes back %s', case when v_c.face_up then v_c.name else 'a card' end)
    when v_to = v_uid then null
    else format('passes a card to %s', public.tabletop_seat_name(v_c.campaign_id, v_to)) end;

  update public.vtt_cards
     set pile = p_to,
         holder = case when p_to = 'hand' then v_to end,
         face_up = case when p_to = 'table' then v_up when p_to = 'discard' then true else false end,
         played_by = case when p_to = 'table' then coalesce(case when v_c.pile = 'table' then v_c.played_by end, v_uid) end,
         ord = v_ord,
         moved_at = now()
   where id = p_card;
  if v_msg is not null then perform public.tabletop_card_say(v_c.campaign_id, v_msg); end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_card_say(p_campaign uuid, p_body text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.vtt_messages (campaign_id, session_id, author_profile, kind, body)
  values (p_campaign, public.tabletop_open_session(p_campaign), auth.uid(), 'emote', left(p_body, 2000));
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_card_seat(p_campaign uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_uid is not null and (
    p_uid = (select gm_id from public.campaigns where id = p_campaign)
    or exists (select 1 from public.characters c where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id = p_uid));
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_cards(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_gm  boolean;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  return jsonb_build_object(
    'decks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id, 'name', d.name, 'kind', d.kind, 'backColor', d.back_color, 'playersDraw', d.players_draw,
               'back', public.tabletop_file_url(d.back_path),
               'total', (select count(*) from public.vtt_cards c where c.deck_id = d.id),
               'draw', (select count(*) from public.vtt_cards c where c.deck_id = d.id and c.pile = 'draw'),
               'discard', (select count(*) from public.vtt_cards c where c.deck_id = d.id and c.pile = 'discard'),
               'discardTop', (select public.tabletop_card_json(c, true) from public.vtt_cards c
                               where c.deck_id = d.id and c.pile = 'discard' order by c.ord desc limit 1))
             order by d.created_at), '[]'::jsonb)
        from public.vtt_decks d where d.campaign_id = p_campaign),
    'table', (
      select coalesce(jsonb_agg(public.tabletop_card_json(c, c.face_up or v_gm or c.played_by = v_uid) order by c.ord), '[]'::jsonb)
        from public.vtt_cards c where c.campaign_id = p_campaign and c.pile = 'table'),
    'hand', (
      select coalesce(jsonb_agg(public.tabletop_card_json(c, true) order by c.ord), '[]'::jsonb)
        from public.vtt_cards c where c.campaign_id = p_campaign and c.pile = 'hand' and c.holder = v_uid),
    'hands', (
      select coalesce(jsonb_agg(jsonb_build_object('holder', h.holder, 'name', public.tabletop_seat_name(p_campaign, h.holder), 'count', h.n)
             order by h.holder), '[]'::jsonb)
        from (select holder, count(*) as n from public.vtt_cards
               where campaign_id = p_campaign and pile = 'hand' and holder is not null group by holder) h),
    'others', case when v_gm then (
      select coalesce(jsonb_agg(public.tabletop_card_json(c, true) order by c.holder, c.ord), '[]'::jsonb)
        from public.vtt_cards c where c.campaign_id = p_campaign and c.pile = 'hand' and c.holder is distinct from v_uid) end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_cards_to_hand(p_deck uuid, p_to uuid, p_count integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_d   public.vtt_decks;
  v_n   integer := greatest(1, least(coalesce(p_count, 1), 10));
  v_got integer;
begin
  -- one draw at a time per deck, so two people never take the same card
  select * into v_d from public.vtt_decks where id = p_deck for update;
  with top as (
    select id, ord from public.vtt_cards where deck_id = p_deck and pile = 'draw' order by ord limit v_n for update
  ), numbered as (
    select id, row_number() over (order by ord) as rn from top
  ), base as (
    select coalesce(max(ord), 0) as m from public.vtt_cards where campaign_id = v_d.campaign_id and pile = 'hand' and holder = p_to
  )
  update public.vtt_cards c
     set pile = 'hand', holder = p_to, face_up = false, played_by = null, ord = base.m + numbered.rn, moved_at = now()
    from numbered, base
   where c.id = numbered.id;
  get diagnostics v_got = row_count;
  if v_got = 0 then raise exception '% is empty: shuffle the discards back in first', v_d.name; end if;
  return v_got;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_combat(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_gm  boolean;
  v_cb  public.combats;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;

  select * into v_cb from public.combats
  where campaign_id = p_campaign and status = 'active'
  order by updated_at desc limit 1;
  if v_cb.id is null then return null; end if;

  return jsonb_build_object(
    'id', v_cb.id,
    'name', v_cb.name,
    'round', v_cb.round,
    'order', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',          e.c ->> 'id',
          'name',        e.c ->> 'name',
          'kind',        e.c ->> 'kind',
          'initiative',  e.c -> 'initiative',
          'defeated',    coalesce((e.c ->> 'defeated')::boolean, false),
          'is_turn',     (e.ord - 1) = v_cb.turn,
          'tokenId',     e.c -> 'tokenId',
          'characterId', e.c -> 'characterId',
          'conditions',  coalesce(e.c -> 'conditions', '[]'::jsonb),
          'mine',        o.mine,
          'awaitingSave', jsonb_typeof(e.c -> 'pendingSaves') = 'array' and jsonb_array_length(e.c -> 'pendingSaves') > 0
        )
        || case when e.c ->> 'kind' = 'pc' then jsonb_build_object(
             'hp',     e.c -> 'hp',
             'maxHp',  e.c -> 'maxHp',
             'tempHp', e.c -> 'tempHp')
           else '{}'::jsonb end
        || case when (e.ord - 1) = v_cb.turn and not o.mine then jsonb_build_object(
             'turnUsed', jsonb_build_object(
               'action', (public.combat_econ(e.c) ->> 'action')::boolean,
               'bonus',  (public.combat_econ(e.c) ->> 'bonus')::boolean,
               'moved',  (public.combat_econ(e.c) ->> 'moved')::integer))
           else '{}'::jsonb end
        || case when o.mine then jsonb_build_object(
             'ac', e.c -> 'ac',
             'pendingSaves', coalesce(case when jsonb_typeof(e.c -> 'pendingSaves') = 'array' then e.c -> 'pendingSaves' end, '[]'::jsonb),
             'lastSave', e.c -> 'lastSave',
             'econ', public.combat_econ(e.c) - 'log'
                     || jsonb_build_object('log', coalesce((select jsonb_agg(l - 'prev' order by o2) from jsonb_array_elements(public.combat_econ(e.c) -> 'log') with ordinality as x(l, o2)), '[]'::jsonb)),
             'speed', e.c -> 'speed',
             'speedNow', public.combat_speed(e.c),
             'attacksPerAction', coalesce(e.c -> 'attacksPerAction', '1'::jsonb),
             'cantAct', public.combat_cant_act(e.c))
           else '{}'::jsonb end
        order by e.ord), '[]'::jsonb)
      from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord),
           lateral (select (e.c ->> 'kind') = 'pc'
                       and coalesce(e.c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
                       and exists (select 1 from public.characters ch
                                   where ch.id = (e.c ->> 'characterId')::uuid and ch.profile_id = v_uid) as mine) o
      where not coalesce((e.c ->> 'hidden')::boolean, false)
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_deck_deal(p_deck uuid, p_to uuid, p_count integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_d   public.vtt_decks;
  v_got integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_d from public.vtt_decks where id = p_deck;
  if v_d.id is null then raise exception 'deck not found'; end if;
  if not public.is_campaign_gm(v_d.campaign_id) then raise exception 'only the GM deals'; end if;
  if not public.tabletop_card_seat(v_d.campaign_id, p_to) then raise exception 'that person is not at this table'; end if;
  v_got := public.tabletop_cards_to_hand(p_deck, p_to, p_count);
  perform public.tabletop_card_say(v_d.campaign_id, format('deals %s from %s to %s',
    case when v_got = 1 then 'a card' else v_got || ' cards' end, v_d.name, public.tabletop_seat_name(v_d.campaign_id, p_to)));
  return v_got;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_deck_draw(p_deck uuid, p_count integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_d   public.vtt_decks;
  v_got integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_d from public.vtt_decks where id = p_deck;
  if v_d.id is null then raise exception 'deck not found'; end if;
  if not public.is_campaign_gm(v_d.campaign_id) then
    if not public.tabletop_is_player(v_d.campaign_id) then raise exception 'not at this table'; end if;
    if not v_d.players_draw then raise exception 'only the GM draws from %', v_d.name; end if;
  end if;
  v_got := public.tabletop_cards_to_hand(p_deck, v_uid, p_count);
  perform public.tabletop_card_say(v_d.campaign_id, format('draws %s from %s', case when v_got = 1 then 'a card' else v_got || ' cards' end, v_d.name));
  return v_got;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_deck_shuffle(p_deck uuid, p_all boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_d public.vtt_decks;
  v_n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_d from public.vtt_decks where id = p_deck for update;
  if v_d.id is null then raise exception 'deck not found'; end if;
  if not public.is_campaign_gm(v_d.campaign_id) then raise exception 'only the GM shuffles'; end if;
  if coalesce(p_all, false) then
    update public.vtt_cards set pile = 'draw', holder = null, face_up = false, played_by = null, moved_at = now()
     where deck_id = p_deck and pile <> 'draw';
  else
    update public.vtt_cards set pile = 'draw', face_up = false, moved_at = now() where deck_id = p_deck and pile = 'discard';
  end if;
  update public.vtt_cards c set ord = s.rn
    from (select id, row_number() over (order by gen_random_uuid()) as rn from public.vtt_cards where deck_id = p_deck and pile = 'draw') s
   where c.id = s.id;
  select count(*) into v_n from public.vtt_cards where deck_id = p_deck and pile = 'draw';
  perform public.tabletop_card_say(v_d.campaign_id,
    case when coalesce(p_all, false) then format('gathers every card and shuffles %s', v_d.name) else format('shuffles %s', v_d.name) end);
  return v_n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_difficult_extra(p_cells jsonb, p_n integer, p_ax double precision, p_ay double precision, p_bx double precision, p_by double precision, p_base integer, p_fps real)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_n    integer := greatest(1, coalesce(p_n, 1));
  v_fps  double precision := case when coalesce(p_fps, 0) > 0 then p_fps else 5 end;
  v_on   boolean[];
  v_dx   double precision := p_bx - p_ax;
  v_dy   double precision := p_by - p_ay;
  v_len  double precision;
  v_k    integer;
  v_hit  integer := 0;
  v_t    double precision;
  v_c    integer;
  v_r    integer;
  v_cell jsonb;
  v_any  boolean := false;
begin
  if p_cells is null or jsonb_typeof(p_cells) <> 'array' or jsonb_array_length(p_cells) = 0 or coalesce(p_base, 0) <= 0 then return 0; end if;
  v_len := sqrt(v_dx * v_dx + v_dy * v_dy);
  if v_len < 1e-9 then return 0; end if;
  v_on := array_fill(false, array[v_n * v_n]);
  for v_cell in select c from jsonb_array_elements(p_cells) as x(c) loop
    if jsonb_typeof(v_cell) = 'number' and (v_cell #>> '{}') ~ '^[0-9]+$' and (v_cell #>> '{}')::bigint < v_n * v_n then
      v_on[(v_cell #>> '{}')::integer + 1] := true; v_any := true;
    end if;
  end loop;
  if not v_any then return 0; end if;
  v_k := greatest(1, ceil(v_len / 0.1)::integer);
  for i in 0 .. v_k - 1 loop
    v_t := (i + 0.5) / v_k;
    v_c := floor(p_ax + v_dx * v_t)::integer;
    v_r := floor(p_ay + v_dy * v_t)::integer;
    if v_c >= 0 and v_r >= 0 and v_c < v_n and v_r < v_n and v_on[v_r * v_n + v_c + 1] then v_hit := v_hit + 1; end if;
  end loop;
  -- floor(x + 0.5), as JavaScript's Math.round: Postgres rounds a double's exact halves to even
  return (floor((v_hit::double precision / v_k) * p_base / v_fps + 0.5) * v_fps)::integer;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_effect_kinds()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select array['fire', 'cold', 'acid', 'lightning', 'poison', 'darkness', 'fog', 'radiant', 'necrotic']::text[];
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_feed(p_campaign uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_gm      boolean;
  v_session uuid;
  v_lim     integer := greatest(1, least(coalesce(p_limit, 200), 500));
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  v_session := public.tabletop_open_session(p_campaign);

  return jsonb_build_object(
    'messages', (
      select coalesce(jsonb_agg(to_jsonb(m) - 'campaign_id' order by m.created_at), '[]'::jsonb)
      from (
        select * from public.vtt_messages m
        where m.campaign_id = p_campaign
          and (p_since is null or m.created_at > p_since)
          and (m.author_profile = v_uid
               or (m.whisper_to is not null and v_uid = any (m.whisper_to))
               or (m.whisper_to is null and v_gm)
               or (m.whisper_to is null and not m.gm_only))
        order by m.created_at desc
        limit v_lim
      ) m
    ),
    'outside_rolls', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'actor_name', e.actor_name, 'character_id', e.character_id, 'source', e.source,
        'event_type', e.event_type, 'name', e.name, 'rolls', e.rolls, 'at', coalesce(e.rolled_at, e.received_at),
        'applied_to', e.applied_to
      ) order by coalesce(e.rolled_at, e.received_at)), '[]'::jsonb)
      from (
        select * from public.vtt_events e
        where v_session is not null and e.session_id = v_session
          and e.source not in ('six_axes_tabletop', 'demo')
          and (p_since is null or e.received_at > p_since)
        order by e.received_at desc
        limit v_lim
      ) e
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_feet(p_dx real, p_dy real, p_rule text, p_fps real)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_dx real := abs(p_dx);
  v_dy real := abs(p_dy);
  v_diag real := least(abs(p_dx), abs(p_dy));
  v_sq real;
begin
  if p_rule = 'euclid' then v_sq := sqrt(v_dx * v_dx + v_dy * v_dy);
  elsif p_rule = 'alternate' then v_sq := greatest(v_dx, v_dy) + floor(round(v_diag) / 2);
  else v_sq := greatest(v_dx, v_dy);
  end if;
  return round(v_sq * coalesce(nullif(p_fps, 0), 5))::integer;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_file_in_use(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.vtt_handouts where image_path = p_path)
      or exists (select 1 from public.vtt_decks where back_path = p_path)
      or exists (select 1 from public.vtt_cards where image_path = p_path);
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_file_ok(p_campaign uuid, p_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_path is null or p_path !~ ('^' || p_campaign::text || '/(handouts|cards|decks)/[0-9a-f-]{36}\.(png|jpg|webp|gif)$') then
    return false;
  end if;
  if public.is_campaign_gm(p_campaign) then return true; end if;
  if not public.tabletop_is_player(p_campaign) then return false; end if;
  return exists (
           select 1 from public.vtt_handouts h
            where h.campaign_id = p_campaign and h.image_path = p_path
              and (h.shown_to is null or exists (
                    select 1 from public.characters me
                     where me.campaign_id = p_campaign and me.kind = 'pc' and me.profile_id = v_uid and me.id = any (h.shown_to))))
      or exists (select 1 from public.vtt_decks d where d.campaign_id = p_campaign and d.back_path = p_path)
      or exists (
           select 1 from public.vtt_cards c
            where c.campaign_id = p_campaign and c.image_path = p_path
              and ((c.pile = 'hand' and c.holder = v_uid)
                   or (c.pile = 'table' and (c.face_up or c.played_by = v_uid))
                   or c.pile = 'discard'));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_file_url(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when p_path is null then null
              else '/api/tabletop/table-file?c=' || split_part(p_path, '/', 1) || '&p=' || p_path end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_floors(p_scene uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_sc  public.vtt_scenes;
  v_gm  boolean;
  v_m   public.battle_maps;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_sc from public.vtt_scenes where id = p_scene;
  if v_sc.id is null then raise exception 'scene not found'; end if;
  v_gm := public.is_campaign_gm(v_sc.campaign_id);
  if not v_gm then
    if not public.tabletop_is_player(v_sc.campaign_id) then raise exception 'not at this table'; end if;
    if public.tabletop_scene_for(v_sc.campaign_id, v_uid) is distinct from p_scene then return '[]'::jsonb; end if;
  end if;
  select * into v_m from public.battle_maps where id = v_sc.battle_map_id;
  -- one scene per floor: the active one, else the most recently changed
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'level', f.level,
             'name', coalesce(nullif(v_m.meta -> 'levelNames' ->> f.level, ''), 'Level ' || (f.level + 1)),
             'current', f.id = p_scene)
           || case when v_gm then jsonb_build_object('sceneId', f.id, 'active', f.is_active) else '{}'::jsonb end
           order by f.level)
      from (select distinct on (s.level) s.id, s.level, s.is_active from public.vtt_scenes s
             where s.campaign_id = v_sc.campaign_id and s.battle_map_id = v_sc.battle_map_id
             order by s.level, (s.id = p_scene) desc, s.is_active desc, s.updated_at desc) f
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_handouts(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if public.is_campaign_gm(p_campaign) then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'entryId', h.entry_id, 'title', coalesce(e.title, h.title), 'type', e.type, 'summary', e.summary,
               'body', e.body, 'blocks', e.blocks, 'imageUrl', e.image_url, 'shownAt', h.shown_at,
               'picture', public.tabletop_file_url(h.image_path), 'picturePath', h.image_path, 'note', h.note,
               'shownTo', case when h.shown_to is null then null else (
                 select coalesce(jsonb_agg(ch.name order by ch.name), '[]'::jsonb) from public.characters ch where ch.id = any (h.shown_to)) end)
             order by h.shown_at desc)
        from public.vtt_handouts h left join public.entries e on e.id = h.entry_id
       where h.campaign_id = p_campaign and (h.entry_id is null or e.id is not null)), '[]'::jsonb);
  end if;
  if not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'entryId', h.entry_id, 'title', coalesce(e.title, h.title), 'type', e.type, 'summary', e.summary,
             'body', e.body, 'blocks', e.blocks, 'imageUrl', e.image_url, 'shownAt', h.shown_at,
             'picture', public.tabletop_file_url(h.image_path), 'note', h.note)
           order by h.shown_at desc)
      from public.vtt_handouts h left join public.entries e on e.id = h.entry_id
     where h.campaign_id = p_campaign
       and (h.entry_id is null or e.id is not null)
       and exists (
         select 1 from public.characters me
          where me.campaign_id = p_campaign and me.kind = 'pc' and me.profile_id = v_uid
            and (h.shown_to is null or me.id = any (h.shown_to))
            and (h.entry_id is null
                 or e.visibility in ('common', 'player')
                 or exists (select 1 from public.entry_reveals r
                             where r.target_type = 'entry' and r.target_id = e.id and r.revealed_to_character_id = me.id)))
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_has_hooks(p_campaign uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (public.is_campaign_gm(p_campaign) or public.tabletop_is_player(p_campaign))
     and exists (select 1 from public.addon_hooks h where h.campaign_id = p_campaign and h.enabled);
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_hide_handout(p_handout uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_h public.vtt_handouts;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_h from public.vtt_handouts where id = p_handout;
  if v_h.id is null then raise exception 'that handout is gone'; end if;
  if not public.is_campaign_gm(v_h.campaign_id) then raise exception 'only the GM hides handouts'; end if;
  delete from public.vtt_handouts where id = p_handout;
  delete from public.entry_reveals r
   where r.id = any (v_h.added_reveals)
     and not exists (select 1 from public.vtt_handouts o where o.campaign_id = v_h.campaign_id and r.id = any (o.added_reveals));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_is_player(p_campaign uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.characters ch
    where ch.campaign_id = p_campaign and ch.profile_id = auth.uid() and ch.kind = 'pc'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_move_token(p_token uuid, p_x real, p_y real, p_rot real DEFAULT NULL::real)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_t    public.vtt_tokens;
  v_n    integer;
  v_fps  real;
  v_rule text;
  v_gm   boolean;
  v_cb   public.combats;
  v_c    jsonb;
  v_ord  bigint;
  v_x    real;
  v_y    real;
  v_ft   integer;
  v_map  public.battle_maps;
  v_lv   integer;
  v_ds   jsonb;
  v_set  jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  v_gm := public.is_campaign_gm(v_t.campaign_id);
  if not (
    v_gm
    or (not v_t.hidden and v_t.layer <> 'gm' and (
          v_uid = any (v_t.controlled_by)
          or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)))
  ) then
    raise exception 'that token is not yours to move';
  end if;
  select b.n, b.feet_per_square, s.settings ->> 'diagonal', s.settings into v_n, v_fps, v_rule, v_set
    from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id where s.id = v_t.scene_id;
  v_n := coalesce(v_n, 100);
  v_x := greatest(-v_n, least(2 * v_n, p_x));
  v_y := greatest(-v_n, least(2 * v_n, p_y));

  if not v_gm then
    -- p122: a player's token may not cross a wall, a closed door, a sight wall or the map's edge
    select s.level, s.door_state into v_lv, v_ds from public.vtt_scenes s where s.id = v_t.scene_id;
    select b.* into v_map
      from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id where s.id = v_t.scene_id;
    if v_map.id is not null
       and public.tabletop_wall_blocks(v_map, v_lv, v_ds, v_t.x::double precision, v_t.y::double precision, v_x::double precision, v_y::double precision) then
      raise exception 'a wall is in the way';
    end if;

    select * into v_cb from public.combats where campaign_id = v_t.campaign_id and status = 'active'
     order by updated_at desc limit 1 for update;
    if v_cb.id is not null then
      select e.c, e.ord into v_c, v_ord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
       where e.c ->> 'tokenId' = p_token::text
          or (v_t.character_id is not null and (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = v_t.character_id::text)
       order by (e.c ->> 'tokenId' = p_token::text) desc nulls last
       limit 1;
      if v_c is not null and not coalesce((v_c ->> 'defeated')::boolean, false) then
        v_ft := public.tabletop_feet(v_x - v_t.x, v_y - v_t.y, coalesce(v_rule, 'five'), coalesce(v_fps, 5));
        if v_ft > 0 then
          -- p125: every foot through difficult terrain costs one more
          v_ft := v_ft + public.tabletop_difficult_extra(v_set -> 'difficult', v_n, v_t.x::double precision, v_t.y::double precision,
                                                         v_x::double precision, v_y::double precision, v_ft, coalesce(v_fps, 5));
          if v_ord - 1 <> v_cb.turn then raise exception 'wait for your turn to move'; end if;
          v_c := public.combat_lock_last(public.combat_move(v_c, v_ft, false));
          update public.combats
             set combatants = (select jsonb_agg(case when e.ord = v_ord then v_c else e.c end order by e.ord)
                                 from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
                 updated_at = now()
           where id = v_cb.id;
        end if;
      end if;
    end if;
  end if;

  update public.vtt_tokens
     set x = v_x, y = v_y,
         rot = coalesce(p_rot, rot),
         updated_at = now()
   where id = p_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_on_connector(p_map battle_maps, p_level integer, p_x double precision, p_y double precision)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from jsonb_array_elements(case when jsonb_typeof(p_map.elements -> p_level) = 'array' then p_map.elements -> p_level else '[]'::jsonb end) e,
           lateral (select case when jsonb_typeof(e.value -> 's') = 'number' then greatest((e.value ->> 's')::double precision, 0.5) else 1 end as s) z
     where e.value ->> 'k' in ('stairs', 'ladder', 'trapdoor', 'pit')
       and jsonb_typeof(e.value -> 'x') = 'number' and jsonb_typeof(e.value -> 'y') = 'number'
       and p_x between (e.value ->> 'x')::double precision - 0.25 and (e.value ->> 'x')::double precision + z.s + 0.25
       and p_y between (e.value ->> 'y')::double precision - 0.25 and (e.value ->> 'y')::double precision + z.s + 0.25);
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_open_session(p_campaign uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id from public.sessions s
  where s.campaign_id = p_campaign and s.ended_at is null
  order by coalesce(s.started_at, s.created_at) desc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_pin_entry(p_pin uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_p   public.vtt_pins;
  v_sc  public.vtt_scenes;
  v_n   integer;
  v_e   public.entries;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_p from public.vtt_pins where id = p_pin;
  if v_p.id is null or v_p.entry_id is null then raise exception 'nothing to read there'; end if;
  select * into v_sc from public.vtt_scenes where id = v_p.scene_id;
  if not public.is_campaign_gm(v_p.campaign_id) then
    select b.n into v_n from public.battle_maps b where b.id = v_sc.battle_map_id;
    if not (public.tabletop_is_player(v_p.campaign_id)
            and v_p.players_see
            and public.tabletop_scene_for(v_p.campaign_id, v_uid) = v_p.scene_id
            and (v_n is null or public.tabletop_revealed(v_sc.revealed, v_sc.fog_on, v_n, floor(v_p.x)::integer, floor(v_p.y)::integer))
            and public.tabletop_player_reads_entry(v_p.campaign_id, v_p.entry_id)) then
      raise exception 'nothing to read there';
    end if;
  end if;
  select * into v_e from public.entries where id = v_p.entry_id;
  return jsonb_build_object('id', v_p.id, 'entryId', v_e.id, 'title', v_e.title, 'type', v_e.type, 'summary', v_e.summary,
    'body', v_e.body, 'blocks', v_e.blocks, 'imageUrl', v_e.image_url, 'shownAt', now());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_pins(p_scene uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_sc    public.vtt_scenes;
  v_n     integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_sc from public.vtt_scenes where id = p_scene;
  if v_sc.id is null then raise exception 'scene not found'; end if;
  if public.is_campaign_gm(v_sc.campaign_id) then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'x', p.x, 'y', p.y, 'label', p.label, 'color', p.color,
               'entryId', p.entry_id, 'entryTitle', e.title, 'gmNote', p.gm_note, 'playersSee', p.players_see) order by p.created_at)
        from public.vtt_pins p left join public.entries e on e.id = p.entry_id
       where p.scene_id = p_scene), '[]'::jsonb);
  end if;
  if not public.tabletop_is_player(v_sc.campaign_id) then raise exception 'not at this table'; end if;
  if public.tabletop_scene_for(v_sc.campaign_id, v_uid) is distinct from p_scene then return '[]'::jsonb; end if;
  select b.n into v_n from public.battle_maps b where b.id = v_sc.battle_map_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'x', p.x, 'y', p.y, 'label', p.label, 'color', p.color,
             'entryId', case when ok.reads then p.entry_id end, 'entryTitle', case when ok.reads then e.title end,
             'playersSee', true) order by p.created_at)
      from public.vtt_pins p
      left join public.entries e on e.id = p.entry_id
      cross join lateral (select p.entry_id is not null and public.tabletop_player_reads_entry(v_sc.campaign_id, p.entry_id) as reads) ok
     where p.scene_id = p_scene and p.players_see
       and (v_n is null or public.tabletop_revealed(v_sc.revealed, v_sc.fog_on, v_n, floor(p.x)::integer, floor(p.y)::integer))
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_place(p_scene uuid, p_profiles uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s public.vtt_scenes;
  v_n integer;
begin
  select * into v_s from public.vtt_scenes where id = p_scene;
  if v_s.id is null then raise exception 'scene not found'; end if;
  if not public.is_campaign_gm(v_s.campaign_id) then raise exception 'only the GM moves players between scenes'; end if;
  if coalesce(array_length(p_profiles, 1), 0) = 0 then raise exception 'pick at least one player'; end if;
  if exists (select 1 from unnest(p_profiles) p where not exists (
      select 1 from public.characters c where c.campaign_id = v_s.campaign_id and c.kind = 'pc' and c.profile_id = p)) then
    raise exception 'that player has no character in this campaign';
  end if;
  if v_s.is_active then
    delete from public.vtt_scene_players where campaign_id = v_s.campaign_id and profile_id = any (p_profiles);
  else
    insert into public.vtt_scene_players (campaign_id, profile_id, scene_id)
    select v_s.campaign_id, p, p_scene from unnest(p_profiles) p
    on conflict (campaign_id, profile_id) do update set scene_id = excluded.scene_id, updated_at = now();
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_player_reads_entry(p_campaign uuid, p_entry uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.entries e, public.characters me
     where e.id = p_entry and e.campaign_id = p_campaign
       and me.campaign_id = p_campaign and me.kind = 'pc' and me.profile_id = auth.uid()
       and (e.visibility in ('common', 'player')
            or exists (select 1 from public.entry_reveals r
                        where r.target_type = 'entry' and r.target_id = e.id and r.revealed_to_character_id = me.id)));
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_revealed(p_rev bytea, p_on boolean, p_n integer, p_x integer, p_y integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select not coalesce(p_on, false) or (
    p_x >= 0 and p_y >= 0 and p_x < p_n and p_y < p_n
    and (p_y * p_n + p_x) < length(p_rev) * 8
    and get_bit(p_rev, p_y * p_n + p_x) = 1
  );
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_say(p_campaign uuid, p_body text, p_kind text DEFAULT 'say'::text, p_as_name text DEFAULT NULL::text, p_character uuid DEFAULT NULL::uuid, p_whisper_to uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_gm   boolean;
  v_id   uuid;
  v_to   uuid[];
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  if p_kind not in ('say', 'emote', 'whisper') then raise exception 'unknown message kind'; end if;
  if coalesce(trim(p_body), '') = '' then return null; end if;
  if char_length(trim(p_body)) > 2000 then raise exception 'message too long (2000 characters at most)'; end if;
  -- a player speaks as their own character; the GM may speak as any character in the campaign or a name
  if p_character is not null and not exists (
    select 1 from public.characters c where c.id = p_character and c.campaign_id = p_campaign
      and (v_gm or c.profile_id = v_uid)) then
    raise exception 'you cannot speak as that character';
  end if;
  if p_kind = 'whisper' then
    -- recipients must be at this table: the GM or the owner of a pc here
    select array_agg(distinct r) into v_to
    from unnest(coalesce(p_whisper_to, '{}')) r
    where r = (select gm_id from public.campaigns where id = p_campaign)
       or exists (select 1 from public.characters c where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id = r);
    if v_to is null or array_length(v_to, 1) is null then raise exception 'nobody at this table by that name'; end if;
  end if;
  insert into public.vtt_messages (campaign_id, session_id, author_profile, as_name, character_id, kind, body, whisper_to)
  values (p_campaign, public.tabletop_open_session(p_campaign), v_uid, nullif(trim(coalesce(p_as_name, '')), ''),
          p_character, p_kind, trim(p_body), case when p_kind = 'whisper' then v_to else null end)
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_scene_for(p_campaign uuid, p_profile uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select sp.scene_id from public.vtt_scene_players sp join public.vtt_scenes s on s.id = sp.scene_id
      where sp.campaign_id = p_campaign and sp.profile_id = p_profile and s.campaign_id = p_campaign),
    (select s.id from public.vtt_scenes s where s.campaign_id = p_campaign and s.is_active limit 1));
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_seat_name(p_campaign uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when p_uid = (select gm_id from public.campaigns where id = p_campaign) then 'GM'
              else coalesce((select c.name from public.characters c
                              where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id = p_uid
                              order by c.active desc, c.name limit 1), 'someone') end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_server_ms()
 RETURNS double precision
 LANGUAGE sql
AS $function$ select extract(epoch from clock_timestamp()) * 1000 $function$
;

CREATE OR REPLACE FUNCTION public.tabletop_set_audio(p_campaign uuid, p_state jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m     jsonb := p_state -> 'music';
  v_snd   public.vtt_sounds;
  v_music jsonb := null;
  v_amb   jsonb := '[]'::jsonb;
  v_a     jsonb;
  v_out   jsonb;
  v_n     integer := 0;
  v_vol   real;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_campaign_gm(p_campaign) then raise exception 'only the GM controls the sound'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or length(p_state::text) > 4000 then raise exception 'that is not a sound setting'; end if;

  if jsonb_typeof(v_m) = 'object' and coalesce(v_m ->> 'soundId', '') ~ '^[0-9a-f-]{36}$' then
    select * into v_snd from public.vtt_sounds where id = (v_m ->> 'soundId')::uuid and campaign_id = p_campaign;
    if v_snd.id is null then raise exception 'that sound is not in this campaign'; end if;
    v_vol := case when jsonb_typeof(v_m -> 'volume') = 'number' then greatest(0, least(1, (v_m ->> 'volume')::real)) else 0.7 end;
    v_music := jsonb_build_object(
      'soundId', v_snd.id, 'name', v_snd.name, 'url', v_snd.url, 'duration', v_snd.duration,
      'playing', coalesce((v_m ->> 'playing')::boolean, false),
      'offset', case when jsonb_typeof(v_m -> 'offset') = 'number' then greatest(0, least(86400, (v_m ->> 'offset')::double precision)) else 0 end,
      'loop', coalesce((v_m ->> 'loop')::boolean, true),
      'volume', v_vol,
      'at', extract(epoch from clock_timestamp()) * 1000);
  end if;

  if jsonb_typeof(p_state -> 'ambient') = 'array' then
    for v_a in select a from jsonb_array_elements(p_state -> 'ambient') as x(a) loop
      exit when v_n >= 4;
      continue when jsonb_typeof(v_a) <> 'object' or coalesce(v_a ->> 'soundId', '') !~ '^[0-9a-f-]{36}$';
      select * into v_snd from public.vtt_sounds where id = (v_a ->> 'soundId')::uuid and campaign_id = p_campaign;
      continue when v_snd.id is null;
      v_vol := case when jsonb_typeof(v_a -> 'volume') = 'number' then greatest(0, least(1, (v_a ->> 'volume')::real)) else 0.5 end;
      v_amb := v_amb || jsonb_build_array(jsonb_build_object('soundId', v_snd.id, 'name', v_snd.name, 'url', v_snd.url, 'volume', v_vol));
      v_n := v_n + 1;
    end loop;
  end if;

  v_out := jsonb_build_object('music', v_music, 'ambient', v_amb);
  insert into public.vtt_audio (campaign_id, state, updated_at) values (p_campaign, v_out, now())
  on conflict (campaign_id) do update set state = excluded.state, updated_at = now();
  return v_out;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_set_doors(p_scene uuid, p_edges text[], p_open boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_s     public.vtt_scenes;
  v_map   public.battle_maps;
  v_gm    boolean;
  v_doors jsonb;
  v_state jsonb;
  v_edge  text;
  v_kind  text;
  v_i     integer;
  v_side  text;
  v_r     integer;
  v_c     integer;
  v_mx    real;
  v_my    real;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_s from public.vtt_scenes where id = p_scene;
  if v_s.id is null then raise exception 'scene not found'; end if;
  v_gm := public.is_campaign_gm(v_s.campaign_id);
  if not v_gm and not (public.tabletop_is_player(v_s.campaign_id) and v_s.id = public.tabletop_scene_for(v_s.campaign_id, v_uid)) then
    raise exception 'not at this table';
  end if;
  select * into v_map from public.battle_maps where id = v_s.battle_map_id;
  v_doors := coalesce(v_map.doors -> v_s.level, '{}'::jsonb);
  v_state := coalesce(v_s.door_state, '{}'::jsonb);
  if coalesce(array_length(p_edges, 1), 0) = 0 then return; end if;
  if array_length(p_edges, 1) > 500 then raise exception 'too many doors at once'; end if;

  foreach v_edge in array p_edges loop
    v_kind := v_doors ->> v_edge;
    if v_kind is null or v_edge !~ '^[0-9]+[hv]$' then raise exception 'there is no door there'; end if;
    if not v_gm then
      -- a closed secret door is a wall to players, so it answers like one
      if v_kind = 'secret' and not (v_state ? v_edge) then raise exception 'there is no door there'; end if;
      v_i := substring(v_edge from '^[0-9]+')::integer;
      v_side := right(v_edge, 1);
      v_r := v_i / v_map.n; v_c := v_i % v_map.n;
      -- the door must touch a revealed square
      if not (public.tabletop_revealed(v_s.revealed, v_s.fog_on, v_map.n, v_c, v_r)
              or (v_side = 'h' and public.tabletop_revealed(v_s.revealed, v_s.fog_on, v_map.n, v_c, v_r - 1))
              or (v_side = 'v' and public.tabletop_revealed(v_s.revealed, v_s.fog_on, v_map.n, v_c - 1, v_r))) then
        raise exception 'there is no door there';
      end if;
      if v_kind not in ('door', 'double') then raise exception 'only the GM can open that door'; end if;
      -- and a token the player controls must stand next to it
      if v_side = 'h' then v_mx := v_c + 0.5; v_my := v_r; else v_mx := v_c; v_my := v_r + 0.5; end if;
      if not exists (
        select 1 from public.vtt_tokens t
        where t.scene_id = p_scene and not t.hidden and t.layer <> 'gm'
          and (v_uid = any (t.controlled_by)
               or exists (select 1 from public.characters c where c.id = t.character_id and c.profile_id = v_uid))
          and sqrt(power(t.x - v_mx, 2) + power(t.y - v_my, 2)) <= 1.5 + t.size / 2.0 - 0.5
      ) then
        raise exception 'move a token next to the door first';
      end if;
    end if;
    if p_open then v_state := v_state || jsonb_build_object(v_edge, true);
    else v_state := v_state - v_edge; end if;
  end loop;

  update public.vtt_scenes set door_state = v_state, updated_at = now() where id = p_scene;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_set_fog(p_scene uuid, p_on boolean DEFAULT NULL::boolean, p_revealed text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s public.vtt_scenes;
  v_n integer;
  v_rev bytea;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_s from public.vtt_scenes where id = p_scene;
  if v_s.id is null then raise exception 'scene not found'; end if;
  if not public.is_campaign_gm(v_s.campaign_id) then raise exception 'only the GM can change the fog'; end if;
  select n into v_n from public.battle_maps where id = v_s.battle_map_id;
  if p_revealed is not null then
    if p_revealed !~ '^([0-9a-f]{2})*$' then raise exception 'the fog bitmap is not hex'; end if;
    v_rev := decode(p_revealed, 'hex');
    if length(v_rev) > (coalesce(v_n, 100) * coalesce(v_n, 100) + 7) / 8 then raise exception 'the fog bitmap is larger than the map'; end if;
  end if;
  update public.vtt_scenes
     set fog_on = coalesce(p_on, fog_on),
         revealed = coalesce(v_rev, revealed),
         updated_at = now()
   where id = p_scene;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_set_token_elevation(p_tokens uuid[], p_feet integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.vtt_tokens;
  v_n   integer := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_tokens is null or cardinality(p_tokens) = 0 or cardinality(p_tokens) > 50 then raise exception 'pick between 1 and 50 tokens'; end if;
  if p_feet is null or p_feet < -9999 or p_feet > 9999 then raise exception 'a height is between -9999 and 9999 ft'; end if;

  for v_t in select * from public.vtt_tokens where id = any(p_tokens) for update loop
    if not (
      public.is_campaign_gm(v_t.campaign_id)
      or (not v_t.hidden and v_t.layer <> 'gm' and (
            v_uid = any (v_t.controlled_by)
            or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)))
    ) then
      raise exception 'that token is not yours to lift';
    end if;
    update public.vtt_tokens
       set style = case when p_feet = 0 then coalesce(style, '{}'::jsonb) - 'elevation'
                        else jsonb_set(coalesce(style, '{}'::jsonb), '{elevation}', to_jsonb(p_feet)) end,
           updated_at = now()
     where id = v_t.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_set_token_look(p_token uuid, p_image_url text DEFAULT NULL::text, p_frame jsonb DEFAULT NULL::jsonb, p_clear_frame boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t      public.vtt_tokens;
  v_ok     text;
  v_border text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  if not public.tabletop_can_edit_token(p_token, v_t.campaign_id) then
    raise exception 'that token is not yours to change';
  end if;
  -- p122: exactly one file in this campaign's token folder, on this project's storage host
  v_ok := '^https://' || replace(public.tabletop_storage_host(), '.', '\.')
       || '/storage/v1/object/public/campaign-maps/' || v_t.campaign_id::text || '/tokens/[A-Za-z0-9._-]+$';
  if p_image_url is not null and p_image_url !~ v_ok then
    raise exception 'that picture was not uploaded for this campaign';
  end if;
  if p_frame is not null then
    if jsonb_typeof(p_frame) <> 'object' or length(p_frame::text) > 2000 then
      raise exception 'that is not a token frame';
    end if;
    v_border := p_frame ->> 'importUrl';
    if v_border is not null and v_border !~ v_ok then
      raise exception 'that border was not uploaded for this campaign';
    end if;
  end if;

  update public.vtt_tokens
     set image_url = coalesce(p_image_url, image_url),
         style = case
                   when p_clear_frame then coalesce(style, '{}'::jsonb) - 'frame'
                   when p_frame is not null then jsonb_set(coalesce(style, '{}'::jsonb), '{frame}', p_frame)
                   else style
                 end,
         updated_at = now()
   where id = p_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_set_token_markers(p_token uuid, p_markers text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.vtt_tokens;
  v_m   text[] := coalesce(p_markers, '{}'::text[]);
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  if not (
    public.is_campaign_gm(v_t.campaign_id)
    or (not v_t.hidden and v_t.layer <> 'gm' and (
          v_uid = any (v_t.controlled_by)
          or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)))
  ) then
    raise exception 'that token is not yours to mark';
  end if;
  if cardinality(v_m) > 16 then raise exception 'a token holds up to 16 markers'; end if;
  if exists (select 1 from unnest(v_m) as m(v) where v is null or v !~ '^[A-Za-z][A-Za-z0-9-]{0,31}(\|-?[0-9]{1,2})?$') then
    raise exception 'that is not a marker';
  end if;

  update public.vtt_tokens
     set style = jsonb_set(coalesce(style, '{}'::jsonb), '{markers}', to_jsonb(v_m)),
         updated_at = now()
   where id = p_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_show_handout(p_campaign uuid, p_entry uuid, p_characters uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_chars uuid[];
  v_added uuid[];
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_campaign_gm(p_campaign) then raise exception 'only the GM shows handouts'; end if;
  if not exists (select 1 from public.entries e where e.id = p_entry and e.campaign_id = p_campaign) then
    raise exception 'that entry is not in this campaign';
  end if;
  select coalesce(array_agg(ch.id), '{}') into v_chars
    from public.characters ch
   where ch.campaign_id = p_campaign and ch.kind = 'pc'
     and (p_characters is null or ch.id = any (p_characters));
  if coalesce(array_length(v_chars, 1), 0) = 0 then raise exception 'no player characters to show it to'; end if;

  with ins as (
    insert into public.entry_reveals (campaign_id, target_type, target_id, revealed_to_character_id)
    select p_campaign, 'entry', p_entry, c from unnest(v_chars) c
    on conflict (target_type, target_id, revealed_to_character_id) do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_added from ins;

  insert into public.vtt_handouts (campaign_id, entry_id, shown_to, added_reveals)
  values (p_campaign, p_entry, case when p_characters is null then null else v_chars end, v_added)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'characters', to_jsonb(v_chars));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_show_image_handout(p_campaign uuid, p_title text, p_path text, p_note text DEFAULT NULL::text, p_characters uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_chars uuid[];
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_campaign_gm(p_campaign) then raise exception 'only the GM shows handouts'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'give the picture a title'; end if;
  select coalesce(array_agg(ch.id), '{}') into v_chars
    from public.characters ch
   where ch.campaign_id = p_campaign and ch.kind = 'pc'
     and (p_characters is null or ch.id = any (p_characters));
  if coalesce(array_length(v_chars, 1), 0) = 0 then raise exception 'no player characters to show it to'; end if;
  insert into public.vtt_handouts (campaign_id, entry_id, title, image_path, note, shown_to, added_reveals)
  values (p_campaign, null, left(trim(p_title), 80), p_path, nullif(left(coalesce(p_note, ''), 600), ''),
          case when p_characters is null then null else v_chars end, '{}')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'characters', to_jsonb(v_chars));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_state(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_gm      boolean;
  v_player  boolean;
  v_camp    public.campaigns;
  v_scene   public.vtt_scenes;
  v_map     public.battle_maps;
  v_lv      integer;
  v_n       integer;
  v_labels  boolean;
  v_fog     boolean := false;
  v_rev     bytea := '\x'::bytea;
  v_ds      jsonb := '{}'::jsonb;
  v_doors   jsonb := '{}'::jsonb;
  v_walls   jsonb := '[]'::jsonb;
  v_mapjson jsonb := null;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  v_player := public.tabletop_is_player(p_campaign);
  if not v_gm and not v_player then raise exception 'not at this table'; end if;

  select * into v_camp from public.campaigns where id = p_campaign;
  -- the scene this person is on: their own (a split party, or the GM viewing another), else the active one
  select * into v_scene from public.vtt_scenes where id = public.tabletop_scene_for(p_campaign, v_uid);
  if v_scene.id is not null then
    select * into v_map from public.battle_maps where id = v_scene.battle_map_id;
    v_fog := v_scene.fog_on;
    v_rev := v_scene.revealed;
    v_ds := coalesce(v_scene.door_state, '{}'::jsonb);
  end if;

  if v_map.id is not null then
    v_lv := v_scene.level;
    v_n := v_map.n;
    v_labels := v_gm or coalesce((v_scene.settings ->> 'show_labels')::boolean, false);

    if v_gm then
      v_doors := coalesce(v_map.doors -> v_lv, '{}'::jsonb);
    else
      -- a door reaches players when it touches a revealed square; a secret door only once it is open,
      -- and then as a plain door
      select coalesce(jsonb_object_agg(d.key, case when d.value = '"secret"'::jsonb then '"door"'::jsonb else d.value end), '{}'::jsonb)
        into v_doors
        from jsonb_each(coalesce(v_map.doors -> v_lv, '{}'::jsonb)) d,
             lateral (select substring(d.key from '^[0-9]+')::integer as i, right(d.key, 1) as side) e
       where d.key ~ '^[0-9]+[hv]$'
         and (d.value <> '"secret"'::jsonb or v_ds ? d.key)
         and (public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n)
              or (e.side = 'h' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n - 1))
              or (e.side = 'v' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n - 1, e.i / v_n)));
      select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb) into v_ds
        from jsonb_each(v_ds) k where v_doors ? k.key;
      -- a closed secret door is plain wall to players: the edge comes as a wall to draw and to block
      -- sight, with nothing to say it is a door (two floor squares otherwise show an open gap)
      select coalesce(jsonb_agg(d.key), '[]'::jsonb)
        into v_walls
        from jsonb_each(coalesce(v_map.doors -> v_lv, '{}'::jsonb)) d,
             lateral (select substring(d.key from '^[0-9]+')::integer as i, right(d.key, 1) as side) e
       where d.key ~ '^[0-9]+[hv]$' and d.value = '"secret"'::jsonb and not (coalesce(v_scene.door_state, '{}'::jsonb) ? d.key)
         and (public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n)
              or (e.side = 'h' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n - 1))
              or (e.side = 'v' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n - 1, e.i / v_n)));
    end if;

    v_mapjson := jsonb_build_object(
      'id', v_map.id,
      'kind', v_map.kind,
      'n', v_map.n,
      'feet_per_square', v_map.feet_per_square,
      'grid', case when v_gm or not v_fog then coalesce(v_map.levels -> v_lv, '[]'::jsonb)
                   else (select coalesce(jsonb_agg(case when public.tabletop_revealed(v_rev, v_fog, v_n, ((g.ord - 1) % v_n)::integer, ((g.ord - 1) / v_n)::integer)
                                                    then g.v else '0'::jsonb end order by g.ord), '[]'::jsonb)
                         from jsonb_array_elements(coalesce(v_map.levels -> v_lv, '[]'::jsonb)) with ordinality g(v, ord)) end,
      'custom', case when v_gm or not v_fog then coalesce(v_map.custom_cells -> v_lv, '{}'::jsonb)
                     else (select coalesce(jsonb_object_agg(cc.key, cc.value), '{}'::jsonb)
                           from jsonb_each(coalesce(v_map.custom_cells -> v_lv, '{}'::jsonb)) cc
                           where cc.key ~ '^[0-9]+$'
                             and public.tabletop_revealed(v_rev, v_fog, v_n, cc.key::integer % v_n, cc.key::integer / v_n)) end,
      'doors', v_doors,
      'door_state', v_ds,
      'walls', v_walls,
      'elements', (select coalesce(jsonb_agg(e.value), '[]'::jsonb)
                   from jsonb_array_elements(coalesce(v_map.elements -> v_lv, '[]'::jsonb)) e
                   where (v_labels or coalesce(e.value ->> 'k', '') <> 'label')
                     and (v_gm or public.tabletop_revealed(v_rev, v_fog, v_n,
                                    floor(coalesce((e.value ->> 'x')::real, 0))::integer,
                                    floor(coalesce((e.value ->> 'y')::real, 0))::integer))),
      'fog', jsonb_build_object('on', v_fog, 'revealed', encode(v_rev, 'hex')),
      'meta', jsonb_build_object(
        'title', v_map.meta -> 'title',
        'levelNames', v_map.meta -> 'levelNames',
        'autoNumber', v_map.meta -> 'autoNumber',
        'showGrid', v_map.meta -> 'showGrid',
        'ground', v_map.meta -> 'ground',
        'grid', v_map.meta -> 'grid',
        'topGrid', v_map.meta -> 'topGrid',
        'overlay', v_map.meta -> 'overlays' -> v_lv,
        'sightWalls', coalesce(v_map.meta -> 'sightWalls' -> v_lv, '[]'::jsonb)
      )
    );
  end if;

  return jsonb_build_object(
    'role', case when v_gm then 'gm' else 'player' end,
    'me', v_uid,
    'campaign', jsonb_build_object('id', v_camp.id, 'name', v_camp.name, 'gm_id', v_camp.gm_id),
    'session_id', public.tabletop_open_session(p_campaign),
    'scene', case when v_scene.id is null then null else jsonb_build_object(
      'id', v_scene.id, 'name', v_scene.name, 'battle_map_id', v_scene.battle_map_id,
      'level', v_scene.level, 'settings', v_scene.settings) end,
    'map', v_mapjson,
    'tokens', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'kind', t.kind, 'character_id', t.character_id, 'stat_block_id', t.stat_block_id,
        'name', t.name, 'image_url', t.image_url, 'x', t.x, 'y', t.y, 'size', t.size, 'rot', t.rot,
        'layer', t.layer, 'hidden', t.hidden, 'controlled_by', to_jsonb(t.controlled_by), 'style', t.style,
        'mine', v_gm or v_uid = any (t.controlled_by)
                or exists (select 1 from public.characters c where c.id = t.character_id and c.profile_id = v_uid)
      ) order by t.created_at), '[]'::jsonb)
      from public.vtt_tokens t
      where v_scene.id is not null and t.scene_id = v_scene.id
        and (v_gm or (not t.hidden and t.layer <> 'gm'
                      and (v_uid = any (t.controlled_by)
                           or exists (select 1 from public.characters c where c.id = t.character_id and c.profile_id = v_uid)
                           or public.tabletop_revealed(v_rev, v_fog, coalesce(v_n, 0), floor(t.x)::integer, floor(t.y)::integer))))
    ),
    -- who is at the table, for whispers and token owners: the GM and every claimed pc
    'party', (
      select coalesce(jsonb_agg(x.p), '[]'::jsonb) from (
        select jsonb_build_object('profile_id', v_camp.gm_id, 'name', 'GM', 'character_id', null, 'portrait_url', null) as p
        union all
        select jsonb_build_object('profile_id', c.profile_id, 'name', c.name, 'character_id', c.id, 'portrait_url', c.portrait_url)
        from public.characters c
        where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id is not null and c.active
      ) x
    ),
    -- GM only: the scenes and battle maps to pick from
    'scenes', case when v_gm then (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'battle_map_id', s.battle_map_id,
        'level', s.level, 'is_active', s.is_active) order by s.updated_at desc), '[]'::jsonb)
      from public.vtt_scenes s where s.campaign_id = p_campaign) else '[]'::jsonb end,
    -- GM only: who is on which scene. Anyone not listed is on the active scene.
    'placements', case when v_gm then (
      select coalesce(jsonb_agg(jsonb_build_object('profile_id', sp.profile_id, 'scene_id', sp.scene_id)), '[]'::jsonb)
      from public.vtt_scene_players sp where sp.campaign_id = p_campaign) else '[]'::jsonb end,
    'battle_maps', case when v_gm then (
      select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind,
        'levelNames', b.meta -> 'levelNames') order by b.created_at), '[]'::jsonb)
      from public.battle_maps b where b.campaign_id = p_campaign) else '[]'::jsonb end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_storage_host()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$ select 'agafmvywayisxgvrfium.supabase.co'::text $function$
;

CREATE OR REPLACE FUNCTION public.tabletop_token_floor(p_token uuid, p_level integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_t    public.vtt_tokens;
  v_sc   public.vtt_scenes;
  v_to   public.vtt_scenes;
  v_m    public.battle_maps;
  v_gm   boolean;
  v_gmid uuid;
  v_p    uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_level is null or p_level not between 0 and 2 then raise exception 'floors are levels 1 to 3'; end if;
  select * into v_t from public.vtt_tokens where id = p_token for update;
  if v_t.id is null then raise exception 'token not found'; end if;
  select * into v_sc from public.vtt_scenes where id = v_t.scene_id;
  select * into v_m from public.battle_maps where id = v_sc.battle_map_id;
  if v_sc.level = p_level then return v_sc.id; end if;
  v_gm := public.is_campaign_gm(v_t.campaign_id);
  if not v_gm then
    if not public.tabletop_is_player(v_t.campaign_id) then raise exception 'not at this table'; end if;
    if v_t.hidden or v_t.layer = 'gm' or not (
         v_uid = any (v_t.controlled_by)
         or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)) then
      raise exception 'that token is not yours';
    end if;
    if public.tabletop_scene_for(v_t.campaign_id, v_uid) is distinct from v_t.scene_id then raise exception 'that token is not on your floor'; end if;
    if not coalesce((v_sc.settings ->> 'freeFloors')::boolean, false)
       and not public.tabletop_on_connector(v_m, v_sc.level, v_t.x, v_t.y) then
      raise exception 'stand on stairs, a ladder, a trapdoor or a pit to change floor';
    end if;
  end if;

  select * into v_to from public.vtt_scenes s
   where s.campaign_id = v_sc.campaign_id and s.battle_map_id = v_sc.battle_map_id and s.level = p_level
   order by s.is_active desc, s.updated_at desc limit 1;
  if v_to.id is null then raise exception 'that floor is not on the table yet: the GM adds it with the floor buttons'; end if;
  if not v_gm and public.tabletop_walled_at(coalesce(v_m.levels -> p_level, '[]'::jsonb), coalesce(v_m.custom_cells -> p_level, '{}'::jsonb),
                                            v_m.n, coalesce(v_m.kind, '') = 'outdoor', floor(v_t.x)::integer, floor(v_t.y)::integer) then
    raise exception 'that spot is solid rock on the other floor';
  end if;

  update public.vtt_tokens set scene_id = v_to.id where id = v_t.id;

  -- the token's players go with it (never the GM, whose view is their own)
  select gm_id into v_gmid from public.campaigns where id = v_t.campaign_id;
  for v_p in
    select distinct p from (
      select c.profile_id as p from public.characters c where c.id = v_t.character_id
      union select unnest(coalesce(v_t.controlled_by, '{}'::uuid[]))) x
     where p is not null and p is distinct from v_gmid and public.tabletop_card_seat(v_t.campaign_id, p)
  loop
    if v_to.is_active then
      delete from public.vtt_scene_players where campaign_id = v_t.campaign_id and profile_id = v_p;
    else
      insert into public.vtt_scene_players (campaign_id, profile_id, scene_id) values (v_t.campaign_id, v_p, v_to.id)
      on conflict (campaign_id, profile_id) do update set scene_id = excluded.scene_id, updated_at = now();
    end if;
  end loop;
  return v_to.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_token_seen(p_token uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.vtt_tokens t
     where t.id = p_token and not t.hidden and t.layer <> 'gm'
       and t.scene_id = public.tabletop_scene_for(t.campaign_id, auth.uid())
       and public.tabletop_token_visible(t.scene_id, t.x, t.y, t.character_id, t.controlled_by));
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_token_visible(p_scene uuid, p_x real, p_y real, p_character uuid, p_controlled uuid[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select auth.uid() = any (coalesce(p_controlled, '{}'))
      or exists (select 1 from public.characters c where c.id = p_character and c.profile_id = auth.uid())
      or exists (
        select 1 from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id
        where s.id = p_scene
          and public.tabletop_revealed(s.revealed, s.fog_on, b.n, floor(p_x)::integer, floor(p_y)::integer)
      );
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_view_scene(p_scene uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s public.vtt_scenes;
begin
  select * into v_s from public.vtt_scenes where id = p_scene;
  if v_s.id is null then raise exception 'scene not found'; end if;
  if not public.is_campaign_gm(v_s.campaign_id) then raise exception 'only the GM can do that'; end if;
  if v_s.is_active then
    delete from public.vtt_scene_players where campaign_id = v_s.campaign_id and profile_id = auth.uid();
  else
    insert into public.vtt_scene_players (campaign_id, profile_id, scene_id) values (v_s.campaign_id, auth.uid(), p_scene)
    on conflict (campaign_id, profile_id) do update set scene_id = excluded.scene_id, updated_at = now();
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_wall_blocks(p_map battle_maps, p_level integer, p_ds jsonb, p_ax double precision, p_ay double precision, p_bx double precision, p_by double precision)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_n      integer := greatest(1, coalesce(p_map.n, 25));
  v_lv     integer := coalesce(p_level, 0);
  v_grid   jsonb := coalesce(p_map.levels -> coalesce(p_level, 0), '[]'::jsonb);
  v_custom jsonb := coalesce(p_map.custom_cells -> coalesce(p_level, 0), '{}'::jsonb);
  v_doors  jsonb := coalesce(p_map.doors -> coalesce(p_level, 0), '{}'::jsonb);
  v_ds     jsonb := coalesce(p_ds, '{}'::jsonb);
  v_out    boolean := coalesce(p_map.kind, '') = 'outdoor';
  v_dx     double precision := p_bx - p_ax;
  v_dy     double precision := p_by - p_ay;
  v_t      double precision;
  v_p      double precision;
  v_line   integer;
  v_cell   integer;
  v_key    text;
  v_kind   text;
  v_a      boolean;
  v_b      boolean;
  v_w      jsonb;
  v_sx     double precision; v_sy double precision; v_ex double precision; v_ey double precision;
  v_den    double precision;
  v_u      double precision;
begin
  if abs(v_dx) < 1e-9 and abs(v_dy) < 1e-9 then return false; end if;

  -- vertical grid lines x = v_line crossed by the move
  if abs(v_dx) > 1e-12 then
    for v_line in ceil(least(p_ax, p_bx))::integer .. floor(greatest(p_ax, p_bx))::integer loop
      v_t := (v_line - p_ax) / v_dx;
      continue when v_t <= 1e-9 or v_t > 1;
      v_p := p_ay + v_t * v_dy;
      if (v_line = 0 or v_line = v_n) and v_p >= -1e-9 and v_p <= v_n + 1e-9 then return true; end if;
      continue when v_line <= 0 or v_line >= v_n;
      -- the edge of the row crossed; exactly on a corner, the edge above it counts too
      foreach v_cell in array (case when v_p = floor(v_p) then array[floor(v_p)::integer, floor(v_p)::integer - 1] else array[floor(v_p)::integer] end) loop
        continue when v_cell < 0 or v_cell >= v_n;
        v_key := (v_cell * v_n + v_line)::text || 'v';
        v_kind := case when jsonb_typeof(v_doors -> v_key) = 'string' then v_doors ->> v_key end;
        if v_kind is not null then
          if v_kind <> 'arch' and not (v_ds ? v_key and (v_ds -> v_key) not in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb)) then return true; end if;
        else
          v_a := public.tabletop_walled_at(v_grid, v_custom, v_n, v_out, v_line, v_cell);
          v_b := public.tabletop_walled_at(v_grid, v_custom, v_n, v_out, v_line - 1, v_cell);
          if v_a <> v_b then return true; end if;
        end if;
      end loop;
    end loop;
  end if;

  -- horizontal grid lines y = v_line
  if abs(v_dy) > 1e-12 then
    for v_line in ceil(least(p_ay, p_by))::integer .. floor(greatest(p_ay, p_by))::integer loop
      v_t := (v_line - p_ay) / v_dy;
      continue when v_t <= 1e-9 or v_t > 1;
      v_p := p_ax + v_t * v_dx;
      if (v_line = 0 or v_line = v_n) and v_p >= -1e-9 and v_p <= v_n + 1e-9 then return true; end if;
      continue when v_line <= 0 or v_line >= v_n;
      foreach v_cell in array (case when v_p = floor(v_p) then array[floor(v_p)::integer, floor(v_p)::integer - 1] else array[floor(v_p)::integer] end) loop
        continue when v_cell < 0 or v_cell >= v_n;
        v_key := (v_line * v_n + v_cell)::text || 'h';
        v_kind := case when jsonb_typeof(v_doors -> v_key) = 'string' then v_doors ->> v_key end;
        if v_kind is not null then
          if v_kind <> 'arch' and not (v_ds ? v_key and (v_ds -> v_key) not in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb)) then return true; end if;
        else
          v_a := public.tabletop_walled_at(v_grid, v_custom, v_n, v_out, v_cell, v_line);
          v_b := public.tabletop_walled_at(v_grid, v_custom, v_n, v_out, v_cell, v_line - 1);
          if v_a <> v_b then return true; end if;
        end if;
      end loop;
    end loop;
  end if;

  -- the level's sight walls, [ax, ay, bx, by] in squares (lib/dungeon/battle.ts normSightWalls rules)
  for v_w in select w from jsonb_array_elements(case when jsonb_typeof(p_map.meta -> 'sightWalls' -> v_lv) = 'array'
                                                     then p_map.meta -> 'sightWalls' -> v_lv else '[]'::jsonb end) as a(w) loop
    -- p126: four numbers, or five with the wall's kind; a screen (kind 2) does not stop feet
    continue when jsonb_typeof(v_w) <> 'array' or jsonb_array_length(v_w) not in (4, 5);
    continue when jsonb_array_length(v_w) = 5 and jsonb_typeof(v_w -> 4) = 'number' and (v_w ->> 4)::numeric = 2;
    continue when exists (select 1 from jsonb_array_elements(v_w) with ordinality x(v, o) where x.o <= 4 and (jsonb_typeof(x.v) <> 'number' or (x.v #>> '{}')::numeric < 0 or (x.v #>> '{}')::numeric > v_n));
    v_sx := round((v_w ->> 0)::numeric * 100) / 100.0; v_sy := round((v_w ->> 1)::numeric * 100) / 100.0;
    v_ex := round((v_w ->> 2)::numeric * 100) / 100.0 - v_sx; v_ey := round((v_w ->> 3)::numeric * 100) / 100.0 - v_sy;
    continue when sqrt(v_ex * v_ex + v_ey * v_ey) < 0.01;
    v_den := v_dx * v_ey - v_dy * v_ex;
    continue when abs(v_den) < 1e-12;
    v_t := ((v_sx - p_ax) * v_ey - (v_sy - p_ay) * v_ex) / v_den;
    v_u := ((v_sx - p_ax) * v_dy - (v_sy - p_ay) * v_dx) / v_den;
    if v_t > 1e-9 and v_t <= 1 and v_u >= -1e-9 and v_u <= 1 + 1e-9 then return true; end if;
  end loop;
  return false;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tabletop_walled_at(p_grid jsonb, p_custom jsonb, p_n integer, p_outdoor boolean, p_c integer, p_r integer)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_i integer;
  v_v jsonb;
  v_t integer := 0;
begin
  if p_c < 0 or p_r < 0 or p_c >= p_n or p_r >= p_n then return false; end if;
  v_i := p_r * p_n + p_c;
  v_v := p_grid -> v_i;
  if jsonb_typeof(v_v) = 'number' and (v_v #>> '{}')::numeric >= 0 and (v_v #>> '{}')::numeric < 26 then
    v_t := floor((v_v #>> '{}')::numeric)::integer;
  end if;
  if p_outdoor then return v_t in (1, 2, 3, 4, 6, 7, 8, 12, 13, 14); end if;
  return v_t > 0 or coalesce(jsonb_typeof(p_custom -> v_i::text) = 'string' and (p_custom ->> v_i::text) <> '', false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.threads_guard_character()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.character_id is not null then
    if not exists (
      select 1 from public.characters ch
      where ch.id = new.character_id
        and ch.profile_id = auth.uid()
    ) then
      raise exception 'you can only attach a thread to a character you own';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_compendium_entries()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_dm_boards()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_player_notes()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_stat_blocks_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.tpdi_autobind()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- A player-scope response is ABOUT THE PERSON. It must never be bound to a
  -- character. This single guard is the whole fix.
  if NEW.scope = 'player' then
    NEW.assigned_character_id := null;
    NEW.campaign_id := null;
    return NEW;
  end if;

  if NEW.assigned_character_id is null and NEW.respondent_id is not null then
    -- Only autobind within a KNOWN campaign. Without one there is no principled way
    -- to pick among a person's characters, and picking arbitrarily is how the bug
    -- above happened. Better to leave it unbound and let claim_character_invite or
    -- the GM assign it.
    if NEW.campaign_id is not null then
      select ch.id into NEW.assigned_character_id
      from public.characters ch
      where ch.profile_id = NEW.respondent_id
        and ch.kind = 'pc'
        and ch.campaign_id = NEW.campaign_id
      order by ch.created_at
      limit 1;
    end if;
  end if;

  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unassign_response(p_response uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_campaign uuid;
begin
  select campaign_id into v_campaign from public.tpdi_responses where id = p_response;
  if v_campaign is null then raise exception 'response not found'; end if;
  if not public.is_campaign_gm(v_campaign) then raise exception 'not permitted'; end if;
  update public.tpdi_responses set assigned_character_id = null where id = p_response;
end; $function$
;

CREATE OR REPLACE FUNCTION public.upgrade_profile_from_auth()
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_user auth.users;
  v_meta jsonb;
  v_row  public.profiles;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select * into v_user from auth.users where id = v_uid;
  v_meta := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);

  -- Guard: only claim the upgrade if a real identity is actually attached. This
  -- keeps a caller from flipping is_anonymous on a still-anonymous session.
  if coalesce(v_user.is_anonymous, false) then
    raise exception 'still anonymous: link an identity before upgrading';
  end if;

  update public.profiles p
     set display_name = coalesce(
           nullif(p.display_name, ''),
           nullif(coalesce(v_meta->>'full_name', v_meta->>'name', v_meta->>'user_name', ''), '')
         ),
         email        = coalesce(nullif(v_user.email, ''), p.email),
         avatar_url   = coalesce(
           nullif(coalesce(v_meta->>'avatar_url', v_meta->>'picture', ''), ''),
           p.avatar_url
         ),
         is_anonymous = false,
         upgraded_at  = coalesce(p.upgraded_at, now()),
         updated_at   = now()
   where p.id = v_uid
  returning * into v_row;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.vibe_target(code text, p_session_number integer)
 RETURNS TABLE(campaign_name text, session_id uuid, session_number integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.name, s.id, s.session_number
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code and s.session_number = p_session_number
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.world_map_ai_image_read(p_campaign uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when public.is_campaign_gm(p_campaign) or public.is_campaign_member(p_campaign) then
      (select wm.ai_image_url from public.world_maps wm where wm.campaign_id = p_campaign limit 1)
    else null
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.world_map_ai_image_read_for_player(p_share text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select wm.ai_image_url
  from public.world_maps wm
  join public.campaigns c on c.id = wm.campaign_id
  where c.share_code = p_share
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.world_map_features_read(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when public.is_campaign_gm(p_campaign) or public.is_campaign_member(p_campaign) then
      coalesce((
        select jsonb_agg(jsonb_build_object('kind', mf.kind, 'class', mf.class, 'path', mf.path, 'name', mf.name))
        from public.map_features mf
        join public.world_maps wm on wm.id = mf.world_map_id
        where wm.campaign_id = p_campaign
      ), '[]'::jsonb)
    else null
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.world_map_features_read_for_player(p_share text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select jsonb_agg(jsonb_build_object('kind', mf.kind, 'class', mf.class, 'path', mf.path, 'name', mf.name))
    from public.map_features mf
    join public.world_maps wm on wm.id = mf.world_map_id
    join public.campaigns c on c.id = wm.campaign_id
    where c.share_code = p_share
  ), '[]'::jsonb);
$function$
;

CREATE OR REPLACE FUNCTION public.world_map_labels_read(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select case
    when public.is_campaign_gm(p_campaign) or public.is_campaign_member(p_campaign) then
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id, 'x', l.x, 'y', l.y, 'text', l.text, 'size', l.size, 'color', l.color
        ))
        from public.map_labels l
        join public.world_maps wm on wm.id = l.world_map_id
        where wm.campaign_id = p_campaign
          and (public.is_campaign_gm(p_campaign) or l.visibility in ('common', 'player'))
      ), '[]'::jsonb)
    else null
  end
$function$
;

CREATE OR REPLACE FUNCTION public.world_map_labels_read_for_player(p_share text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'x', l.x, 'y', l.y, 'text', l.text, 'size', l.size, 'color', l.color
    ))
    from public.map_labels l
    join public.world_maps wm on wm.id = l.world_map_id
    join public.campaigns c on c.id = wm.campaign_id
    where c.share_code = p_share
      and l.visibility in ('common','player')
  ), '[]'::jsonb);
$function$
;

CREATE OR REPLACE FUNCTION public.world_map_paint(p_campaign uuid, p_terrain text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from world_maps wm
    where wm.campaign_id = p_campaign
      and (is_campaign_gm(p_campaign) or (wm.editable_by = 'party' and is_campaign_member(p_campaign)))
  ) then
    raise exception 'not permitted to edit this map';
  end if;
  update world_maps set terrain = p_terrain, updated_at = now() where campaign_id = p_campaign;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.world_map_read(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with allowed as (
    select
      is_campaign_gm(p_campaign) as is_gm,
      (is_campaign_gm(p_campaign) or is_campaign_member(p_campaign)) as can_read
  ),
  wm as (
    select * from world_maps where campaign_id = p_campaign
  )
  select case
    when not (select can_read from allowed) then null::jsonb
    else jsonb_build_object(
      'map',    (select to_jsonb(w) - 'campaign_id' from wm w),
      'biomes', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from biomes b),
      'images', (select coalesce(jsonb_agg(to_jsonb(i) order by i.z), '[]'::jsonb)
                 from map_images i where i.world_map_id = (select id from wm)),
      'icons',  (select coalesce(jsonb_agg(jsonb_build_object('id', mi.id, 'url', mi.url)), '[]'::jsonb)
                 from map_icons mi where mi.campaign_id = p_campaign),
      'layers', (select coalesce(jsonb_agg(to_jsonb(l) order by l.ord), '[]'::jsonb)
                 from map_layers l where l.world_map_id = (select id from wm)),
      'regions', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
                  from regions r
                  where r.world_map_id = (select id from wm)
                    and ((select is_gm from allowed) or r.visibility in ('common','player'))),
      'hexes', (select coalesce(jsonb_agg(jsonb_build_object('col', h.col, 'row', h.row, 'region_id', h.region_id)), '[]'::jsonb)
                from world_hexes h
                join regions r on r.id = h.region_id
                where h.world_map_id = (select id from wm)
                  and ((select is_gm from allowed) or r.visibility in ('common','player'))),
      'pois', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
               from map_pois p
               where p.world_map_id = (select id from wm)
                 and ((select is_gm from allowed) or p.visibility in ('common','player')))
    )
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.world_map_read_for_player(p_share text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with camp as (
    select id from public.campaigns where share_code = p_share limit 1
  ),
  wm as (
    select * from public.world_maps where campaign_id = (select id from camp)
  )
  select case
    when (select id from camp) is null then null::jsonb
    else jsonb_build_object(
      'map',    (select to_jsonb(w) - 'campaign_id' from wm w),
      'biomes', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from public.biomes b),
      'images', (select coalesce(jsonb_agg(to_jsonb(i) order by i.z), '[]'::jsonb)
                 from public.map_images i where i.world_map_id = (select id from wm)),
      'icons',  (select coalesce(jsonb_agg(jsonb_build_object('id', mi.id, 'url', mi.url)), '[]'::jsonb)
                 from public.map_icons mi where mi.campaign_id = (select id from camp)),
      'layers', (select coalesce(jsonb_agg(to_jsonb(l) order by l.ord), '[]'::jsonb)
                 from public.map_layers l where l.world_map_id = (select id from wm)),
      'regions', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
                  from public.regions r
                  where r.world_map_id = (select id from wm)
                    and r.visibility in ('common','player')),
      'hexes', (select coalesce(jsonb_agg(jsonb_build_object('col', h.col, 'row', h.row, 'region_id', h.region_id)), '[]'::jsonb)
                from public.world_hexes h
                join public.regions r on r.id = h.region_id
                where h.world_map_id = (select id from wm)
                  and r.visibility in ('common','player')),
      'pois', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
               from public.map_pois p
               where p.world_map_id = (select id from wm)
                 and p.visibility in ('common','player'))
    )
  end;
$function$
;


-- ================================================================================================
-- 03 constraints (234)
-- ================================================================================================

do $c$ begin
  alter table public.addon_hooks add constraint addon_hooks_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_keys add constraint addon_keys_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_outbox add constraint addon_outbox_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.ai_map_renders add constraint ai_map_renders_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arc_touches add constraint arc_touches_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arcs add constraint arcs_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.attendance add constraint attendance_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.audio_tracks add constraint audio_tracks_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.bastion_maps add constraint bastion_maps_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.battle_maps add constraint battle_maps_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.biomes add constraint biomes_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.building_maps add constraint building_maps_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.campaign_journals add constraint campaign_journals_pkey PRIMARY KEY (campaign_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.campaigns add constraint campaigns_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.capture_control add constraint capture_control_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.capture_jobs add constraint capture_jobs_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.character_identities add constraint character_identities_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.character_wiki_gm_edit add constraint character_wiki_gm_edit_pkey PRIMARY KEY (character_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.character_wiki_sections add constraint character_wiki_sections_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.characters add constraint characters_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.chat_grants add constraint chat_grants_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.chat_messages add constraint chat_messages_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.class_capabilities add constraint class_capabilities_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.classes add constraint classes_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.combats add constraint combats_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.compendium_entries add constraint compendium_entries_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.disposition_reveals add constraint disposition_reveals_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.disposition_runs add constraint disposition_runs_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dispositions add constraint dispositions_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dm_boards add constraint dm_boards_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dungeon_maps add constraint dungeon_maps_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.encounters add constraint encounters_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entity_links add constraint entity_links_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entries add constraint entries_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entry_reveals add constraint entry_reveals_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.event_types add constraint event_types_pkey PRIMARY KEY (key);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.events add constraint events_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_event_kinds add constraint gm_event_kinds_pkey PRIMARY KEY (kind);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_identities add constraint gm_identities_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_proposed_events add constraint gm_proposed_events_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_candidates add constraint import_candidates_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_jobs add constraint import_jobs_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_sessions add constraint import_sessions_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.loot_grants add constraint loot_grants_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.lore_backup add constraint lore_backup_pkey PRIMARY KEY (backup_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_features add constraint map_features_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_fog add constraint map_fog_pkey PRIMARY KEY (map_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_icons add constraint map_icons_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_images add constraint map_images_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_labels add constraint map_labels_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_layers add constraint map_layers_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_pins add constraint map_pins_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_pois add constraint map_pois_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.maps add constraint maps_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.memberships add constraint memberships_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_funds add constraint party_funds_pkey PRIMARY KEY (campaign_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_items add constraint party_items_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.pc_library add constraint pc_library_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.player_notes add constraint player_notes_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.poll_responses add constraint poll_responses_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.proposed_events add constraint proposed_events_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recodings add constraint recodings_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recording_consents add constraint recording_consents_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.regions add constraint regions_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.roll_tables add constraint roll_tables_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.session_plan_items add constraint session_plan_items_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.session_polls add constraint session_polls_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.sessions add constraint sessions_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.species add constraint species_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.species_variants add constraint species_variants_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.stat_blocks add constraint stat_blocks_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.threads add constraint threads_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.tool_render_log add constraint tool_render_log_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.tpdi_responses add constraint tpdi_responses_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.transcript_segments add constraint transcript_segments_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vibe_checks add constraint vibe_checks_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_audio add constraint vtt_audio_pkey PRIMARY KEY (campaign_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_cards add constraint vtt_cards_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_decks add constraint vtt_decks_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_effects add constraint vtt_effects_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_events add constraint vtt_events_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_handouts add constraint vtt_handouts_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_messages add constraint vtt_messages_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_pins add constraint vtt_pins_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_scene_players add constraint vtt_scene_players_pkey PRIMARY KEY (campaign_id, profile_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_scenes add constraint vtt_scenes_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_sounds add constraint vtt_sounds_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_templates add constraint vtt_templates_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_token_notes add constraint vtt_token_notes_pkey PRIMARY KEY (token_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_tokens add constraint vtt_tokens_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.world_hexes add constraint world_hexes_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.world_maps add constraint world_maps_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_keys add constraint addon_keys_key_hash_key UNIQUE (key_hash);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.attendance add constraint attendance_session_id_profile_id_key UNIQUE (session_id, profile_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.bastion_maps add constraint bastion_maps_campaign_id_key UNIQUE (campaign_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.biomes add constraint biomes_key_key UNIQUE (key);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.building_maps add constraint building_maps_campaign_id_key UNIQUE (campaign_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.classes add constraint classes_system_name_key UNIQUE (system, name);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.disposition_reveals add constraint disposition_reveals_profile_key UNIQUE (profile_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dungeon_maps add constraint dungeon_maps_campaign_id_key UNIQUE (campaign_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entity_links add constraint entity_links_campaign_id_source_type_source_id_target_type__key UNIQUE (campaign_id, source_type, source_id, target_type, target_id, relation);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entry_reveals add constraint entry_reveals_target_type_target_id_revealed_to_character_i_key UNIQUE (target_type, target_id, revealed_to_character_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_identities add constraint gm_identities_campaign_id_discord_user_id_key UNIQUE (campaign_id, discord_user_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.memberships add constraint memberships_campaign_id_profile_id_key UNIQUE (campaign_id, profile_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.poll_responses add constraint poll_responses_poll_id_discord_user_id_key UNIQUE (poll_id, discord_user_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recording_consents add constraint recording_consents_session_id_character_id_key UNIQUE (session_id, character_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.species add constraint species_system_name_key UNIQUE (system, name);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.species_variants add constraint species_variants_species_name_kind_key UNIQUE (species_id, name, variant_kind);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vibe_checks add constraint vibe_checks_session_id_profile_id_key UNIQUE (session_id, profile_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.world_hexes add constraint world_hexes_cell_uq UNIQUE (world_map_id, col, "row");
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_hooks add constraint addon_hooks_events_check CHECK (((cardinality(events) >= 1) AND (events <@ ARRAY['roll'::text, 'chat'::text, 'turn'::text, 'combat'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_hooks add constraint addon_hooks_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 40)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_hooks add constraint addon_hooks_secret_check CHECK ((char_length(secret) >= 32));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_hooks add constraint addon_hooks_url_check CHECK (((char_length(url) <= 500) AND (url ~ '^https://[^[:space:]]+$'::text)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_keys add constraint addon_keys_prefix_check CHECK (((char_length(prefix) >= 4) AND (char_length(prefix) <= 16)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_keys add constraint addon_keys_scopes_check CHECK (((cardinality(scopes) >= 1) AND (scopes <@ ARRAY['read'::text, 'chat'::text, 'roll'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_keys add constraint addon_keys_key_hash_check CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_keys add constraint addon_keys_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 40)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arcs add constraint arcs_status_check CHECK ((status = ANY (ARRAY['open'::text, 'progressing'::text, 'resolved'::text, 'dormant'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.attendance add constraint attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text, 'partial'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.audio_tracks add constraint audio_tracks_kind_check CHECK ((kind = ANY (ARRAY['speaker'::text, 'room'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.audio_tracks add constraint audio_tracks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'transcribing'::text, 'done'::text, 'error'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.battle_maps add constraint battle_maps_feet_per_square_check CHECK (((feet_per_square >= 1) AND (feet_per_square <= 1000)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.battle_maps add constraint battle_maps_n_check CHECK (((n >= 5) AND (n <= 200)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.battle_maps add constraint battle_maps_kind_check CHECK ((kind = ANY (ARRAY['indoor'::text, 'outdoor'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.capture_jobs add constraint capture_jobs_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'blocked_consent'::text, 'uploading'::text, 'transcribing'::text, 'extracting'::text, 'review'::text, 'done'::text, 'error'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.capture_jobs add constraint capture_jobs_source_check CHECK ((source = ANY (ARRAY['online'::text, 'in_person'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.character_wiki_sections add constraint character_wiki_sections_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'shared'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.characters add constraint characters_kind_check CHECK ((kind = ANY (ARRAY['pc'::text, 'npc'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.characters add constraint characters_visibility_check CHECK ((visibility = ANY (ARRAY['common'::text, 'player'::text, 'gm'::text, 'private'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.classes add constraint classes_edition_check CHECK ((edition = ANY (ARRAY['2014'::text, '2024'::text, 'both'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.combats add constraint combats_status_ck CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.compendium_entries add constraint compendium_entries_ruleset_check CHECK ((ruleset = ANY (ARRAY['2014'::text, '2024'::text, 'both'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.disposition_runs add constraint disposition_runs_status_check CHECK ((status = ANY (ARRAY['fitting'::text, 'done'::text, 'error'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dispositions add constraint dispositions_scope_shape_check CHECK ((((scope = 'player'::text) AND (character_id IS NULL) AND (campaign_id IS NULL)) OR ((scope = 'character'::text) AND (character_id IS NOT NULL))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dispositions add constraint dispositions_source_check CHECK ((source = ANY (ARRAY['prior'::text, 'posterior'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dispositions add constraint dispositions_scope_check CHECK ((scope = ANY (ARRAY['player'::text, 'character'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entity_links add constraint entity_links_source_type_check CHECK ((source_type = ANY (ARRAY['entry'::text, 'character'::text, 'arc'::text, 'session'::text, 'event'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entity_links add constraint entity_links_target_type_check CHECK ((target_type = ANY (ARRAY['entry'::text, 'character'::text, 'arc'::text, 'session'::text, 'event'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entries add constraint entries_visibility_check CHECK ((visibility = ANY (ARRAY['common'::text, 'player'::text, 'gm'::text, 'private'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entries add constraint entries_type_check CHECK ((type = ANY (ARRAY['note'::text, 'location'::text, 'lore'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.event_types add constraint event_types_category_check CHECK ((category = ANY (ARRAY['opportunity'::text, 'response'::text, 'reward'::text, 'meta'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.event_types add constraint event_types_default_target_check CHECK ((default_target = ANY (ARRAY['fiction'::text, 'player'::text, 'system'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.event_types add constraint event_types_default_frame_check CHECK ((default_frame = ANY (ARRAY['ic'::text, 'ooc'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.event_types add constraint event_types_default_axis_check CHECK ((default_axis = ANY (ARRAY['N'::text, 'T'::text, 'O'::text, 'S'::text, 'E'::text, 'I'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.events add constraint events_target_check CHECK ((target = ANY (ARRAY['fiction'::text, 'player'::text, 'system'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.events add constraint events_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'vtt'::text, 'transcript'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.events add constraint events_frame_check CHECK ((frame = ANY (ARRAY['ic'::text, 'ooc'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.events add constraint events_axis_check CHECK ((axis = ANY (ARRAY['N'::text, 'T'::text, 'O'::text, 'S'::text, 'E'::text, 'I'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_thread_status_check CHECK ((thread_status = ANY (ARRAY['n/a'::text, 'open'::text, 'resolved'::text, 'dropped'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_lore_disposition_check CHECK ((lore_disposition = ANY (ARRAY['legacy'::text, 'kept'::text, 'dismissed'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_proposed_events add constraint gm_proposed_events_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'merged'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_candidates add constraint import_candidates_kind_check CHECK ((kind = ANY (ARRAY['npc'::text, 'location'::text, 'faction'::text, 'item'::text, 'lore'::text, 'pc'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_candidates add constraint import_candidates_decision_check CHECK ((decision = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'merged'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_jobs add constraint import_jobs_status_check CHECK ((status = ANY (ARRAY['parsing'::text, 'extracting'::text, 'review'::text, 'committing'::text, 'committed'::text, 'error'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_sessions add constraint import_sessions_decision_check CHECK ((decision = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_features add constraint map_features_kind_check CHECK ((kind = ANY (ARRAY['river'::text, 'road'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_pois add constraint map_pois_visibility_ck CHECK ((visibility = ANY (ARRAY['common'::text, 'player'::text, 'gm'::text, 'private'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.memberships add constraint memberships_role_check CHECK ((role = ANY (ARRAY['player'::text, 'gm'::text, 'co-gm'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_funds add constraint party_funds_sp_check CHECK ((sp >= 0));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_funds add constraint party_funds_pp_check CHECK ((pp >= 0));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_funds add constraint party_funds_gp_check CHECK ((gp >= 0));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_funds add constraint party_funds_ep_check CHECK ((ep >= 0));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_funds add constraint party_funds_cp_check CHECK ((cp >= 0));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_items add constraint party_items_variant_check CHECK (((variant IS NULL) OR (char_length(variant) <= 80)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_items add constraint party_items_weight_check CHECK (((weight IS NULL) OR ((weight >= (0)::double precision) AND (weight <= (10000)::double precision))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_items add constraint party_items_mod_check CHECK (((mod IS NULL) OR ((mod >= 0) AND (mod <= 3))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_items add constraint party_items_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 80)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_items add constraint party_items_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_items add constraint party_items_qty_check CHECK (((qty >= 1) AND (qty <= 9999)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.proposed_events add constraint proposed_events_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'accepted'::text, 'rejected'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.regions add constraint regions_visibility_ck CHECK ((visibility = ANY (ARRAY['common'::text, 'player'::text, 'gm'::text, 'private'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.roll_tables add constraint roll_tables_body_check CHECK ((char_length(body) <= 20000));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.roll_tables add constraint roll_tables_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 80)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.sessions add constraint sessions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'live'::text, 'completed'::text, 'processed'::text, 'cancelled'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.sessions add constraint sessions_capture_modality_check CHECK ((capture_modality = ANY (ARRAY['none'::text, 'manual'::text, 'online'::text, 'in_person'::text, 'mixed'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.species add constraint species_edition_check CHECK ((edition = ANY (ARRAY['2014'::text, '2024'::text, 'both'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.species_variants add constraint species_variants_edition_check CHECK ((edition = ANY (ARRAY['2014'::text, '2024'::text, 'both'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.species_variants add constraint species_variants_kind_check CHECK ((variant_kind = ANY (ARRAY['subrace'::text, 'lineage'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.tpdi_responses add constraint tpdi_responses_scope_shape_check CHECK ((((scope = 'player'::text) AND (assigned_character_id IS NULL)) OR (scope = 'character'::text)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.tpdi_responses add constraint tpdi_responses_scope_check CHECK ((scope = ANY (ARRAY['player'::text, 'character'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vibe_checks add constraint vibe_checks_spotlight_feeling_check CHECK ((spotlight_feeling = ANY (ARRAY['wanted_more'::text, 'about_right'::text, 'wanted_less'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vibe_checks add constraint vibe_checks_satisfaction_check CHECK (((satisfaction >= 1) AND (satisfaction <= 5)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_cards add constraint vtt_cards_rank_check CHECK ((rank ~ '^(A|[2-9]|10|J|Q|K|R|B)$'::text));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_cards add constraint vtt_cards_pile_check CHECK ((pile = ANY (ARRAY['draw'::text, 'hand'::text, 'table'::text, 'discard'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_cards add constraint vtt_cards_picture_folder CHECK (((image_path IS NULL) OR (image_path ~ (('^'::text || (campaign_id)::text) || '/cards/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'::text))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_cards add constraint vtt_cards_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 80)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_cards add constraint vtt_cards_body_check CHECK ((char_length(body) <= 600));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_cards add constraint vtt_cards_suit_check CHECK ((suit = ANY (ARRAY['hearts'::text, 'diamonds'::text, 'clubs'::text, 'spades'::text, 'joker'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_decks add constraint vtt_decks_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 60)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_decks add constraint vtt_decks_back_color_check CHECK ((back_color ~ '^#[0-9a-fA-F]{6}$'::text));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_decks add constraint vtt_decks_back_folder CHECK (((back_path IS NULL) OR (back_path ~ (('^'::text || (campaign_id)::text) || '/decks/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'::text))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_decks add constraint vtt_decks_kind_check CHECK ((kind = ANY (ARRAY['standard'::text, 'custom'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_check CHECK (((kind <> 'text'::text) OR ((text IS NOT NULL) AND (char_length(TRIM(BOTH FROM text)) > 0))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_kind_check CHECK ((kind = ANY (ARRAY['pen'::text, 'line'::text, 'rect'::text, 'ellipse'::text, 'text'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_color_check CHECK ((color ~ '^#[0-9a-fA-F]{6}$'::text));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_layer_check CHECK ((layer = ANY (ARRAY['table'::text, 'gm'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_points_check CHECK (((jsonb_typeof(points) = 'array'::text) AND ((jsonb_array_length(points) >= 1) AND (jsonb_array_length(points) <= 4000))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_size_check CHECK (((size >= (0.2)::double precision) AND (size <= (6)::double precision)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_text_check CHECK (((text IS NULL) OR (char_length(text) <= 200)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_width_check CHECK (((width >= (0.02)::double precision) AND (width <= (1)::double precision)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_effects add constraint vtt_effects_radius_ft_check CHECK (((radius_ft >= (0)::double precision) AND (radius_ft <= (120)::double precision)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_effects add constraint vtt_effects_kind_check CHECK ((kind = ANY (ARRAY['fire'::text, 'cold'::text, 'acid'::text, 'lightning'::text, 'poison'::text, 'darkness'::text, 'fog'::text, 'radiant'::text, 'necrotic'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_events add constraint vtt_events_fidelity_check CHECK ((fidelity = ANY (ARRAY['canonical'::text, 'unverified'::text, 'heard'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_handouts add constraint vtt_handouts_picture_folder CHECK (((image_path IS NULL) OR (image_path ~ (('^'::text || (campaign_id)::text) || '/handouts/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'::text))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_handouts add constraint vtt_handouts_entry_or_picture CHECK (((entry_id IS NOT NULL) OR ((image_path IS NOT NULL) AND ((char_length(TRIM(BOTH FROM COALESCE(title, ''::text))) >= 1) AND (char_length(TRIM(BOTH FROM COALESCE(title, ''::text))) <= 80)) AND (char_length(COALESCE(note, ''::text)) <= 600))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_messages add constraint vtt_messages_body_check CHECK ((char_length(body) <= 2000));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_messages add constraint vtt_messages_kind_check CHECK ((kind = ANY (ARRAY['say'::text, 'emote'::text, 'whisper'::text, 'roll'::text, 'system'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_pins add constraint vtt_pins_x_check CHECK (((x >= ('-1000'::integer)::double precision) AND (x <= (1000)::double precision)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_pins add constraint vtt_pins_color_check CHECK ((color ~ '^#[0-9a-fA-F]{6}$'::text));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_pins add constraint vtt_pins_y_check CHECK (((y >= ('-1000'::integer)::double precision) AND (y <= (1000)::double precision)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_pins add constraint vtt_pins_gm_note_check CHECK ((char_length(gm_note) <= 2000));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_pins add constraint vtt_pins_label_check CHECK (((char_length(TRIM(BOTH FROM label)) >= 1) AND (char_length(TRIM(BOTH FROM label)) <= 80)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_scenes add constraint vtt_scenes_level_check CHECK (((level >= 0) AND (level <= 2)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_sounds add constraint vtt_sounds_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 80)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_sounds add constraint vtt_sounds_url_ours CHECK ((url ~ (((('^https://'::text || replace(tabletop_storage_host(), '.'::text, '\.'::text)) || '/storage/v1/object/public/campaign-maps/'::text) || (campaign_id)::text) || '/audio/[A-Za-z0-9._-]+$'::text)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_sounds add constraint vtt_sounds_kind_check CHECK ((kind = ANY (ARRAY['music'::text, 'ambient'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_sounds add constraint vtt_sounds_duration_check CHECK (((duration IS NULL) OR ((duration > (0)::double precision) AND (duration < (86400)::double precision))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_sounds add constraint vtt_sounds_bytes_check CHECK (((bytes IS NULL) OR (bytes >= 0)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_templates add constraint vtt_templates_shape_check CHECK ((shape = ANY (ARRAY['circle'::text, 'cone'::text, 'square'::text, 'line'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_templates add constraint vtt_templates_color_check CHECK ((color ~ '^#[0-9a-fA-F]{6}$'::text));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_templates add constraint vtt_templates_effect_check CHECK (((effect IS NULL) OR (effect = ANY (ARRAY['fire'::text, 'cold'::text, 'acid'::text, 'lightning'::text, 'poison'::text, 'darkness'::text, 'fog'::text, 'radiant'::text, 'necrotic'::text]))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_templates add constraint vtt_templates_label_check CHECK (((label IS NULL) OR (char_length(label) <= 60)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_templates add constraint vtt_templates_size_ft_check CHECK (((size_ft > (0)::double precision) AND (size_ft <= (1000)::double precision)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_templates add constraint vtt_templates_width_ft_check CHECK (((width_ft > (0)::double precision) AND (width_ft <= (200)::double precision)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_token_notes add constraint vtt_token_notes_body_check CHECK ((char_length(body) <= 4000));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_tokens add constraint vtt_tokens_kind_check CHECK ((kind = ANY (ARRAY['pc'::text, 'npc'::text, 'monster'::text, 'object'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_tokens add constraint vtt_tokens_size_check CHECK (((size > (0)::double precision) AND (size <= (12)::double precision)));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_tokens add constraint vtt_tokens_layer_check CHECK ((layer = ANY (ARRAY['map'::text, 'token'::text, 'gm'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.world_maps add constraint world_maps_size_ck CHECK ((((width >= 1) AND (width <= 250)) AND ((height >= 1) AND (height <= 250))));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.world_maps add constraint world_maps_editable_ck CHECK ((editable_by = ANY (ARRAY['gm'::text, 'players'::text])));
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;


-- ================================================================================================
-- 04 foreign keys (222)
-- ================================================================================================

do $c$ begin
  alter table public.addon_hooks add constraint addon_hooks_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_hooks add constraint addon_hooks_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_keys add constraint addon_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_keys add constraint addon_keys_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_outbox add constraint addon_outbox_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.addon_outbox add constraint addon_outbox_hook_id_fkey FOREIGN KEY (hook_id) REFERENCES addon_hooks(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.ai_map_renders add constraint ai_map_renders_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arc_touches add constraint arc_touches_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arc_touches add constraint arc_touches_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arc_touches add constraint arc_touches_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arc_touches add constraint arc_touches_arc_id_fkey FOREIGN KEY (arc_id) REFERENCES arcs(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arcs add constraint arcs_opened_session_id_fkey FOREIGN KEY (opened_session_id) REFERENCES sessions(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arcs add constraint arcs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arcs add constraint arcs_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arcs add constraint arcs_last_touched_session_id_fkey FOREIGN KEY (last_touched_session_id) REFERENCES sessions(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.arcs add constraint arcs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.attendance add constraint attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.attendance add constraint attendance_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.attendance add constraint attendance_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.attendance add constraint attendance_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.audio_tracks add constraint audio_tracks_gm_identity_id_fkey FOREIGN KEY (gm_identity_id) REFERENCES gm_identities(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.audio_tracks add constraint audio_tracks_job_id_fkey FOREIGN KEY (job_id) REFERENCES capture_jobs(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.audio_tracks add constraint audio_tracks_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.audio_tracks add constraint audio_tracks_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.bastion_maps add constraint bastion_maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.battle_maps add constraint battle_maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.building_maps add constraint building_maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.campaign_journals add constraint campaign_journals_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.campaigns add constraint campaigns_gm_id_fkey FOREIGN KEY (gm_id) REFERENCES profiles(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.capture_control add constraint capture_control_capture_job_id_fkey FOREIGN KEY (capture_job_id) REFERENCES capture_jobs(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.capture_control add constraint capture_control_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.capture_control add constraint capture_control_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.capture_jobs add constraint capture_jobs_room_consent_by_fkey FOREIGN KEY (room_consent_by) REFERENCES auth.users(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.capture_jobs add constraint capture_jobs_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.capture_jobs add constraint capture_jobs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.capture_jobs add constraint capture_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.character_identities add constraint character_identities_source_library_id_fkey FOREIGN KEY (source_library_id) REFERENCES pc_library(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.character_identities add constraint character_identities_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES auth.users(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.character_wiki_gm_edit add constraint character_wiki_gm_edit_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.character_wiki_gm_edit add constraint character_wiki_gm_edit_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.character_wiki_sections add constraint character_wiki_sections_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.character_wiki_sections add constraint character_wiki_sections_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.characters add constraint characters_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.characters add constraint characters_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES character_identities(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.characters add constraint characters_alter_ego_of_fkey FOREIGN KEY (alter_ego_of) REFERENCES characters(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.characters add constraint characters_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.chat_grants add constraint chat_grants_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.chat_messages add constraint chat_messages_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.combats add constraint combats_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.combats add constraint combats_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.combats add constraint combats_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.compendium_entries add constraint compendium_entries_gm_id_fkey FOREIGN KEY (gm_id) REFERENCES auth.users(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.compendium_entries add constraint compendium_entries_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.disposition_reveals add constraint disposition_reveals_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.disposition_reveals add constraint disposition_reveals_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.disposition_reveals add constraint disposition_reveals_revealed_by_fkey FOREIGN KEY (revealed_by) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.disposition_runs add constraint disposition_runs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dispositions add constraint dispositions_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dispositions add constraint dispositions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dispositions add constraint dispositions_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dispositions add constraint dispositions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dm_boards add constraint dm_boards_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dm_boards add constraint dm_boards_gm_id_fkey FOREIGN KEY (gm_id) REFERENCES auth.users(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.dungeon_maps add constraint dungeon_maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.encounters add constraint encounters_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entity_links add constraint entity_links_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entries add constraint entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entries add constraint entries_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entry_reveals add constraint entry_reveals_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.entry_reveals add constraint entry_reveals_revealed_to_character_id_fkey FOREIGN KEY (revealed_to_character_id) REFERENCES characters(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.events add constraint events_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.events add constraint events_event_type_fkey FOREIGN KEY (event_type) REFERENCES event_types(key);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.events add constraint events_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.events add constraint events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.events add constraint events_actor_profile_id_fkey FOREIGN KEY (actor_profile_id) REFERENCES profiles(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_resolved_by_event_id_fkey FOREIGN KEY (resolved_by_event_id) REFERENCES gm_events(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_npc_id_fkey FOREIGN KEY (npc_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_proposed_from_fkey FOREIGN KEY (proposed_from) REFERENCES gm_proposed_events(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_location_id_fkey FOREIGN KEY (location_id) REFERENCES entries(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_kind_fkey FOREIGN KEY (kind) REFERENCES gm_event_kinds(kind);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_faction_id_fkey FOREIGN KEY (faction_id) REFERENCES entries(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_audio_track_id_fkey FOREIGN KEY (audio_track_id) REFERENCES audio_tracks(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_resolved_session_id_fkey FOREIGN KEY (resolved_session_id) REFERENCES sessions(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_events add constraint gm_events_target_character_id_fkey FOREIGN KEY (target_character_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_identities add constraint gm_identities_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_identities add constraint gm_identities_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_proposed_events add constraint gm_proposed_events_target_character_id_fkey FOREIGN KEY (target_character_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_proposed_events add constraint gm_proposed_events_audio_track_id_fkey FOREIGN KEY (audio_track_id) REFERENCES audio_tracks(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_proposed_events add constraint gm_proposed_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_proposed_events add constraint gm_proposed_events_faction_id_fkey FOREIGN KEY (faction_id) REFERENCES entries(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_proposed_events add constraint gm_proposed_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES capture_jobs(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_proposed_events add constraint gm_proposed_events_kind_fkey FOREIGN KEY (kind) REFERENCES gm_event_kinds(kind);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_proposed_events add constraint gm_proposed_events_location_id_fkey FOREIGN KEY (location_id) REFERENCES entries(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_proposed_events add constraint gm_proposed_events_npc_id_fkey FOREIGN KEY (npc_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.gm_proposed_events add constraint gm_proposed_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_candidates add constraint import_candidates_job_id_fkey FOREIGN KEY (job_id) REFERENCES import_jobs(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_candidates add constraint import_candidates_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_jobs add constraint import_jobs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_jobs add constraint import_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_sessions add constraint import_sessions_job_id_fkey FOREIGN KEY (job_id) REFERENCES import_jobs(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.import_sessions add constraint import_sessions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.loot_grants add constraint loot_grants_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.loot_grants add constraint loot_grants_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.loot_grants add constraint loot_grants_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.loot_grants add constraint loot_grants_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_features add constraint map_features_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES world_maps(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_fog add constraint map_fog_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_fog add constraint map_fog_map_id_fkey FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_icons add constraint map_icons_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_images add constraint map_images_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES world_maps(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_labels add constraint map_labels_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES world_maps(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_layers add constraint map_layers_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES world_maps(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_pins add constraint map_pins_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_pins add constraint map_pins_map_id_fkey FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_pois add constraint map_pois_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_pois add constraint map_pois_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES world_maps(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_pois add constraint map_pois_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.map_pois add constraint map_pois_icon_id_fkey FOREIGN KEY (icon_id) REFERENCES map_icons(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.maps add constraint maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.maps add constraint maps_linked_entry_id_fkey FOREIGN KEY (linked_entry_id) REFERENCES entries(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.memberships add constraint memberships_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.memberships add constraint memberships_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_funds add constraint party_funds_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_funds add constraint party_funds_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_items add constraint party_items_added_by_fkey FOREIGN KEY (added_by) REFERENCES profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.party_items add constraint party_items_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.pc_library add constraint pc_library_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES auth.users(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.pc_library add constraint pc_library_alter_ego_of_fkey FOREIGN KEY (alter_ego_of) REFERENCES pc_library(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.player_notes add constraint player_notes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES auth.users(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.player_notes add constraint player_notes_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.player_notes add constraint player_notes_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.poll_responses add constraint poll_responses_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES session_polls(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.poll_responses add constraint poll_responses_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.proposed_events add constraint proposed_events_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.proposed_events add constraint proposed_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES capture_jobs(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.proposed_events add constraint proposed_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.proposed_events add constraint proposed_events_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES transcript_segments(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.proposed_events add constraint proposed_events_event_type_fkey FOREIGN KEY (event_type) REFERENCES event_types(key);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.proposed_events add constraint proposed_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recodings add constraint recodings_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES transcript_segments(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recodings add constraint recodings_event_type_fkey FOREIGN KEY (event_type) REFERENCES event_types(key);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recodings add constraint recodings_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recodings add constraint recodings_job_id_fkey FOREIGN KEY (job_id) REFERENCES capture_jobs(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recording_consents add constraint recording_consents_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recording_consents add constraint recording_consents_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recording_consents add constraint recording_consents_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recording_consents add constraint recording_consents_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES profiles(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.recording_consents add constraint recording_consents_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.regions add constraint regions_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES world_maps(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.regions add constraint regions_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.regions add constraint regions_layer_id_fkey FOREIGN KEY (layer_id) REFERENCES map_layers(id) ON DELETE RESTRICT;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.regions add constraint regions_parent_region_id_fkey FOREIGN KEY (parent_region_id) REFERENCES regions(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.roll_tables add constraint roll_tables_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.session_plan_items add constraint session_plan_items_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.session_plan_items add constraint session_plan_items_linked_event_id_fkey FOREIGN KEY (linked_event_id) REFERENCES gm_events(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.session_plan_items add constraint session_plan_items_linked_character_id_fkey FOREIGN KEY (linked_character_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.session_polls add constraint session_polls_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.session_polls add constraint session_polls_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.sessions add constraint sessions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.species_variants add constraint species_variants_species_id_fkey FOREIGN KEY (species_id) REFERENCES species(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.stat_blocks add constraint stat_blocks_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.stat_blocks add constraint stat_blocks_gm_id_fkey FOREIGN KEY (gm_id) REFERENCES auth.users(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.threads add constraint threads_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.threads add constraint threads_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.threads add constraint threads_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.tpdi_responses add constraint tpdi_responses_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.tpdi_responses add constraint tpdi_responses_assigned_character_id_fkey FOREIGN KEY (assigned_character_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.transcript_segments add constraint transcript_segments_track_id_fkey FOREIGN KEY (track_id) REFERENCES audio_tracks(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.transcript_segments add constraint transcript_segments_job_id_fkey FOREIGN KEY (job_id) REFERENCES capture_jobs(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.transcript_segments add constraint transcript_segments_gm_identity_id_fkey FOREIGN KEY (gm_identity_id) REFERENCES gm_identities(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.transcript_segments add constraint transcript_segments_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.transcript_segments add constraint transcript_segments_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vibe_checks add constraint vibe_checks_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vibe_checks add constraint vibe_checks_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vibe_checks add constraint vibe_checks_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_audio add constraint vtt_audio_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_cards add constraint vtt_cards_holder_fkey FOREIGN KEY (holder) REFERENCES profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_cards add constraint vtt_cards_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_cards add constraint vtt_cards_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES vtt_decks(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_cards add constraint vtt_cards_played_by_fkey FOREIGN KEY (played_by) REFERENCES profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_decks add constraint vtt_decks_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES vtt_scenes(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_drawings add constraint vtt_drawings_owner_fkey FOREIGN KEY (owner) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_effects add constraint vtt_effects_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES vtt_scenes(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_effects add constraint vtt_effects_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_effects add constraint vtt_effects_token_id_fkey FOREIGN KEY (token_id) REFERENCES vtt_tokens(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_effects add constraint vtt_effects_owner_fkey FOREIGN KEY (owner) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_events add constraint vtt_events_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_events add constraint vtt_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_events add constraint vtt_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_handouts add constraint vtt_handouts_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_handouts add constraint vtt_handouts_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_messages add constraint vtt_messages_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_messages add constraint vtt_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_messages add constraint vtt_messages_vtt_event_id_fkey FOREIGN KEY (vtt_event_id) REFERENCES vtt_events(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_messages add constraint vtt_messages_author_profile_fkey FOREIGN KEY (author_profile) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_messages add constraint vtt_messages_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_pins add constraint vtt_pins_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_pins add constraint vtt_pins_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_pins add constraint vtt_pins_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES vtt_scenes(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_scene_players add constraint vtt_scene_players_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_scene_players add constraint vtt_scene_players_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_scene_players add constraint vtt_scene_players_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES vtt_scenes(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_scenes add constraint vtt_scenes_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_scenes add constraint vtt_scenes_battle_map_id_fkey FOREIGN KEY (battle_map_id) REFERENCES battle_maps(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_sounds add constraint vtt_sounds_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_templates add constraint vtt_templates_owner_fkey FOREIGN KEY (owner) REFERENCES profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_templates add constraint vtt_templates_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_templates add constraint vtt_templates_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES vtt_scenes(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_token_notes add constraint vtt_token_notes_token_id_fkey FOREIGN KEY (token_id) REFERENCES vtt_tokens(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_token_notes add constraint vtt_token_notes_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_tokens add constraint vtt_tokens_stat_block_id_fkey FOREIGN KEY (stat_block_id) REFERENCES stat_blocks(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_tokens add constraint vtt_tokens_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_tokens add constraint vtt_tokens_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.vtt_tokens add constraint vtt_tokens_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES vtt_scenes(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.world_hexes add constraint world_hexes_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES world_maps(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.world_hexes add constraint world_hexes_region_id_fkey FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;

do $c$ begin
  alter table public.world_maps add constraint world_maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null;
end $c$;


-- ================================================================================================
-- 05 indexes (126)
-- ================================================================================================

CREATE INDEX IF NOT EXISTS addon_hooks_campaign_idx ON public.addon_hooks USING btree (campaign_id) WHERE enabled;

CREATE INDEX IF NOT EXISTS addon_keys_campaign_idx ON public.addon_keys USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS addon_outbox_due_idx ON public.addon_outbox USING btree (next_at) WHERE ((delivered_at IS NULL) AND (dropped_at IS NULL));

CREATE INDEX IF NOT EXISTS addon_outbox_campaign_idx ON public.addon_outbox USING btree (campaign_id) WHERE ((delivered_at IS NULL) AND (dropped_at IS NULL));

CREATE INDEX IF NOT EXISTS ai_map_renders_profile_time_idx ON public.ai_map_renders USING btree (profile_id, created_at);

CREATE INDEX IF NOT EXISTS arcs_campaign_id_idx ON public.arcs USING btree (campaign_id);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_session_character_key ON public.attendance USING btree (session_id, character_id);

CREATE INDEX IF NOT EXISTS attendance_session_id_idx ON public.attendance USING btree (session_id);

CREATE INDEX IF NOT EXISTS audio_tracks_gm_identity_idx ON public.audio_tracks USING btree (gm_identity_id) WHERE (gm_identity_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS audio_tracks_job_idx ON public.audio_tracks USING btree (job_id);

CREATE INDEX IF NOT EXISTS audio_tracks_retention_idx ON public.audio_tracks USING btree (created_at) WHERE (purged_at IS NULL);

CREATE INDEX IF NOT EXISTS battle_maps_campaign_idx ON public.battle_maps USING btree (campaign_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_public_slug_key ON public.campaigns USING btree (public_slug) WHERE (public_slug IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_share_code_key ON public.campaigns USING btree (share_code);

CREATE INDEX IF NOT EXISTS capture_control_status_idx ON public.capture_control USING btree (status);

CREATE INDEX IF NOT EXISTS capture_control_campaign_idx ON public.capture_control USING btree (campaign_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS capture_control_one_open_per_guild ON public.capture_control USING btree (guild_id) WHERE (status = ANY (ARRAY['requested'::text, 'active'::text, 'stopping'::text]));

CREATE INDEX IF NOT EXISTS capture_control_open_heartbeat_idx ON public.capture_control USING btree (heartbeat_at) WHERE (status = ANY (ARRAY['requested'::text, 'active'::text, 'stopping'::text]));

CREATE INDEX IF NOT EXISTS capture_jobs_session_idx ON public.capture_jobs USING btree (session_id);

CREATE INDEX IF NOT EXISTS character_identities_profile_idx ON public.character_identities USING btree (profile_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS character_identities_owner_build_uidx ON public.character_identities USING btree (profile_id, source_library_id) WHERE (source_library_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS character_wiki_sections_char_idx ON public.character_wiki_sections USING btree (character_id, "position");

CREATE INDEX IF NOT EXISTS characters_campaign_id_idx ON public.characters USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS characters_system_idx ON public.characters USING btree (system);

CREATE INDEX IF NOT EXISTS characters_alter_ego_of_idx ON public.characters USING btree (alter_ego_of) WHERE (alter_ego_of IS NOT NULL);

CREATE INDEX IF NOT EXISTS characters_public_idx ON public.characters USING btree (campaign_id) WHERE is_public;

CREATE INDEX IF NOT EXISTS characters_identity_idx ON public.characters USING btree (identity_id) WHERE (identity_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS characters_ddb_idx ON public.characters USING btree (campaign_id, ddb_character_id);

CREATE UNIQUE INDEX IF NOT EXISTS characters_invite_code_key ON public.characters USING btree (invite_code);

CREATE INDEX IF NOT EXISTS characters_campaign_discord_idx ON public.characters USING btree (campaign_id, discord_user_id);

CREATE INDEX IF NOT EXISTS chat_grants_lookup_idx ON public.chat_grants USING btree (campaign_id, player_profile);

CREATE INDEX IF NOT EXISTS chat_messages_campaign_idx ON public.chat_messages USING btree (campaign_id, created_at);

CREATE INDEX IF NOT EXISTS combats_campaign_status_idx ON public.combats USING btree (campaign_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS compendium_entries_owner_idx ON public.compendium_entries USING btree (gm_id, system);

CREATE UNIQUE INDEX IF NOT EXISTS compendium_entries_one_account_override ON public.compendium_entries USING btree (gm_id, system, overrides_id) WHERE ((overrides_id IS NOT NULL) AND (campaign_id IS NULL));

CREATE INDEX IF NOT EXISTS disposition_runs_campaign_idx ON public.disposition_runs USING btree (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dispositions_profile_id_source_idx ON public.dispositions USING btree (profile_id, source);

CREATE INDEX IF NOT EXISTS dispositions_scope_idx ON public.dispositions USING btree (profile_id, scope, source, as_of DESC);

CREATE INDEX IF NOT EXISTS dm_boards_owner_idx ON public.dm_boards USING btree (gm_id);

CREATE INDEX IF NOT EXISTS encounters_campaign_idx ON public.encounters USING btree (campaign_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS entity_links_src_idx ON public.entity_links USING btree (campaign_id, source_type, source_id);

CREATE INDEX IF NOT EXISTS entity_links_tgt_idx ON public.entity_links USING btree (campaign_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS entries_campaign_idx ON public.entries USING btree (campaign_id, type);

CREATE INDEX IF NOT EXISTS entries_public_idx ON public.entries USING btree (campaign_id) WHERE is_public;

CREATE INDEX IF NOT EXISTS entries_tags_idx ON public.entries USING gin (tags);

CREATE UNIQUE INDEX IF NOT EXISTS entries_campaign_slug_uniq ON public.entries USING btree (campaign_id, slug) WHERE (slug IS NOT NULL);

CREATE INDEX IF NOT EXISTS entry_reveals_campaign_idx ON public.entry_reveals USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS entry_reveals_target_idx ON public.entry_reveals USING btree (target_type, target_id);

CREATE INDEX IF NOT EXISTS events_actor_profile_id_idx ON public.events USING btree (actor_profile_id);

CREATE INDEX IF NOT EXISTS events_session_id_axis_idx ON public.events USING btree (session_id, axis);

CREATE INDEX IF NOT EXISTS events_campaign_id_session_id_idx ON public.events USING btree (campaign_id, session_id);

CREATE INDEX IF NOT EXISTS gm_events_faction_idx ON public.gm_events USING btree (faction_id);

CREATE INDEX IF NOT EXISTS gm_events_session_idx ON public.gm_events USING btree (session_id, kind);

CREATE INDEX IF NOT EXISTS gm_events_thread_idx ON public.gm_events USING btree (campaign_id, thread_status) WHERE (thread_status = 'open'::text);

CREATE INDEX IF NOT EXISTS gm_events_npc_idx ON public.gm_events USING btree (campaign_id, npc_id);

CREATE INDEX IF NOT EXISTS gm_events_location_idx ON public.gm_events USING btree (location_id);

CREATE INDEX IF NOT EXISTS gm_proposed_session_idx ON public.gm_proposed_events USING btree (session_id, status);

CREATE INDEX IF NOT EXISTS import_candidates_job_idx ON public.import_candidates USING btree (job_id, kind, decision);

CREATE INDEX IF NOT EXISTS import_jobs_campaign_idx ON public.import_jobs USING btree (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS import_sessions_job_idx ON public.import_sessions USING btree (job_id, idx);

CREATE INDEX IF NOT EXISTS loot_grants_campaign_id_character_id_idx ON public.loot_grants USING btree (campaign_id, character_id);

CREATE INDEX IF NOT EXISTS map_features_world_map_id_idx ON public.map_features USING btree (world_map_id);

CREATE INDEX IF NOT EXISTS map_fog_campaign_idx ON public.map_fog USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS map_icons_campaign_idx ON public.map_icons USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS map_images_world_map_id_idx ON public.map_images USING btree (world_map_id);

CREATE INDEX IF NOT EXISTS map_labels_world_map_id_idx ON public.map_labels USING btree (world_map_id);

CREATE INDEX IF NOT EXISTS map_layers_world_map_id_idx ON public.map_layers USING btree (world_map_id, ord);

CREATE INDEX IF NOT EXISTS map_pins_map_idx ON public.map_pins USING btree (map_id);

CREATE INDEX IF NOT EXISTS map_pois_world_map_id_idx ON public.map_pois USING btree (world_map_id);

CREATE INDEX IF NOT EXISTS maps_linked_entry_idx ON public.maps USING btree (linked_entry_id);

CREATE INDEX IF NOT EXISTS maps_campaign_idx ON public.maps USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS memberships_profile_id_idx ON public.memberships USING btree (profile_id);

CREATE INDEX IF NOT EXISTS party_items_campaign_idx ON public.party_items USING btree (campaign_id, name);

CREATE INDEX IF NOT EXISTS pc_library_system_idx ON public.pc_library USING btree (system);

CREATE INDEX IF NOT EXISTS pc_library_profile_idx ON public.pc_library USING btree (profile_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS pc_library_alter_ego_of_idx ON public.pc_library USING btree (alter_ego_of) WHERE (alter_ego_of IS NOT NULL);

CREATE INDEX IF NOT EXISTS player_notes_owner_campaign_idx ON public.player_notes USING btree (profile_id, campaign_id);

CREATE UNIQUE INDEX IF NOT EXISTS player_notes_one_per_entry ON public.player_notes USING btree (profile_id, entry_id) WHERE (entry_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS poll_responses_poll_idx ON public.poll_responses USING btree (poll_id);

CREATE INDEX IF NOT EXISTS proposed_events_job_idx ON public.proposed_events USING btree (job_id, status);

CREATE INDEX IF NOT EXISTS recodings_job_idx ON public.recodings USING btree (job_id);

CREATE UNIQUE INDEX IF NOT EXISTS recording_consents_blanket_uniq ON public.recording_consents USING btree (character_id, campaign_id) WHERE (session_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS recording_consents_session_uniq ON public.recording_consents USING btree (character_id, session_id) WHERE (session_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS recording_consents_blanket_unq ON public.recording_consents USING btree (campaign_id, character_id) WHERE (session_id IS NULL);

CREATE INDEX IF NOT EXISTS regions_world_map_id_idx ON public.regions USING btree (world_map_id);

CREATE INDEX IF NOT EXISTS regions_layer_id_idx ON public.regions USING btree (layer_id);

CREATE INDEX IF NOT EXISTS regions_parent_idx ON public.regions USING btree (parent_region_id);

CREATE INDEX IF NOT EXISTS roll_tables_campaign_idx ON public.roll_tables USING btree (campaign_id, name);

CREATE INDEX IF NOT EXISTS session_plan_items_campaign_idx ON public.session_plan_items USING btree (campaign_id, "position");

CREATE INDEX IF NOT EXISTS session_polls_campaign_idx ON public.session_polls USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS sessions_campaign_id_idx ON public.sessions USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS species_partner_idx ON public.species USING btree (partnered, partner);

CREATE INDEX IF NOT EXISTS species_variants_species_idx ON public.species_variants USING btree (species_id);

CREATE INDEX IF NOT EXISTS species_variants_partner_idx ON public.species_variants USING btree (partnered, partner);

CREATE INDEX IF NOT EXISTS stat_blocks_campaign_idx ON public.stat_blocks USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS stat_blocks_gm_idx ON public.stat_blocks USING btree (gm_id);

CREATE INDEX IF NOT EXISTS stat_blocks_system_idx ON public.stat_blocks USING btree (system);

CREATE INDEX IF NOT EXISTS threads_profile_idx ON public.threads USING btree (profile_id);

CREATE INDEX IF NOT EXISTS threads_campaign_idx ON public.threads USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS tool_render_log_ip_created_idx ON public.tool_render_log USING btree (ip, created_at);

CREATE INDEX IF NOT EXISTS tool_render_log_created_idx ON public.tool_render_log USING btree (created_at);

CREATE INDEX IF NOT EXISTS tpdi_responses_scope_idx ON public.tpdi_responses USING btree (respondent_id, scope, created_at DESC);

CREATE INDEX IF NOT EXISTS transcript_segments_job_idx ON public.transcript_segments USING btree (job_id, start_ms);

CREATE INDEX IF NOT EXISTS transcript_segments_track_speaker_idx ON public.transcript_segments USING btree (track_id, speaker) WHERE (speaker IS NOT NULL);

CREATE INDEX IF NOT EXISTS transcript_segments_gm_identity_idx ON public.transcript_segments USING btree (gm_identity_id) WHERE (gm_identity_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS vibe_checks_campaign_id_session_id_idx ON public.vibe_checks USING btree (campaign_id, session_id);

CREATE INDEX IF NOT EXISTS vtt_cards_deck_idx ON public.vtt_cards USING btree (deck_id, pile, ord);

CREATE INDEX IF NOT EXISTS vtt_cards_campaign_idx ON public.vtt_cards USING btree (campaign_id, pile, holder);

CREATE INDEX IF NOT EXISTS vtt_decks_campaign_idx ON public.vtt_decks USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS vtt_drawings_scene_idx ON public.vtt_drawings USING btree (scene_id);

CREATE INDEX IF NOT EXISTS vtt_effects_scene_idx ON public.vtt_effects USING btree (scene_id);

CREATE INDEX IF NOT EXISTS vtt_events_campaign_idx ON public.vtt_events USING btree (campaign_id, received_at);

CREATE INDEX IF NOT EXISTS vtt_events_session_idx ON public.vtt_events USING btree (session_id, rolled_at);

CREATE INDEX IF NOT EXISTS vtt_handouts_campaign_idx ON public.vtt_handouts USING btree (campaign_id, shown_at DESC);

CREATE INDEX IF NOT EXISTS vtt_messages_author_idx ON public.vtt_messages USING btree (author_profile);

CREATE INDEX IF NOT EXISTS vtt_messages_campaign_idx ON public.vtt_messages USING btree (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vtt_pins_scene_idx ON public.vtt_pins USING btree (scene_id);

CREATE UNIQUE INDEX IF NOT EXISTS vtt_scenes_one_active ON public.vtt_scenes USING btree (campaign_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS vtt_scenes_campaign_idx ON public.vtt_scenes USING btree (campaign_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS vtt_sounds_campaign_idx ON public.vtt_sounds USING btree (campaign_id, kind, name);

CREATE INDEX IF NOT EXISTS vtt_templates_scene_idx ON public.vtt_templates USING btree (scene_id);

CREATE INDEX IF NOT EXISTS vtt_token_notes_campaign_idx ON public.vtt_token_notes USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS vtt_tokens_campaign_idx ON public.vtt_tokens USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS vtt_tokens_scene_idx ON public.vtt_tokens USING btree (scene_id);

CREATE INDEX IF NOT EXISTS world_hexes_region_idx ON public.world_hexes USING btree (region_id);

CREATE UNIQUE INDEX IF NOT EXISTS world_maps_one_per_campaign ON public.world_maps USING btree (campaign_id);


-- ================================================================================================
-- 07 views (10)
-- ================================================================================================

create or replace view public.profiles_public as  SELECT id,
    display_name,
    avatar_url,
    is_anonymous
   FROM profiles;

create or replace view public.v_arc_freshness as  WITH cur AS (
         SELECT sessions.campaign_id,
            max(sessions.session_number) AS current_session
           FROM sessions
          GROUP BY sessions.campaign_id
        ), lt AS (
         SELECT a_1.id AS arc_id,
            s.session_number AS last_touched_num
           FROM arcs a_1
             LEFT JOIN sessions s ON s.id = a_1.last_touched_session_id
        )
 SELECT a.id AS arc_id,
    a.campaign_id,
    a.title,
    a.status,
    a.character_id,
    ch.name AS character_name,
    lt.last_touched_num,
    cur.current_session,
        CASE
            WHEN lt.last_touched_num IS NULL THEN cur.current_session
            ELSE cur.current_session - lt.last_touched_num
        END AS sessions_since_touched,
    (a.status = ANY (ARRAY['open'::text, 'progressing'::text])) AND (lt.last_touched_num IS NULL OR (cur.current_session - lt.last_touched_num) >= 3) AS stale
   FROM arcs a
     JOIN cur ON cur.campaign_id = a.campaign_id
     LEFT JOIN lt ON lt.arc_id = a.id
     LEFT JOIN characters ch ON ch.id = a.character_id;

create or replace view public.v_audio_due_for_purge as  SELECT id AS track_id,
    campaign_id,
    job_id,
    storage_path,
    created_at,
    now() - created_at AS age
   FROM audio_tracks t
  WHERE purged_at IS NULL AND storage_path IS NOT NULL AND created_at < (now() - '60 days'::interval);

create or replace view public.v_campaign_audio_retention as  SELECT campaign_id,
    count(*) FILTER (WHERE purged_at IS NULL AND storage_path IS NOT NULL) AS audio_present,
    count(*) FILTER (WHERE purged_at IS NOT NULL) AS audio_purged,
    min(created_at) FILTER (WHERE purged_at IS NULL) AS oldest_retained_at
   FROM audio_tracks t
  GROUP BY campaign_id;

create or replace view public.v_character_catalog_audit as  SELECT id AS character_id,
    campaign_id,
    name,
    species,
    species_variant,
    class,
    subclass,
    species IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM species s
          WHERE s.name = ch.species)) AS species_unknown,
    class IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM classes c
          WHERE c.name = ch.class)) AS class_unknown,
    subclass IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM class_capabilities cc
          WHERE cc.subclass = ch.subclass)) AS subclass_unknown,
    subclass IS NULL OR NOT (EXISTS ( SELECT 1
           FROM class_capabilities cc
          WHERE cc.subclass = ch.subclass)) AS no_capabilities
   FROM characters ch
  WHERE kind = 'pc'::text;

create or replace view public.v_loot_fairness as  WITH per_char AS (
         SELECT loot_grants.campaign_id,
            loot_grants.character_id,
            sum(COALESCE(loot_grants.est_value, 0::numeric)) AS total_value,
            count(*) AS items
           FROM loot_grants
          WHERE loot_grants.character_id IS NOT NULL
          GROUP BY loot_grants.campaign_id, loot_grants.character_id
        ), camp AS (
         SELECT per_char.campaign_id,
            sum(per_char.total_value) AS camp_total,
            count(*) AS n_recipients
           FROM per_char
          GROUP BY per_char.campaign_id
        )
 SELECT p.campaign_id,
    p.character_id,
    ch.name AS character_name,
    p.items,
    p.total_value,
        CASE
            WHEN c.camp_total > 0::numeric THEN round(p.total_value / c.camp_total, 3)
            ELSE NULL::numeric
        END AS share,
        CASE
            WHEN c.n_recipients > 0 THEN round(1.0 / c.n_recipients::numeric, 3)
            ELSE NULL::numeric
        END AS equal_share,
        CASE
            WHEN c.camp_total > 0::numeric THEN round(p.total_value / c.camp_total - 1.0 / c.n_recipients::numeric, 3)
            ELSE NULL::numeric
        END AS deviation
   FROM per_char p
     JOIN camp c ON c.campaign_id = p.campaign_id
     LEFT JOIN characters ch ON ch.id = p.character_id;

create or replace view public.v_session_axis_engagement as  WITH opps AS (
         SELECT e.session_id,
            e.axis,
            count(*) AS opportunities
           FROM events e
             JOIN event_types t ON t.key = e.event_type
          WHERE t.category = 'opportunity'::text AND e.axis IS NOT NULL
          GROUP BY e.session_id, e.axis
        ), resp AS (
         SELECT e.campaign_id,
            e.session_id,
            e.character_id,
            e.axis,
            count(*) AS responses
           FROM events e
             JOIN event_types t ON t.key = e.event_type
          WHERE t.category = 'response'::text AND e.axis IS NOT NULL AND e.character_id IS NOT NULL
          GROUP BY e.campaign_id, e.session_id, e.character_id, e.axis
        )
 SELECT r.campaign_id,
    r.session_id,
    r.character_id,
    r.axis,
    r.responses,
    COALESCE(o.opportunities, 0::bigint) AS opportunities,
        CASE
            WHEN COALESCE(o.opportunities, 0::bigint) > 0 THEN round(r.responses::numeric / o.opportunities::numeric, 3)
            ELSE NULL::numeric
        END AS per_opportunity_rate
   FROM resp r
     LEFT JOIN opps o ON o.session_id = r.session_id AND o.axis = r.axis;

create or replace view public.v_session_spotlight as  WITH resp AS (
         SELECT e.campaign_id,
            e.session_id,
            e.character_id,
            sum(
                CASE
                    WHEN e.event_type = ANY (ARRAY['decision'::text, 'character_choice'::text]) THEN 2.0
                    ELSE 1.0
                END) AS weighted,
            count(*) AS raw_events
           FROM events e
             JOIN event_types t ON t.key = e.event_type
          WHERE t.category = 'response'::text AND e.character_id IS NOT NULL
          GROUP BY e.campaign_id, e.session_id, e.character_id
        )
 SELECT r.campaign_id,
    r.session_id,
    r.character_id,
    c.name AS character_name,
    r.raw_events,
    r.weighted,
    round(r.weighted / NULLIF(sum(r.weighted) OVER (PARTITION BY r.session_id), 0::numeric), 3) AS share
   FROM resp r
     LEFT JOIN characters c ON c.id = r.character_id;

create or replace view public.v_session_equity as  SELECT campaign_id,
    session_id,
    count(*) AS n_active,
    round(sum(weighted), 2) AS total_weighted,
    round(avg(weighted), 2) AS mean_weighted,
    round(stddev_pop(weighted), 2) AS sd_weighted,
        CASE
            WHEN avg(weighted) > 0::numeric THEN round(stddev_pop(weighted) / avg(weighted), 3)
            ELSE 0::numeric
        END AS cv
   FROM v_session_spotlight
  GROUP BY campaign_id, session_id;

create or replace view public.v_session_gini as  WITH ranked AS (
         SELECT v_session_spotlight.campaign_id,
            v_session_spotlight.session_id,
            v_session_spotlight.weighted,
            row_number() OVER (PARTITION BY v_session_spotlight.session_id ORDER BY v_session_spotlight.weighted) AS i,
            count(*) OVER (PARTITION BY v_session_spotlight.session_id) AS n,
            sum(v_session_spotlight.weighted) OVER (PARTITION BY v_session_spotlight.session_id) AS tot
           FROM v_session_spotlight
        )
 SELECT campaign_id,
    session_id,
    max(n) AS n_active,
        CASE
            WHEN max(tot) > 0::numeric AND max(n) > 1 THEN round(2.0 * sum(i::numeric * weighted) / (max(n)::numeric * max(tot)) - (max(n)::numeric + 1.0) / max(n)::numeric, 3)
            ELSE 0::numeric
        END AS gini
   FROM ranked
  GROUP BY campaign_id, session_id;


-- ================================================================================================
-- 08 triggers (25)
-- ================================================================================================

CREATE OR REPLACE TRIGGER arc_touch_bumps_arc AFTER INSERT ON public.arc_touches FOR EACH ROW EXECUTE FUNCTION bump_arc_on_touch();

CREATE OR REPLACE TRIGGER arcs_updated BEFORE UPDATE ON public.arcs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER campaigns_updated BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER capture_jobs_updated BEFORE UPDATE ON public.capture_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER character_identities_set_updated_at BEFORE UPDATE ON public.character_identities FOR EACH ROW EXECUTE FUNCTION character_identities_touch_updated_at();

CREATE OR REPLACE TRIGGER character_wiki_grant_fill_t BEFORE INSERT ON public.character_wiki_gm_edit FOR EACH ROW EXECUTE FUNCTION character_wiki_grant_fill();

CREATE OR REPLACE TRIGGER character_wiki_fill_t BEFORE INSERT OR UPDATE ON public.character_wiki_sections FOR EACH ROW EXECUTE FUNCTION character_wiki_fill();

CREATE OR REPLACE TRIGGER characters_alter_ego_flat BEFORE INSERT OR UPDATE OF alter_ego_of ON public.characters FOR EACH ROW EXECUTE FUNCTION alter_ego_is_flat();

CREATE OR REPLACE TRIGGER characters_updated BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER combat_turn_econ BEFORE UPDATE OF turn, round ON public.combats FOR EACH ROW EXECUTE FUNCTION combat_turn_econ();

CREATE OR REPLACE TRIGGER addon_on_combat AFTER INSERT OR UPDATE ON public.combats FOR EACH ROW EXECUTE FUNCTION addon_on_combat();

CREATE OR REPLACE TRIGGER compendium_entries_touch BEFORE UPDATE ON public.compendium_entries FOR EACH ROW EXECUTE FUNCTION touch_compendium_entries();

CREATE OR REPLACE TRIGGER disposition_runs_touch BEFORE UPDATE ON public.disposition_runs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE OR REPLACE TRIGGER dm_boards_touch BEFORE UPDATE ON public.dm_boards FOR EACH ROW EXECUTE FUNCTION touch_dm_boards();

CREATE OR REPLACE TRIGGER entries_slug BEFORE INSERT ON public.entries FOR EACH ROW EXECUTE FUNCTION entries_set_slug();

CREATE OR REPLACE TRIGGER entries_updated BEFORE UPDATE ON public.entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER pc_library_set_updated_at BEFORE UPDATE ON public.pc_library FOR EACH ROW EXECUTE FUNCTION pc_library_touch_updated_at();

CREATE OR REPLACE TRIGGER pc_library_alter_ego_flat BEFORE INSERT OR UPDATE OF alter_ego_of ON public.pc_library FOR EACH ROW EXECUTE FUNCTION library_alter_ego_is_flat();

CREATE OR REPLACE TRIGGER player_notes_touch BEFORE UPDATE ON public.player_notes FOR EACH ROW EXECUTE FUNCTION touch_player_notes();

CREATE OR REPLACE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER sessions_updated BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER stat_blocks_touch BEFORE UPDATE ON public.stat_blocks FOR EACH ROW EXECUTE FUNCTION touch_stat_blocks_updated_at();

CREATE OR REPLACE TRIGGER threads_guard_character_trg BEFORE INSERT OR UPDATE ON public.threads FOR EACH ROW EXECUTE FUNCTION threads_guard_character();

CREATE OR REPLACE TRIGGER tpdi_autobind_trg BEFORE INSERT ON public.tpdi_responses FOR EACH ROW EXECUTE FUNCTION tpdi_autobind();

CREATE OR REPLACE TRIGGER addon_on_message AFTER INSERT ON public.vtt_messages FOR EACH ROW EXECUTE FUNCTION addon_on_message();


-- ================================================================================================
-- 09 rls (252)
-- ================================================================================================

alter table public.addon_hooks enable row level security;

alter table public.addon_keys enable row level security;

alter table public.addon_outbox enable row level security;

alter table public.ai_map_renders enable row level security;

alter table public.arc_touches enable row level security;

alter table public.arcs enable row level security;

alter table public.attendance enable row level security;

alter table public.audio_tracks enable row level security;

alter table public.bastion_maps enable row level security;

alter table public.battle_maps enable row level security;

alter table public.biomes enable row level security;

alter table public.building_maps enable row level security;

alter table public.campaign_journals enable row level security;

alter table public.campaigns enable row level security;

alter table public.capture_control enable row level security;

alter table public.capture_jobs enable row level security;

alter table public.character_identities enable row level security;

alter table public.character_wiki_gm_edit enable row level security;

alter table public.character_wiki_sections enable row level security;

alter table public.characters enable row level security;

alter table public.chat_grants enable row level security;

alter table public.chat_messages enable row level security;

alter table public.class_capabilities enable row level security;

alter table public.classes enable row level security;

alter table public.combats enable row level security;

alter table public.compendium_entries enable row level security;

alter table public.disposition_reveals enable row level security;

alter table public.disposition_runs enable row level security;

alter table public.dispositions enable row level security;

alter table public.dm_boards enable row level security;

alter table public.dungeon_maps enable row level security;

alter table public.encounters enable row level security;

alter table public.entity_links enable row level security;

alter table public.entries enable row level security;

alter table public.entry_reveals enable row level security;

alter table public.event_types enable row level security;

alter table public.events enable row level security;

alter table public.gm_event_kinds enable row level security;

alter table public.gm_events enable row level security;

alter table public.gm_identities enable row level security;

alter table public.gm_proposed_events enable row level security;

alter table public.import_candidates enable row level security;

alter table public.import_jobs enable row level security;

alter table public.import_sessions enable row level security;

alter table public.loot_grants enable row level security;

alter table public.lore_backup enable row level security;

alter table public.map_features enable row level security;

alter table public.map_fog enable row level security;

alter table public.map_icons enable row level security;

alter table public.map_images enable row level security;

alter table public.map_labels enable row level security;

alter table public.map_layers enable row level security;

alter table public.map_pins enable row level security;

alter table public.map_pois enable row level security;

alter table public.maps enable row level security;

alter table public.memberships enable row level security;

alter table public.party_funds enable row level security;

alter table public.party_items enable row level security;

alter table public.pc_library enable row level security;

alter table public.player_notes enable row level security;

alter table public.poll_responses enable row level security;

alter table public.profiles enable row level security;

alter table public.proposed_events enable row level security;

alter table public.recodings enable row level security;

alter table public.recording_consents enable row level security;

alter table public.regions enable row level security;

alter table public.roll_tables enable row level security;

alter table public.session_plan_items enable row level security;

alter table public.session_polls enable row level security;

alter table public.sessions enable row level security;

alter table public.species enable row level security;

alter table public.species_variants enable row level security;

alter table public.stat_blocks enable row level security;

alter table public.threads enable row level security;

alter table public.tool_render_log enable row level security;

alter table public.tpdi_responses enable row level security;

alter table public.transcript_segments enable row level security;

alter table public.vibe_checks enable row level security;

alter table public.vtt_audio enable row level security;

alter table public.vtt_cards enable row level security;

alter table public.vtt_decks enable row level security;

alter table public.vtt_drawings enable row level security;

alter table public.vtt_effects enable row level security;

alter table public.vtt_events enable row level security;

alter table public.vtt_handouts enable row level security;

alter table public.vtt_messages enable row level security;

alter table public.vtt_pins enable row level security;

alter table public.vtt_scene_players enable row level security;

alter table public.vtt_scenes enable row level security;

alter table public.vtt_sounds enable row level security;

alter table public.vtt_templates enable row level security;

alter table public.vtt_token_notes enable row level security;

alter table public.vtt_tokens enable row level security;

alter table public.world_hexes enable row level security;

alter table public.world_maps enable row level security;

drop policy if exists addon_hooks_gm on public.addon_hooks;
create policy addon_hooks_gm on public.addon_hooks for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists addon_keys_gm on public.addon_keys;
create policy addon_keys_gm on public.addon_keys for all to public using (is_campaign_gm(campaign_id)) with check ((is_campaign_gm(campaign_id) AND (created_by = auth.uid())));

drop policy if exists "ai_map_renders owner read" on public.ai_map_renders;
create policy "ai_map_renders owner read" on public.ai_map_renders for select to public using ((profile_id = auth.uid()));

drop policy if exists "gm writes arc_touches" on public.arc_touches;
create policy "gm writes arc_touches" on public.arc_touches for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "members read arc_touches" on public.arc_touches;
create policy "members read arc_touches" on public.arc_touches for select to authenticated using (is_campaign_member(campaign_id));

drop policy if exists "gm writes arcs" on public.arcs;
create policy "gm writes arcs" on public.arcs for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "members read arcs" on public.arcs;
create policy "members read arcs" on public.arcs for select to authenticated using (is_campaign_member(campaign_id));

drop policy if exists "members read attendance" on public.attendance;
create policy "members read attendance" on public.attendance for select to authenticated using (is_campaign_member(campaign_id));

drop policy if exists "gm writes attendance" on public.attendance;
create policy "gm writes attendance" on public.attendance for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "gm all audio_tracks" on public.audio_tracks;
create policy "gm all audio_tracks" on public.audio_tracks for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists bastion_maps_gm on public.bastion_maps;
create policy bastion_maps_gm on public.bastion_maps for all to public using ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = bastion_maps.campaign_id) AND (c.gm_id = auth.uid()))))) with check ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = bastion_maps.campaign_id) AND (c.gm_id = auth.uid())))));

drop policy if exists battle_maps_gm on public.battle_maps;
create policy battle_maps_gm on public.battle_maps for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "biomes readable by all" on public.biomes;
create policy "biomes readable by all" on public.biomes for select to public using (true);

drop policy if exists building_maps_gm on public.building_maps;
create policy building_maps_gm on public.building_maps for all to public using ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = building_maps.campaign_id) AND (c.gm_id = auth.uid()))))) with check ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = building_maps.campaign_id) AND (c.gm_id = auth.uid())))));

drop policy if exists "gm reads journal" on public.campaign_journals;
create policy "gm reads journal" on public.campaign_journals for select to public using (is_campaign_gm(campaign_id));

drop policy if exists "members read campaigns" on public.campaigns;
create policy "members read campaigns" on public.campaigns for select to authenticated using ((is_campaign_member(id) OR (gm_id = auth.uid())));

drop policy if exists "create own campaign" on public.campaigns;
create policy "create own campaign" on public.campaigns for insert to authenticated with check ((gm_id = auth.uid()));

drop policy if exists "gm deletes campaign" on public.campaigns;
create policy "gm deletes campaign" on public.campaigns for delete to authenticated using ((gm_id = auth.uid()));

drop policy if exists "gm manages campaign" on public.campaigns;
create policy "gm manages campaign" on public.campaigns for update to authenticated using (is_campaign_gm(id));

drop policy if exists "gm all capture_jobs" on public.capture_jobs;
create policy "gm all capture_jobs" on public.capture_jobs for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "owner inserts own identities" on public.character_identities;
create policy "owner inserts own identities" on public.character_identities for insert to public with check ((profile_id = auth.uid()));

drop policy if exists "owner reads own identities" on public.character_identities;
create policy "owner reads own identities" on public.character_identities for select to public using ((profile_id = auth.uid()));

drop policy if exists "owner updates own identities" on public.character_identities;
create policy "owner updates own identities" on public.character_identities for update to public using ((profile_id = auth.uid())) with check ((profile_id = auth.uid()));

drop policy if exists "owner deletes own identities" on public.character_identities;
create policy "owner deletes own identities" on public.character_identities for delete to public using ((profile_id = auth.uid()));

drop policy if exists "cw grant: owner grants" on public.character_wiki_gm_edit;
create policy "cw grant: owner grants" on public.character_wiki_gm_edit for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM characters ch
  WHERE ((ch.id = character_wiki_gm_edit.character_id) AND (ch.profile_id = auth.uid())))));

drop policy if exists "cw grant: read" on public.character_wiki_gm_edit;
create policy "cw grant: read" on public.character_wiki_gm_edit for select to authenticated using ((is_campaign_gm(campaign_id) OR (EXISTS ( SELECT 1
   FROM characters ch
  WHERE ((ch.id = character_wiki_gm_edit.character_id) AND (ch.profile_id = auth.uid()))))));

drop policy if exists "cw grant: owner revokes" on public.character_wiki_gm_edit;
create policy "cw grant: owner revokes" on public.character_wiki_gm_edit for delete to authenticated using ((EXISTS ( SELECT 1
   FROM characters ch
  WHERE ((ch.id = character_wiki_gm_edit.character_id) AND (ch.profile_id = auth.uid())))));

drop policy if exists "cw sections: delete" on public.character_wiki_sections;
create policy "cw sections: delete" on public.character_wiki_sections for delete to authenticated using (((owner_id = auth.uid()) OR (is_campaign_gm(campaign_id) AND (EXISTS ( SELECT 1
   FROM character_wiki_gm_edit g
  WHERE (g.character_id = character_wiki_sections.character_id))))));

drop policy if exists "cw sections: insert" on public.character_wiki_sections;
create policy "cw sections: insert" on public.character_wiki_sections for insert to authenticated with check (((owner_id = auth.uid()) OR (is_campaign_gm(campaign_id) AND (EXISTS ( SELECT 1
   FROM character_wiki_gm_edit g
  WHERE (g.character_id = character_wiki_sections.character_id))))));

drop policy if exists "cw sections: read" on public.character_wiki_sections;
create policy "cw sections: read" on public.character_wiki_sections for select to authenticated using (((owner_id = auth.uid()) OR ((visibility = 'shared'::text) AND is_campaign_gm(campaign_id))));

drop policy if exists "cw sections: update" on public.character_wiki_sections;
create policy "cw sections: update" on public.character_wiki_sections for update to authenticated using (((owner_id = auth.uid()) OR (is_campaign_gm(campaign_id) AND (EXISTS ( SELECT 1
   FROM character_wiki_gm_edit g
  WHERE (g.character_id = character_wiki_sections.character_id))))));

drop policy if exists "owner or gm adds character" on public.characters;
create policy "owner or gm adds character" on public.characters for insert to authenticated with check ((is_campaign_gm(campaign_id) OR ((profile_id = auth.uid()) AND is_campaign_member(campaign_id))));

drop policy if exists "members read characters" on public.characters;
create policy "members read characters" on public.characters for select to public using ((is_campaign_member(campaign_id) OR (profile_id = auth.uid())));

drop policy if exists "owner or gm edits character" on public.characters;
create policy "owner or gm edits character" on public.characters for update to authenticated using ((is_campaign_gm(campaign_id) OR (profile_id = auth.uid())));

drop policy if exists "read class_capabilities" on public.class_capabilities;
create policy "read class_capabilities" on public.class_capabilities for select to authenticated using (true);

drop policy if exists "read classes" on public.classes;
create policy "read classes" on public.classes for select to anon, authenticated using (true);

drop policy if exists "gm all combats" on public.combats;
create policy "gm all combats" on public.combats for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "own compendium entries only" on public.compendium_entries;
create policy "own compendium entries only" on public.compendium_entries for all to public using ((gm_id = auth.uid())) with check ((gm_id = auth.uid()));

drop policy if exists "reveal: gm reads" on public.disposition_reveals;
create policy "reveal: gm reads" on public.disposition_reveals for select to authenticated using ((EXISTS ( SELECT 1
   FROM (characters ch
     JOIN campaigns c ON ((c.id = ch.campaign_id)))
  WHERE ((ch.profile_id = disposition_reveals.profile_id) AND (c.gm_id = auth.uid())))));

drop policy if exists "reveal: gm revokes" on public.disposition_reveals;
create policy "reveal: gm revokes" on public.disposition_reveals for delete to authenticated using ((EXISTS ( SELECT 1
   FROM (characters ch
     JOIN campaigns c ON ((c.id = ch.campaign_id)))
  WHERE ((ch.profile_id = disposition_reveals.profile_id) AND (c.gm_id = auth.uid())))));

drop policy if exists "reveal: player reads own" on public.disposition_reveals;
create policy "reveal: player reads own" on public.disposition_reveals for select to authenticated using ((profile_id = auth.uid()));

drop policy if exists "reveal: gm grants" on public.disposition_reveals;
create policy "reveal: gm grants" on public.disposition_reveals for insert to authenticated with check (((revealed_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (characters ch
     JOIN campaigns c ON ((c.id = ch.campaign_id)))
  WHERE ((ch.profile_id = disposition_reveals.profile_id) AND (c.gm_id = auth.uid()))))));

drop policy if exists disposition_runs_gm_read on public.disposition_runs;
create policy disposition_runs_gm_read on public.disposition_runs for select to public using (is_campaign_gm(campaign_id));

drop policy if exists "dispositions: player scope" on public.dispositions;
create policy "dispositions: player scope" on public.dispositions for select to authenticated using (((scope = 'player'::text) AND ((EXISTS ( SELECT 1
   FROM (characters ch
     JOIN campaigns c ON ((c.id = ch.campaign_id)))
  WHERE ((ch.profile_id = dispositions.profile_id) AND (c.gm_id = auth.uid())))) OR ((profile_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM disposition_reveals r
  WHERE (r.profile_id = auth.uid())))))));

drop policy if exists "dispositions: character scope" on public.dispositions;
create policy "dispositions: character scope" on public.dispositions for select to authenticated using (((scope = 'character'::text) AND ((profile_id = auth.uid()) OR ((campaign_id IS NOT NULL) AND is_campaign_gm(campaign_id)))));

drop policy if exists "self writes own disposition" on public.dispositions;
create policy "self writes own disposition" on public.dispositions for insert to authenticated with check ((profile_id = auth.uid()));

drop policy if exists "own dm boards only" on public.dm_boards;
create policy "own dm boards only" on public.dm_boards for all to public using ((gm_id = auth.uid())) with check ((gm_id = auth.uid()));

drop policy if exists dungeon_maps_gm on public.dungeon_maps;
create policy dungeon_maps_gm on public.dungeon_maps for all to public using ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = dungeon_maps.campaign_id) AND (c.gm_id = auth.uid()))))) with check ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = dungeon_maps.campaign_id) AND (c.gm_id = auth.uid())))));

drop policy if exists "gm all encounters" on public.encounters;
create policy "gm all encounters" on public.encounters for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "player reads own character links" on public.entity_links;
create policy "player reads own character links" on public.entity_links for select to authenticated using ((can_write_character_portrait((source_id)::text) OR can_write_character_portrait((target_id)::text)));

drop policy if exists "player unlinks from own character" on public.entity_links;
create policy "player unlinks from own character" on public.entity_links for delete to authenticated using (((source_type = 'character'::text) AND can_write_character_portrait((source_id)::text)));

drop policy if exists "gm reads links" on public.entity_links;
create policy "gm reads links" on public.entity_links for select to authenticated using (is_campaign_gm(campaign_id));

drop policy if exists "gm writes links" on public.entity_links;
create policy "gm writes links" on public.entity_links for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "player links from own character" on public.entity_links;
create policy "player links from own character" on public.entity_links for insert to authenticated with check (((source_type = 'character'::text) AND can_write_character_portrait((source_id)::text)));

drop policy if exists "gm writes entries" on public.entries;
create policy "gm writes entries" on public.entries for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "author writes own entries" on public.entries;
create policy "author writes own entries" on public.entries for all to authenticated using (((created_by = auth.uid()) AND is_campaign_member(campaign_id))) with check (((created_by = auth.uid()) AND is_campaign_member(campaign_id)));

drop policy if exists "read entries" on public.entries;
create policy "read entries" on public.entries for select to authenticated using ((((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND is_campaign_member(campaign_id)) OR ((visibility = 'gm'::text) AND is_campaign_gm(campaign_id)) OR ((visibility = 'private'::text) AND (created_by = auth.uid()))));

drop policy if exists "gm all reveals" on public.entry_reveals;
create policy "gm all reveals" on public.entry_reveals for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "read event_types" on public.event_types;
create policy "read event_types" on public.event_types for select to authenticated using (true);

drop policy if exists "members read events" on public.events;
create policy "members read events" on public.events for select to authenticated using (is_campaign_member(campaign_id));

drop policy if exists "gm writes events" on public.events;
create policy "gm writes events" on public.events for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists gm_event_kinds_read on public.gm_event_kinds;
create policy gm_event_kinds_read on public.gm_event_kinds for select to authenticated using (true);

drop policy if exists gm_events_select_own on public.gm_events;
create policy gm_events_select_own on public.gm_events for select to public using ((campaign_id IN ( SELECT campaigns.id
   FROM campaigns
  WHERE (campaigns.gm_id = auth.uid()))));

drop policy if exists gm_proposed_events_select_own on public.gm_proposed_events;
create policy gm_proposed_events_select_own on public.gm_proposed_events for select to public using ((campaign_id IN ( SELECT campaigns.id
   FROM campaigns
  WHERE (campaigns.gm_id = auth.uid()))));

drop policy if exists "import_candidates: gm all" on public.import_candidates;
create policy "import_candidates: gm all" on public.import_candidates for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "import_jobs: gm all" on public.import_jobs;
create policy "import_jobs: gm all" on public.import_jobs for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "import_sessions: gm all" on public.import_sessions;
create policy "import_sessions: gm all" on public.import_sessions for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "members read loot" on public.loot_grants;
create policy "members read loot" on public.loot_grants for select to authenticated using (is_campaign_member(campaign_id));

drop policy if exists "gm writes loot" on public.loot_grants;
create policy "gm writes loot" on public.loot_grants for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "map_features gm all" on public.map_features;
create policy "map_features gm all" on public.map_features for all to public using ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_features.world_map_id) AND (c.gm_id = auth.uid()))))) with check ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_features.world_map_id) AND (c.gm_id = auth.uid())))));

drop policy if exists "gm all map fog" on public.map_fog;
create policy "gm all map fog" on public.map_fog for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "members read map fog" on public.map_fog;
create policy "members read map fog" on public.map_fog for select to authenticated using (is_campaign_member(campaign_id));

drop policy if exists "map_icons gm all" on public.map_icons;
create policy "map_icons gm all" on public.map_icons for all to public using ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = map_icons.campaign_id) AND (c.gm_id = ( SELECT auth.uid() AS uid)))))) with check ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = map_icons.campaign_id) AND (c.gm_id = ( SELECT auth.uid() AS uid))))));

drop policy if exists "map_images gm all" on public.map_images;
create policy "map_images gm all" on public.map_images for all to public using ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_images.world_map_id) AND (c.gm_id = ( SELECT auth.uid() AS uid)))))) with check ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_images.world_map_id) AND (c.gm_id = ( SELECT auth.uid() AS uid))))));

drop policy if exists map_labels_gm_all on public.map_labels;
create policy map_labels_gm_all on public.map_labels for all to public using ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_labels.world_map_id) AND (c.gm_id = auth.uid()))))) with check ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_labels.world_map_id) AND (c.gm_id = auth.uid())))));

drop policy if exists "map_layers gm all" on public.map_layers;
create policy "map_layers gm all" on public.map_layers for all to public using ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_layers.world_map_id) AND (c.gm_id = ( SELECT auth.uid() AS uid)))))) with check ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_layers.world_map_id) AND (c.gm_id = ( SELECT auth.uid() AS uid))))));

drop policy if exists "gm all pins" on public.map_pins;
create policy "gm all pins" on public.map_pins for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "map_pois member delete when open" on public.map_pois;
create policy "map_pois member delete when open" on public.map_pois for delete to public using (((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND (EXISTS ( SELECT 1
   FROM world_maps wm
  WHERE ((wm.id = map_pois.world_map_id) AND (wm.editable_by = 'party'::text) AND is_campaign_member(wm.campaign_id))))));

drop policy if exists "map_pois member insert when open" on public.map_pois;
create policy "map_pois member insert when open" on public.map_pois for insert to public with check (((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND (EXISTS ( SELECT 1
   FROM world_maps wm
  WHERE ((wm.id = map_pois.world_map_id) AND (wm.editable_by = 'party'::text) AND is_campaign_member(wm.campaign_id))))));

drop policy if exists "map_pois member read visible" on public.map_pois;
create policy "map_pois member read visible" on public.map_pois for select to public using (((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND (EXISTS ( SELECT 1
   FROM world_maps wm
  WHERE ((wm.id = map_pois.world_map_id) AND is_campaign_member(wm.campaign_id))))));

drop policy if exists "map_pois member update when open" on public.map_pois;
create policy "map_pois member update when open" on public.map_pois for update to public using (((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND (EXISTS ( SELECT 1
   FROM world_maps wm
  WHERE ((wm.id = map_pois.world_map_id) AND (wm.editable_by = 'party'::text) AND is_campaign_member(wm.campaign_id)))))) with check (((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND (EXISTS ( SELECT 1
   FROM world_maps wm
  WHERE ((wm.id = map_pois.world_map_id) AND (wm.editable_by = 'party'::text) AND is_campaign_member(wm.campaign_id))))));

drop policy if exists "map_pois gm all" on public.map_pois;
create policy "map_pois gm all" on public.map_pois for all to public using ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_pois.world_map_id) AND (c.gm_id = ( SELECT auth.uid() AS uid)))))) with check ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_pois.world_map_id) AND (c.gm_id = ( SELECT auth.uid() AS uid))))));

drop policy if exists "gm all maps" on public.maps;
create policy "gm all maps" on public.maps for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "see relevant memberships" on public.memberships;
create policy "see relevant memberships" on public.memberships for select to authenticated using (((profile_id = auth.uid()) OR is_campaign_member(campaign_id)));

drop policy if exists "gm or self updates membership" on public.memberships;
create policy "gm or self updates membership" on public.memberships for update to authenticated using ((is_campaign_gm(campaign_id) OR (profile_id = auth.uid())));

drop policy if exists "gm or self removes membership" on public.memberships;
create policy "gm or self removes membership" on public.memberships for delete to authenticated using ((is_campaign_gm(campaign_id) OR (profile_id = auth.uid())));

drop policy if exists "gm adds members" on public.memberships;
create policy "gm adds members" on public.memberships for insert to authenticated with check (is_campaign_gm(campaign_id));

drop policy if exists party_funds_read on public.party_funds;
create policy party_funds_read on public.party_funds for select to public using ((is_campaign_gm(campaign_id) OR tabletop_is_player(campaign_id)));

drop policy if exists party_items_table on public.party_items;
create policy party_items_table on public.party_items for all to public using ((is_campaign_gm(campaign_id) OR tabletop_is_player(campaign_id))) with check ((is_campaign_gm(campaign_id) OR tabletop_is_player(campaign_id)));

drop policy if exists "owner reads own library" on public.pc_library;
create policy "owner reads own library" on public.pc_library for select to public using ((profile_id = auth.uid()));

drop policy if exists "owner deletes own library" on public.pc_library;
create policy "owner deletes own library" on public.pc_library for delete to public using ((profile_id = auth.uid()));

drop policy if exists "owner inserts own library" on public.pc_library;
create policy "owner inserts own library" on public.pc_library for insert to public with check ((profile_id = auth.uid()));

drop policy if exists "owner updates own library" on public.pc_library;
create policy "owner updates own library" on public.pc_library for update to public using ((profile_id = auth.uid())) with check ((profile_id = auth.uid()));

drop policy if exists "own notes only" on public.player_notes;
create policy "own notes only" on public.player_notes for all to public using ((profile_id = auth.uid())) with check ((profile_id = auth.uid()));

drop policy if exists "gm reads poll responses" on public.poll_responses;
create policy "gm reads poll responses" on public.poll_responses for select to public using ((EXISTS ( SELECT 1
   FROM session_polls p
  WHERE ((p.id = poll_responses.poll_id) AND is_campaign_gm(p.campaign_id)))));

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using ((id = auth.uid()));

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using ((id = auth.uid()));

drop policy if exists "gm all proposed_events" on public.proposed_events;
create policy "gm all proposed_events" on public.proposed_events for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "gm all recodings" on public.recodings;
create policy "gm all recodings" on public.recodings for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "gm writes consents" on public.recording_consents;
create policy "gm writes consents" on public.recording_consents for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "members read consents" on public.recording_consents;
create policy "members read consents" on public.recording_consents for select to authenticated using (is_campaign_member(campaign_id));

drop policy if exists "regions gm all" on public.regions;
create policy "regions gm all" on public.regions for all to public using ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = regions.world_map_id) AND (c.gm_id = ( SELECT auth.uid() AS uid)))))) with check ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = regions.world_map_id) AND (c.gm_id = ( SELECT auth.uid() AS uid))))));

drop policy if exists roll_tables_gm on public.roll_tables;
create policy roll_tables_gm on public.roll_tables for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists roll_tables_player_read on public.roll_tables;
create policy roll_tables_player_read on public.roll_tables for select to public using ((players_can_roll AND tabletop_is_player(campaign_id)));

drop policy if exists "gm all plan items" on public.session_plan_items;
create policy "gm all plan items" on public.session_plan_items for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "gm reads polls" on public.session_polls;
create policy "gm reads polls" on public.session_polls for select to public using (is_campaign_gm(campaign_id));

drop policy if exists "members read sessions" on public.sessions;
create policy "members read sessions" on public.sessions for select to authenticated using (is_campaign_member(campaign_id));

drop policy if exists "gm writes sessions" on public.sessions;
create policy "gm writes sessions" on public.sessions for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "read species" on public.species;
create policy "read species" on public.species for select to anon, authenticated using (true);

drop policy if exists "read species_variants" on public.species_variants;
create policy "read species_variants" on public.species_variants for select to anon, authenticated using (true);

drop policy if exists "gm manages own stat blocks" on public.stat_blocks;
create policy "gm manages own stat blocks" on public.stat_blocks for all to public using (((gm_id = auth.uid()) OR ((campaign_id IS NOT NULL) AND is_campaign_gm(campaign_id)))) with check (((gm_id = auth.uid()) OR ((campaign_id IS NOT NULL) AND is_campaign_gm(campaign_id))));

drop policy if exists "members read pinned stat blocks" on public.stat_blocks;
create policy "members read pinned stat blocks" on public.stat_blocks for select to public using (((campaign_id IS NOT NULL) AND is_campaign_member(campaign_id)));

drop policy if exists threads_select_own on public.threads;
create policy threads_select_own on public.threads for select to public using ((profile_id = auth.uid()));

drop policy if exists threads_update_own on public.threads;
create policy threads_update_own on public.threads for update to public using ((profile_id = auth.uid())) with check ((profile_id = auth.uid()));

drop policy if exists threads_insert_own on public.threads;
create policy threads_insert_own on public.threads for insert to public with check ((profile_id = auth.uid()));

drop policy if exists threads_delete_own on public.threads;
create policy threads_delete_own on public.threads for delete to public using ((profile_id = auth.uid()));

drop policy if exists "gm reads campaign responses" on public.tpdi_responses;
create policy "gm reads campaign responses" on public.tpdi_responses for select to authenticated using (((campaign_id IS NOT NULL) AND is_campaign_gm(campaign_id)));

drop policy if exists "insert own responses" on public.tpdi_responses;
create policy "insert own responses" on public.tpdi_responses for insert to anon, authenticated with check ((respondent_id = ( SELECT auth.uid() AS uid)));

drop policy if exists "read own responses" on public.tpdi_responses;
create policy "read own responses" on public.tpdi_responses for select to anon, authenticated using ((respondent_id = ( SELECT auth.uid() AS uid)));

drop policy if exists "update own responses" on public.tpdi_responses;
create policy "update own responses" on public.tpdi_responses for update to anon, authenticated using ((respondent_id = ( SELECT auth.uid() AS uid))) with check ((respondent_id = ( SELECT auth.uid() AS uid)));

drop policy if exists "gm all transcript_segments" on public.transcript_segments;
create policy "gm all transcript_segments" on public.transcript_segments for all to authenticated using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "self or gm reads vibe" on public.vibe_checks;
create policy "self or gm reads vibe" on public.vibe_checks for select to authenticated using (((profile_id = auth.uid()) OR is_campaign_gm(campaign_id)));

drop policy if exists "self updates vibe" on public.vibe_checks;
create policy "self updates vibe" on public.vibe_checks for update to authenticated using ((profile_id = auth.uid()));

drop policy if exists "self writes vibe" on public.vibe_checks;
create policy "self writes vibe" on public.vibe_checks for insert to authenticated with check (((profile_id = auth.uid()) AND is_campaign_member(campaign_id)));

drop policy if exists vtt_audio_player_read on public.vtt_audio;
create policy vtt_audio_player_read on public.vtt_audio for select to public using (tabletop_is_player(campaign_id));

drop policy if exists vtt_audio_gm_read on public.vtt_audio;
create policy vtt_audio_gm_read on public.vtt_audio for select to public using (is_campaign_gm(campaign_id));

drop policy if exists vtt_cards_gm on public.vtt_cards;
create policy vtt_cards_gm on public.vtt_cards for all to public using (is_campaign_gm(campaign_id)) with check ((is_campaign_gm(campaign_id) AND (EXISTS ( SELECT 1
   FROM vtt_decks d
  WHERE ((d.id = vtt_cards.deck_id) AND (d.campaign_id = vtt_cards.campaign_id))))));

drop policy if exists vtt_decks_gm on public.vtt_decks;
create policy vtt_decks_gm on public.vtt_decks for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists vtt_drawings_gm on public.vtt_drawings;
create policy vtt_drawings_gm on public.vtt_drawings for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists vtt_drawings_player_update on public.vtt_drawings;
create policy vtt_drawings_player_update on public.vtt_drawings for update to public using (((owner = auth.uid()) AND (layer = 'table'::text) AND tabletop_is_player(campaign_id))) with check (((owner = auth.uid()) AND (layer = 'table'::text) AND tabletop_is_player(campaign_id)));

drop policy if exists vtt_drawings_player_read on public.vtt_drawings;
create policy vtt_drawings_player_read on public.vtt_drawings for select to public using (((layer = 'table'::text) AND tabletop_is_player(campaign_id) AND (scene_id = tabletop_scene_for(campaign_id, auth.uid()))));

drop policy if exists vtt_drawings_player_insert on public.vtt_drawings;
create policy vtt_drawings_player_insert on public.vtt_drawings for insert to public with check (((owner = auth.uid()) AND (layer = 'table'::text) AND tabletop_is_player(campaign_id) AND (scene_id = tabletop_scene_for(campaign_id, auth.uid()))));

drop policy if exists vtt_drawings_player_delete on public.vtt_drawings;
create policy vtt_drawings_player_delete on public.vtt_drawings for delete to public using (((owner = auth.uid()) AND tabletop_is_player(campaign_id)));

drop policy if exists vtt_effects_player_delete on public.vtt_effects;
create policy vtt_effects_player_delete on public.vtt_effects for delete to public using (((owner = auth.uid()) AND tabletop_is_player(campaign_id)));

drop policy if exists vtt_effects_gm on public.vtt_effects;
create policy vtt_effects_gm on public.vtt_effects for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists vtt_effects_player_read on public.vtt_effects;
create policy vtt_effects_player_read on public.vtt_effects for select to public using ((tabletop_is_player(campaign_id) AND tabletop_token_seen(token_id)));

drop policy if exists vtt_effects_player_insert on public.vtt_effects;
create policy vtt_effects_player_insert on public.vtt_effects for insert to public with check (((owner = auth.uid()) AND tabletop_is_player(campaign_id) AND tabletop_token_seen(token_id) AND (scene_id = ( SELECT t.scene_id
   FROM vtt_tokens t
  WHERE (t.id = vtt_effects.token_id)))));

drop policy if exists "gm reads vtt events" on public.vtt_events;
create policy "gm reads vtt events" on public.vtt_events for select to public using ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = vtt_events.campaign_id) AND (c.gm_id = auth.uid())))));

drop policy if exists vtt_handouts_gm on public.vtt_handouts;
create policy vtt_handouts_gm on public.vtt_handouts for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists vtt_messages_read on public.vtt_messages;
create policy vtt_messages_read on public.vtt_messages for select to public using (((author_profile = auth.uid()) OR ((whisper_to IS NOT NULL) AND (auth.uid() = ANY (whisper_to))) OR ((whisper_to IS NULL) AND is_campaign_gm(campaign_id)) OR ((whisper_to IS NULL) AND (NOT gm_only) AND tabletop_is_player(campaign_id))));

drop policy if exists vtt_messages_gm_delete on public.vtt_messages;
create policy vtt_messages_gm_delete on public.vtt_messages for delete to public using (is_campaign_gm(campaign_id));

drop policy if exists vtt_pins_gm on public.vtt_pins;
create policy vtt_pins_gm on public.vtt_pins for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists vtt_scene_players_own on public.vtt_scene_players;
create policy vtt_scene_players_own on public.vtt_scene_players for select to public using ((profile_id = auth.uid()));

drop policy if exists vtt_scene_players_gm on public.vtt_scene_players;
create policy vtt_scene_players_gm on public.vtt_scene_players for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists vtt_scenes_gm on public.vtt_scenes;
create policy vtt_scenes_gm on public.vtt_scenes for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists vtt_scenes_player_read on public.vtt_scenes;
create policy vtt_scenes_player_read on public.vtt_scenes for select to public using (tabletop_is_player(campaign_id));

drop policy if exists vtt_sounds_gm on public.vtt_sounds;
create policy vtt_sounds_gm on public.vtt_sounds for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists vtt_templates_gm on public.vtt_templates;
create policy vtt_templates_gm on public.vtt_templates for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists vtt_templates_player_update on public.vtt_templates;
create policy vtt_templates_player_update on public.vtt_templates for update to public using (((owner = auth.uid()) AND tabletop_is_player(campaign_id))) with check (((owner = auth.uid()) AND tabletop_is_player(campaign_id) AND (scene_id = tabletop_scene_for(campaign_id, auth.uid()))));

drop policy if exists vtt_templates_player_read on public.vtt_templates;
create policy vtt_templates_player_read on public.vtt_templates for select to public using ((tabletop_is_player(campaign_id) AND (scene_id = tabletop_scene_for(campaign_id, auth.uid()))));

drop policy if exists vtt_templates_player_insert on public.vtt_templates;
create policy vtt_templates_player_insert on public.vtt_templates for insert to public with check (((owner = auth.uid()) AND tabletop_is_player(campaign_id) AND (scene_id = tabletop_scene_for(campaign_id, auth.uid()))));

drop policy if exists vtt_templates_player_delete on public.vtt_templates;
create policy vtt_templates_player_delete on public.vtt_templates for delete to public using (((owner = auth.uid()) AND tabletop_is_player(campaign_id)));

drop policy if exists vtt_token_notes_gm on public.vtt_token_notes;
create policy vtt_token_notes_gm on public.vtt_token_notes for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists vtt_tokens_player_read on public.vtt_tokens;
create policy vtt_tokens_player_read on public.vtt_tokens for select to public using ((tabletop_is_player(campaign_id) AND (NOT hidden) AND (layer <> 'gm'::text) AND (scene_id = tabletop_scene_for(campaign_id, auth.uid())) AND tabletop_token_visible(scene_id, x, y, character_id, controlled_by)));

drop policy if exists vtt_tokens_gm on public.vtt_tokens;
create policy vtt_tokens_gm on public.vtt_tokens for all to public using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "world_hexes gm all" on public.world_hexes;
create policy "world_hexes gm all" on public.world_hexes for all to public using ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = world_hexes.world_map_id) AND (c.gm_id = ( SELECT auth.uid() AS uid)))))) with check ((EXISTS ( SELECT 1
   FROM (world_maps wm
     JOIN campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = world_hexes.world_map_id) AND (c.gm_id = ( SELECT auth.uid() AS uid))))));

drop policy if exists "world_maps gm all" on public.world_maps;
create policy "world_maps gm all" on public.world_maps for all to public using ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = world_maps.campaign_id) AND (c.gm_id = ( SELECT auth.uid() AS uid)))))) with check ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = world_maps.campaign_id) AND (c.gm_id = ( SELECT auth.uid() AS uid))))));


-- ================================================================================================
-- 10 grants (294)
-- ================================================================================================

grant delete, insert, references, select, trigger, truncate, update on public.addon_hooks to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.addon_hooks to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.addon_keys to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.addon_keys to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.addon_outbox to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.ai_map_renders to anon;

grant delete, insert, references, select, trigger, truncate, update on public.ai_map_renders to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.ai_map_renders to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.arc_touches to anon;

grant delete, insert, references, select, trigger, truncate, update on public.arc_touches to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.arc_touches to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.arcs to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.arcs to anon;

grant delete, insert, references, select, trigger, truncate, update on public.arcs to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.attendance to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.attendance to anon;

grant delete, insert, references, select, trigger, truncate, update on public.attendance to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.audio_tracks to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.audio_tracks to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.audio_tracks to anon;

grant delete, insert, references, select, trigger, truncate, update on public.bastion_maps to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.bastion_maps to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.bastion_maps to anon;

grant delete, insert, references, select, trigger, truncate, update on public.battle_maps to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.battle_maps to anon;

grant delete, insert, references, select, trigger, truncate, update on public.battle_maps to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.biomes to anon;

grant delete, insert, references, select, trigger, truncate, update on public.biomes to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.biomes to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.building_maps to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.building_maps to anon;

grant delete, insert, references, select, trigger, truncate, update on public.building_maps to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.campaign_journals to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.campaign_journals to anon;

grant delete, insert, references, select, trigger, truncate, update on public.campaign_journals to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.campaigns to anon;

grant delete, insert, references, select, trigger, truncate, update on public.campaigns to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.campaigns to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.capture_control to anon;

grant delete, insert, references, select, trigger, truncate, update on public.capture_control to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.capture_control to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.capture_jobs to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.capture_jobs to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.capture_jobs to anon;

grant delete, insert, references, select, trigger, truncate, update on public.character_identities to anon;

grant delete, insert, references, select, trigger, truncate, update on public.character_identities to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.character_identities to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.character_wiki_gm_edit to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.character_wiki_gm_edit to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.character_wiki_gm_edit to anon;

grant delete, insert, references, select, trigger, truncate, update on public.character_wiki_sections to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.character_wiki_sections to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.character_wiki_sections to anon;

grant delete, insert, references, select, trigger, truncate, update on public.characters to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.characters to anon;

grant delete, insert, references, select, trigger, truncate, update on public.characters to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.chat_grants to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.chat_grants to anon;

grant delete, insert, references, select, trigger, truncate, update on public.chat_grants to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.chat_messages to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.chat_messages to anon;

grant delete, insert, references, select, trigger, truncate, update on public.chat_messages to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.class_capabilities to anon;

grant delete, insert, references, select, trigger, truncate, update on public.class_capabilities to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.class_capabilities to service_role;

grant select on public.classes to authenticated;

grant select on public.classes to anon;

grant delete, insert, references, select, trigger, truncate, update on public.classes to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.combats to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.combats to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.combats to anon;

grant delete, insert, references, select, trigger, truncate, update on public.compendium_entries to anon;

grant delete, insert, references, select, trigger, truncate, update on public.compendium_entries to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.compendium_entries to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.disposition_reveals to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.disposition_reveals to anon;

grant delete, insert, references, select, trigger, truncate, update on public.disposition_reveals to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.disposition_runs to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.disposition_runs to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.disposition_runs to anon;

grant delete, insert, references, select, trigger, truncate, update on public.dispositions to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.dispositions to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.dispositions to anon;

grant delete, insert, references, select, trigger, truncate, update on public.dm_boards to anon;

grant delete, insert, references, select, trigger, truncate, update on public.dm_boards to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.dm_boards to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.dungeon_maps to anon;

grant delete, insert, references, select, trigger, truncate, update on public.dungeon_maps to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.dungeon_maps to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.encounters to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.encounters to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.encounters to anon;

grant delete, insert, references, select, trigger, truncate, update on public.entity_links to anon;

grant delete, insert, references, select, trigger, truncate, update on public.entity_links to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.entity_links to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.entries to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.entries to anon;

grant delete, insert, references, select, trigger, truncate, update on public.entries to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.entry_reveals to anon;

grant delete, insert, references, select, trigger, truncate, update on public.entry_reveals to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.entry_reveals to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.event_types to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.event_types to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.event_types to anon;

grant delete, insert, references, select, trigger, truncate, update on public.events to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.events to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.events to anon;

grant delete, insert, references, select, trigger, truncate, update on public.gm_event_kinds to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.gm_event_kinds to anon;

grant delete, insert, references, select, trigger, truncate, update on public.gm_event_kinds to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.gm_events to anon;

grant delete, insert, references, select, trigger, truncate, update on public.gm_events to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.gm_events to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.gm_identities to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.gm_identities to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.gm_identities to anon;

grant delete, insert, references, select, trigger, truncate, update on public.gm_proposed_events to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.gm_proposed_events to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.gm_proposed_events to anon;

grant delete, insert, references, select, trigger, truncate, update on public.import_candidates to anon;

grant delete, insert, references, select, trigger, truncate, update on public.import_candidates to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.import_candidates to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.import_jobs to anon;

grant delete, insert, references, select, trigger, truncate, update on public.import_jobs to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.import_jobs to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.import_sessions to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.import_sessions to anon;

grant delete, insert, references, select, trigger, truncate, update on public.import_sessions to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.loot_grants to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.loot_grants to anon;

grant delete, insert, references, select, trigger, truncate, update on public.loot_grants to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.lore_backup to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.lore_backup to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.lore_backup to anon;

grant delete, insert, references, select, trigger, truncate, update on public.map_features to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.map_features to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.map_features to anon;

grant delete, insert, references, select, trigger, truncate, update on public.map_fog to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.map_fog to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.map_fog to anon;

grant delete, insert, references, select, trigger, truncate, update on public.map_icons to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.map_icons to anon;

grant delete, insert, references, select, trigger, truncate, update on public.map_icons to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.map_images to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.map_images to anon;

grant delete, insert, references, select, trigger, truncate, update on public.map_images to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.map_labels to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.map_labels to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.map_labels to anon;

grant delete, insert, references, select, trigger, truncate, update on public.map_layers to anon;

grant delete, insert, references, select, trigger, truncate, update on public.map_layers to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.map_layers to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.map_pins to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.map_pins to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.map_pins to anon;

grant delete, insert, references, select, trigger, truncate, update on public.map_pois to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.map_pois to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.map_pois to anon;

grant delete, insert, references, select, trigger, truncate, update on public.maps to anon;

grant delete, insert, references, select, trigger, truncate, update on public.maps to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.maps to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.memberships to anon;

grant delete, insert, references, select, trigger, truncate, update on public.memberships to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.memberships to authenticated;

grant references, select, trigger, truncate on public.party_funds to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.party_funds to anon;

grant delete, insert, references, select, trigger, truncate, update on public.party_funds to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.party_items to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.party_items to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.party_items to anon;

grant delete, insert, references, select, trigger, truncate, update on public.pc_library to anon;

grant delete, insert, references, select, trigger, truncate, update on public.pc_library to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.pc_library to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.player_notes to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.player_notes to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.player_notes to anon;

grant delete, insert, references, select, trigger, truncate, update on public.poll_responses to anon;

grant delete, insert, references, select, trigger, truncate, update on public.poll_responses to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.poll_responses to service_role;

grant delete, insert, references, trigger, truncate, update on public.profiles to anon;

grant delete, insert, references, trigger, truncate, update on public.profiles to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.profiles to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.profiles_public to service_role;

grant select on public.profiles_public to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.proposed_events to anon;

grant delete, insert, references, select, trigger, truncate, update on public.proposed_events to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.proposed_events to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.recodings to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.recodings to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.recodings to anon;

grant delete, insert, references, select, trigger, truncate, update on public.recording_consents to anon;

grant delete, insert, references, select, trigger, truncate, update on public.recording_consents to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.recording_consents to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.regions to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.regions to anon;

grant delete, insert, references, select, trigger, truncate, update on public.regions to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.roll_tables to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.roll_tables to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.session_plan_items to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.session_plan_items to anon;

grant delete, insert, references, select, trigger, truncate, update on public.session_plan_items to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.session_polls to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.session_polls to anon;

grant delete, insert, references, select, trigger, truncate, update on public.session_polls to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.sessions to anon;

grant delete, insert, references, select, trigger, truncate, update on public.sessions to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.sessions to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.species to service_role;

grant select on public.species to authenticated;

grant select on public.species to anon;

grant select on public.species_variants to anon;

grant delete, insert, references, select, trigger, truncate, update on public.species_variants to service_role;

grant select on public.species_variants to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.stat_blocks to anon;

grant delete, insert, references, select, trigger, truncate, update on public.stat_blocks to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.stat_blocks to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.threads to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.threads to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.threads to anon;

grant delete, insert, references, select, trigger, truncate, update on public.tool_render_log to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.tool_render_log to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.tool_render_log to anon;

grant delete, insert, references, select, trigger, truncate, update on public.tpdi_responses to anon;

grant delete, insert, references, select, trigger, truncate, update on public.tpdi_responses to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.tpdi_responses to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.transcript_segments to anon;

grant delete, insert, references, select, trigger, truncate, update on public.transcript_segments to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.transcript_segments to authenticated;

grant select on public.v_arc_freshness to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.v_arc_freshness to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.v_audio_due_for_purge to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.v_campaign_audio_retention to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.v_campaign_audio_retention to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.v_character_catalog_audit to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.v_character_catalog_audit to anon;

grant delete, insert, references, select, trigger, truncate, update on public.v_character_catalog_audit to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.v_loot_fairness to service_role;

grant select on public.v_loot_fairness to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.v_session_axis_engagement to service_role;

grant select on public.v_session_axis_engagement to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.v_session_equity to service_role;

grant select on public.v_session_equity to authenticated;

grant select on public.v_session_gini to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.v_session_gini to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.v_session_spotlight to service_role;

grant select on public.v_session_spotlight to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vibe_checks to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vibe_checks to anon;

grant delete, insert, references, select, trigger, truncate, update on public.vibe_checks to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_audio to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_audio to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_cards to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_cards to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_decks to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_decks to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_drawings to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_drawings to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_drawings to anon;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_effects to anon;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_effects to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_effects to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_events to anon;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_events to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_events to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_handouts to anon;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_handouts to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_handouts to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_messages to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_messages to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_messages to anon;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_pins to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_pins to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_scene_players to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_scene_players to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_scene_players to anon;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_scenes to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_scenes to anon;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_scenes to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_sounds to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_sounds to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_templates to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_templates to anon;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_templates to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_token_notes to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_token_notes to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_tokens to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_tokens to anon;

grant delete, insert, references, select, trigger, truncate, update on public.vtt_tokens to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.world_hexes to anon;

grant delete, insert, references, select, trigger, truncate, update on public.world_hexes to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.world_hexes to service_role;

grant delete, insert, references, select, trigger, truncate, update on public.world_maps to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.world_maps to anon;

grant delete, insert, references, select, trigger, truncate, update on public.world_maps to service_role;


reset check_function_bodies;
