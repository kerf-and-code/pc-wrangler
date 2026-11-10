-- supabase/migrations/p145-data-rights-legal.sql (2026-11-10)
--
-- Push 9, data rights and legal.
--
-- T14, G11  export_my_data() and delete_my_account() were written at p6 and never caught up. The export
--           now also carries: each character's full sheet (build, page blocks, portrait, system), your
--           personal notes, your library builds, your character identities, the character page sections
--           you wrote, your table attendance and poll answers, your AI map renders, your roll keys (when
--           and where, never the key), your email preferences, your custom tiles, the campaigns you run,
--           and campaign handovers you offered. Deletion now also removes the character page sections
--           you wrote, your AI render log, your custom tiles and your email preferences, clears your
--           name from capture jobs you created and passes codex entries you created to the campaign's
--           GM (those rows used to block the delete outright), and returns the picture paths that are only yours (library portraits, custom
--           tiles) so the route can remove them. delete_my_account() is not in the live schema dump of
--           2026-11-09, so this also makes sure it exists. Otherwise both are as before (export: the
--           live definition; delete: p6, the only migration that ever defined it).
-- T13       profiles.terms_accepted_at and terms_version, set by accept_terms(); my_terms() reads them.
--           Every signed-in (non-guest) account is asked once to confirm it is 18+ and agrees to the
--           Terms and Privacy Policy (components/terms-gate.tsx); email sign-up asks on the form.
-- F12       sync_my_email() copies the address from the sign-in record to the profile after an email
--           change, so the settings page and anything reading profiles.email shows the new one.
-- T23       The campaign-maps bucket takes only images and audio, up to 60 MB (the largest upload the
--           app allows is a 60 MB battle map), as p133 did for table-files.
--
-- Idempotent. Run by hand after p144, BEFORE deploying this push, then
-- supabase/checks/p145-data-rights-legal-check.sql.

-- ------------------------------------------------------------------------------------------- T13
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists terms_version text;

