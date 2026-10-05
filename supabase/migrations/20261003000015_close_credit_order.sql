begin;
-- Service verifies current Stripe state before closing an unpaid checkout.
-- A concurrent paid fulfillment wins over a stale failure/expiry observation.
create function public.close_credit_order(p_order uuid, p_session text, p_state text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if p_state not in ('expired', 'failed') or p_state is null
    or p_session is null or p_session not like 'cs_%' then
    raise exception 'Invalid unpaid checkout closure' using errcode = '23514';
  end if;
  update public.credit_orders set state = p_state, session_id = p_session
    where id = p_order and state = 'pending'
      and (session_id is null or session_id = p_session);
  get diagnostics changed = row_count;
  return changed = 1;
end $$;
revoke all on function public.close_credit_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.close_credit_order(uuid, text, text) to service_role;
commit;
