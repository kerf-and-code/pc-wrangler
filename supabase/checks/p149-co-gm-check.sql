-- p149-co-gm-check.sql (2026-11-10, push 18). Read-only. Run before and after p149-co-gm.sql.

-- 1. Memberships that make someone a GM without owning the campaign. Before p149 any player could
--    create one of these by setting role on their own row. Expect only real co-GMs you invited after
--    p149; anything else is worth a look (the owner can remove it from the Workspace GMs panel).
select c.name as campaign, m.profile_id, p.display_name, m.role, m.active, m.joined_at
  from public.memberships m
  join public.campaigns c on c.id = m.campaign_id
  left join public.profiles p on p.id = m.profile_id
 where m.role in ('gm', 'co-gm') and m.profile_id <> c.gm_id
 order by c.name, m.joined_at;

-- 2. The guards. After p149: both rows, enabled = 'O'.
select tgrelid::regclass as on_table, tgname, tgenabled as enabled
  from pg_trigger
 where tgname in ('memberships_gm_guard', 'campaigns_owner_guard');

-- 3. Policies still comparing campaigns.gm_id to the caller. After p149 expect only the owner-only
--    ones: campaigns (create, delete, read), compendium_entries, dm_boards, stat_blocks.
select schemaname, tablename, policyname, cmd
  from pg_policies
 where schemaname in ('public', 'storage')
   and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'gm_id = (auth\.uid\(\)|\( SELECT auth\.uid\(\) AS uid\))'
 order by 1, 2, 3;

-- 4. Functions that mention gm_id. After p149 the ones left compare it only for owner actions, per-
--    account data, or display: the transfer functions, trash/restore/my_trashed_campaigns,
--    delete_campaign, my_deletion_blockers, export_my_data, delete_my_account, claim_by_discord and
--    discord_claim_allowed (a GM as placeholder owner), can_write_statblock_portrait (stat blocks are
--    per account), my_campaigns and tabletop_state (the owner's name), is_campaign_gm, and p149's own
--    functions and guards.
select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosrc ~ 'gm_id'
 order by 1;

-- 5. The new pieces and the ledger.
select to_regclass('public.campaign_gm_invites') as invites_table,
       to_regprocedure('public.accept_gm_invite(uuid)') as accept_rpc,
       to_regprocedure('public.campaign_gm_of(uuid,uuid)') as gm_of,
       (select count(*) from public._migrations where name = 'p149-co-gm') as ledger;

-- 6. Invites so far.
select c.name as campaign, i.created_at, i.expires_at, i.accepted_at, i.revoked_at
  from public.campaign_gm_invites i join public.campaigns c on c.id = i.campaign_id
 order by i.created_at desc limit 20;
