\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('result-owner') as w \gset
select public.ensure_workspace('result-other');
select public.grant_credits(:'w','result-grant',100,'v1',null);
select (public.reserve_credit_quote(:'w','result-owner','stable',repeat('a',64),'research','web',5,'v1')).id as op_id \gset
select public.start_credit_operation(:'op_id','result-owner');
select public.finish_credit_result(:'op_id','result-owner',5,jsonb_build_object('body',repeat('x',100000)));
do $$ declare op uuid; result jsonb; begin
  select id into op from public.credit_operations where user_id = 'result-owner';
  result := public.read_credit_result(op,'result-owner');
  if length(result->>'body') <> 100000 then raise exception 'Large replay truncated'; end if;
  if public.finish_credit_result(op,'result-owner',5,result) then raise exception 'Settlement repeated'; end if;
  begin
    perform public.finish_credit_result(op,'result-owner',5,'{"different":true}'::jsonb);
    raise exception 'Result overwritten';
  exception when unique_violation then null; end;
  begin
    perform public.read_credit_result(op,'result-other');
    raise exception 'Result leaked across users';
  exception when insufficient_privilege then null; end;
  update public.workspace_members set active = false where user_id = 'result-owner';
  begin
    perform public.read_credit_result(op,'result-owner');
    raise exception 'Revoked owner read result';
  exception when insufficient_privilege then null; end;
end $$;
update public.workspace_members set active = true where user_id = 'result-owner';
select (public.reserve_credit_quote(:'w','result-owner','null-result',repeat('a',64),'research','web',1,'v1')).id as null_op \gset
select public.start_credit_operation(:'null_op','result-owner');
select public.finish_credit_result(:'null_op','result-owner',1,null);
select (public.reserve_credit_quote(:'w','result-owner','legacy-null',repeat('a',64),'research','web',1,'v1')).id as legacy_op \gset
select public.start_credit_operation(:'legacy_op','result-owner');
select public.finish_credit_operation(:'legacy_op','result-owner','succeeded',1,null);
do $$ declare op uuid; begin
  select id into op from public.credit_operations where operation_key = 'legacy-null';
  begin
    perform public.finish_credit_result(op,'result-owner',1,'{"changed":true}'::jsonb);
    raise exception 'Completed legacy null result overwritten';
  exception when unique_violation then null; end;
  if public.finish_credit_result(op,'result-owner',1,null) then raise exception 'Legacy result charged again'; end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform * from public.credit_results;
    raise exception 'Results table exposed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
