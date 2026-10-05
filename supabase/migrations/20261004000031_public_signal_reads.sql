begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Publication shares the recipe only. It never grants editing rights or
-- permits cross-workspace campaign references; consumers must own a copy.
drop policy workspace_boundary on public.signals;
create policy workspace_signal_read on public.signals as restrictive
  for select to authenticated using (
    not public.hosted_mode() or is_builtin or is_public
    or workspace_id = public.requesting_workspace_id()
  );
create policy workspace_signal_insert on public.signals as restrictive
  for insert to authenticated with check (
    not public.hosted_mode() or is_builtin
    or workspace_id = public.requesting_workspace_id()
  );
create policy workspace_signal_update on public.signals as restrictive
  for update to authenticated using (
    not public.hosted_mode() or is_builtin
    or workspace_id = public.requesting_workspace_id()
  ) with check (
    not public.hosted_mode() or is_builtin
    or workspace_id = public.requesting_workspace_id()
  );
create policy workspace_signal_delete on public.signals as restrictive
  for delete to authenticated using (
    not public.hosted_mode() or is_builtin
    or workspace_id = public.requesting_workspace_id()
  );
commit;
