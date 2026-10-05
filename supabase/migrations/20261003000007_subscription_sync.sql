begin;
alter table public.workspace_billing add column sync_locked_until timestamptz;
create function public.begin_subscription_sync(p_customer_id text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare revision bigint;
begin
  update public.workspace_billing set sync_revision = sync_revision + 1,
    sync_locked_until = clock_timestamp() + interval '2 minutes'
    where stripe_customer_id = p_customer_id and
      (sync_locked_until is null or sync_locked_until <= clock_timestamp())
    returning sync_revision into revision;
  if revision is null and exists(select 1 from public.workspace_billing where stripe_customer_id = p_customer_id) then
    raise exception 'Subscription synchronization already running; retry' using errcode = '55P03';
  end if;
  return revision;
end $$;
create function public.release_subscription_sync(p_customer_id text, p_revision bigint) returns void
language sql security definer set search_path = '' as $$
  update public.workspace_billing set sync_locked_until = null
    where stripe_customer_id = p_customer_id and sync_revision = p_revision
$$;
create function public.finish_subscription_sync(p_customer_id text, p_revision bigint, p_state jsonb)
returns boolean language sql security definer set search_path = '' as $$
  with changed as (
    update public.workspace_billing set
      stripe_subscription_id = p_state->>'stripe_subscription_id', status = p_state->>'status',
      price_id = p_state->>'price_id', plan_version = p_state->>'plan_version',
      period_start = (p_state->>'period_start')::timestamptz,
      period_end = (p_state->>'period_end')::timestamptz,
      monthly_units = (p_state->>'monthly_units')::bigint,
      monitor_limit = (p_state->>'monitor_limit')::integer,
      cancel_at_period_end = (p_state->>'cancel_at_period_end')::boolean,
      reconciled_at = clock_timestamp()
    where stripe_customer_id = p_customer_id and sync_revision = p_revision
      and sync_locked_until > clock_timestamp() returning 1
  ) select exists(select 1 from changed)
$$;
revoke all on function public.finish_subscription_sync(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.finish_subscription_sync(text, bigint, jsonb) to service_role;
revoke all on function public.begin_subscription_sync(text), public.release_subscription_sync(text, bigint)
  from public, anon, authenticated;
grant execute on function public.begin_subscription_sync(text), public.release_subscription_sync(text, bigint) to service_role;
commit;
