-- p151-scene-snapshots.sql (2026-11-10, push 25, audit P14)
--
-- Scene snapshots for the tabletop. A snapshot keeps one scene as it stood: its fog, doors and settings,
-- and its tokens, drawings, templates, effects and pins. Every scene of a campaign is snapshotted when a
-- session closes, and the GM can take one by hand at any time. Restoring puts ONE scene back as it was
-- (not the whole campaign): the scene's current tokens, drawings, templates, effects and pins are
-- replaced by the snapshot's.
--
--   scene_snapshots                  one row per snapshot, RLS on, GMs read their campaign's
--   snapshot_scene(scene, label)     GM: take a snapshot now
--   scene_snapshots_for(scene)       GM: the list, newest first, with what each holds
--   restore_scene_snapshot(id)       GM: put the scene back; first snapshots it as it is now, so a
--                                    restore can itself be undone
--   snapshot_campaign_scenes_at_close(campaign, session)   service role only, called by
--                                    /api/session/close
--
-- Kept: the newest 20 snapshots per scene. Restoring skips what no longer exists: a drawing whose
-- author deleted their account, a token's character or stat block that was deleted (the link is
-- cleared), an effect whose token is not restored.
--
-- Idempotent. Run supabase\checks\p151-scene-snapshots-check.sql after.

create table if not exists public.scene_snapshots (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  scene_id    uuid not null references public.vtt_scenes (id) on delete cascade,
  session_id  uuid references public.sessions (id) on delete set null,
  label       text not null check (char_length(label) <= 120),
  taken_by    uuid references public.profiles (id) on delete set null,
  taken_at    timestamptz not null default now(),
  data        jsonb not null
);
create index if not exists scene_snapshots_scene_idx on public.scene_snapshots (scene_id, taken_at desc);
alter table public.scene_snapshots enable row level security;
revoke all on public.scene_snapshots from anon, authenticated;
grant select on public.scene_snapshots to authenticated;
drop policy if exists "gm reads scene snapshots" on public.scene_snapshots;
create policy "gm reads scene snapshots" on public.scene_snapshots for select to authenticated using (public.is_campaign_gm(campaign_id));

-- The snapshot itself. No permission check: only the functions below call it.
create or replace function public.scene_snapshot_take(p_scene uuid, p_label text, p_session uuid, p_by uuid)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_sc public.vtt_scenes;
  v_id uuid;
begin
  select * into v_sc from public.vtt_scenes where id = p_scene;
  if v_sc.id is null then raise exception 'scene not found'; end if;
  insert into public.scene_snapshots (campaign_id, scene_id, session_id, label, taken_by, data)
  values (v_sc.campaign_id, v_sc.id, p_session, left(coalesce(nullif(trim(p_label), ''), 'Snapshot'), 120), p_by,
    jsonb_build_object(
      'scene', jsonb_build_object('fog_on', v_sc.fog_on, 'revealed', encode(coalesce(v_sc.revealed, '\x'::bytea), 'hex'),
                                  'door_state', coalesce(v_sc.door_state, '{}'::jsonb), 'settings', coalesce(v_sc.settings, '{}'::jsonb)),
      'tokens',    coalesce((select jsonb_agg(to_jsonb(tok)) from public.vtt_tokens tok where tok.scene_id = p_scene), '[]'::jsonb),
      'drawings',  coalesce((select jsonb_agg(to_jsonb(drw)) from public.vtt_drawings drw where drw.scene_id = p_scene), '[]'::jsonb),
      'templates', coalesce((select jsonb_agg(to_jsonb(tpl)) from public.vtt_templates tpl where tpl.scene_id = p_scene), '[]'::jsonb),
      'effects',   coalesce((select jsonb_agg(to_jsonb(eff)) from public.vtt_effects eff where eff.scene_id = p_scene), '[]'::jsonb),
      'pins',      coalesce((select jsonb_agg(to_jsonb(pin)) from public.vtt_pins pin where pin.scene_id = p_scene), '[]'::jsonb)))
  returning id into v_id;
  -- keep the newest 20 for this scene
  delete from public.scene_snapshots s
   where s.scene_id = p_scene
     and s.id not in (select id from public.scene_snapshots where scene_id = p_scene order by taken_at desc limit 20);
  return v_id;
