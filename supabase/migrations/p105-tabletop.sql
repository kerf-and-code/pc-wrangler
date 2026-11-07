-- p105-tabletop.sql
--
-- The tabletop, phase 1 (2026-11-06): a battle map level put on a shared table, tokens on it, and a
-- table chat that carries rolls. Facts this file relies on were read live first
-- (supabase/checks/p105-tabletop-precheck.sql and -2.sql):
--
--   * Players have NO memberships rows. is_campaign_member() is false for every player, so each
--     player-facing rule below goes through tabletop_is_player() (owns a pc in the campaign), the
--     same test my_campaigns() uses. Realtime applies table RLS directly, so the policies, not just
--     the functions, must admit players or they get no live updates.
--   * Players cannot read campaigns, sessions, battle_maps or vtt_events directly. Everything the
--     player view needs comes through SECURITY DEFINER functions here, which strip what players must
--     not see (hidden tokens, the GM layer, secret doors, GM labels) before it leaves the database.
--   * The open session is the newest one with ended_at null, exactly as /api/vtt/ingest picks it, so
--     table rolls and D&D Beyond rolls land in the same session.
--   * Party chat (chat_messages, /chat) is players only by design (p81) and is NOT touched. Table chat
--     is spoken to the whole table, GM included, so it is its own table.
--   * Table chat is a player's words: export_my_data() gains it (its live definition was copied
--     verbatim and one entry added), and deleting a profile deletes its table chat by cascade.
--
-- Tables
--   vtt_scenes    a battle map level on the table; one active scene per campaign
--   vtt_tokens    pieces on a scene: x, y are the token's centre in squares from the grid's top-left
--   vtt_messages  table chat: say, emote, whisper, roll, system
--
-- Idempotent: create if not exists, guarded policies and publication adds, create or replace.
-- Run by hand in the Supabase SQL editor, then supabase/checks/p105-tabletop-check.sql.

-- ---------------------------------------------------------------------------------------------------
-- Access helper: owns a player character in this campaign.
create or replace function public.tabletop_is_player(p_campaign uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.characters ch
    where ch.campaign_id = p_campaign and ch.profile_id = auth.uid() and ch.kind = 'pc'
  );
