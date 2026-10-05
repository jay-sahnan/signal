\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('large-recovery-owner') as w \gset
select public.grant_credits(:'w','large-recovery-grant',10,'v1',null);
do $$ declare op uuid; attempt uuid:=gen_random_uuid(); payload text:='{"data":"'||repeat('x',1000001)||'"}'; begin
 op := (public.reserve_credit_quote((select workspace_id from public.workspace_members where user_id='large-recovery-owner'),
  'large-recovery-owner','large-result',repeat('b',64),'research','web',5,'v1')).id;
 perform public.claim_credit_execution(op,'large-recovery-owner',attempt);
 begin
  perform public.finish_serialized_credit_result(op,'large-recovery-owner',5,payload);
  raise exception 'Normal result limit bypassed';
 exception when check_violation then null; end;
 perform public.finish_credit_operation(op,'large-recovery-owner','uncertain',null,null);
 perform public.reconcile_credit_operation(op,attempt,'operator','receipt/large',5,payload);
 if public.read_serialized_credit_result(op,'large-recovery-owner') <> payload then raise exception 'Exact result lost'; end if;
 if public.reconcile_credit_operation(op,attempt,'operator','receipt/large',5,payload) then raise exception 'Double charge'; end if;
 if (select sum(consumed) from public.credit_grants where workspace_id=(select workspace_id from public.credit_operations where id=op)) <> 5 then raise exception 'Charge incorrect'; end if;
 if (select sum(reserved) from public.credit_grants where workspace_id=(select workspace_id from public.credit_operations where id=op)) <> 0 then raise exception 'Reservation retained'; end if;
 begin
  perform public.read_serialized_credit_result(op,'foreign');
  raise exception 'Recovered result leaked';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
