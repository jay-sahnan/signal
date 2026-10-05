\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare
  a uuid := public.ensure_workspace('prospect_test_a');
  b uuid := public.ensure_workspace('prospect_test_b');
begin
  insert into public.organizations(name, domain, workspace_id) values
    ('A', 'same.example', a), ('B', 'same.example', b);
  insert into public.people(name, linkedin_url, github_url, workspace_id) values
    ('A', 'https://linkedin.com/in/same', 'https://github.com/same', a),
    ('B', 'https://linkedin.com/in/same', 'https://github.com/same', b);
  begin
    insert into public.organizations(name, domain, workspace_id)
      values ('duplicate', 'same.example', a);
    raise exception 'same-workspace duplicate accepted';
  exception when unique_violation then null;
  end;
  insert into public.organizations(name, domain) values ('legacy', 'legacy.example');
  begin
    insert into public.organizations(name, domain) values ('duplicate', 'legacy.example');
    raise exception 'legacy uniqueness broken';
  exception when unique_violation then null;
  end;
  begin
    insert into public.people(name, linkedin_url, workspace_id)
      values ('duplicate', 'https://linkedin.com/in/same', a);
    raise exception 'duplicate contact accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.people(name, github_url, workspace_id)
      values ('duplicate github', 'https://github.com/same', a);
    raise exception 'duplicate GitHub contact accepted';
  exception when unique_violation then null;
  end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.organizations where domain = 'same.example') then
    raise exception 'staged customer data visible to an unscoped legacy lookup';
  end if;
  if (select count(*) from public.organizations where domain = 'legacy.example') <> 1 then
    raise exception 'legacy lookup no longer works';
  end if;
end $$;
rollback;
