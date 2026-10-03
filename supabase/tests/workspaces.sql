\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('workspace_test_a') as a \gset
select public.ensure_workspace('workspace_test_b') as b \gset
select public.ensure_workspace('workspace_test_a') = :'a'::uuid as same \gset
\if :same
\else
  \quit 1
\endif
reset role;
select set_config('request.jwt.claims', '{"sub":"workspace_test_a"}', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.workspaces) <> 1 then
    raise exception 'workspace visibility is not isolated';
  end if;
  if (select count(*) from public.workspace_members) <> 1 then
    raise exception 'membership visibility is not isolated';
  end if;
  if exists(select from public.workspaces where owner_user_id <> 'workspace_test_a')
    or exists(select from public.workspace_members where user_id <> 'workspace_test_a') then
    raise exception 'wrong owner visible';
  end if;
  if public.requesting_workspace_id() is null then
    raise exception 'member cannot resolve workspace';
  end if;
  begin
    perform public.ensure_workspace('forged_user');
    raise exception 'authenticated user provisioned a forged identity';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.workspace_members(workspace_id, user_id, role)
      values (public.requesting_workspace_id(), 'intruder', 'owner');
    raise exception 'member escalated another identity';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update public.workspace_members set active = false where user_id = 'workspace_test_a';
set local role authenticated;
do $$
begin
  if public.requesting_workspace_id() is not null then
    raise exception 'revoked membership retained access';
  end if;
  if exists(select from public.workspaces) then
    raise exception 'revoked user can see workspace';
  end if;
end $$;
set local role service_role;
do $$
begin
  begin
    perform public.ensure_workspace('workspace_test_a');
    raise exception 'revoked user was reprovisioned';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
