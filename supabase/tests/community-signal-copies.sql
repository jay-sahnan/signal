\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('copy_a');
select public.ensure_workspace('copy_b') as workspace_b \gset
update public.deployment_settings set hosted_enabled = true;
insert into public.user_profile(user_id) values ('copy_a') returning id as profile_a \gset
insert into public.user_profile(user_id) values ('copy_b') returning id as profile_b \gset
insert into public.campaigns(name, user_id) values ('B campaign', 'copy_b') returning id as campaign_b \gset
insert into public.campaigns(name, user_id) values ('A campaign', 'copy_a') returning id as campaign_a \gset
insert into public.signals(name, slug, description, created_by, is_public, config)
 values ('Public recipe', 'copy-source', 'shared', :'profile_a', true, '{"instructions":"original"}') returning id as source \gset
insert into public.signals(name, slug, description, created_by)
 values ('Private recipe', 'copy-private', 'private', :'profile_a') returning id as private_source \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"copy_b"}', true);
select set_config('test.campaign_b', :'campaign_b', true);
select set_config('test.campaign_a', :'campaign_a', true);
select set_config('test.private_source', :'private_source', true);
select set_config('test.source', :'source', true);
set local role authenticated;
select (public.set_campaign_signal(:'campaign_b', :'source', true)).signal_id as copied \gset
select (public.set_campaign_signal(:'campaign_b', :'source', false)).signal_id as repeated \gset
select set_config('test.copied', :'copied', true);
do $$ begin
  if current_setting('test.copied') = current_setting('test.source') then raise exception 'foreign recipe linked directly'; end if;
  if (select count(*) from public.signals where source_signal_id = current_setting('test.source')::uuid) <> 1 then raise exception 'copy not reused'; end if;
  if exists(select from public.campaign_signals where campaign_id = current_setting('test.campaign_b')::uuid and enabled) then raise exception 'copy not disabled'; end if;
  if exists(select from public.signals where id = current_setting('test.copied')::uuid and (is_public or is_builtin or workspace_id <> public.requesting_workspace_id())) then raise exception 'copy ownership invalid'; end if;
  begin
    perform public.set_campaign_signal(current_setting('test.campaign_b')::uuid, current_setting('test.private_source')::uuid, true);
    raise exception 'private source copied';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_campaign_signal(current_setting('test.campaign_a')::uuid, current_setting('test.source')::uuid, true);
    raise exception 'foreign campaign changed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
update public.signals set is_public = false, config = '{"instructions":"changed"}' where id = :'source';
reset role;
set local role authenticated;
select public.set_campaign_signal(:'campaign_b', :'source', true);
do $$ begin
  if (select config->>'instructions' from public.signals where id = current_setting('test.copied')::uuid) <> 'original' then raise exception 'publisher changed local recipe'; end if;
end $$;
rollback;
