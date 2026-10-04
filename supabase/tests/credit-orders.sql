\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('pack-owner') as w \gset
insert into public.workspace_billing(workspace_id, stripe_customer_id) values(:'w', 'cus_pack');
do $$ declare w uuid; first public.credit_orders; retry public.credit_orders; grant_id uuid; begin
  select id into w from public.workspaces where owner_user_id = 'pack-owner';
  first := public.claim_credit_order(w, 'pack-owner', 'price_pack', 100, 'v1', 1000, 'usd', null);
  retry := public.claim_credit_order(w, 'pack-owner', 'price_changed', 200, 'v2', 2000, 'usd', null);
  if first.id <> retry.id or retry.credits <> 100 or retry.price_id <> 'price_pack' then raise exception 'Pending order terms changed'; end if;
  begin
    perform public.claim_credit_order(w, 'forged', 'price_pack', 100, 'v1', 1000, 'usd', null);
    raise exception 'Non-owner purchased credits';
  exception when insufficient_privilege then null; end;
  begin
    perform public.fulfill_credit_order(first.id, 'cs_pack', 'pi_pack', 1, 'usd');
    raise exception 'Wrong payment amount granted credits';
  exception when check_violation then null; end;
  grant_id := public.fulfill_credit_order(first.id, 'cs_pack', 'pi_pack', 1000, 'usd');
  if public.fulfill_credit_order(first.id, 'cs_pack', 'pi_pack', 1000, 'usd') <> grant_id then raise exception 'Payment event duplicated credit grant'; end if;
  if (select sum(credits) from public.credit_grants where workspace_id = w) <> 100 then raise exception 'Credit amount changed'; end if;
  retry := public.claim_credit_order(w, 'pack-owner', 'price_pack', 100, 'v1', 1000, 'usd', null);
  if first.id = retry.id then raise exception 'Paid order prevents deliberate top-up'; end if;
  begin
    perform public.fulfill_credit_order(retry.id, 'cs_other', 'pi_pack', 1000, 'usd');
    raise exception 'Payment credited to two orders';
  exception when unique_violation then null; end;
  first := public.claim_credit_order(w, 'pack-owner', 'price_pack', 100, 'v1', 1000, 'usd', retry.id);
  if first.id = retry.id or (select state from public.credit_orders where id = retry.id) <> 'expired' then raise exception 'Expired checkout did not rotate'; end if;
  retry := public.claim_credit_order(w, 'pack-owner', 'price_pack', 100, 'v1', 1000, 'usd', retry.id);
  if first.id <> retry.id then raise exception 'Stale rotation created another checkout'; end if;
  update public.workspace_billing set risk_hold = true where workspace_id = w;
  begin
    perform public.claim_credit_order(w, 'pack-owner', 'price_pack', 100, 'v1', 1000, 'usd', null);
    raise exception 'Billing hold bypassed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform 1 from public.credit_orders;
    raise exception 'Private purchase records exposed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.fulfill_credit_order(gen_random_uuid(), 'cs_forged', 'pi_forged', 1000, 'usd');
    raise exception 'Customer fulfilled a payment';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
