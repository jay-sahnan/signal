\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('encoded-owner') as w \gset
select public.grant_credits(:'w','encoded-grant',100,'v1',null);
select (public.reserve_credit_quote(:'w','encoded-owner','tiny-numbers',repeat('b',64),'research','web',5,'v1')).id as op_id \gset
select public.start_credit_operation(:'op_id','encoded-owner');
select public.finish_serialized_credit_result(:'op_id','encoded-owner',5,'[' || repeat('5e-324,',9999) || '5e-324]');
do $$ declare op uuid; payload text; begin
 select id into op from public.credit_operations where user_id = 'encoded-owner';
 payload := public.read_serialized_credit_result(op,'encoded-owner');
 if octet_length(payload) <> 70001 then raise exception 'Serialized payload changed'; end if;
 if public.finish_serialized_credit_result(op,'encoded-owner',5,payload) then raise exception 'Double settlement'; end if;
 begin
  perform public.finish_serialized_credit_result(op,'encoded-owner',5,'[]');
  raise exception 'Result overwritten';
 exception when unique_violation then null; end;
 begin
  perform public.read_serialized_credit_result(op,'foreign');
  raise exception 'Result leaked';
 exception when insufficient_privilege then null; end;
end $$;
select (public.reserve_credit_quote(:'w','encoded-owner','null-character',repeat('b',64),'research','web',1,'v1')).id as null_op \gset
select public.start_credit_operation(:'null_op','encoded-owner');
select public.finish_serialized_credit_result(:'null_op','encoded-owner',1,'"\u0000"');
select (public.reserve_credit_quote(:'w','encoded-owner','no-work',repeat('c',64),'research','web',5,'v1')).id as free_op \gset
select public.start_credit_operation(:'free_op','encoded-owner');
select public.finish_serialized_credit_result(:'free_op','encoded-owner',0,'{"status":"failed","reason":"No sources"}');
do $$ declare op public.credit_operations; begin
 select * into op from public.credit_operations where user_id = 'encoded-owner' and operation_key = 'no-work';
 if op.state <> 'succeeded' or op.charged <> 0 then raise exception 'Unbilled result was charged'; end if;
 if (select sum(reserved) from public.credit_grants where workspace_id = op.workspace_id) <> 0
  or (select sum(consumed) from public.credit_grants where workspace_id = op.workspace_id) <> 6 then
  raise exception 'Unbilled completion changed spent credits or retained reservation';
 end if;
 if public.read_serialized_credit_result(op.id,'encoded-owner') <> '{"status":"failed","reason":"No sources"}' then
  raise exception 'Unbilled result was not replayable';
 end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin
  perform * from public.credit_serialized_results;
  raise exception 'Private results exposed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
