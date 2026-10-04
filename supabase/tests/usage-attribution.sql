\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('usage-owner') as w \gset
select public.ensure_workspace('usage-other') as other \gset
select public.grant_credits(:'w','usage-grant',10,'v1',null);
select (public.reserve_credit_quote(:'w','usage-owner','usage',repeat('a',64),'research','web',1,'v1')).id as op \gset
insert into public.api_usage(service,operation,estimated_cost_usd,user_id,workspace_id,credit_operation_id)
values ('exa','search',0.01,'usage-owner',:'w',:'op');
do $$ declare other uuid; op uuid; begin
  select id into other from public.workspaces where owner_user_id = 'usage-other';
  select id into op from public.credit_operations where user_id = 'usage-owner';
  begin
    insert into public.api_usage(service,operation,estimated_cost_usd,workspace_id,credit_operation_id)
    values ('exa','search',0.01,other,op);
    raise exception 'Usage crossed workspace operation boundary';
  exception when foreign_key_violation then null; end;
end $$;
update public.deployment_settings set hosted_enabled = true;
reset role;
select set_config('request.jwt.claims','{"sub":"usage-owner"}',true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.api_usage) then raise exception 'Internal provider costs exposed'; end if;
  begin
    insert into public.api_usage(service,operation,estimated_cost_usd,user_id) values ('exa','search',999,'usage-owner');
    raise exception 'Customer forged internal usage';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
