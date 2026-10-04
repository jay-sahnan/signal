\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('close-owner') as w \gset
insert into public.workspace_billing(workspace_id, stripe_customer_id) values (:'w', 'cus_close');
select (public.claim_credit_order(:'w','close-owner','price_one',100,'v1',1000,'usd',null)).id as order_id \gset
select public.close_credit_order(:'order_id', 'cs_closed', 'failed');
do $$ begin
  if (select state from public.credit_orders where session_id = 'cs_closed') <> 'failed' then raise exception 'Order not closed'; end if;
  if exists(select 1 from public.credit_grants) then raise exception 'Unpaid closure minted credits'; end if;
end $$;
select (public.claim_credit_order(:'w','close-owner','price_one',100,'v1',1000,'usd',null)).id as paid_id \gset
select public.fulfill_credit_order(:'paid_id', 'cs_paid', 'pi_paid', 1000, 'usd');
select public.close_credit_order(:'paid_id', 'cs_paid', 'expired');
do $$ begin
  if (select state from public.credit_orders where session_id = 'cs_paid') <> 'paid' then raise exception 'Stale failure overwrote payment'; end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.close_credit_order(gen_random_uuid(), 'cs_fake', 'failed');
    raise exception 'Client closed order';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
