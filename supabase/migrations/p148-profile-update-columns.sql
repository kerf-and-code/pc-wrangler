-- supabase/migrations/p148-profile-update-columns.sql (2026-11-10)
--
-- Security fix, found while building the owner console (audit F10). Safe to run twice.
--
-- profiles had a table-wide UPDATE grant for anon and authenticated, and the row policy "update own
-- profile" (id = auth.uid()). Together they let any signed-in account, including an anonymous
-- share-link player, update every column of its own row from the browser:
--   update profiles set access_granted = true, access_role = 'gm' where id = auth.uid()
-- which opens the GM tools and the AI and image spend that hasGmAccess guards. The proxy and /api/gate
-- were written on the assumption that only the service role could set those columns.
--
-- After this, signed-in accounts may update display_name only, the one column the app writes from the
-- browser (app/me/settings). Every other profile write (the access code in /api/gate, the owner
-- console, accept_terms, sync_my_email) runs with the service role or as a security definer function,
-- so nothing the app does is affected. The row policy stays as it is.

revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

insert into public._migrations (name) values ('p148-profile-update-columns') on conflict do nothing;
