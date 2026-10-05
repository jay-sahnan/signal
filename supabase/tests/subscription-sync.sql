\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('sync_owner') as w \gset
insert into public.workspace_billing(workspace_id, stripe_customer_id, risk_hold)
  values (:'w', 'cus_sync', true);
do $$ declare old_revision bigint; new_revision bigint; begin
  old_revision := public.begin_subscription_sync('cus_sync');
  begin
    perform public.begin_subscription_sync('cus_sync');
    raise exception 'overlapping provider reads accepted';
  exception when lock_not_available then null;
  end;
  update public.workspace_billing set sync_locked_until = now() - interval '1 second'
    where stripe_customer_id = 'cus_sync';
  if public.finish_subscription_sync('cus_sync', old_revision, '{"status":"active"}') then
    raise exception 'expired lease wrote without reacquisition';
  end if;
  new_revision := public.begin_subscription_sync('cus_sync');
  perform public.release_subscription_sync('cus_sync', old_revision);
  if (select sync_locked_until is null from public.workspace_billing where stripe_customer_id = 'cus_sync') then
    raise exception 'expired worker released the newer lease';
  end if;
  if public.finish_subscription_sync('cus_sync', old_revision, '{"status":"active"}') then
    raise exception 'stale sync restored paid access';
  end if;
  if not public.finish_subscription_sync('cus_sync', new_revision,
    '{"status":"canceled","monthly_units":0,"monitor_limit":0,"cancel_at_period_end":false}') then
    raise exception 'current sync was lost';
  end if;
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