$function$;
revoke all on function public.tabletop_is_player(uuid) from public, anon;
grant execute on function public.tabletop_is_player(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
create table if not exists public.vtt_scenes (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  battle_map_id uuid not null references public.battle_maps(id) on delete cascade,
  level         integer not null default 0 check (level between 0 and 2),
  name          text not null default 'Scene',
  is_active     boolean not null default false,
  settings      jsonb not null default '{}'::jsonb,   -- diagonal rule, show labels to players
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists vtt_scenes_campaign_idx on public.vtt_scenes (campaign_id, updated_at desc);
create unique index if not exists vtt_scenes_one_active on public.vtt_scenes (campaign_id) where is_active;

create table if not exists public.vtt_tokens (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  scene_id      uuid not null references public.vtt_scenes(id) on delete cascade,
  kind          text not null default 'monster' check (kind in ('pc', 'npc', 'monster', 'object')),
  character_id  uuid references public.characters(id) on delete set null,
  stat_block_id uuid references public.stat_blocks(id) on delete set null,
  name          text not null default 'Token',
  image_url     text,
  x             real not null default 0.5,
  y             real not null default 0.5,
  size          real not null default 1 check (size > 0 and size <= 12),
  rot           real not null default 0,
  layer         text not null default 'token' check (layer in ('map', 'token', 'gm')),
  hidden        boolean not null default false,
  controlled_by uuid[] not null default '{}',          -- extra controllers; a pc's owner always controls it
  style         jsonb not null default '{}'::jsonb,    -- ring colour now; bars, markers, auras later
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists vtt_tokens_scene_idx on public.vtt_tokens (scene_id);
create index if not exists vtt_tokens_campaign_idx on public.vtt_tokens (campaign_id);

create table if not exists public.vtt_messages (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  session_id     uuid references public.sessions(id) on delete set null,
  author_profile uuid not null references public.profiles(id) on delete cascade,
  as_name        text,
  character_id   uuid references public.characters(id) on delete set null,
  kind           text not null default 'say' check (kind in ('say', 'emote', 'whisper', 'roll', 'system')),
  body           text not null default '' check (char_length(body) <= 2000),
  roll           jsonb,                                   -- label, notation, total, dice, natural
  vtt_event_id   uuid references public.vtt_events(id) on delete set null,
  whisper_to     uuid[],                                  -- null = the whole table
  gm_only        boolean not null default false,          -- a /gr roll: the roller and the GM
  created_at     timestamptz not null default now()
);
create index if not exists vtt_messages_campaign_idx on public.vtt_messages (campaign_id, created_at desc);
create index if not exists vtt_messages_author_idx on public.vtt_messages (author_profile);

-- ---------------------------------------------------------------------------------------------------
-- RLS. GMs manage scenes and tokens directly; players read through these policies (for Realtime) and
-- write only through the functions below. Nobody inserts chat directly.
alter table public.vtt_scenes enable row level security;
alter table public.vtt_tokens enable row level security;
alter table public.vtt_messages enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_scenes' and policyname = 'vtt_scenes_gm') then
    create policy vtt_scenes_gm on public.vtt_scenes
      for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_scenes' and policyname = 'vtt_scenes_player_read') then
    create policy vtt_scenes_player_read on public.vtt_scenes
      for select using (tabletop_is_player(campaign_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_tokens' and policyname = 'vtt_tokens_gm') then
    create policy vtt_tokens_gm on public.vtt_tokens
      for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_tokens' and policyname = 'vtt_tokens_player_read') then
    create policy vtt_tokens_player_read on public.vtt_tokens
      for select using (tabletop_is_player(campaign_id) and not hidden and layer <> 'gm');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_messages' and policyname = 'vtt_messages_read') then
    create policy vtt_messages_read on public.vtt_messages
      for select using (
        author_profile = auth.uid()
        or (whisper_to is not null and auth.uid() = any (whisper_to))
        or (whisper_to is null and is_campaign_gm(campaign_id))
        or (whisper_to is null and not gm_only and tabletop_is_player(campaign_id))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_messages' and policyname = 'vtt_messages_gm_delete') then
    create policy vtt_messages_gm_delete on public.vtt_messages
      for delete using (is_campaign_gm(campaign_id));
  end if;
end $$;

-- Realtime: tokens, scenes and chat push live. Deletes carry the whole old row so a client can tell
-- which scene a removed token was on.
alter table public.vtt_tokens replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vtt_scenes') then
    alter publication supabase_realtime add table public.vtt_scenes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vtt_tokens') then
    alter publication supabase_realtime add table public.vtt_tokens;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vtt_messages') then
    alter publication supabase_realtime add table public.vtt_messages;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The open session: newest with ended_at null, as /api/vtt/ingest picks it.
create or replace function public.tabletop_open_session(p_campaign uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select s.id from public.sessions s
  where s.campaign_id = p_campaign and s.ended_at is null
  order by coalesce(s.started_at, s.created_at) desc
  limit 1;
$function$;
revoke all on function public.tabletop_open_session(uuid) from public, anon;
grant execute on function public.tabletop_open_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Everything the table page needs on load, filtered by role.
create or replace function public.tabletop_state(p_campaign uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_gm      boolean;
  v_player  boolean;
  v_camp    public.campaigns;
  v_scene   public.vtt_scenes;
  v_map     public.battle_maps;
  v_lv      integer;
  v_labels  boolean;
  v_mapjson jsonb := null;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  v_player := public.tabletop_is_player(p_campaign);
  if not v_gm and not v_player then raise exception 'not at this table'; end if;

  select * into v_camp from public.campaigns where id = p_campaign;
  select * into v_scene from public.vtt_scenes where campaign_id = p_campaign and is_active limit 1;
  if v_scene.id is not null then
    select * into v_map from public.battle_maps where id = v_scene.battle_map_id;
  end if;

  if v_map.id is not null then
    v_lv := v_scene.level;
    v_labels := v_gm or coalesce((v_scene.settings ->> 'show_labels')::boolean, false);
    v_mapjson := jsonb_build_object(
      'id', v_map.id,
      'kind', v_map.kind,
      'n', v_map.n,
      'feet_per_square', v_map.feet_per_square,
      'grid', coalesce(v_map.levels -> v_lv, '[]'::jsonb),
      'custom', coalesce(v_map.custom_cells -> v_lv, '{}'::jsonb),
      -- players never receive secret doors: they are drawn as plain wall
      'doors', case when v_gm then coalesce(v_map.doors -> v_lv, '{}'::jsonb)
                    else (select coalesce(jsonb_object_agg(d.key, d.value), '{}'::jsonb)
                          from jsonb_each(coalesce(v_map.doors -> v_lv, '{}'::jsonb)) d
                          where d.value <> '"secret"'::jsonb) end,
      'elements', (select coalesce(jsonb_agg(e.value), '[]'::jsonb)
                   from jsonb_array_elements(coalesce(v_map.elements -> v_lv, '[]'::jsonb)) e
                   where v_labels or coalesce(e.value ->> 'k', '') <> 'label'),
      'meta', jsonb_build_object(
        'title', v_map.meta -> 'title',
        'levelNames', v_map.meta -> 'levelNames',
        'autoNumber', v_map.meta -> 'autoNumber',
        'showGrid', v_map.meta -> 'showGrid',
        'ground', v_map.meta -> 'ground',
        'grid', v_map.meta -> 'grid',
        'topGrid', v_map.meta -> 'topGrid',
        'overlay', v_map.meta -> 'overlays' -> v_lv
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
        and (v_gm or (not t.hidden and t.layer <> 'gm'))
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
    'battle_maps', case when v_gm then (
      select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind,
        'levelNames', b.meta -> 'levelNames') order by b.created_at), '[]'::jsonb)
      from public.battle_maps b where b.campaign_id = p_campaign) else '[]'::jsonb end
  );
end;
$function$;
revoke all on function public.tabletop_state(uuid) from public, anon;
grant execute on function public.tabletop_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Make one scene the active one (one statement pair, so the unique index never sees two).
create or replace function public.tabletop_activate_scene(p_scene uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_campaign uuid;
begin
  select campaign_id into v_campaign from public.vtt_scenes where id = p_scene;
  if v_campaign is null then raise exception 'scene not found'; end if;
  if not public.is_campaign_gm(v_campaign) then raise exception 'only the GM can change the scene'; end if;
  update public.vtt_scenes set is_active = false, updated_at = now() where campaign_id = v_campaign and is_active and id <> p_scene;
  update public.vtt_scenes set is_active = true, updated_at = now() where id = p_scene;
end;
$function$;
revoke all on function public.tabletop_activate_scene(uuid) from public, anon;
grant execute on function public.tabletop_activate_scene(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Move (and optionally turn) a token. The GM moves anything; a player moves a visible token whose
-- character they own or which lists them as a controller. Positions are kept on the map, give or take
-- a square.
create or replace function public.tabletop_move_token(p_token uuid, p_x real, p_y real, p_rot real default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.vtt_tokens;
  v_n   integer;
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
    raise exception 'that token is not yours to move';
  end if;
  select b.n into v_n from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id where s.id = v_t.scene_id;
  v_n := coalesce(v_n, 100);
  update public.vtt_tokens
     set x = greatest(-1, least(v_n + 1, p_x)),
         y = greatest(-1, least(v_n + 1, p_y)),
         rot = coalesce(p_rot, rot),
         updated_at = now()
   where id = p_token;
end;
$function$;
revoke all on function public.tabletop_move_token(uuid, real, real, real) from public, anon;
grant execute on function public.tabletop_move_token(uuid, real, real, real) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Say something at the table. Rolls are NOT posted here: /api/tabletop/roll rolls on the server and
-- writes both the vtt_events row and the chat card, so the number shown is the number stored.
create or replace function public.tabletop_say(
  p_campaign uuid, p_body text, p_kind text default 'say', p_as_name text default null,
  p_character uuid default null, p_whisper_to uuid[] default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;
revoke all on function public.tabletop_say(uuid, text, text, text, uuid, uuid[]) from public, anon;
grant execute on function public.tabletop_say(uuid, text, text, text, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The chat log for the caller, oldest first, plus rolls that reached the open session from outside
-- the table (D&D Beyond through the capture extension, Foundry), so they show up in table chat.
create or replace function public.tabletop_feed(p_campaign uuid, p_since timestamptz default null, p_limit integer default 200)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
        'event_type', e.event_type, 'name', e.name, 'rolls', e.rolls, 'at', coalesce(e.rolled_at, e.received_at)
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
$function$;
revoke all on function public.tabletop_feed(uuid, timestamptz, integer) from public, anon;
grant execute on function public.tabletop_feed(uuid, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- export_my_data(): the LIVE definition (read 2026-11-06), unchanged except for the 'table_chat'
-- entry after 'chat_messages'. Same signature and return type, so CREATE OR REPLACE keeps its grants.
create or replace function public.export_my_data()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;
