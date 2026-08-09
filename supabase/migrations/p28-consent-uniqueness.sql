-- ============================================================================
-- p28-consent-uniqueness.sql
-- One consent row per decision, instead of one per attempt.
--
-- WHAT IS WRONG TODAY
--   Every claim INSERTS into recording_consents rather than updating, so a player who claims,
--   unclaims and re-claims leaves three rows. Live data on 2026-08-08 had five characters carrying
--   three or four rows each, and one character with three identical "false" rows written over two
--   weeks.
--
-- WHY IT MATTERS MORE THAN IT LOOKS
--   Nothing has broken yet because the submit route reads consent with .select() and builds a Set,
--   which tolerates duplicates. But the table is the record of who agreed to be recorded, and a
--   record that accumulates contradictory rows is one bad query away from answering the wrong way.
--   Any future .maybeSingle() against it - the obvious way to ask "did this person consent" - will
--   throw on exactly the characters who have changed their mind. That is the worst possible set to
--   fail on.
--
-- THE TWO SHAPES A ROW CAN HAVE
--   BLANKET   session_id IS NULL, campaign_id set. Standing consent, given at claim.
--   PER-SESSION  session_id set. A GM's opt-out for one night.
--   They are different decisions and both need to be unique on their own terms, which is why this
--   is two partial indexes rather than one constraint.
--
-- NEWEST WINS. Where duplicates disagree, the later row is the person's more recent decision, and
-- keeping the older one would mean the app remembering a withdrawn consent.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

-- ---------------------------------------------------------------- 1. look before deleting
-- Run this first if you want to see what is about to go. It changes nothing.
--
--   select character_id, campaign_id, session_id, count(*), array_agg(consented order by created_at)
--   from public.recording_consents
--   group by character_id, campaign_id, session_id
--   having count(*) > 1;
--
-- An array like {false,false,false} is a repeated claim. An array like {true,false} is a person who
-- changed their mind, and the false is the one that survives.

-- ---------------------------------------------------------------- 2. dedupe
-- ctid rather than an id column: this works whether or not the table has a surrogate key, and the
-- window is partitioned on the same triple the indexes below enforce, so what survives here is
-- exactly what the constraint would have allowed.
delete from public.recording_consents t
using (
  select ctid,
         row_number() over (
           partition by character_id, campaign_id, session_id
           order by created_at desc, ctid desc
         ) as rn
  from public.recording_consents
) d
where t.ctid = d.ctid and d.rn > 1;

-- ---------------------------------------------------------------- 3. enforce
-- Standing consent: one per character per campaign. `where session_id is null` is what makes this a
-- statement about BLANKET consent rather than about every row.
create unique index if not exists recording_consents_blanket_uniq
  on public.recording_consents (character_id, campaign_id)
  where session_id is null;

-- A GM's opt-out for one night: one per character per session.
create unique index if not exists recording_consents_session_uniq
  on public.recording_consents (character_id, session_id)
  where session_id is not null;

comment on index public.recording_consents_blanket_uniq is
  'One standing consent per character per campaign. Claiming again must UPDATE this row, not insert '
  'beside it.';

-- ----------------------------------------------------------------------------
-- AFTER RUNNING THIS
--   The claim path must upsert rather than insert, or the next re-claim raises 23505 instead of
--   silently duplicating. That is a code change, not a migration: whichever route writes consent at
--   claim needs an on-conflict clause naming the matching index.
--
--   The failure mode swaps from "quietly wrong" to "loudly broken", which is the right direction to
--   move it, but it does need the code change to land close behind.
--
-- Verify:
--   select character_id, campaign_id, session_id, count(*)
--   from public.recording_consents
--   group by character_id, campaign_id, session_id having count(*) > 1;
--   -- expect zero rows
-- ----------------------------------------------------------------------------
