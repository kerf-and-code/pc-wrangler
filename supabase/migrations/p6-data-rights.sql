-- D6: data rights. Export and deletion.
--
-- WHY THIS IS URGENT AND NOT POLISH.
--
-- The live privacy policy says, in production, today:
--
--   "You can export or delete your data."
--   "You can delete specific items (such as a recording) in the app."
--   "you can delete your account"
--   "...contact [PRIVACY CONTACT EMAIL] and we will delete it."   <- COPPA notice
--
-- None of that was true, and the last one is a child-safety commitment addressed to
-- an empty bracket. A promise about people's voices, made and not kept, is worse
-- than a promise never made.
--
-- WHAT DELETION ACTUALLY MEANS HERE, AND THE LINE I DREW.
--
-- A player's data is entangled with a GM's campaign. Deleting a player must not
-- destroy the story their table told together. So:
--
--   DELETED   everything that is ABOUT THE PERSON: their voice (audio), their words
--             (transcript segments), their self-report, their check-ins, their
--             private threads, their dispositions, their chat, their consents.
--
--   RETAINED  the campaign's own record: the events, the arcs, the characters. The
--             character stays in the campaign, UNLINKED from the person. The story
--             happened; who was behind the mask is the personal part, and that goes.
--
-- This is a defensible line and it is stated plainly in the policy rather than buried.
--
-- TEN FOREIGN KEYS BLOCK A PROFILE DELETE (arcs, attendance, campaigns, capture_jobs,
-- characters, entries, events, recording_consents x2, vibe_checks), all NO ACTION,
-- and entries.created_by is NOT NULL so it cannot even be nulled. Each is handled
-- explicitly below rather than left to a cascade nobody wrote.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. EXPORT. Everything we hold about you, as one JSON document.
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'notice', 'Everything Six Axes holds that is linked to your account. Session audio is deleted automatically 60 days after recording, so older recordings will not appear here because they no longer exist.',

    'profile', (
      select to_jsonb(p) - 'id'
      from public.profiles p where p.id = v_uid
    ),

    'characters', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', ch.name, 'campaign', c.name, 'species', ch.species,
        'species_variant', ch.species_variant, 'class', ch.class,
        'subclass', ch.subclass, 'level', ch.level, 'alignment', ch.alignment,
        'description', ch.description, 'created_at', ch.created_at
      ) order by c.name, ch.name), '[]'::jsonb)
      from public.characters ch
      join public.campaigns c on c.id = ch.campaign_id
      where ch.profile_id = v_uid
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

    'chat_messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'body', m.body, 'at', m.created_at
      ) order by m.created_at), '[]'::jsonb)
      from public.chat_messages m where m.author_profile = v_uid
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
    )
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. WHAT WOULD BLOCK MY DELETION? Ask before you pull the lever.
-- ---------------------------------------------------------------------------
-- A GM cannot simply vanish: campaigns.gm_id is NOT NULL and points at them, and
-- their players' entire history hangs off those campaigns. Deleting a GM by cascade
-- would take other people's data with them, which is not a data right, it is a data
-- loss. They must transfer or delete their campaigns first, and we say so instead of
-- failing with a foreign key error.
create or replace function public.my_deletion_blockers()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'campaigns_i_run', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)), '[]'::jsonb)
      from public.campaigns c where c.gm_id = auth.uid()
    ),
    'can_delete', not exists (select 1 from public.campaigns c where c.gm_id = auth.uid())
  );
$$;

revoke all on function public.my_deletion_blockers() from public, anon;
grant execute on function public.my_deletion_blockers() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. DELETE. Returns the storage paths the caller must then purge.
-- ---------------------------------------------------------------------------
-- Postgres cannot reach the storage API, so this function does the database half and
-- hands back the object paths. The ROUTE deletes the objects, and only then deletes
-- the auth user (which cascades this profile away). Order matters: if we dropped the
-- profile first, we would lose the ability to find the audio, and the person's voice
-- would sit in a bucket forever with nothing pointing at it.
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_paths text[];
  v_blockers jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  v_blockers := public.my_deletion_blockers();
  if not (v_blockers->>'can_delete')::boolean then
    raise exception 'You still run one or more campaigns. Delete or hand them over first, so your players do not lose their history along with you.';
  end if;

  -- Collect the audio object paths BEFORE unlinking the characters that point to them.
  select coalesce(array_agg(a.storage_path), '{}')
    into v_paths
  from public.audio_tracks a
  join public.characters ch on ch.id = a.character_id
  where ch.profile_id = v_uid
    and a.storage_path is not null;

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
  -- dispositions, threads, memberships cascade from profiles. Named here so the next
  -- reader does not have to go and check.

  -- --- RETAIN, UNLINKED: the campaign's own story ---------------------------
  -- The character stays in the campaign. The events still happened. What goes is the
  -- thread connecting them to a person.
  update public.events     set actor_profile_id = null where actor_profile_id = v_uid;
  update public.arcs       set profile_id       = null where profile_id       = v_uid;
  update public.characters set profile_id = null, discord_user_id = null, ddb_character_id = null
   where profile_id = v_uid;

  -- gm_identities is ON DELETE SET NULL already.

  return jsonb_build_object(
    'ok', true,
    'storage_paths', to_jsonb(v_paths),
    'note', 'Database rows removed. The caller must now delete the storage objects and then the auth user.'
  );
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