create or replace function public.accept_terms(p_version text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_version is null or char_length(p_version) not between 1 and 32 then raise exception 'bad terms version'; end if;
  update public.profiles
     set terms_accepted_at = now(), terms_version = p_version, updated_at = now()
   where id = auth.uid();
end;
$function$;
revoke all on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;

create or replace function public.my_terms()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object('accepted_at', p.terms_accepted_at, 'version', p.terms_version, 'is_anonymous', p.is_anonymous)
    from public.profiles p where p.id = auth.uid();
$function$;
revoke all on function public.my_terms() from public, anon;
grant execute on function public.my_terms() to authenticated;

-- ------------------------------------------------------------------------------------------- F12
create or replace function public.sync_my_email()
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_email text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select u.email into v_email from auth.users u where u.id = auth.uid();
  if nullif(v_email, '') is not null then
    update public.profiles set email = v_email, updated_at = now()
     where id = auth.uid() and email is distinct from v_email;
  end if;
  return v_email;
end;
$function$;
revoke all on function public.sync_my_email() from public, anon;
grant execute on function public.sync_my_email() to authenticated;

-- ------------------------------------------------------------------------------------------- T23
do $t23$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = 62914560 where id = 'campaign-maps';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set allowed_mime_types = array['image/*', 'audio/*'] where id = 'campaign-maps';
  end if;
end $t23$;

-- --------------------------------------------------------------------------------------- T14, G11
-- Tables that may not exist on every database (custom_tiles, p87) are read through to_regclass and
-- dynamic SQL, so the function never fails on a missing table.
create or replace function public.export_my_data()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_out   jsonb;
  v_tiles jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  if to_regclass('public.custom_tiles') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('scope', t.scope, 'label', t.label, 'color', t.color,
               'image_url', t.image_url, 'created_at', t.created_at) order by t.created_at), '[]'::jsonb)
        from public.custom_tiles t where t.profile_id = $1 $q$
      into v_tiles using v_uid;
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'notice', 'Everything Six Axes holds that is linked to your account. Session audio is deleted automatically 60 days after recording, so older recordings will not appear here because they no longer exist. Campaigns you run as GM are listed here; their full contents (codex, sessions, recaps, maps and files) come from the campaign export in the GM workspace.',

    'profile', (
      select to_jsonb(p) - 'id'
      from public.profiles p where p.id = v_uid
    ),

    -- p145: the whole sheet as well (build), the character page blocks, portrait and system.
    'characters', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', ch.name, 'campaign', c.name, 'system', ch.system, 'species', ch.species,
        'species_variant', ch.species_variant, 'class', ch.class,
        'subclass', ch.subclass, 'level', ch.level, 'alignment', ch.alignment,
        'description', ch.description, 'summary', ch.summary, 'portrait_url', ch.portrait_url,
        'build', ch.build, 'page_blocks', ch.blocks, 'created_at', ch.created_at
      ) order by c.name, ch.name), '[]'::jsonb)
      from public.characters ch
      join public.campaigns c on c.id = ch.campaign_id
      where ch.profile_id = v_uid
    ),

    -- p145: the character page sections you wrote.
    'character_pages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'character', ch.name, 'title', w.title, 'body', w.body, 'visibility', w.visibility,
        'created_at', w.created_at, 'updated_at', w.updated_at
      ) order by ch.name, w."position"), '[]'::jsonb)
      from public.character_wiki_sections w
      left join public.characters ch on ch.id = w.character_id
      where w.owner_id = v_uid
    ),

    -- p145: your character library (builds kept outside any campaign).
    'library', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', l.name, 'system', l.system, 'species', l.species, 'species_variant', l.species_variant,
        'class', l.class, 'subclass', l.subclass, 'level', l.level, 'portrait_url', l.portrait_url,
        'build', l.build, 'created_at', l.created_at, 'updated_at', l.updated_at
      ) order by l.name), '[]'::jsonb)
      from public.pc_library l where l.profile_id = v_uid
    ),

    -- p145: the same character across campaigns.
    'character_identities', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', ci.name, 'species', ci.species, 'species_variant', ci.species_variant,
        'class', ci.class, 'subclass', ci.subclass, 'created_at', ci.created_at
      ) order by ci.name), '[]'::jsonb)
      from public.character_identities ci where ci.profile_id = v_uid
    ),

    -- p145: your private notes.
    'notes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'campaign', c.name, 'about_entry', n.entry_id, 'body', n.body,
        'created_at', n.created_at, 'updated_at', n.updated_at
      ) order by n.created_at), '[]'::jsonb)
      from public.player_notes n
      left join public.campaigns c on c.id = n.campaign_id
      where n.profile_id = v_uid
    ),

    -- The self-perception series. Every snapshot, dated, not just the latest.
    'self_reports', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'scope', t.scope, 'taken_at', t.created_at,
        'instrument_version', t.instrument_version,
        'answers', t.answers, 'scores', t.scores, 'safety', t.safety
      ) order by t.created_at), '[]'::jsonb)
      from public.tpdi_responses t where t.respondent_id = v_uid
    ),

    'dispositions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'scope', d.scope, 'source', d.source, 'as_of', d.as_of,
        'model_version', d.model_version, 'axis_scores', d.axis_scores,
        'uncertainty', d.weights
      ) order by d.as_of desc), '[]'::jsonb)
      from public.dispositions d where d.profile_id = v_uid
    ),

    'threads', (
      select coalesce(jsonb_agg(to_jsonb(th) - 'profile_id' - 'id'), '[]'::jsonb)
      from public.threads th where th.profile_id = v_uid
    ),

    'check_ins', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'satisfaction', v.satisfaction, 'spotlight', v.spotlight_feeling,
        'note', v.note, 'at', v.created_at
      ) order by v.created_at), '[]'::jsonb)
      from public.vibe_checks v where v.profile_id = v_uid
    ),

    -- p145: which sessions you were at, and when you said you could play.
    'attendance', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'campaign', c.name, 'session', s.session_number, 'status', a.status
      ) order by c.name, s.session_number), '[]'::jsonb)
      from public.attendance a
      join public.sessions s on s.id = a.session_id
      join public.campaigns c on c.id = a.campaign_id
      where a.profile_id = v_uid
    ),
    'poll_answers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'character', ch.name, 'available', pr.available, 'updated_at', pr.updated_at
      ) order by pr.updated_at), '[]'::jsonb)
      from public.poll_responses pr
      join public.characters ch on ch.id = pr.character_id
      where ch.profile_id = v_uid
    ),

    'chat_messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'body', m.body, 'at', m.created_at
      ) order by m.created_at), '[]'::jsonb)
      from public.chat_messages m where m.author_profile = v_uid
    ),

    -- What you said and rolled in table chat on the tabletop (p105).
    'table_chat', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', tm.kind, 'as', tm.as_name, 'body', tm.body, 'roll', tm.roll, 'at', tm.created_at
      ) order by tm.created_at), '[]'::jsonb)
      from public.vtt_messages tm where tm.author_profile = v_uid
    ),

    -- Your words, as transcribed. This is the most personal thing in the system
    -- after the audio itself, and it belongs in an export.
    'transcript_segments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'text', ts.text, 'start_ms', ts.start_ms, 'at', ts.created_at
      ) order by ts.created_at), '[]'::jsonb)
      from public.transcript_segments ts
      join public.characters ch on ch.id = ts.character_id
      where ch.profile_id = v_uid
    ),

    'recordings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'recorded_at', a.created_at,
        'duration_seconds', a.duration_seconds,
        'status', case when a.purged_at is not null
                       then 'deleted under the 60-day retention policy'
                       else 'retained' end,
        'deleted_at', a.purged_at
      ) order by a.created_at desc), '[]'::jsonb)
      from public.audio_tracks a
      join public.characters ch on ch.id = a.character_id
      where ch.profile_id = v_uid
    ),

    'recording_consents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'consented', rc.consented, 'method', rc.method, 'at', rc.created_at,
        'scope', case when rc.session_id is null then 'standing (campaign-wide)'
                      else 'this session only' end
      ) order by rc.created_at), '[]'::jsonb)
      from public.recording_consents rc where rc.profile_id = v_uid
    ),

    -- p145: account-level settings and logs.
    'email_preferences', (
      select to_jsonb(ep) from public.email_prefs ep where ep.email = v_email
    ),
    'roll_keys', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'campaign', c.name, 'kind', k.kind, 'created_at', k.created_at,
        'last_used_at', k.last_used_at, 'retired_at', k.revoked_at
      ) order by k.created_at), '[]'::jsonb)
      from public.vtt_ingest_keys k
      left join public.campaigns c on c.id = k.campaign_id
      where k.profile_id = v_uid
    ),
    'ai_map_renders', (
      select coalesce(jsonb_agg(jsonb_build_object('campaign', c.name, 'kind', r.kind, 'at', r.created_at)
               order by r.created_at), '[]'::jsonb)
      from public.ai_map_renders r
      left join public.campaigns c on c.id = r.campaign_id
      where r.profile_id = v_uid
    ),
    'custom_tiles', v_tiles,

    -- p145: what you run as GM, and handovers you offered.
    'campaigns_you_run', (
      select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'created_at', c.created_at) order by c.name), '[]'::jsonb)
      from public.campaigns c where c.gm_id = v_uid
    ),
    'campaign_handovers_offered', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'campaign', c.name, 'to_email', t.to_email, 'offered_at', t.created_at,
        'accepted_at', t.accepted_at, 'cancelled_at', t.cancelled_at
      ) order by t.created_at), '[]'::jsonb)
      from public.campaign_transfers t
      left join public.campaigns c on c.id = t.campaign_id
      where t.from_id = v_uid
    )
  ) into v_out;

  return v_out;
