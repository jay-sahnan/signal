begin;
alter table public.api_usage add column workspace_id uuid references public.workspaces(id);
alter table public.api_usage add column credit_operation_id uuid;
alter table public.api_usage add constraint usage_credit_workspace foreign key (workspace_id, credit_operation_id)
  references public.credit_operations(workspace_id, id);
create index api_usage_workspace_created on public.api_usage(workspace_id, created_at);
-- Provider invoices and internal cost estimates are operator telemetry in hosted
-- mode. Customers read their credit wallet, not deployment-wide provider costs.
create policy hosted_usage_private on public.api_usage as restrictive for all to authenticated
  using (not public.hosted_mode()) with check (not public.hosted_mode());
commit;
