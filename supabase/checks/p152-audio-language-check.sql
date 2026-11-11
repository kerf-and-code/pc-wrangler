-- p152-audio-language-check.sql (2026-11-10, push 26). Read-only. Run after p152-audio-language.sql.

-- 1. The column, its rule and the ledger row.
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'campaigns' and column_name = 'audio_language';
select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'campaigns_audio_language_shape';
select count(*) as ledger from public._migrations where name = 'p152-audio-language';

-- 2. Which campaigns play in a language other than English.
select name, audio_language from public.campaigns where audio_language is not null and deleted_at is null order by name;
