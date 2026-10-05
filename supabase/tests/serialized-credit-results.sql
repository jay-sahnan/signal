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
reset role;
set local role authenticated;
do $$ begin
 begin
  perform * from public.credit_serialized_results;
  raise exception 'Private results exposed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
