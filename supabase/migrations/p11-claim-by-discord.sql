-- p11-claim-by-discord.sql
--
-- Claim every character linked to the caller's Discord account, in one call, with no invite
-- code. This is the web counterpart to the /claim Discord command: /claim sets
-- characters.discord_user_id at the table, and this binds those same characters to the
-- web profile once the player signs in with Discord.
--
-- WHY THIS EXISTS
--
-- The web claim flow signed players in ANONYMOUSLY (signInAnonymously) and bound the
-- character to that throwaway identity. When a player later cleared cookies, switched
-- devices, or made a real account, the anonymous identity was unreachable and the
-- character was stranded on it. That is exactly how "Larkin" was lost: claimed on an
-- anonymous session, orphaned when the player signed in with Google instead.
--
-- Discord is the source of truth for who a player is. characters.discord_user_id is the
-- raw snowflake set by the bot, and it EQUALS the provider_id on a Supabase Discord OAuth
-- identity (verified: provider_id 1493069747766427731 matched three characters directly).
-- So once a player signs in with Discord, we can bind every one of their characters with
-- no code and no anonymous session ever created.
--
-- FULL TRANSFER, by decision. If a matching character is currently owned by a DIFFERENT
-- profile, this re-points it to the Discord-authenticated caller. Discord identity wins,
-- always. That is deliberate: the Discord account is the durable hub, and a web profile
-- that no longer matches the Discord id (an old anonymous claim, a stale Google account)
-- should yield to it. The prior owner's TPDI responses and dispositions are moved along
-- with the character so nothing is orphaned by the transfer.
--
-- SECURITY DEFINER with a pinned search_path, matching claim_character_invite. The caller
-- is whoever is signed in; auth.uid() is trusted, the Discord id is read from the caller's
-- own identity row, so a caller can only ever claim characters that match THEIR Discord id.

create or replace function public.claim_by_discord()
returns table(campaign_share_code text, character_id uuid, character_name text)
language plpgsql
security definer
set search_path to 'public'
as $function$
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

      update public.dispositions
         set profile_id = v_uid
       where profile_id = v_char.old_owner
         and (character_id = v_char.id or scope = 'player');

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
end;
$function$;

-- Callable by any signed-in user. The function reads the caller's own Discord id, so it is
-- self-scoping: there is no parameter through which a caller could reach another person's
-- characters.
revoke all on function public.claim_by_discord() from public;
grant execute on function public.claim_by_discord() to authenticated;
