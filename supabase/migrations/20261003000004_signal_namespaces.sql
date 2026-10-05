begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Built-ins retain the global namespace; customer recipes share names safely.
alter table public.signals drop constraint signals_slug_key;
create unique index signals_workspace_slug_key
  on public.signals(workspace_id, slug) nulls not distinct;
commit;
