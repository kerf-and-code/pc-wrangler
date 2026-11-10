-- supabase/checks/p135-audit-claims-ai-caps-check.sql (2026-11-09)
-- Read-only. Run after p135.

-- 1. The pieces are in place. Expect kind_column true, rule_function true, claim_uses_rule true.
select exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'ai_map_renders' and column_name = 'kind') as kind_column,
       to_regprocedure('public.discord_claim_allowed(uuid, uuid, text)') is not null as rule_function,
       position('discord_claim_allowed' in pg_get_functiondef('public.claim_by_discord()'::regprocedure)) > 0 as claim_uses_rule;

-- 2. Signed-in users cannot call the rule directly; the server can. Expect authenticated false, service_role true.
select has_function_privilege('authenticated', 'public.discord_claim_allowed(uuid, uuid, text)', 'execute') as authenticated,
       has_function_privilege('service_role', 'public.discord_claim_allowed(uuid, uuid, text)', 'execute') as service_role;

-- 3. Characters the new rule would now protect: linked to a Discord id, owned by a real account that is
--    not the GM and not signed in with that Discord id. Each row is a character a /claim could have
--    taken before. Look for any where the owner and the Discord link belong to DIFFERENT players: that
--    is a past takeover (or a shared account) for the GM to fix. Ids only, no names or emails.
select c.campaign_id, c.id as character_id, c.profile_id as owner, c.discord_user_id
  from public.characters c
 where c.kind = 'pc' and c.discord_user_id is not null and c.profile_id is not null
   and not public.discord_claim_allowed(c.profile_id, c.campaign_id, c.discord_user_id)
 order by c.campaign_id;

-- 4. AI calls per kind in the last 24 hours and 7 days, to see the new caps against real use.
select kind,
       count(*) filter (where created_at > now() - interval '24 hours') as last_24h,
       count(*) filter (where created_at > now() - interval '7 days') as last_7d,
       max(created_at) as latest
  from public.ai_map_renders group by kind order by kind;

-- 5. Campaign owners whose AI calls (map renders, paintings, traces, imports) are now refused because
--    their account never entered the GM access code. Expect none you care about. If your own account is
--    listed, enter the GM code at /enter (or tell me and we will look at why the flag is not set).
select c.gm_id, count(*) as campaigns, p.access_granted, p.access_role
  from public.campaigns c left join public.profiles p on p.id = c.gm_id
 where not coalesce(p.access_granted and p.access_role = 'gm', false)
 group by c.gm_id, p.access_granted, p.access_role
 order by campaigns desc;
