\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('recovery-owner') as w \gset
select public.grant_credits(:'w','recovery-grant',100,'v1',null);
do $$ declare w uuid; op uuid; attempt uuid := gen_random_uuid(); i integer; begin
 select workspace_id into w from public.workspace_members where user_id='recovery-owner';
 for i in 1..4 loop
  op := (public.reserve_credit_quote(w,'recovery-owner','held-'||i,repeat('a',64),'contact.discover','web',5,'v1')).id;
  perform public.claim_credit_execution(op,'recovery-owner',attempt);
  perform public.finish_credit_operation(op,'recovery-owner','uncertain',null,null);
 end loop;
 begin
  perform public.reserve_credit_quote(w,'recovery-owner','blocked',repeat('a',64),'contact.discover','web',5,'v1');
  raise exception 'Active limit not enforced';
 exception when lock_not_available then null; end;
 select id into op from public.credit_operations where workspace_id=w and operation_key='held-1';
 begin
  perform public.reconcile_credit_operation(op,gen_random_uuid(),'operator','receipt/1',0,'{"error":"Confirmed no work"}');
  raise exception 'Wrong attempt accepted';
 exception when object_not_in_prerequisite_state then null; end;
 begin
  perform public.reconcile_credit_operation(op,attempt,'operator','',0,'{}');
  raise exception 'Missing evidence accepted';
 exception when check_violation then null; end;
 if not public.reconcile_credit_operation(op,attempt,'operator','receipt/1',0,'{"error":"Confirmed no work"}') then
  raise exception 'Recovery did not settle'; end if;
 if public.reconcile_credit_operation(op,attempt,'operator','receipt/1',0,'{"error":"Confirmed no work"}') then
  raise exception 'Recovery applied twice'; end if;
 begin
  perform public.reconcile_credit_operation(op,attempt,'operator','receipt/2',5,'{}');
  raise exception 'Conflicting recovery accepted';
 exception when unique_violation then null; end;
 if public.read_serialized_credit_result(op,'recovery-owner') <> '{"error":"Confirmed no work"}' then raise exception 'Replay lost'; end if;
 perform public.reserve_credit_quote(w,'recovery-owner','unblocked',repeat('a',64),'contact.discover','web',5,'v1');
 select id into op from public.credit_operations where workspace_id=w and operation_key='held-2';
 perform public.reconcile_credit_operation(op,attempt,'operator','receipt/paid',5,'{"contacts":[]}');
 if (select sum(consumed) from public.credit_grants where workspace_id=w) <> 5 then raise exception 'Incorrect charge'; end if;
 if (select count(*) from public.credit_operation_reconciliations where workspace_id=w) <> 2 then raise exception 'Audit missing'; end if;
 select id into op from public.credit_operations where workspace_id=w and operation_key='held-3';
 begin
  perform public.reconcile_credit_operation(op,attempt,'operator','receipt/invalid',0,'not json');
  raise exception 'Invalid result accepted';
 exception when invalid_text_representation then null; end;
 if exists(select 1 from public.credit_operation_reconciliations where operation_id=op) then raise exception 'Failed settlement audited as success'; end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin
  perform public.reconcile_credit_operation(gen_random_uuid(),gen_random_uuid(),'customer','fake',0,'{}');
  raise exception 'Customer can settle credits';
 exception when insufficient_privilege then null; end;
 begin
  perform * from public.credit_operation_reconciliations;
  raise exception 'Audit exposed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
