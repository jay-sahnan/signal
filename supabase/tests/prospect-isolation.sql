\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('isolation_a') as a \gset
select public.ensure_workspace('isolation_b') as b \gset
insert into public.organizations(name, domain) values ('legacy', 'legacy-isolation.example');
do $$ begin
  if exists(select from public.organizations where domain = 'legacy-isolation.example'
    and workspace_id is not null) then raise exception 'self-host behavior changed'; end if;
end $$;
update public.deployment_settings set hosted_enabled = true;
reset role;
select set_config('request.jwt.claims', '{"sub":"isolation_a"}', true);
set local role authenticated;
insert into public.organizations(name, domain) values ('A private', 'isolation.example') returning id as org \gset
insert into public.people(name, organization_id) values ('A contact', :'org');
select set_config('request.jwt.claims', '{"sub":"isolation_b"}', true);
do $$
begin
  if exists(select from public.organizations where name = 'A private')
    or exists(select from public.people where name = 'A contact') then
    raise exception 'cross-workspace read';
  end if;
  update public.organizations set name = 'forged' where domain = 'isolation.example';
  if found then raise exception 'cross-workspace update'; end if;
end $$;
insert into public.organizations(name, domain) values ('B private', 'isolation.example');
select set_config('test.foreign_org', :'org', true);
select set_config('test.foreign_workspace', :'a', true);
do $$
begin
  begin
    update public.organizations set workspace_id = current_setting('test.foreign_workspace')::uuid
      where name = 'B private';
    raise exception 'workspace reassignment accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.people(name, organization_id)
      values ('forged', current_setting('test.foreign_org')::uuid);
    raise exception 'cross-workspace relationship accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.organizations(name, workspace_id)
      values ('forged', current_setting('test.foreign_workspace')::uuid);
    raise exception 'cross-workspace insert';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.deployment_settings set hosted_enabled = false;
    raise exception 'user disabled isolation';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
