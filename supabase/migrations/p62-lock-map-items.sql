-- p62: a per-item lock for placed markers and area labels, so a finished one can't be dragged by
-- accident while panning. Default false (unlocked). Existing rows lock to false.

alter table public.map_pois   add column if not exists locked boolean not null default false;
alter table public.map_labels add column if not exists locked boolean not null default false;
