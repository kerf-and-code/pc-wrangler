-- Least privilege on the identity functions.
--
-- Postgres grants EXECUTE to PUBLIC by default on every newly created function.
-- p3-identity.sql granted to `authenticated` but never revoked that default, so
-- upgrade_profile_from_auth() ended up callable by PUBLIC and anon.
--
-- Nothing is exploitable through it: it is SECURITY DEFINER, it raises if
-- auth.uid() is null, it raises if the caller is still anonymous, and it only ever
-- updates `where p.id = auth.uid()`. So this is hygiene, not an incident. But an
-- auth-adjacent SECURITY DEFINER function should not be reachable by PUBLIC, and
-- the same default applies to every function we add from here.
--
-- Idempotent.

-- Upgrading a guest to a durable account requires being signed in and having
-- actually linked an identity. anon has no business calling it.
revoke all on function public.upgrade_profile_from_auth() from public, anon;
grant execute on function public.upgrade_profile_from_auth() to authenticated;

-- Claiming an invite requires a session (the function itself raises otherwise).
-- Anonymous players DO claim characters, so anon keeps execute here. This is
-- deliberate: it is the guest path, and the security guard added in p3-identity
-- is what makes it safe.
revoke all on function public.claim_character_invite(text) from public;
grant execute on function public.claim_character_invite(text) to anon, authenticated;

-- my_characters() resolves through auth.uid() and returns nothing without a
-- session. anon keeps execute so a guest can still see their own stable before
-- they upgrade, which is the whole pitch of the upgrade prompt.
revoke all on function public.my_characters() from public;
grant execute on function public.my_characters() to anon, authenticated;
