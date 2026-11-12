-- p163-npc-text-fix.sql (2026-11-11, push 40: NPC text that landed on locations)
--
-- The old Review bug (fixed 2026-08-02) wrote an NPC's beat text onto the LOCATION from the same beat and
-- left the NPC with no description, so places read as character sheets and NPCs read as empty. This moves
-- the text back where it belongs, for rows where that is unambiguous:
--   a location with text, linked (entity_links) to exactly ONE NPC; that NPC's description is empty; and
--   the location's text names that NPC.
-- The NPC gets the text as its description and the location is left empty, which is honest: an empty
-- place reads as "not described yet", a mislabelled one misleads.
--
-- ONLY the campaigns of the GM who runs Emberwatch are touched, so another GM's campaign (CandleKeep
-- Tuesday) never is. Run supabase\checks\npc-text-in-locations-check.sql FIRST and read every row.
--
-- Every move is recorded in npc_text_fix_backup (old text on both sides), so it can be undone:
--   update public.entries e set body = b.old_entry_body from public.npc_text_fix_backup b where b.entry_id = e.id;
--   update public.characters c set description = b.old_char_description from public.npc_text_fix_backup b where b.character_id = c.id;
-- The backup table has row level security and no policies: only the SQL editor reads it.
--
-- Idempotent: a row already moved has an NPC description, so it no longer qualifies.

create table if not exists public.npc_text_fix_backup (
  entry_id              uuid not null,
  character_id          uuid not null,
  campaign_id           uuid not null,
  old_entry_body        text,
  old_char_description  text,
  fixed_at              timestamptz not null default now(),
  primary key (entry_id, character_id)
);
alter table public.npc_text_fix_backup enable row level security;
revoke all on public.npc_text_fix_backup from anon, authenticated;

do $$
declare
  v_gm uuid := (select gm_id from public.campaigns where name = 'Emberwatch' order by created_at limit 1);
  r record;
  n integer := 0;
begin
  if v_gm is null then raise notice 'No Emberwatch campaign found, so nothing was changed.'; return; end if;
  for r in
    with links as (
      select case when l.source_type = 'entry' then l.source_id else l.target_id end as entry_id,
             case when l.source_type = 'character' then l.source_id else l.target_id end as character_id
        from public.entity_links l
       where (l.source_type = 'entry' and l.target_type = 'character')
          or (l.source_type = 'character' and l.target_type = 'entry')
    ),
    npc_links as (
      select distinct lk.entry_id, lk.character_id
        from links lk join public.characters ch on ch.id = lk.character_id and ch.kind = 'npc'
    ),
    one_npc as (
      select entry_id from npc_links group by entry_id having count(distinct character_id) = 1
    )
    select e.id as entry_id, ch.id as character_id, e.campaign_id, e.body, ch.description
      from npc_links nl
      join one_npc o on o.entry_id = nl.entry_id
      join public.entries e on e.id = nl.entry_id and e.type = 'location'
      join public.characters ch on ch.id = nl.character_id
      join public.campaigns c on c.id = e.campaign_id and c.gm_id = v_gm
     where coalesce(trim(e.body), '') <> ''
       and coalesce(trim(ch.description), '') = ''
       and position(lower(ch.name) in lower(e.body)) > 0
  loop
    insert into public.npc_text_fix_backup (entry_id, character_id, campaign_id, old_entry_body, old_char_description)
    values (r.entry_id, r.character_id, r.campaign_id, r.body, r.description)
    on conflict (entry_id, character_id) do nothing;
    update public.characters set description = r.body where id = r.character_id;
    update public.entries set body = '' where id = r.entry_id;
    n := n + 1;
  end loop;
  raise notice 'Moved the text of % location(s) to their NPC.', n;
end;
$$;

insert into public._migrations (name) values ('p163-npc-text-fix') on conflict do nothing;
