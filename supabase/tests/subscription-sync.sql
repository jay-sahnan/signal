\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('sync_owner') as w \gset
insert into public.workspace_billing(workspace_id, stripe_customer_id, risk_hold)
  values (:'w', 'cus_sync', true);
do $$ declare old_revision bigint; new_revision bigint; changed integer; begin
  old_revision := public.begin_subscription_sync('cus_sync');
  new_revision := public.begin_subscription_sync('cus_sync');
  update public.workspace_billing set status = 'active'
    where stripe_customer_id = 'cus_sync' and sync_revision = old_revision;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'stale sync restored paid access'; end if;
  update public.workspace_billing set status = 'canceled'
    where stripe_customer_id = 'cus_sync' and sync_revision = new_revision;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'current sync was lost'; end if;
  if not (select risk_hold from public.workspace_billing where stripe_customer_id = 'cus_sync') then
    raise exception 'sync removed risk hold';
  end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.begin_subscription_sync('cus_sync');
    raise exception 'customer can interfere with subscription sync';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
