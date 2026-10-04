begin;
create function public.begin_subscription_sync(p_customer_id text) returns bigint
language sql security definer set search_path = '' as $$
  update public.workspace_billing set sync_revision = sync_revision + 1
    where stripe_customer_id = p_customer_id returning sync_revision
$$;
revoke all on function public.begin_subscription_sync(text) from public, anon, authenticated;
grant execute on function public.begin_subscription_sync(text) to service_role;
commit;
