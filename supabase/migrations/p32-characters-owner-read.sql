-- ============================================================================
-- p32-characters-owner-read.sql
-- A player can read their own character.
--
-- THE BUG
--   The SELECT policy on characters was `is_campaign_member(campaign_id)`, which reads the
--   memberships table. Players never get membership rows in this app - that is the design, stated
--   in app/me/campaigns/page.tsx and enforced by my_campaigns(), which derives a player's campaign
--   list entirely from characters they OWN and never touches memberships at all.
--
--   So no player has ever been able to read a campaign character under their own session. It went
--   unnoticed because every other player-facing path is scoped some other way: Discord claim and
--   consent go through the bot, capture through the sidecar, recaps and journals through a share
--   code, the roster through the GM. The Forge is the FIRST page that reads characters under a
--   player's own token, so it is the first place the gap could surface - which it did, as
--   "That character could not be loaded" on a character the player owns.
--
-- WHY OWNERSHIP IS THE RIGHT SIGNAL HERE
--   The UPDATE policy already accepts it: `is_campaign_gm(campaign_id) OR profile_id = auth.uid()`.
--   A player could edit a character they could not read, which is incoherent on its own terms - the
--   select was not protecting anything the update did not already allow.
--
-- SCOPE: OWN CHARACTERS ONLY. This does NOT let a player read the rest of the party. If a party
-- view is wanted later that is a separate, deliberate widening; granting it here as a side effect
-- of a bug fix would be the wrong way to make that decision.
--
-- No data fix is needed. The 19 characters with no membership row are correct as they are.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

drop policy if exists "members read characters" on public.characters;

create policy "members read characters"
  on public.characters
  for select
  using (
    is_campaign_member(campaign_id)          -- the GM, and anyone genuinely in memberships
    or profile_id = auth.uid()               -- the player who owns this character
  );

-- ----------------------------------------------------------------------------
-- Verify, as the affected player rather than as the GM:
--   the Forge should open on /me/forge?c=b3667b4d-041f-46b2-b8d7-588513c73de2
--
-- And confirm the policy reads as expected:
--   select policyname, cmd, qual from pg_policies
--   where schemaname = 'public' and tablename = 'characters';
-- ----------------------------------------------------------------------------
