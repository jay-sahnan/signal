-- Cross-instance cache of Exa search responses. Exa bills per call and the
-- agent repeats near-identical queries across turns, users and serverless
-- instances (15% of a month's calls were exact repeats). Results are public
-- web data, so one shared row per (query, options) is fine; the table is
-- written by the service role only and exposed to nobody else.
create table if not exists public.exa_search_cache (
  key text primary key,
  query text not null,
  options jsonb not null default '{}'::jsonb,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists exa_search_cache_created_at_idx
  on public.exa_search_cache (created_at);

alter table public.exa_search_cache enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) reads or
-- writes this table.
