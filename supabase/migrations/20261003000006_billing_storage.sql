begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.workspace_billing (
  workspace_id uuid primary key references public.workspaces(id),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'none' check (status in (
    'none', 'incomplete', 'incomplete_expired', 'trialing', 'active',
    'past_due', 'canceled', 'unpaid', 'paused'
  )),
  price_id text,
  plan_version text,
  period_start timestamptz,
  period_end timestamptz,
  monthly_units bigint not null default 0 check (monthly_units >= 0),
  monitor_limit integer not null default 0 check (monitor_limit >= 0),
  risk_hold boolean not null default false,
  cancel_at_period_end boolean not null default false,
  sync_revision bigint not null default 0,
  reconciled_at timestamptz,
  check ((period_start is null and period_end is null) or
    (period_start is not null and period_end is not null and period_end > period_start))
);
alter table public.workspace_billing enable row level security;
revoke all on public.workspace_billing from public, anon, authenticated;
grant select on public.workspace_billing to authenticated;
grant all on public.workspace_billing to service_role;
create policy billing_read on public.workspace_billing for select to authenticated
  using (workspace_id = public.requesting_workspace_id());

-- Retain identifiers and processing state only, never raw payment payloads.
create table public.billing_events (
  id text primary key,
  event_type text not null,
  customer_id text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from public, anon, authenticated;
grant all on public.billing_events to service_role;
commit;
