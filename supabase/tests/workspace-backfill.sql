\set ON_ERROR_STOP on
begin;
set local role service_role;
insert into public.user_profile(user_id) values ('legacy_owner');
insert into public.organizations(name, domain) values ('Legacy company', 'legacy.example');
insert into public.people(name, organization_id)
  select 'Legacy contact', id from public.organizations where domain = 'legacy.example';
do $$ declare report jsonb; w uuid; begin
  report := public.workspace_backfill_report();
  if not (report->'owners' @> '["legacy_owner"]'::jsonb) then
    raise exception 'dry run omitted historical owner';
  end if;
  begin
    perform public.assign_legacy_workspace('legacy_owner', array['wrong_owner']);
    raise exception 'unconfirmed ownership accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.ensure_workspace('other_customer');
    insert into public.organizations(name, workspace_id)
      select 'Other customer company', id from public.workspaces where owner_user_id = 'other_customer';
    perform public.assign_legacy_workspace('legacy_owner', array['legacy_owner']);
    raise exception 'mixed workspace graph accepted';
  exception when check_violation then null;
  end;
  if exists(select 1 from public.workspace_members where user_id = 'legacy_owner') then
    raise exception 'failed backfill leaked membership';
  end if;
  begin
    w := public.ensure_workspace('legacy_owner');
    insert into public.signals(name, slug, description, is_builtin, workspace_id)
      values ('Invalid legacy builtin', 'invalid-legacy-builtin', 'test', true, w);
    perform public.assign_legacy_workspace('legacy_owner', array['legacy_owner']);
    raise exception 'invalid graph survived final validation';
  exception when check_violation then null;
  end;
  if public.hosted_mode() or
    exists(select 1 from public.workspace_members where user_id = 'legacy_owner') or
    exists(select 1 from public.organizations where workspace_id is not null) then
    raise exception 'final validation did not roll back assignments and mode';
  end if;
  w := public.assign_legacy_workspace('legacy_owner', array['legacy_owner']);
  if exists(select 1 from public.organizations where workspace_id is distinct from w) then
    raise exception 'company not assigned';
  end if;
  if exists(select 1 from public.people where workspace_id is distinct from w) then
    raise exception 'contact not assigned';
  end if;
  if public.hosted_mode() then raise exception 'backfill enabled hosted mode'; end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.assign_legacy_workspace('attacker', array['legacy_owner']);
    raise exception 'customer can assign legacy data';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
