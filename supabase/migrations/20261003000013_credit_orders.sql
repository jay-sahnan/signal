begin;
create table public.credit_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id text not null,
  customer_id text not null,
  price_id text not null,
  credits bigint not null check (credits between 1 and 1000000000),
  rate_version text not null check (length(rate_version) between 1 and 100),
  amount bigint not null check (amount between 1 and 99999999),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  state text not null default 'pending' check (state in ('pending', 'paid', 'expired', 'failed')),
  session_id text unique,
  payment_intent_id text unique,
  grant_id uuid unique references public.credit_grants(id),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create unique index credit_orders_one_pending on public.credit_orders(workspace_id) where state = 'pending';
alter table public.credit_orders enable row level security;
revoke all on public.credit_orders from anon, authenticated;
grant all on public.credit_orders to service_role;

-- Freeze the exact pack purchased. Only server-verified owner calls this; a
-- previous pending order may rotate only after Stripe confirms its expiry.
create function public.claim_credit_order(p_workspace uuid, p_user text, p_price text,
  p_credits bigint, p_version text, p_amount bigint, p_currency text, p_previous uuid default null)
returns public.credit_orders language plpgsql security definer set search_path = '' as $$
declare billing public.workspace_billing; row public.credit_orders;
begin
  perform 1 from public.workspaces w join public.workspace_members m on m.workspace_id = w.id
    where w.id = p_workspace and w.owner_user_id = p_user and m.user_id = p_user and m.active for share of m;
  if not found then raise exception 'Active owner required' using errcode = '42501'; end if;
  perform 1 from public.workspaces where id = p_workspace for update;
  select * into billing from public.workspace_billing where workspace_id = p_workspace for update;
  if not found or billing.stripe_customer_id is null or billing.risk_hold then
    raise exception 'Billing account unavailable' using errcode = '42501';
  end if;
  select * into row from public.credit_orders where workspace_id = p_workspace and state = 'pending' for update;
  if found then
    if p_previous is distinct from row.id then return row; end if;
    update public.credit_orders set state = 'expired' where id = row.id;
  end if;
  insert into public.credit_orders(workspace_id, user_id, customer_id, price_id, credits, rate_version, amount, currency)
    values(p_workspace, p_user, billing.stripe_customer_id, p_price, p_credits, p_version, p_amount, p_currency) returning * into row;
  return row;
end $$;

-- Caller must retrieve Stripe's settled payment and validate customer, mode,
-- line item, and order reference first. The transaction grants credits once.
create function public.fulfill_credit_order(p_order uuid, p_session text,
  p_payment text, p_amount bigint, p_currency text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare row public.credit_orders; credited uuid;
begin
  select * into row from public.credit_orders where id = p_order;
  if not found then raise exception 'Unknown credit order' using errcode = '42501'; end if;
  perform 1 from public.workspaces where id = row.workspace_id for update;
  select * into row from public.credit_orders where id = p_order for update;
  if p_session is null or p_session not like 'cs_%' or p_payment is null or p_payment not like 'pi_%'
    or p_amount is distinct from row.amount or p_currency is distinct from row.currency then
    raise exception 'Payment does not match order' using errcode = '23514';
  end if;
  if (row.session_id is not null and row.session_id <> p_session)
    or (row.payment_intent_id is not null and row.payment_intent_id <> p_payment) then
    raise exception 'Order already bound to another payment' using errcode = '23505';
  end if;
  credited := public.grant_credits(row.workspace_id, 'stripe-payment:' || p_payment, row.credits, row.rate_version, null);
  update public.credit_orders set state = 'paid', session_id = p_session, payment_intent_id = p_payment,
    grant_id = credited, paid_at = coalesce(paid_at, clock_timestamp()) where id = p_order;
  return credited;
end $$;
revoke all on function public.claim_credit_order(uuid, text, text, bigint, text, bigint, text, uuid),
  public.fulfill_credit_order(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.claim_credit_order(uuid, text, text, bigint, text, bigint, text, uuid),
  public.fulfill_credit_order(uuid, text, text, bigint, text) to service_role;
commit;
