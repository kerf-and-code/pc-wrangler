-- supabase/migrations/p128-tabletop-notes-pins.sql (2026-11-09)
--
-- Phase 5x: GM notes on tokens and pins on the map (gap 8 in the tabletop audit doc).
--
--   vtt_token_notes  the GM's private note on a token ("bribed by the cult", "has the key"). Its own
--                    table, GM only: a token's style goes to every player live, so a note kept there would
--                    leak.
--   vtt_pins         pins on a scene: a label, a colour, the GM's own note, and optionally a wiki entry
--                    (entries) it opens. GM only by row level security; players get pins through
--                    tabletop_pins, which hands over only the pins marked for players that sit on squares
--                    the fog has revealed, on the scene the player is on, without the GM's note, and names
--                    the entry only when the wiki lets that player read it (the rule tabletop_handouts
--                    uses, p113: a common or player entry, or one revealed to their character).
--   tabletop_pin_entry  the entry behind a pin, for reading at the table, under the same rules.
--
-- Idempotent. Run by hand after p127, then supabase/checks/p128-tabletop-notes-pins-check.sql.

create table if not exists public.vtt_token_notes (
  token_id     uuid primary key references public.vtt_tokens(id) on delete cascade,
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  body         text not null default '' check (char_length(body) <= 4000),
  updated_at   timestamptz not null default now()
);
create index if not exists vtt_token_notes_campaign_idx on public.vtt_token_notes (campaign_id);

create table if not exists public.vtt_pins (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  scene_id     uuid not null references public.vtt_scenes(id) on delete cascade,
  x            real not null check (x between -1000 and 1000),
  y            real not null check (y between -1000 and 1000),
  label        text not null check (char_length(trim(label)) between 1 and 80),
  color        text not null default '#d9a43a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  entry_id     uuid references public.entries(id) on delete set null,
  gm_note      text not null default '' check (char_length(gm_note) <= 2000),
  players_see  boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists vtt_pins_scene_idx on public.vtt_pins (scene_id);

alter table public.vtt_token_notes enable row level security;
alter table public.vtt_pins enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_token_notes' and policyname = 'vtt_token_notes_gm') then
    create policy vtt_token_notes_gm on public.vtt_token_notes
      for all using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_pins' and policyname = 'vtt_pins_gm') then
    create policy vtt_pins_gm on public.vtt_pins
      for all using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));
  end if;
end;
$$;

revoke all on public.vtt_token_notes from anon;
revoke all on public.vtt_pins from anon;
grant select, insert, update, delete on public.vtt_token_notes to authenticated;
grant select, insert, update, delete on public.vtt_pins to authenticated;

-- May this player (a pc of theirs in the campaign) read this wiki entry? As tabletop_handouts (p113).
create or replace function public.tabletop_player_reads_entry(p_campaign uuid, p_entry uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.entries e, public.characters me
     where e.id = p_entry and e.campaign_id = p_campaign
       and me.campaign_id = p_campaign and me.kind = 'pc' and me.profile_id = auth.uid()
       and (e.visibility in ('common', 'player')
            or exists (select 1 from public.entry_reveals r
                        where r.target_type = 'entry' and r.target_id = e.id and r.revealed_to_character_id = me.id)));
$function$;
revoke all on function public.tabletop_player_reads_entry(uuid, uuid) from public, anon, authenticated;

-- The pins on a scene. The GM: all of them, with notes and entries. A player: on their own scene only,
-- the pins for players on revealed squares, with no note, and the entry only when they may read it.
create or replace function public.tabletop_pins(p_scene uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
$function$;
revoke all on function public.tabletop_pins(uuid) from public, anon;
grant execute on function public.tabletop_pins(uuid) to authenticated;

-- The wiki entry behind a pin, to read at the table: for the GM always, for a player only when
-- tabletop_pins would show them the pin and its entry.
create or replace function public.tabletop_pin_entry(p_pin uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
$function$;
revoke all on function public.tabletop_pin_entry(uuid) from public, anon;
grant execute on function public.tabletop_pin_entry(uuid) to authenticated;
