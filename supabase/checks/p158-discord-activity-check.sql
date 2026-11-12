-- p158-discord-activity-check.sql (2026-11-11, push 34). Read-only. Run after p158-discord-activity.sql.

-- 1. The three functions, service role only, and the ledger row.
select p.proname, array_to_string(p.proacl, ', ') as grants
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('activity_identity', 'activity_call', 'activity_watch_profile')
 order by 1;
select count(*) as ledger from public._migrations where name = 'p158-discord-activity';

-- 2. Campaigns the Activity can open: linked to a Discord server with /setup.
select name, discord_guild_id, discord_channel_id
  from public.campaigns
 where discord_guild_id is not null and deleted_at is null
 order by name;

-- 3. How many players each of those campaigns can recognise in Discord (signed in with Discord on the
--    website, or a character claimed with /claim that has an account behind it).
select c.name,
       (select count(distinct ch.profile_id) from public.characters ch
         where ch.campaign_id = c.id and ch.kind = 'pc' and ch.profile_id is not null
           and (ch.discord_user_id is not null
                or exists (select 1 from auth.identities i where i.user_id = ch.profile_id and i.provider = 'discord'))) as players_known_in_discord,
       (select count(*) from public.characters ch
         where ch.campaign_id = c.id and ch.kind = 'pc' and ch.discord_user_id is not null and ch.profile_id is null) as claimed_without_account
  from public.campaigns c
 where c.discord_guild_id is not null and c.deleted_at is null
 order by c.name;
