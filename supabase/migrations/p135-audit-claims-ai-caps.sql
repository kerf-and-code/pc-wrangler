-- supabase/migrations/p135-audit-claims-ai-caps.sql (2026-11-09)
--
-- Two audit fixes.
--
-- B4  A player could take another player's character: Discord /claim bound any character with no Discord
--     link to whoever picked it, and claim_by_discord then moved ownership (and the old owner's
--     self-reports and dispositions) to that person. Now one rule decides, in discord_claim_allowed:
--     a character may go to a Discord user only when it has no owner, or its owner is a guest account,
--     the campaign's GM, or an account signed in with that same Discord id. The bot asks it before
--     linking (app/api/discord/interactions), and claim_by_discord skips anything it refuses.
-- T4  ai_map_renders gets a kind (world, battle, trace), so each kind of AI call has its own daily cap
--     (lib/ai-allowance.ts). Rows written before this are counted as world renders.
--
-- Idempotent. Run by hand after p134, BEFORE deploying this commit (the AI routes write kind), then
-- supabase/checks/p135-audit-claims-ai-caps-check.sql.

alter table public.ai_map_renders add column if not exists kind text not null default 'world';
do $c$ begin
  alter table public.ai_map_renders add constraint ai_map_renders_kind_check check (kind in ('world', 'battle', 'trace'));
exception when duplicate_object then null;
end $c$;
create index if not exists ai_map_renders_profile_kind_time_idx on public.ai_map_renders (profile_id, kind, created_at);

-- Server only: called by the Discord bot with the service role, and inside claim_by_discord.
create or replace function public.discord_claim_allowed(p_owner uuid, p_campaign uuid, p_discord text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_owner is null
      or exists (select 1 from auth.users u where u.id = p_owner and coalesce(u.is_anonymous, false))
      or exists (select 1 from public.campaigns c where c.id = p_campaign and c.gm_id = p_owner)
      or (p_discord is not null and exists (
            select 1 from auth.identities i
             where i.user_id = p_owner and i.provider = 'discord' and i.provider_id = p_discord));
$function$;
revoke all on function public.discord_claim_allowed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.discord_claim_allowed(uuid, uuid, text) to service_role;

-- claim_by_discord as live on 2026-11-09 (0000-base-schema.sql), with the two p135 changes marked.
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
$function$;
revoke all on function public.claim_by_discord() from public, anon;
grant execute on function public.claim_by_discord() to authenticated;
