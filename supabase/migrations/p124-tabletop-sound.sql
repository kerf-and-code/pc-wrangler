-- supabase/migrations/p124-tabletop-sound.sql (2026-11-08)
--
-- Phase 5s: music and ambient sound at the tabletop (gap 3 in the tabletop audit doc).
--
--   vtt_sounds   the campaign's sound library: music and ambient loops the GM uploaded (app/api/tabletop/
--                sound, into the public campaign-maps bucket under <campaign_id>/audio/). The address must
--                be a file in that folder on this project's storage host (p122 tabletop_storage_host), so
--                a sound can never point anywhere else. Not to be confused with audio_tracks (session
--                recordings).
--   vtt_audio    what is playing at the table, one row per campaign: one music track (playing or paused,
--                where it is, looping or not, its volume) and up to four ambient layers that loop.
--                Everyone at the table reads it and follows it live (realtime); only the GM changes it,
--                through tabletop_set_audio.
--
--   tabletop_set_audio(campaign, state)  the GM's controls. The state names sounds by id only; the
--                server looks up their names and addresses, and stamps the moment it saved (server
--                milliseconds) so every browser can work out where the music is now, whatever its own
--                clock says.
--   tabletop_server_ms()  the server's clock, so a browser can measure how far its own clock is off.
--
-- Idempotent. Run by hand after p123, then supabase/checks/p124-tabletop-sound-check.sql.

create table if not exists public.vtt_sounds (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 80),
  kind         text not null default 'music' check (kind in ('music', 'ambient')),
  url          text not null,
  duration     real check (duration is null or (duration > 0 and duration < 86400)),
  bytes        integer check (bytes is null or bytes >= 0),
  created_at   timestamptz not null default now(),
  constraint vtt_sounds_url_ours check (
    url ~ ('^https://' || replace(public.tabletop_storage_host(), '.', '\.')
           || '/storage/v1/object/public/campaign-maps/' || campaign_id::text || '/audio/[A-Za-z0-9._-]+$'))
);
create index if not exists vtt_sounds_campaign_idx on public.vtt_sounds (campaign_id, kind, name);

create table if not exists public.vtt_audio (
  campaign_id  uuid primary key references public.campaigns(id) on delete cascade,
  state        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.vtt_sounds enable row level security;
alter table public.vtt_audio enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_sounds' and policyname = 'vtt_sounds_gm') then
    create policy vtt_sounds_gm on public.vtt_sounds
      for all using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_audio' and policyname = 'vtt_audio_gm_read') then
    create policy vtt_audio_gm_read on public.vtt_audio
      for select using (public.is_campaign_gm(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_audio' and policyname = 'vtt_audio_player_read') then
    create policy vtt_audio_player_read on public.vtt_audio
      for select using (public.tabletop_is_player(campaign_id));
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vtt_audio') then
    alter publication supabase_realtime add table public.vtt_audio;
  end if;
end;
$$;

revoke all on public.vtt_sounds from anon;
revoke all on public.vtt_audio from anon;
grant select, insert, update, delete on public.vtt_sounds to authenticated;
grant select on public.vtt_audio to authenticated;

create or replace function public.tabletop_server_ms()
 returns double precision
 language sql
 volatile
as $function$ select extract(epoch from clock_timestamp()) * 1000 $function$;
revoke all on function public.tabletop_server_ms() from public, anon;
grant execute on function public.tabletop_server_ms() to authenticated;

-- p_state: { music: { soundId, playing, offset (seconds into the track), loop, volume (0..1) } | null,
--            ambient: [ { soundId, volume } ] (at most 4) }
-- Saved: the same, plus each sound's name, url and duration, and "at" (server ms) on the music.
create or replace function public.tabletop_set_audio(p_campaign uuid, p_state jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;
revoke all on function public.tabletop_set_audio(uuid, jsonb) from public, anon;
grant execute on function public.tabletop_set_audio(uuid, jsonb) to authenticated;
