\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('record_a') as a \gset
select public.ensure_workspace('record_b') as b \gset
update public.deployment_settings set hosted_enabled = true;
insert into public.campaigns(name, user_id) values ('B campaign', 'record_b') returning id as campaign_b \gset
insert into public.organizations(name, workspace_id) values ('B org', :'b') returning id as org_b \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"record_a"}', true);
set local role authenticated;
insert into public.campaigns(name, user_id) values ('A campaign', 'record_a') returning id as campaign_a \gset
select set_config('test.campaign_a', :'campaign_a', true);
select set_config('test.org_b', :'org_b', true);
do $$
begin
  if exists(select from public.campaigns where workspace_id <> public.requesting_workspace_id()) then
    raise exception 'campaign owner not resolved';
  end if;
  begin
    insert into public.campaign_organizations(campaign_id, organization_id)
      values (current_setting('test.campaign_a')::uuid, current_setting('test.org_b')::uuid);
    raise exception 'foreign prospect linked';
  exception when check_violation then null;
  end;
  begin
    insert into public.people(name, affiliation_detached_from)
      values ('forged past employer', current_setting('test.org_b')::uuid);
    raise exception 'foreign past employer accepted';
  exception when check_violation then null;
  end;
end $$;
reset role;
insert into public.user_profile(user_id) values ('record_b') returning id as profile_b \gset
insert into public.signals(name, slug, description, created_by)
  values ('B signal', 'record-private', 'private', :'profile_b') returning id as signal_b \gset
insert into public.signal_results(signal_id, campaign_id)
  values (:'signal_b', :'campaign_b');
set local role authenticated;
do $$ begin
  if exists(select from public.signal_results) then raise exception 'foreign result visible'; end if;
  if exists(select from public.signals where slug = 'record-private') then
    raise exception 'foreign signal visible';
  end if;
end $$;
rollback;
