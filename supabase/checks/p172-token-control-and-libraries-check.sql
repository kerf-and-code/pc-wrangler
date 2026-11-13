-- supabase/checks/p172-token-control-and-libraries-check.sql (push 51). Read only. Every row should say ok.

select 'migration recorded' as what,
       case when exists (select 1 from public._migrations where name = 'p172-token-control-and-libraries') then 'ok' else 'MISSING' end as result
union all
select 'the eight token functions use tabletop_controls',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.prosrc like '%tabletop_controls(%'
                     and p.proname in ('tabletop_can_edit_token', 'tabletop_move_token', 'tabletop_set_token_markers', 'tabletop_set_token_elevation',
                                       'tabletop_set_doors', 'tabletop_token_floor', 'tabletop_state', 'tabletop_token_visible')) = 8 then 'ok' else 'NOT ALL' end
union all
select 'players put effects only on tokens they control',
       case when exists (select 1 from pg_policy where polrelid = 'public.vtt_effects'::regclass and polname = 'vtt_effects_player_insert'
                          and pg_get_expr(polwithcheck, polrelid) like '%tabletop_can_edit_token%') then 'ok' else 'OLD RULE' end
union all
select 'token library, own rows only',
       case when to_regclass('public.vtt_token_library') is null then 'MISSING'
            when has_table_privilege('anon', 'public.vtt_token_library', 'select') then 'OPEN' else 'ok' end
union all
select 'monster pictures follow the monster',
       case when (select count(*) from pg_trigger where tgname in ('vtt_tokens_monster_look_in', 'vtt_tokens_monster_look_out') and not tgisinternal) = 2 then 'ok' else 'MISSING' end
union all
select 'controlled_by holds characters (rows still holding something else)',
       case when exists (select 1 from public.vtt_tokens t, unnest(t.controlled_by) u(v)
                          where not exists (select 1 from public.characters c where c.id = u.v)) then 'FOUND' else 'ok' end;
