-- p114-tabletop-split-effects.sql
--
-- Phase 4e (2026-11-07): a split party, and animated effects.
--
-- SPLIT PARTY (Terry, 2026-11-07): the GM can put players on different scenes, half the party in the
-- dungeon and half in town. vtt_scene_players says who is on which scene; anyone without a row is on the
-- active scene, as before. The GM's own row is the scene the GM is looking at, so the GM moves between
-- the groups without moving anyone. tabletop_scene_for() answers "which scene is this person on" and
-- replaces "the active scene" wherever a player is concerned:
--   * tabletop_state (p109) sends the caller their own scene, and the GM the placements;
--   * the player read rules on tokens, area templates and drawings admit only the player's own scene,
--     so a player never receives another scene's tokens, live or otherwise;
--   * tabletop_set_doors (p109) lets a player open doors on their own scene.
--   tabletop_activate_scene (p105) now brings everyone (the GM too) to that scene; tabletop_place
--   moves chosen players, and tabletop_view_scene moves only the GM's view.
--
-- EFFECTS (Terry, 2026-11-07, everyone places them): animated fire, cold, acid, lightning, poison,
-- darkness, fog, radiant and necrotic, drawn by the table itself. An effect fills an area template
-- (vtt_templates.effect, so anyone who can place a template can set its effect) or surrounds a token
-- (vtt_effects, with a radius in feet beyond the token's edge; 0 = on the token). Players add and remove
-- their own; the GM manages all of them. A player sees a token's effects only while they can see the
-- token.
--
-- Idempotent. Run by hand after p113, then supabase/checks/p114-tabletop-split-effects-check.sql.

-- ---------------------------------------------------------------------------------------------------
create table if not exists public.vtt_scene_players (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  scene_id    uuid not null references public.vtt_scenes(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  primary key (campaign_id, profile_id)
);
alter table public.vtt_scene_players enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_scene_players' and policyname = 'vtt_scene_players_gm') then
    create policy vtt_scene_players_gm on public.vtt_scene_players
      for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_scene_players' and policyname = 'vtt_scene_players_own') then
    create policy vtt_scene_players_own on public.vtt_scene_players
      for select using (profile_id = auth.uid());
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vtt_scene_players') then
    alter publication supabase_realtime add table public.vtt_scene_players;
  end if;
end $$;
grant select, insert, update, delete on public.vtt_scene_players to authenticated;

-- The scene this person is on: their placement, else the active scene (null when there is neither).
create or replace function public.tabletop_scene_for(p_campaign uuid, p_profile uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select sp.scene_id from public.vtt_scene_players sp join public.vtt_scenes s on s.id = sp.scene_id
      where sp.campaign_id = p_campaign and sp.profile_id = p_profile and s.campaign_id = p_campaign),
    (select s.id from public.vtt_scenes s where s.campaign_id = p_campaign and s.is_active limit 1));
$function$;
revoke all on function public.tabletop_scene_for(uuid, uuid) from public, anon;
grant execute on function public.tabletop_scene_for(uuid, uuid) to authenticated;

-- Put a scene on the table for everyone: it becomes the active scene and every placement (the GM's
-- view too) is cleared, so the whole table is together again.
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
  delete from public.vtt_scene_players where campaign_id = v_campaign;
end;
$function$;
revoke all on function public.tabletop_activate_scene(uuid) from public, anon;
grant execute on function public.tabletop_activate_scene(uuid) to authenticated;

-- Move chosen players to a scene (the GM). Placing someone on the active scene just clears their row.
-- Only people with a player character in the campaign can be placed.
create or replace function public.tabletop_place(p_scene uuid, p_profiles uuid[])
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;
revoke all on function public.tabletop_place(uuid, uuid[]) from public, anon;
grant execute on function public.tabletop_place(uuid, uuid[]) to authenticated;

-- The GM looks at a scene without moving anyone.
create or replace function public.tabletop_view_scene(p_scene uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;
revoke all on function public.tabletop_view_scene(uuid) from public, anon;
grant execute on function public.tabletop_view_scene(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Players read tokens, templates and drawings on their own scene only (p109, p106, p113 restated with
-- the scene test added; the names stay, so the GM policies are untouched).
drop policy if exists vtt_tokens_player_read on public.vtt_tokens;
create policy vtt_tokens_player_read on public.vtt_tokens
  for select using (
    tabletop_is_player(campaign_id) and not hidden and layer <> 'gm'
    and scene_id = tabletop_scene_for(campaign_id, auth.uid())
    and tabletop_token_visible(scene_id, x, y, character_id, controlled_by)
  );

drop policy if exists vtt_templates_player_read on public.vtt_templates;
create policy vtt_templates_player_read on public.vtt_templates
  for select using (tabletop_is_player(campaign_id) and scene_id = tabletop_scene_for(campaign_id, auth.uid()));
drop policy if exists vtt_templates_player_insert on public.vtt_templates;
create policy vtt_templates_player_insert on public.vtt_templates
  for insert with check (owner = auth.uid() and tabletop_is_player(campaign_id) and scene_id = tabletop_scene_for(campaign_id, auth.uid()));
drop policy if exists vtt_templates_player_update on public.vtt_templates;
create policy vtt_templates_player_update on public.vtt_templates
  for update using (owner = auth.uid() and tabletop_is_player(campaign_id))
  with check (owner = auth.uid() and tabletop_is_player(campaign_id) and scene_id = tabletop_scene_for(campaign_id, auth.uid()));

drop policy if exists vtt_drawings_player_read on public.vtt_drawings;
create policy vtt_drawings_player_read on public.vtt_drawings
  for select using (layer = 'table' and tabletop_is_player(campaign_id) and scene_id = tabletop_scene_for(campaign_id, auth.uid()));
drop policy if exists vtt_drawings_player_insert on public.vtt_drawings;
create policy vtt_drawings_player_insert on public.vtt_drawings
  for insert with check (owner = auth.uid() and layer = 'table' and tabletop_is_player(campaign_id) and scene_id = tabletop_scene_for(campaign_id, auth.uid()));

-- ---------------------------------------------------------------------------------------------------
-- Effects
create or replace function public.tabletop_effect_kinds()
 returns text[]
 language sql
 immutable
as $function$
  select array['fire', 'cold', 'acid', 'lightning', 'poison', 'darkness', 'fog', 'radiant', 'necrotic']::text[];
$function$;
grant execute on function public.tabletop_effect_kinds() to authenticated;

alter table public.vtt_templates add column if not exists effect text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_templates_effect_check' and conrelid = 'public.vtt_templates'::regclass) then
    alter table public.vtt_templates add constraint vtt_templates_effect_check
      check (effect is null or effect in ('fire', 'cold', 'acid', 'lightning', 'poison', 'darkness', 'fog', 'radiant', 'necrotic'));
  end if;
end $$;

create table if not exists public.vtt_effects (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  scene_id    uuid not null references public.vtt_scenes(id) on delete cascade,
  token_id    uuid not null references public.vtt_tokens(id) on delete cascade,
  owner       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('fire', 'cold', 'acid', 'lightning', 'poison', 'darkness', 'fog', 'radiant', 'necrotic')),
  radius_ft   real not null default 0 check (radius_ft >= 0 and radius_ft <= 120),
  created_at  timestamptz not null default now()
);
create index if not exists vtt_effects_scene_idx on public.vtt_effects (scene_id);
alter table public.vtt_effects enable row level security;

-- May this player see that token right now (their own scene, not hidden, and visible through the fog)?
create or replace function public.tabletop_token_seen(p_token uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.vtt_tokens t
     where t.id = p_token and not t.hidden and t.layer <> 'gm'
       and t.scene_id = public.tabletop_scene_for(t.campaign_id, auth.uid())
       and public.tabletop_token_visible(t.scene_id, t.x, t.y, t.character_id, t.controlled_by));
$function$;
revoke all on function public.tabletop_token_seen(uuid) from public, anon;
grant execute on function public.tabletop_token_seen(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_effects' and policyname = 'vtt_effects_gm') then
    create policy vtt_effects_gm on public.vtt_effects
      for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_effects' and policyname = 'vtt_effects_player_read') then
    create policy vtt_effects_player_read on public.vtt_effects
      for select using (tabletop_is_player(campaign_id) and tabletop_token_seen(token_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_effects' and policyname = 'vtt_effects_player_insert') then
    create policy vtt_effects_player_insert on public.vtt_effects
      for insert with check (owner = auth.uid() and tabletop_is_player(campaign_id) and tabletop_token_seen(token_id)
                             and scene_id = (select t.scene_id from public.vtt_tokens t where t.id = token_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_effects' and policyname = 'vtt_effects_player_delete') then
    create policy vtt_effects_player_delete on public.vtt_effects
      for delete using (owner = auth.uid() and tabletop_is_player(campaign_id));
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vtt_effects') then
    alter publication supabase_realtime add table public.vtt_effects;
  end if;
end $$;
grant select, insert, delete on public.vtt_effects to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Doors (p109): a player opens doors on their own scene. Otherwise unchanged.
create or replace function public.tabletop_set_doors(p_scene uuid, p_edges text[], p_open boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;
revoke all on function public.tabletop_set_doors(uuid, text[], boolean) from public, anon;
grant execute on function public.tabletop_set_doors(uuid, text[], boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- tabletop_state (p109): the caller's own scene instead of the active one, and the GM gets the
-- placements. Otherwise unchanged.
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
$function$;
revoke all on function public.tabletop_state(uuid) from public, anon;
grant execute on function public.tabletop_state(uuid) to authenticated;
