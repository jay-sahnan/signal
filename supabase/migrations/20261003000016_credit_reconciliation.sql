begin;
alter table public.credit_orders add column reconcile_after timestamptz not null default now();
create index credit_orders_reconcile on public.credit_orders(reconcile_after, id) where state = 'pending';
create function public.claim_credit_reconciliation(p_limit integer default 2)
returns setof public.credit_orders language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Invalid reconciliation batch' using errcode = '23514';
  end if;
  return query with candidates as (
    select id from public.credit_orders
      where state = 'pending' and reconcile_after <= clock_timestamp()
      order by reconcile_after, id for update skip locked limit p_limit
  ) update public.credit_orders orders
    set reconcile_after = clock_timestamp() + interval '5 minutes'
    from candidates where orders.id = candidates.id returning orders.*;
end $$;
revoke all on function public.claim_credit_reconciliation(integer) from public, anon, authenticated;
grant execute on function public.claim_credit_reconciliation(integer) to service_role;
commit;
