-- Security fixes surfaced by the base-schema dump.
--
-- Two of these are regressions introduced by p3-identity.sql and audio-retention-60d.sql.
-- One is pre-existing. All three are the same class of bug: a read path that is wider
-- than the data behind it.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. profiles.email was readable by every anonymous player.
-- ---------------------------------------------------------------------------
-- The existing policy is:
--     create policy "read profiles" for select to authenticated using (true)
--
-- `using (true)` means every authenticated user, and in this app anonymous players
-- ARE authenticated. That was harmless while profiles held only display_name. Then
-- p3-identity added email and avatar_url, and every guest at every table could
-- suddenly read the email address of every GM and player in the database.
--
-- The fix is NOT to lock profiles down entirely: several surfaces legitimately need
-- to render another member's display_name (the roster, RSVPs via rsvps_for_gm, the
-- chat author list). What they never need is the email.
--
-- So: split the read. A narrow view exposes the safe columns to campaign co-members;
-- the base table becomes self-only.

drop policy if exists "read profiles" on public.profiles;

-- You can always read your own full row (the /me hub needs the email to show which
-- account you are signed in as).
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- You can read the NAME of someone you actually share a campaign with. Not the email.
drop policy if exists "read co-member profile" on public.profiles;
create policy "read co-member profile" on public.profiles
  for select to authenticated
  using (
    exists (
      select 1
      from public.memberships m_them
      join public.memberships m_me
        on m_me.campaign_id = m_them.campaign_id
      where m_them.profile_id = public.profiles.id
        and m_me.profile_id   = auth.uid()
        and m_them.active and m_me.active
    )
    or exists (
      -- the GM of a campaign you are in, and the players in a campaign you GM
      select 1 from public.campaigns c
      where (c.gm_id = public.profiles.id and public.is_campaign_member(c.id))
         or (c.gm_id = auth.uid() and exists (
              select 1 from public.memberships m
              where m.campaign_id = c.id and m.profile_id = public.profiles.id and m.active
            ))
    )
  );

-- NOTE: this policy still returns the whole row, including email, to a co-member.
-- Postgres RLS is row-level, not column-level. To actually withhold the column,
-- application reads of OTHER people's profiles must go through this view, which
-- simply does not select email. Column-level grants below enforce it properly.
create or replace view public.profiles_public
with (security_invoker = true) as
  select id, display_name, avatar_url, is_anonymous
  from public.profiles;

comment on view public.profiles_public is
  'Safe projection of profiles: no email. Use this anywhere you render someone OTHER than the current user.';

grant select on public.profiles_public to authenticated;
revoke all on public.profiles_public from anon;

-- Column-level enforcement, so a co-member literally cannot select the email even
-- if they hit the base table directly. This is the part RLS cannot do on its own.
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, avatar_url, is_anonymous, created_at, updated_at, upgraded_at)
  on public.profiles to authenticated;
-- Only the owner reads their own email, and the "read own profile" policy is what
-- restricts that to auth.uid().
grant select (email) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Views bypass RLS and were granted to anon.
-- ---------------------------------------------------------------------------
-- A Postgres view runs as its OWNER (postgres) unless security_invoker is set, so
-- it bypasses row level security on the tables underneath. Every view here was
-- granted to anon with full privileges (Supabase's default grant), which means an
-- anonymous session could read them across ALL campaigns.
--
-- v_audio_due_for_purge is the worst of them: it exposes storage_path. That one is
-- mine, from audio-retention-60d.sql. The six analytics views are pre-existing and
-- have the same hole.
--
-- Two fixes, applied together:
--   a) security_invoker = true, so the view respects the caller's RLS
--   b) revoke anon, and revoke the nonsensical write grants on read-only views

alter view public.v_audio_due_for_purge      set (security_invoker = true);
alter view public.v_campaign_audio_retention set (security_invoker = true);
alter view public.v_session_spotlight        set (security_invoker = true);
alter view public.v_session_equity           set (security_invoker = true);
alter view public.v_session_gini             set (security_invoker = true);
alter view public.v_session_axis_engagement  set (security_invoker = true);
alter view public.v_arc_freshness            set (security_invoker = true);
alter view public.v_loot_fairness            set (security_invoker = true);

-- The retention views are operational, not player-facing. The cron uses the service
-- role, which bypasses RLS anyway, so nothing else needs access to the purge queue.
revoke all on public.v_audio_due_for_purge      from anon, authenticated;
grant select on public.v_audio_due_for_purge      to service_role;

-- The GM should see retention state for their own campaigns; security_invoker now
-- makes audio_tracks' own "gm all audio_tracks" policy do that scoping.
revoke all on public.v_campaign_audio_retention from anon;
grant select on public.v_campaign_audio_retention to authenticated, service_role;

-- Analytics views: read-only, and only for signed-in users. security_invoker now
-- scopes them per campaign through the underlying tables' policies.
revoke all on public.v_session_spotlight       from anon, authenticated;
revoke all on public.v_session_equity          from anon, authenticated;
revoke all on public.v_session_gini            from anon, authenticated;
revoke all on public.v_session_axis_engagement from anon, authenticated;
revoke all on public.v_arc_freshness           from anon, authenticated;
revoke all on public.v_loot_fairness           from anon, authenticated;

grant select on public.v_session_spotlight       to authenticated, service_role;
grant select on public.v_session_equity          to authenticated, service_role;
grant select on public.v_session_gini            to authenticated, service_role;
grant select on public.v_session_axis_engagement to authenticated, service_role;
grant select on public.v_arc_freshness           to authenticated, service_role;
grant select on public.v_loot_fairness           to authenticated, service_role;
