-- supabase/migrations/p143-server-hardening.sql (2026-11-10)
--
-- Push 7, server hardening. Four audit fixes need the database:
--
-- B6   claim_by_discord failed outright when the caller already had a disposition reveal
--      (disposition_reveals is unique per profile, so moving the old owner's row onto the caller broke
--      the unique key and rolled the whole claim back). Now the old owner's reveal moves only when the
--      caller has none, and only one tagged with this character's campaign. The audit also flagged the
--      player-level dispositions moving with no campaign filter; they cannot be filtered, because the
--      schema keeps them campaign-free (dispositions_scope_shape_check: scope 'player' has no campaign),
--      and since p135 the old owner here is a guest or an account with the same Discord id, so that
--      move is left as it was. Otherwise as live after p135.
-- L-B1 tool_render_reserve checks the free map render caps and reserves a slot in one locked step, so
--      parallel requests cannot all pass the count (app/api/tools/map-render).
-- T17  The campaign-maps bucket had a select policy covering the whole bucket for every role, so the
--      public key could LIST every file: unrevealed maps, player portraits, sounds. Public buckets serve
--      files by link without any select policy, so it is dropped. Each upload path keeps its own
--      policy (portraits, codex covers, character block images, world map images), which is what an
--      upsert needs. Found by its condition, not its name, because live policy names may differ.
-- B12  vtt_ingest_keys holds the hashes of roll keys (lib/vtt/ingest-keys.ts), which prove who sent a
--      roll to /api/vtt/ingest. Service role only.
--
-- Idempotent. Run by hand after p142, BEFORE deploying this push (the map render and ingest routes use
-- the new function and table), then supabase/checks/p143-server-hardening-check.sql.

-- ------------------------------------------------------------------------------------------- B12
create table if not exists public.vtt_ingest_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
do $c$ begin
  alter table public.vtt_ingest_keys add constraint vtt_ingest_keys_key_hash_key unique (key_hash);
exception when duplicate_object or duplicate_table then null;
end $c$;
do $c$ begin
  alter table public.vtt_ingest_keys add constraint vtt_ingest_keys_kind_check check (kind in ('player', 'gm'));
exception when duplicate_object then null;
end $c$;
create index if not exists vtt_ingest_keys_owner_idx on public.vtt_ingest_keys (profile_id, campaign_id) where revoked_at is null;
alter table public.vtt_ingest_keys enable row level security;
revoke all on table public.vtt_ingest_keys from anon, authenticated;
grant select, insert, update, delete on table public.vtt_ingest_keys to service_role;

-- ------------------------------------------------------------------------------------------ L-B1
create or replace function public.tool_render_reserve(p_tool text, p_ip text, p_global integer, p_per_ip integer)
 returns table(reserved_id bigint, refused text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_since timestamptz := now() - interval '24 hours';
  v_id bigint;
begin
  -- One reservation at a time, so every request counts the ones before it.
  perform pg_advisory_xact_lock(hashtext('public.tool_render_reserve'));
  if (select count(*) from public.tool_render_log where created_at >= v_since) >= coalesce(p_global, 0) then
    return query select null::bigint, 'global'::text;
    return;
  end if;
  if coalesce(p_ip, 'unknown') <> 'unknown'
     and (select count(*) from public.tool_render_log where ip = p_ip and created_at >= v_since) >= coalesce(p_per_ip, 0) then
    return query select null::bigint, 'ip'::text;
    return;
  end if;
  insert into public.tool_render_log (tool, ip) values (coalesce(p_tool, 'map-render'), p_ip) returning id into v_id;
  return query select v_id, null::text;
end;
$function$;
revoke all on function public.tool_render_reserve(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.tool_render_reserve(text, text, integer, integer) to service_role;

-- ------------------------------------------------------------------------------------------- T17
do $t17$
declare
  r record;
begin
  for r in
    select policyname
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
       and lower(regexp_replace(coalesce(qual, ''), '\s', '', 'g')) in (
             '(bucket_id=''campaign-maps''::text)',
             'bucket_id=''campaign-maps''::text',
             '(bucket_id=''campaign-maps'')',
             'bucket_id=''campaign-maps''')
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
    raise notice 'p143: dropped storage.objects policy "%" (it let anyone list campaign-maps)', r.policyname;
  end loop;
exception when undefined_table or insufficient_privilege then
  raise notice 'p143: storage.objects not reachable here, T17 skipped';
end
$t17$;

-- -------------------------------------------------------------------------------------------- B6
-- claim_by_discord as restated in p135, with the p143 changes marked.
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
    -- p135 (audit B4): never take a character from a real player. Transfer only from nobody, this caller,
    -- a guest account, the campaign's GM (a placeholder owner), or another account signed in with this
    -- same Discord id. Anything else is skipped: the GM sorts it out.
    if v_char.old_owner is not null and v_char.old_owner <> v_uid
       and not public.discord_claim_allowed(v_char.old_owner, v_char.campaign_id, v_discord) then
      continue;
    end if;

    -- Move the character.
    update public.characters
       set profile_id = v_uid
     where id = v_char.id;

    -- Move the history that is keyed on the PRIOR owner, so a transfer does not strand the
    -- player's own self-reports or disposition rows on an identity they no longer use.
    -- Only runs when there was a different prior owner; a first claim has none.
    -- p135: a GM's own rows (their dispositions and reveals) stay with the GM.
    if v_char.old_owner is not null and v_char.old_owner <> v_uid
       and not exists (select 1 from public.campaigns cg where cg.id = v_char.campaign_id and cg.gm_id = v_char.old_owner) then
      update public.tpdi_responses
         set respondent_id = v_uid
       where respondent_id = v_char.old_owner
         and campaign_id = v_char.campaign_id;

      update public.dispositions d
         set profile_id = v_uid
       where d.profile_id = v_char.old_owner
         and (d.character_id = v_char.id or d.scope = 'player');

      -- p143 (audit B6): a reveal is one row per profile. Move the old owner's reveal for this campaign
      -- only when the caller has none; when the caller already has one, theirs stands and the old
      -- owner's is left as it is. Moving onto an existing row broke the unique key and failed the claim.
      if not exists (select 1 from public.disposition_reveals where profile_id = v_uid) then
        update public.disposition_reveals
           set profile_id = v_uid
         where profile_id = v_char.old_owner
           and campaign_id = v_char.campaign_id;
      end if;
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
$function$;
revoke all on function public.claim_by_discord() from public, anon;
grant execute on function public.claim_by_discord() to authenticated;
