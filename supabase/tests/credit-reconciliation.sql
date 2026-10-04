\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('recovery-owner') as w \gset
insert into public.workspace_billing(workspace_id, stripe_customer_id) values (:'w', 'cus_recovery');
select public.claim_credit_order(:'w','recovery-owner','price_one',100,'v1',1000,'usd',null);
do $$ declare claimed integer; begin
  select count(*) into claimed from public.claim_credit_reconciliation(2);
  if claimed <> 1 then raise exception 'Missing pending purchase'; end if;
  if exists(select 1 from public.claim_credit_reconciliation(2)) then raise exception 'Concurrent tick repeats leased purchase'; end if;
  update public.credit_orders set reconcile_after = now() - interval '1 minute' where customer_id = 'cus_recovery';
  if not exists(select 1 from public.claim_credit_reconciliation(2)) then raise exception 'Crashed recovery never retries'; end if;
  update public.credit_orders set state = 'paid', reconcile_after = now() - interval '1 minute' where customer_id = 'cus_recovery';
  if exists(select 1 from public.claim_credit_reconciliation(2)) then raise exception 'Completed purchase still scheduled'; end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.claim_credit_reconciliation(2);
    raise exception 'Client claimed billing recovery';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