end;
$function$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- Postgres cannot reach the storage API, so this does the database half and hands back the object
-- paths. The route deletes the objects, and only then the auth user (which cascades this profile).
create or replace function public.delete_my_account()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_paths    text[];
  v_maps     text[] := '{}';
  v_tiles    text[] := '{}';
  v_blockers jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  v_blockers := public.my_deletion_blockers();
  if not (v_blockers->>'can_delete')::boolean then
    raise exception 'You still run one or more campaigns. Hand each one to another GM first, or delete it, so your players do not lose their history along with you.';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  -- Collect the audio object paths BEFORE unlinking the characters that point to them.
  select coalesce(array_agg(a.storage_path), '{}')
    into v_paths
  from public.audio_tracks a
  join public.characters ch on ch.id = a.character_id
  where ch.profile_id = v_uid
    and a.storage_path is not null;

  -- p145: pictures that are only yours. Library portraits no campaign character still shows, and your
  -- custom tiles. Character portraits stay: the characters stay in their campaigns.
  select coalesce(array_agg(distinct l.portrait_url), '{}')
    into v_maps
  from public.pc_library l
  where l.profile_id = v_uid
    and nullif(l.portrait_url, '') is not null
    and l.portrait_url !~ '^https?://'
    and not exists (select 1 from public.characters ch where ch.portrait_url = l.portrait_url);

  if to_regclass('public.custom_tiles') is not null then
    execute $q$
      select coalesce(array_agg(split_part(t.image_url, '/campaign-maps/', 2)), '{}')
        from public.custom_tiles t
       where t.profile_id = $1 and t.image_url like '%/campaign-maps/%' $q$
      into v_tiles using v_uid;
    execute 'delete from public.custom_tiles where profile_id = $1' using v_uid;
  end if;

  -- --- DELETE: things that are ABOUT THE PERSON -----------------------------

  -- Your words. Deleted with the audio they came from.
  delete from public.transcript_segments ts
   using public.characters ch
   where ch.id = ts.character_id and ch.profile_id = v_uid;

  -- Your voice. The rows go; the route removes the objects.
  delete from public.audio_tracks a
   using public.characters ch
   where ch.id = a.character_id and ch.profile_id = v_uid;

  delete from public.tpdi_responses     where respondent_id = v_uid;
  delete from public.vibe_checks        where profile_id    = v_uid;
  delete from public.chat_messages      where author_profile = v_uid;
  delete from public.chat_grants        where player_profile = v_uid;
  delete from public.recording_consents where profile_id = v_uid or recorded_by = v_uid;
  delete from public.attendance         where profile_id = v_uid;
  delete from public.disposition_reveals where profile_id = v_uid or revealed_by = v_uid;
  -- p145: the character page sections you wrote, your AI render log, your email preferences.
  delete from public.character_wiki_sections where owner_id = v_uid;
  delete from public.ai_map_renders     where profile_id = v_uid;
  if v_email is not null then
    delete from public.email_prefs where email = v_email;
  end if;
  -- dispositions, threads, memberships, notes, library, identities, table chat, roll keys and the
  -- tabletop rows you own cascade from profiles or auth.users. Named here so the next reader does not
  -- have to go and check.

  -- --- RETAIN, UNLINKED: the campaign's own story ---------------------------
  -- The character stays in the campaign. The events still happened. What goes is the
  -- thread connecting them to a person.
  update public.events     set actor_profile_id = null where actor_profile_id = v_uid;
  update public.arcs       set profile_id       = null where profile_id       = v_uid;
  -- p145: capture jobs and codex entries you created keep existing for the campaign; these two
  -- references have no ON DELETE rule, so left in place they stopped the account being deleted.
  -- An entry must have a creator, so it passes to the campaign's GM (you no longer run it, or the
  -- check above would have stopped here).
  update public.capture_jobs set created_by = null where created_by = v_uid;
  update public.entries e set created_by = c.gm_id
    from public.campaigns c where c.id = e.campaign_id and e.created_by = v_uid;
  update public.poll_responses pr set discord_user_id = null
    from public.characters ch where ch.id = pr.character_id and ch.profile_id = v_uid;
  update public.characters set profile_id = null, discord_user_id = null, ddb_character_id = null
   where profile_id = v_uid;

  -- gm_identities is ON DELETE SET NULL already.

  return jsonb_build_object(
    'ok', true,
    'storage_paths', to_jsonb(v_paths),
    'map_paths', to_jsonb(v_maps || v_tiles),
    'note', 'Database rows removed. The caller must now delete the storage objects and then the auth user.'
  );
end;
$function$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
