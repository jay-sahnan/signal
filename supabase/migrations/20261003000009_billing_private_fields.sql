begin;
-- The website projects safe status fields through a verified workspace context.
-- Keep customer mappings and checkout/idempotency identifiers service-only.
revoke select on public.workspace_billing from authenticated;
grant select (workspace_id, status, period_start, period_end, monthly_units,
  monitor_limit, cancel_at_period_end, risk_hold, reconciled_at)
  on public.workspace_billing to authenticated;
commit;