end;
$$;
revoke all on function public.scene_snapshot_take(uuid, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.snapshot_scene(p_scene uuid, p_label text default null)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_c uuid;
begin
  select campaign_id into v_c from public.vtt_scenes where id = p_scene;
  if v_c is null or not public.is_campaign_gm(v_c) then raise exception 'only the GM can snapshot a scene'; end if;
  return public.scene_snapshot_take(p_scene, coalesce(nullif(trim(p_label), ''), 'Saved by hand'), null, auth.uid());
end;
$$;

create or replace function public.scene_snapshots_for(p_scene uuid)
returns table (id uuid, label text, taken_at timestamptz, session_number integer, tokens integer, drawings integer)
language sql stable security definer
set search_path to 'public'
as $$
  select s.id, s.label, s.taken_at, se.session_number,
         jsonb_array_length(s.data -> 'tokens'), jsonb_array_length(s.data -> 'drawings')
    from public.scene_snapshots s
    left join public.sessions se on se.id = s.session_id
   where s.scene_id = p_scene and public.is_campaign_gm(s.campaign_id)
   order by s.taken_at desc;
$$;

create or replace function public.restore_scene_snapshot(p_snapshot uuid)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_s     public.scene_snapshots;
  v_scene uuid;
  v_ids   uuid[];
begin
  select * into v_s from public.scene_snapshots where id = p_snapshot;
  if v_s.id is null then raise exception 'snapshot not found'; end if;
  if not public.is_campaign_gm(v_s.campaign_id) then raise exception 'only the GM can restore a scene'; end if;
  v_scene := v_s.scene_id;

  -- the scene as it is now, so this restore can be undone
  perform public.scene_snapshot_take(v_scene, 'Before restoring ' || to_char(v_s.taken_at at time zone 'UTC', 'Mon DD HH24:MI') || ' UTC', null, auth.uid());

  update public.vtt_scenes
     set fog_on = coalesce((v_s.data -> 'scene' ->> 'fog_on')::boolean, fog_on),
         revealed = decode(coalesce(v_s.data -> 'scene' ->> 'revealed', ''), 'hex'),
         door_state = coalesce(v_s.data -> 'scene' -> 'door_state', '{}'::jsonb),
         settings = coalesce(v_s.data -> 'scene' -> 'settings', settings),
         updated_at = now()
   where id = v_scene;

  -- tokens: the scene's current ones go, and so does any snapshot token now standing on another floor
  select coalesce(array_agg((t ->> 'id')::uuid), '{}') into v_ids from jsonb_array_elements(v_s.data -> 'tokens') t;
  delete from public.vtt_tokens where scene_id = v_scene or id = any (v_ids);
  insert into public.vtt_tokens
  select (r).* from (
    select jsonb_populate_record(null::public.vtt_tokens, t
             || jsonb_build_object('scene_id', v_scene, 'campaign_id', v_s.campaign_id,
                  'character_id', case when exists (select 1 from public.characters c where c.id = (t ->> 'character_id')::uuid and c.campaign_id = v_s.campaign_id) then t -> 'character_id' else 'null'::jsonb end,
                  'stat_block_id', case when exists (select 1 from public.stat_blocks b where b.id = (t ->> 'stat_block_id')::uuid) then t -> 'stat_block_id' else 'null'::jsonb end)) as r
      from jsonb_array_elements(v_s.data -> 'tokens') t) q;

  delete from public.vtt_drawings where scene_id = v_scene;
  insert into public.vtt_drawings
  select (r).* from (
    select jsonb_populate_record(null::public.vtt_drawings, d || jsonb_build_object('scene_id', v_scene, 'campaign_id', v_s.campaign_id)) as r
      from jsonb_array_elements(v_s.data -> 'drawings') d
     where exists (select 1 from public.profiles pr where pr.id = (d ->> 'owner')::uuid)
       and not exists (select 1 from public.vtt_drawings x where x.id = (d ->> 'id')::uuid)) q;

  delete from public.vtt_templates where scene_id = v_scene;
  insert into public.vtt_templates
  select (r).* from (
    select jsonb_populate_record(null::public.vtt_templates, jt || jsonb_build_object('scene_id', v_scene, 'campaign_id', v_s.campaign_id)) as r
      from jsonb_array_elements(v_s.data -> 'templates') jt
     where exists (select 1 from public.profiles pr where pr.id = (jt ->> 'owner')::uuid)
       and not exists (select 1 from public.vtt_templates y where y.id = (jt ->> 'id')::uuid)) q;

  delete from public.vtt_effects where scene_id = v_scene;
  insert into public.vtt_effects
  select (r).* from (
    select jsonb_populate_record(null::public.vtt_effects, e || jsonb_build_object('scene_id', v_scene, 'campaign_id', v_s.campaign_id)) as r
      from jsonb_array_elements(v_s.data -> 'effects') e
     where exists (select 1 from public.vtt_tokens t where t.id = (e ->> 'token_id')::uuid)
       and exists (select 1 from public.profiles pr where pr.id = (e ->> 'owner')::uuid)
       and not exists (select 1 from public.vtt_effects y where y.id = (e ->> 'id')::uuid)) q;

  delete from public.vtt_pins where scene_id = v_scene;
  insert into public.vtt_pins
  select (r).* from (
    select jsonb_populate_record(null::public.vtt_pins, jp || jsonb_build_object('scene_id', v_scene, 'campaign_id', v_s.campaign_id,
             'entry_id', case when exists (select 1 from public.entries en where en.id = (jp ->> 'entry_id')::uuid) then jp -> 'entry_id' else 'null'::jsonb end)) as r
      from jsonb_array_elements(v_s.data -> 'pins') jp
     where not exists (select 1 from public.vtt_pins y where y.id = (jp ->> 'id')::uuid)) q;

  return v_scene;
end;
$$;

-- At session close, every scene of the campaign. Called by /api/session/close with the service role.
create or replace function public.snapshot_campaign_scenes_at_close(p_campaign uuid, p_session uuid)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_scene uuid;
  v_n     integer := 0;
  v_num   integer;
begin
  select session_number into v_num from public.sessions where id = p_session;
  for v_scene in select id from public.vtt_scenes where campaign_id = p_campaign loop
    perform public.scene_snapshot_take(v_scene, 'End of ' || case when v_num is null then 'a session' else 'Session ' || v_num end, p_session, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.snapshot_scene(uuid, text)                     from public, anon;
revoke all on function public.scene_snapshots_for(uuid)                      from public, anon;
revoke all on function public.restore_scene_snapshot(uuid)                   from public, anon;
revoke all on function public.snapshot_campaign_scenes_at_close(uuid, uuid)  from public, anon, authenticated;
grant execute on function public.snapshot_scene(uuid, text)                    to authenticated;
grant execute on function public.scene_snapshots_for(uuid)                     to authenticated;
grant execute on function public.restore_scene_snapshot(uuid)                  to authenticated;
grant execute on function public.snapshot_campaign_scenes_at_close(uuid, uuid) to service_role;

insert into public._migrations (name) values ('p151-scene-snapshots') on conflict do nothing;
