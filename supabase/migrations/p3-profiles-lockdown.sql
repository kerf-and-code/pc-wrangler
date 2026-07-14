-- Close the residual email exposure on profiles.
--
-- p3-security-fixes.sql left one gap, and I want it shut rather than documented.
--
-- THE GAP: `"read co-member profile"` granted ROW access on public.profiles to
-- anyone sharing a campaign with you. Postgres RLS is row-level and cannot hide a
-- column, and `authenticated` holds select(email). So a co-member querying
-- public.profiles directly could still read your email. profiles_public was the
-- safe path, but it only protects you if the app remembers to use it. That is a
-- convention, not a wall.
--
-- WHY IT IS FREE TO CLOSE: the app never queries public.profiles directly. Not
-- once, anywhere. Every read of another person's name already goes through a
-- SECURITY DEFINER RPC (rsvps_for_gm, gm_chat_read, roster_for_share, and the
-- rest), which bypasses RLS entirely and is unaffected by any policy here.
--
-- So the co-member policy was protecting nothing and exposing something.
--
-- AFTER THIS: public.profiles is strictly self-only. Reading anyone else goes
-- through profiles_public (no email) or an existing RPC. There is no path by which
-- one player reads another player's email address.
--
-- Idempotent.

drop policy if exists "read co-member profile" on public.profiles;

-- Self-only remains. (Restated for clarity; already created in p3-security-fixes.)
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- profiles_public is now the ONLY way to read another person from the table, and it
-- does not select email. security_invoker is on, so it still respects RLS, which
-- means it too would return nothing for another person... which is why it needs its
-- own scoping. Recreate it as SECURITY DEFINER-equivalent: owner-run, but exposing
-- only the safe columns. This is the correct shape: the column set IS the security
-- boundary, so there is nothing left for row policies to protect.
create or replace view public.profiles_public
with (security_invoker = false) as
  select id, display_name, avatar_url, is_anonymous
  from public.profiles;

comment on view public.profiles_public is
  'The only read path to another person''s profile. No email, ever. Runs as owner (security_invoker off) because the column set, not RLS, is the boundary here: display_name and avatar_url are already visible through the roster and chat RPCs.';

revoke all on public.profiles_public from anon, authenticated;
grant select on public.profiles_public to authenticated;
