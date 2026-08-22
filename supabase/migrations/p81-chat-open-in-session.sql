-- ============================================================================
-- p81-chat-open-in-session.sql
-- Leave party chat OPEN during a live session.
--
-- Party chat is players-only (the GM sees nothing unless a player grants a time window). It used to
-- CLOSE for the whole game: chat_locked(code) returned true whenever any session in the campaign had
-- status='live', and BOTH chat_context (the page's `locked` flag) and chat_post (the send RPC) gated on
-- it. Terry's call: keep it open the entire session, because some players need side-talk to stay engaged
-- while a scene focuses on one or two others.
--
-- The lock has a single source, chat_locked(), so neutralizing it there opens both callers with no other
-- database change. Kept as a function returning false (rather than dropped) so the two callers keep
-- resolving and the behavior can be reinstated later if wanted. Signature unchanged (code text), so
-- CREATE OR REPLACE preserves grants.
--
-- UNCHANGED on purpose:
--   - privacy: chat stays players-only; the GM grant-window model is not touched.
--   - roll ingestion: /api/vtt/ingest keys on sessions.ended_at, not chat_locked(), so table rolls still
--     land in the live session exactly as before.
--
-- Idempotent. Run by hand in the Supabase SQL editor.
-- ============================================================================

create or replace function public.chat_locked(code text)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $function$
  -- Party chat now stays open during live sessions.
  -- (Was: select exists (select 1 from campaigns c join sessions s on s.campaign_id = c.id
  --        where c.share_code = code and s.status = 'live');)
  select false;
$function$;

-- ----------------------------------------------------------------------------
-- Verify:
--   select public.chat_locked('<a-campaign-share-code>');   -- returns false even mid-session
--   with a session live: chat_post succeeds and chat_context returns locked = false
-- ----------------------------------------------------------------------------
