\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('summary-owner') as w \gset
select public.ensure_workspace('summary-other') as other \gset
select public.grant_credits(:'w', 'summary-live', 100, 'v1', null);
select public.grant_credits(:'w', 'summary-expired', 100, 'v1', now() - interval '1 day');
select public.grant_credits(:'other', 'summary-other', 999, 'v1', null);
update public.credit_grants set reserved = 20, consumed = 30 where source_key = 'summary-live';
update public.credit_grants set reserved = 10, consumed = 15 where source_key = 'summary-expired';
do $$ declare w uuid; summary jsonb; begin
  select id into w from public.workspaces where owner_user_id = 'summary-owner';
  summary := public.credit_summary(w, 'summary-owner');
  if summary <> '{"available":50,"reserved":30,"spent":45}'::jsonb then
    raise exception 'Incorrect wallet totals: %', summary;
  end if;
  begin
    perform public.credit_summary(w, 'summary-other');
    raise exception 'Cross-workspace summary allowed';
  exception when insufficient_privilege then null; end;
  update public.workspace_members set active = false where user_id = 'summary-owner';
  begin
    perform public.credit_summary(w, 'summary-owner');
    raise exception 'Revoked member summary allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.credit_summary(gen_random_uuid(), 'summary-owner');
    raise exception 'Client impersonation allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
