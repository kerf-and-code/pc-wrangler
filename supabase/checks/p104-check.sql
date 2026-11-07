-- p104-check.sql: run after p104-battle-maps.sql. Read-only.

-- 1. the helper the policy uses exists (expect one row)
select proname from pg_proc where proname = 'is_campaign_gm';

-- 2. the table, its RLS switch and its policy (expect rls_on = true and one policy row)
select c.relname, c.relrowsecurity as rls_on from pg_class c where c.relname = 'battle_maps';
select policyname, cmd, qual, with_check from pg_policies where tablename = 'battle_maps';

-- 3. maps per campaign (empty until a GM opens the Battle maps tab; then the old dungeon is copied over)
select campaign_id, count(*) as maps, max(updated_at) as last_edit
from public.battle_maps group by campaign_id order by last_edit desc;
